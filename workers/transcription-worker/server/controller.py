from __future__ import annotations

import traceback
import threading
import time
from datetime import datetime, timezone
from typing import Any

from .config import Config, public_config
from .crm import CrmApiError, CrmClient
from .events import EventBroker
from .pipeline import PipelineRunner, dependency_status
from .redaction import redact_text, redact_value
from .state_machine import stage_status
from .store import WorkerStore, utc_now


def _call_id(job: dict[str, Any]) -> str | None:
    call = job.get("call") or {}
    value = call.get("id") or job.get("telephonyCallId")
    return str(value) if value else None


def _elapsed_ms(started_at: str | None) -> int | None:
    if not started_at:
        return None
    try:
        started = datetime.fromisoformat(started_at)
    except ValueError:
        return None
    return int((datetime.now(timezone.utc) - started).total_seconds() * 1000)


class DashboardError(RuntimeError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class WorkerController:
    def __init__(
        self,
        config: Config,
        store: WorkerStore,
        broker: EventBroker,
        crm_client: CrmClient | None = None,
        pipeline: PipelineRunner | None = None,
    ):
        self.config = config
        self.store = store
        self.broker = broker
        self.crm = crm_client or CrmClient(config.crm_api_url, config.crm_worker_token)
        self.pipeline = pipeline or PipelineRunner(config)
        self._busy = False
        self._busy_lock = threading.Lock()
        self._stop = threading.Event()
        self._poll_thread: threading.Thread | None = None
        self._crm_connection_status = "unknown"
        self._crm_connection_error: str | None = None
        self._crm_queue_snapshot: dict[str, Any] = {
            "items": [],
            "totals": {
                "completedToday": 0,
                "failed": 0,
                "processing": 0,
                "queued": 0,
                "total": 0,
                "untranscribedInCrm": 0,
            },
        }
        self._crm_queue_loaded_at = 0.0
        self.set_polling_running(not config.start_paused)

    def start_background_polling(self) -> None:
        if self._poll_thread and self._poll_thread.is_alive():
            return
        self._poll_thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._poll_thread.start()

    def stop(self) -> None:
        self._stop.set()

    def set_polling_running(self, running: bool) -> dict[str, Any]:
        self.store.set_control("polling", "running" if running else "paused")
        self._publish_snapshot()
        return self.status()

    def polling_status(self) -> str:
        return self.store.get_control("polling", "running")

    def status(self) -> dict[str, Any]:
        deps = dependency_status(self.config)
        current_job = self.store.get_current_job()
        crm_queue = self._get_crm_queue_snapshot()
        return {
            "config": public_config(self.config),
            "connection": {
                "crm": self._crm_connection_status,
                "error": self._crm_connection_error,
            },
            "crmQueue": crm_queue,
            "currentJob": current_job,
            "dependencies": deps,
            "events": self.store.get_events(limit=40),
            "counters": self.store.counters(),
            "polling": {
                "busy": self._busy,
                "intervalSeconds": self.config.poll_interval_seconds,
                "status": self.polling_status(),
            },
        }

    def list_jobs(self, status: str | None = None) -> list[dict[str, Any]]:
        return self.store.get_jobs(limit=150, status=status)

    def _get_crm_queue_snapshot(self, force: bool = False) -> dict[str, Any]:
        if not self.config.crm_worker_token:
            return self._crm_queue_snapshot
        now = time.monotonic()
        if not force and now - self._crm_queue_loaded_at < 8:
            return self._crm_queue_snapshot
        try:
            self._crm_queue_snapshot = self.crm.queue()
            self._crm_queue_loaded_at = now
        except Exception as error:
            self._set_crm_connection("error", str(error))
        return self._crm_queue_snapshot

    def get_job(self, job_id: int) -> dict[str, Any]:
        job = self.store.get_job(job_id)
        if not job:
            raise DashboardError("Job not found", status=404)
        return job

    def claim_one_async(self, source: str = "manual") -> dict[str, Any]:
        with self._busy_lock:
            if self._busy:
                raise DashboardError("Worker is already processing a job", status=409)
            self._busy = True
        thread = threading.Thread(target=self._claim_and_process, args=(source,), daemon=True)
        thread.start()
        self._publish_snapshot()
        return {"accepted": True, "source": source}

    def retry_job_async(self, local_job_id: int) -> dict[str, Any]:
        job = self.get_job(local_job_id)
        if job["status"] != "failed":
            raise DashboardError("Retry is only available for failed jobs", status=409)
        if not job.get("crmJobId"):
            raise DashboardError("Job has no CRM job id", status=409)
        with self._busy_lock:
            if self._busy:
                raise DashboardError("Worker is already processing a job", status=409)
            self._busy = True
        thread = threading.Thread(target=self._retry_and_process, args=(job,), daemon=True)
        thread.start()
        self._publish_snapshot()
        return {"accepted": True, "jobId": local_job_id}

    def _publish_snapshot(self) -> None:
        self.broker.publish("snapshot", self.status())

    def _poll_loop(self) -> None:
        while not self._stop.is_set():
            if self.polling_status() == "running" and not self._busy:
                try:
                    self.claim_one_async(source="poll")
                except DashboardError:
                    pass
            self._stop.wait(self.config.poll_interval_seconds)

    def _set_crm_connection(self, status: str, error: str | None = None) -> None:
        self._crm_connection_status = status
        self._crm_connection_error = redact_text(error, [self.config.crm_worker_token or ""]) if error else None

    def _global_event(self, stage: str, message: str | None = None, details: dict[str, Any] | None = None) -> None:
        payload = self.store.add_event(
            stage=stage,
            message=message,
            details=redact_value(details or {}, [self.config.crm_worker_token or ""]),
            job_id=None,
        )
        self.broker.publish("worker_event", payload)
        self._publish_snapshot()

    def _job_event(
        self,
        local_job_id: int,
        stage: str,
        message: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        safe_details = redact_value(details or {}, [self.config.crm_worker_token or ""])
        status = stage_status(stage)
        update: dict[str, Any] = {"current_stage": stage}
        if status:
            update["status"] = status
        if stage == "ffmpeg_preprocess" and "codec" in safe_details:
            update.update(
                {
                    "audio_channel_layout": safe_details.get("channelLayout"),
                    "audio_channels": safe_details.get("channels"),
                    "audio_codec": safe_details.get("codec"),
                    "audio_duration_seconds": safe_details.get("durationSeconds"),
                    "ffprobe_json": safe_details,
                }
            )
        elif stage == "ffmpeg_preprocess" and "mode" in safe_details:
            update["channel_mapping_json"] = {
                "administrator": self.config.channel_admin,
                "client": self.config.channel_client,
                "split": safe_details,
            }
        elif stage == "merging_segments":
            update["asr_segments_count"] = safe_details.get("segments")
        elif stage == "uploading_result":
            update["submit_status"] = "completed"
        elif stage == "completed":
            job = self.store.get_job(local_job_id) or {}
            update["completed_at"] = utc_now()
            update["processing_time_ms"] = _elapsed_ms(job.get("startedAt"))
        elif stage == "failed":
            job = self.store.get_job(local_job_id) or {}
            update["completed_at"] = utc_now()
            update["processing_time_ms"] = _elapsed_ms(job.get("startedAt"))

        self.store.update_job(local_job_id, **update)
        payload = self.store.add_event(
            stage=stage,
            message=message,
            details=safe_details,
            job_id=local_job_id,
        )
        self.broker.publish("worker_event", payload)
        self._publish_snapshot()

    def _connect_crm(self) -> None:
        self._global_event("crm_connecting", "Checking CRM connection", {"url": self.config.crm_api_url})
        try:
            self.crm.health()
            self._set_crm_connection("connected")
            self._global_event("crm_connected", "CRM connection is healthy")
        except Exception as error:
            self._set_crm_connection("error", str(error))
            raise

    def _claim_and_process(self, source: str) -> None:
        local_job_id: int | None = None
        try:
            self._connect_crm()
            self._global_event("waiting_in_crm", "Checking CRM transcription queue", {"source": source})
            claimed = self.crm.claim_job(self.config.worker_id)
            job = claimed.get("job") if claimed else None
            if not job:
                self._global_event("waiting_in_crm", "No transcription jobs available", {"source": source})
                self._get_crm_queue_snapshot(force=True)
                return

            local_job = self.store.create_job(job, self.config.whisper_model, self.config.whisper_model_path)
            self._get_crm_queue_snapshot(force=True)
            local_job_id = local_job["id"]
            self._job_event(
                local_job_id,
                "claimed",
                "Job claimed",
                {
                    "callId": _call_id(job),
                    "crmJobId": job.get("id"),
                    "recordingStatus": (job.get("call") or {}).get("recordingStatus"),
                },
            )
            self._process_claimed_job(local_job_id, job)
        except Exception as error:
            if local_job_id is None:
                self._global_event("failed", "Claim failed", {"error": str(error)})
            else:
                self._fail_local_job(local_job_id, error)
        finally:
            with self._busy_lock:
                self._busy = False
            self._publish_snapshot()

    def _retry_and_process(self, failed_job: dict[str, Any]) -> None:
        local_job_id: int | None = None
        try:
            self._connect_crm()
            self._global_event(
                "waiting_in_crm",
                "Retrying failed CRM transcription job",
                {"localJobId": failed_job["id"], "crmJobId": failed_job["crmJobId"]},
            )
            retry_payload = self.crm.retry_job(failed_job["crmJobId"], self.config.worker_id)
            job = retry_payload.get("job") if retry_payload else None
            if not job:
                claimed = self.crm.claim_job(self.config.worker_id)
                job = claimed.get("job") if claimed else None
            if not job:
                raise DashboardError("CRM retry did not return a job and claim returned no tasks", status=409)
            local_job = self.store.create_job(job, self.config.whisper_model, self.config.whisper_model_path)
            local_job_id = local_job["id"]
            self._job_event(
                local_job_id,
                "claimed",
                "Retried job claimed",
                {"retryOfLocalJobId": failed_job["id"], "crmJobId": job.get("id"), "callId": _call_id(job)},
            )
            self._process_claimed_job(local_job_id, job)
        except Exception as error:
            if local_job_id is None:
                self._global_event("failed", "Retry failed", {"error": str(error)})
            else:
                self._fail_local_job(local_job_id, error)
        finally:
            with self._busy_lock:
                self._busy = False
            self._publish_snapshot()

    def _process_claimed_job(self, local_job_id: int, job: dict[str, Any]) -> None:
        self._job_event(local_job_id, "downloading_audio", "Requesting recording reference")
        audio_reference = self.crm.audio_reference(job["id"])
        result = self.pipeline.run(
            job,
            audio_reference,
            lambda stage, message=None, details=None: self._job_event(local_job_id, stage, message, details),
        )
        self._job_event(local_job_id, "uploading_result", "Submitting transcript to CRM")
        self.crm.complete_job(job["id"], result["transcript"])
        self._get_crm_queue_snapshot(force=True)
        self._job_event(local_job_id, "uploading_result", "Transcript submitted to CRM")
        self._job_event(local_job_id, "completed", "Job completed")

    def _fail_local_job(self, local_job_id: int, error: Exception) -> None:
        stack = redact_text(traceback.format_exc(), [self.config.crm_worker_token or ""])
        summary = redact_text(str(error), [self.config.crm_worker_token or ""])
        self.store.update_job(
            local_job_id,
            error_summary=summary[:1000],
            error_stack=stack[:6000],
            status="failed",
        )
        self._job_event(local_job_id, "failed", "Job failed", {"error": summary})
        job = self.store.get_job(local_job_id)
        crm_job_id = job.get("crmJobId") if job else None
        if crm_job_id:
            try:
                self.crm.fail_job(crm_job_id, summary[:4000])
            except (CrmApiError, RuntimeError) as fail_error:
                self._job_event(
                    local_job_id,
                    "failed",
                    "CRM fail API error",
                    {"error": str(fail_error)},
                )
