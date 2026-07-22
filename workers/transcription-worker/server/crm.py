from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

MAX_RETRY_AFTER_SECONDS = 300


def parse_retry_after_seconds(
    value: str | None,
    maximum: int = MAX_RETRY_AFTER_SECONDS,
) -> int | None:
    if (
        not isinstance(value, str)
        or len(value) > 10
        or not value.isascii()
        or not value.isdigit()
    ):
        return None
    if value.startswith("0"):
        return None
    seconds = int(value)
    if seconds < 1:
        return None
    return min(seconds, maximum)


class CrmApiError(RuntimeError):
    def __init__(
        self,
        message: str,
        status: int | None = None,
        retry_after_seconds: int | None = None,
    ):
        super().__init__(message)
        self.status = status
        self.retry_after_seconds = retry_after_seconds


class CrmClient:
    def __init__(self, base_url: str, token: str | None, timeout_seconds: int = 30, worker_instance_id: str | None = None):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout_seconds = timeout_seconds
        self.worker_instance_id = worker_instance_id or "python-worker"

    def _request(self, path: str, method: str = "GET", body: dict[str, Any] | None = None) -> Any:
        if not self.base_url:
            raise CrmApiError("CRM_API_URL is not configured")
        if not self.token:
            raise CrmApiError("CRM_WORKER_TOKEN is not configured")

        data = None
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.token}",
            "X-Worker-Instance-Id": self.worker_instance_id,
            "X-Worker-Protocol-Version": "2",
        }
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        request = urllib.request.Request(
            f"{self.base_url}/{path.lstrip('/')}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = response.read().decode("utf-8")
                if not payload:
                    return None
                return json.loads(payload)
        except urllib.error.HTTPError as error:
            if error.code == 429:
                raise CrmApiError(
                    "CRM request rate limited",
                    status=429,
                    retry_after_seconds=parse_retry_after_seconds(
                        error.headers.get("Retry-After") if error.headers else None
                    ),
                ) from error
            payload = error.read().decode("utf-8", errors="replace")
            message = payload
            try:
                parsed = json.loads(payload)
                message = parsed.get("error") or parsed.get("message") or payload
            except json.JSONDecodeError:
                pass
            raise CrmApiError(
                f"CRM HTTP {error.code}: {message}",
                status=error.code,
            ) from error
        except urllib.error.URLError as error:
            raise CrmApiError(f"CRM connection failed: {error.reason}") from error
        except TimeoutError as error:
            raise CrmApiError("CRM request timed out") from error

    def health(self) -> Any:
        return self._request("/health", method="GET")

    def claim_job(self, worker_id: str) -> dict[str, Any]:
        return self._request(
            "/telephony/transcription-jobs/claim",
            method="POST",
            body={"workerId": worker_id},
        )

    def queue(self) -> dict[str, Any]:
        return self._request(
            "/telephony/transcription-jobs/worker-queue?pageSize=80",
            method="GET",
        )

    @staticmethod
    def _job_request(job: dict[str, Any] | str | int) -> tuple[str | int, dict[str, Any]]:
        if not isinstance(job, dict):
            return job, {}
        lease = job.get("_lease") or {}
        body = {
            key: lease[key]
            for key in ("claimId", "claimToken")
            if lease.get(key)
        }
        return job.get("id"), body

    def audio_reference(self, job: dict[str, Any] | str | int) -> dict[str, Any]:
        job_id, lease = self._job_request(job)
        return self._request(
            f"/telephony/transcription-jobs/{job_id}/audio-reference",
            method="POST",
            body=lease,
        )

    def progress_job(self, job: dict[str, Any] | str | int, stage: str, progress: int, message: str | None = None) -> dict[str, Any]:
        job_id, lease = self._job_request(job)
        return self._request(
            f"/telephony/transcription-jobs/{job_id}/progress",
            method="POST",
            body={**lease, "stage": stage, "progress": progress, "message": message},
        )

    def complete_job(self, job: dict[str, Any] | str | int, payload: dict[str, Any]) -> dict[str, Any]:
        job_id, lease = self._job_request(job)
        return self._request(
            f"/telephony/transcription-jobs/{job_id}/result",
            method="POST",
            body={**payload, **lease},
        )

    def fail_job(self, job: dict[str, Any] | str | int, error_message: str) -> dict[str, Any]:
        job_id, lease = self._job_request(job)
        return self._request(
            f"/telephony/transcription-jobs/{job_id}/fail",
            method="POST",
            body={**lease, "errorMessage": error_message},
        )

    def retry_job(self, job_id: str | int, worker_id: str | None = None) -> dict[str, Any]:
        return self._request(
            f"/telephony/transcription-jobs/{job_id}/worker-retry",
            method="POST",
            body={"workerId": worker_id} if worker_id else {},
        )
