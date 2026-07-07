from __future__ import annotations

from dataclasses import dataclass


STAGES = [
    "waiting_in_crm",
    "queued",
    "claimed",
    "downloading_audio",
    "ffmpeg_preprocess",
    "transcribing_admin_channel",
    "transcribing_client_channel",
    "transcribing_unknown_channel",
    "merging_segments",
    "uploading_result",
    "completed",
    "failed",
]

TERMINAL_STATUSES = {"completed", "failed"}


@dataclass
class JobState:
    status: str = "queued"
    current_stage: str | None = None


class JobStateMachine:
    def __init__(self, state: JobState | None = None):
        self.state = state or JobState()

    def apply(self, stage: str) -> JobState:
        if stage not in STAGES:
            raise ValueError(f"Unknown stage: {stage}")
        if self.state.status in TERMINAL_STATUSES and stage not in {"completed", "failed"}:
            raise ValueError("Cannot move terminal job to a non-terminal stage")

        self.state.current_stage = stage
        if stage == "queued":
            self.state.status = "queued"
        elif stage == "claimed":
            self.state.status = "processing"
        elif stage == "completed":
            self.state.status = "completed"
        elif stage == "failed":
            self.state.status = "failed"

        return self.state


def stage_status(stage: str) -> str | None:
    if stage == "queued":
        return "queued"
    if stage == "claimed":
        return "processing"
    if stage == "completed":
        return "completed"
    if stage == "failed":
        return "failed"
    return None
