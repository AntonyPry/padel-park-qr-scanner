from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _load_json(value: str | None, default: Any = None) -> Any:
    if not value:
        return default


def _safe_crm_job(job_payload: dict[str, Any]) -> dict[str, Any]:
    tenant = job_payload.get("tenant") or {}
    return {
        "id": job_payload.get("id"),
        "status": job_payload.get("status"),
        "progress": job_payload.get("progress"),
        "progressStage": job_payload.get("progressStage"),
        "attempts": job_payload.get("attempts"),
        "tenant": {
            "organizationKey": tenant.get("organizationKey"),
            "clubKey": tenant.get("clubKey"),
        },
    }
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


class WorkerStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._migrate()

    def _migrate(self) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  crm_job_id TEXT,
                  call_id TEXT,
                  organization_key TEXT,
                  club_key TEXT,
                  attempt INTEGER,
                  claim_id TEXT,
                  protocol_version INTEGER,
                  status TEXT NOT NULL,
                  current_stage TEXT,
                  recording_status TEXT,
                  audio_duration_seconds REAL,
                  audio_channels INTEGER,
                  audio_codec TEXT,
                  audio_channel_layout TEXT,
                  model TEXT,
                  model_path TEXT,
                  started_at TEXT,
                  completed_at TEXT,
                  processing_time_ms INTEGER,
                  error_summary TEXT,
                  error_stack TEXT,
                  ffprobe_json TEXT,
                  channel_mapping_json TEXT,
                  asr_segments_count INTEGER,
                  submit_status TEXT,
                  crm_job_json TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                )
                """
            )
            existing_columns = {
                row["name"] for row in self._conn.execute("PRAGMA table_info(jobs)").fetchall()
            }
            for column, definition in {
                "organization_key": "TEXT",
                "club_key": "TEXT",
                "attempt": "INTEGER",
                "claim_id": "TEXT",
                "protocol_version": "INTEGER",
            }.items():
                if column not in existing_columns:
                    self._conn.execute(f"ALTER TABLE jobs ADD COLUMN {column} {definition}")
            self._conn.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS jobs_tenant_attempt_unique
                ON jobs(organization_key, club_key, crm_job_id, attempt)
                WHERE organization_key IS NOT NULL AND club_key IS NOT NULL AND attempt IS NOT NULL
                """
            )
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  job_id INTEGER,
                  stage TEXT NOT NULL,
                  message TEXT,
                  details_json TEXT,
                  created_at TEXT NOT NULL,
                  FOREIGN KEY(job_id) REFERENCES jobs(id)
                )
                """
            )
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS control (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                )
                """
            )

    def set_control(self, key: str, value: str) -> None:
        now = utc_now()
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT INTO control(key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (key, value, now),
            )

    def get_control(self, key: str, default: str) -> str:
        with self._lock:
            row = self._conn.execute("SELECT value FROM control WHERE key = ?", (key,)).fetchone()
        return str(row["value"]) if row else default

    def create_job(self, job_payload: dict[str, Any], model: str, model_path: str) -> dict[str, Any]:
        now = utc_now()
        call = job_payload.get("call") or {}
        crm_job_id = str(job_payload.get("id") or "")
        tenant = job_payload.get("tenant") or {}
        lease = job_payload.get("_lease") or {}
        call_id = "" if tenant else str(call.get("id") or job_payload.get("telephonyCallId") or "")
        with self._lock, self._conn:
            cursor = self._conn.execute(
                """
                INSERT INTO jobs(
                  crm_job_id, call_id, organization_key, club_key, attempt, claim_id,
                  protocol_version, status, current_stage, recording_status,
                  model, model_path, started_at, crm_job_json, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 'claimed', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    crm_job_id,
                    call_id,
                    tenant.get("organizationKey"),
                    tenant.get("clubKey"),
                    lease.get("attempt"),
                    lease.get("claimId"),
                    job_payload.get("protocolVersion"),
                    call.get("recordingStatus"),
                    model,
                    model_path,
                    now,
                    _json(_safe_crm_job(job_payload)),
                    now,
                    now,
                ),
            )
            job_id = int(cursor.lastrowid)
        return self.get_job(job_id) or {}

    def update_job(self, job_id: int, **fields: Any) -> dict[str, Any]:
        if not fields:
            return self.get_job(job_id) or {}

        fields["updated_at"] = utc_now()
        allowed = {
            "asr_segments_count",
            "audio_channel_layout",
            "audio_channels",
            "audio_codec",
            "audio_duration_seconds",
            "channel_mapping_json",
            "completed_at",
            "current_stage",
            "error_stack",
            "error_summary",
            "ffprobe_json",
            "processing_time_ms",
            "recording_status",
            "status",
            "submit_status",
            "updated_at",
        }
        assignments = []
        values = []
        for key, value in fields.items():
            if key not in allowed:
                continue
            assignments.append(f"{key} = ?")
            if key.endswith("_json") and not isinstance(value, str):
                values.append(_json(value))
            else:
                values.append(value)
        if not assignments:
            return self.get_job(job_id) or {}

        values.append(job_id)
        with self._lock, self._conn:
            self._conn.execute(
                f"UPDATE jobs SET {', '.join(assignments)} WHERE id = ?",
                values,
            )
        return self.get_job(job_id) or {}

    def add_event(
        self,
        stage: str,
        message: str | None = None,
        details: dict[str, Any] | None = None,
        job_id: int | None = None,
    ) -> dict[str, Any]:
        now = utc_now()
        with self._lock, self._conn:
            cursor = self._conn.execute(
                """
                INSERT INTO events(job_id, stage, message, details_json, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (job_id, stage, message, _json(details or {}), now),
            )
            event_id = int(cursor.lastrowid)
        event = {
            "id": event_id,
            "jobId": job_id,
            "stage": stage,
            "message": message,
            "details": details or {},
            "createdAt": now,
        }
        return event

    def get_job(self, job_id: int) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            return None
        job = self._row_to_job(row)
        job["events"] = self.get_events(job_id=job_id, limit=500)
        return job

    def get_jobs(self, limit: int = 100, status: str | None = None) -> list[dict[str, Any]]:
        sql = "SELECT * FROM jobs"
        values: list[Any] = []
        if status:
            sql += " WHERE status = ?"
            values.append(status)
        sql += " ORDER BY id DESC LIMIT ?"
        values.append(limit)
        with self._lock:
            rows = self._conn.execute(sql, values).fetchall()
        return [self._row_to_job(row) for row in rows]

    def get_events(self, job_id: int | None = None, limit: int = 100) -> list[dict[str, Any]]:
        values: list[Any] = []
        sql = "SELECT * FROM events"
        if job_id is not None:
            sql += " WHERE job_id = ?"
            values.append(job_id)
        sql += " ORDER BY id DESC LIMIT ?"
        values.append(limit)
        with self._lock:
            rows = self._conn.execute(sql, values).fetchall()
        events = [self._row_to_event(row) for row in rows]
        events.reverse()
        return events

    def get_current_job(self) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                """
                SELECT * FROM jobs
                WHERE status = 'processing'
                ORDER BY id DESC
                LIMIT 1
                """
            ).fetchone()
        return self._row_to_job(row) if row else None

    def counters(self) -> dict[str, Any]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT status, COUNT(*) AS count FROM jobs GROUP BY status"
            ).fetchall()
            avg_row = self._conn.execute(
                """
                SELECT AVG(processing_time_ms) AS avg_ms FROM jobs
                WHERE status = 'completed' AND processing_time_ms IS NOT NULL
                """
            ).fetchone()
        counters = {"queued": 0, "processing": 0, "completed": 0, "failed": 0}
        for row in rows:
            counters[str(row["status"])] = int(row["count"])
        counters["averageProcessingTimeMs"] = (
            int(avg_row["avg_ms"]) if avg_row and avg_row["avg_ms"] is not None else None
        )
        return counters

    def _row_to_event(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": int(row["id"]),
            "jobId": row["job_id"],
            "stage": row["stage"],
            "message": row["message"],
            "details": _load_json(row["details_json"], {}),
            "createdAt": row["created_at"],
        }

    def _row_to_job(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": int(row["id"]),
            "crmJobId": row["crm_job_id"],
            "callId": row["call_id"],
            "organizationKey": row["organization_key"],
            "clubKey": row["club_key"],
            "attempt": row["attempt"],
            "claimId": row["claim_id"],
            "protocolVersion": row["protocol_version"],
            "status": row["status"],
            "currentStage": row["current_stage"],
            "recordingStatus": row["recording_status"],
            "audioDurationSeconds": row["audio_duration_seconds"],
            "audioChannels": row["audio_channels"],
            "audioCodec": row["audio_codec"],
            "audioChannelLayout": row["audio_channel_layout"],
            "model": row["model"],
            "modelPath": row["model_path"],
            "startedAt": row["started_at"],
            "completedAt": row["completed_at"],
            "processingTimeMs": row["processing_time_ms"],
            "errorSummary": row["error_summary"],
            "errorStack": row["error_stack"],
            "ffprobe": _load_json(row["ffprobe_json"], None),
            "channelMapping": _load_json(row["channel_mapping_json"], None),
            "asrSegmentsCount": row["asr_segments_count"],
            "submitStatus": row["submit_status"],
            "crmJob": _load_json(row["crm_job_json"], None),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
