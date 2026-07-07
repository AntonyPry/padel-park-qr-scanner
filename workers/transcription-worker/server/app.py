from __future__ import annotations

import json
import mimetypes
import queue
import re
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .config import load_quality_config, read_config, public_config
from .controller import DashboardError, WorkerController
from .crm import CrmClient
from .events import EventBroker, sse_frame
from .redaction import redact_text
from .store import WorkerStore


ROOT_DIR = Path(__file__).resolve().parents[1]
CLIENT_DIR = ROOT_DIR / "client"


def json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def parse_job_id(path: str, suffix: str = "") -> int | None:
    pattern = rf"^/api/jobs/(\d+){re.escape(suffix)}$"
    match = re.match(pattern, path)
    if not match:
        return None
    return int(match.group(1))


class DashboardHandler(BaseHTTPRequestHandler):
    controller: WorkerController
    broker: EventBroker

    server_version = "PadelParkTranscriptionDashboard/0.1"

    def handle(self) -> None:
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def finish(self) -> None:
        try:
            super().finish()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, fmt: str, *args: Any) -> None:
        message = redact_text(fmt % args, [self.controller.config.crm_worker_token or ""])
        sys.stderr.write(f"{self.address_string()} - {message}\n")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/health":
                self._send_json({"status": "ok", "service": "transcription-dashboard"})
            elif parsed.path == "/api/status":
                self._send_json(self.controller.status())
            elif parsed.path == "/api/config":
                self._send_json(public_config(self.controller.config))
            elif parsed.path == "/api/jobs":
                status = parse_qs(parsed.query).get("status", [None])[0]
                self._send_json({"items": self.controller.list_jobs(status=status)})
            elif parsed.path == "/api/events":
                self._serve_sse()
            elif (job_id := parse_job_id(parsed.path)) is not None:
                self._send_json(self.controller.get_job(job_id))
            else:
                self._serve_static(parsed.path)
        except DashboardError as error:
            self._send_json({"error": str(error)}, status=error.status)
        except Exception as error:
            self._send_json({"error": str(error)}, status=500)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/control/start":
                self._send_json(self.controller.set_polling_running(True))
            elif parsed.path == "/api/control/pause":
                self._send_json(self.controller.set_polling_running(False))
            elif parsed.path == "/api/control/claim-one":
                self._send_json(self.controller.claim_one_async(source="manual"), status=202)
            elif (job_id := parse_job_id(parsed.path, "/retry")) is not None:
                self._send_json(self.controller.retry_job_async(job_id), status=202)
            else:
                self._send_json({"error": "Not found"}, status=404)
        except DashboardError as error:
            self._send_json({"error": str(error)}, status=error.status)
        except Exception as error:
            self._send_json({"error": str(error)}, status=500)

    def _send_json(self, payload: Any, status: int = 200) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_sse(self) -> None:
        subscriber = self.broker.subscribe()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            self.wfile.write(sse_frame("snapshot", self.controller.status()))
            self.wfile.flush()
            while True:
                try:
                    event = subscriber.get(timeout=20)
                    self.wfile.write(sse_frame(event["type"], event["payload"]))
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            self.broker.unsubscribe(subscriber)

    def _serve_static(self, path: str) -> None:
        target = "index.html" if path in {"/", ""} else path.lstrip("/")
        file_path = (CLIENT_DIR / target).resolve()
        if CLIENT_DIR.resolve() not in file_path.parents and file_path != CLIENT_DIR.resolve():
            self._send_json({"error": "Not found"}, status=404)
            return
        if not file_path.exists() or not file_path.is_file():
            file_path = CLIENT_DIR / "index.html"
        content = file_path.read_bytes()
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        if file_path.suffix == ".js":
            content_type = "application/javascript; charset=utf-8"
        elif file_path.suffix in {".html", ".css"}:
            content_type = f"{content_type}; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def create_server() -> ThreadingHTTPServer:
    config = load_quality_config(read_config())
    store = WorkerStore(config.state_db_path)
    broker = EventBroker()
    controller = WorkerController(
        config=config,
        store=store,
        broker=broker,
        crm_client=CrmClient(config.crm_api_url, config.crm_worker_token),
    )
    controller.start_background_polling()
    DashboardHandler.controller = controller
    DashboardHandler.broker = broker
    return ThreadingHTTPServer((config.dashboard_bind_host, config.dashboard_port), DashboardHandler)


def main() -> None:
    server = create_server()
    config = DashboardHandler.controller.config
    print(f"Transcription dashboard listening on {config.dashboard_url}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        DashboardHandler.controller.stop()
        server.server_close()


if __name__ == "__main__":
    main()
