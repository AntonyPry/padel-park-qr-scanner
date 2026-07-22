import unittest
from types import SimpleNamespace
from unittest.mock import patch

from server.controller import DashboardError, WorkerController
from server.crm import CrmApiError


class FakeStore:
    def __init__(self):
        self.updates = []

    def update_job(self, job_id, **values):
        self.updates.append((job_id, values))


class RateLimitControllerTest(unittest.TestCase):
    def test_retry_after_creates_bounded_claim_retry_and_queue_backoff(self):
        controller = object.__new__(WorkerController)
        controller._crm_rate_limit_until = 0.0
        controller._crm_queue_snapshot = {"items": [], "totals": {"queued": 0}}
        controller._crm_queue_loaded_at = 0.0
        controller.config = SimpleNamespace(crm_worker_token="worker-secret")
        queue_calls = []
        controller.crm = SimpleNamespace(queue=lambda: queue_calls.append(True))
        error = CrmApiError(
            "Worker request rate limited",
            status=429,
            retry_after_seconds=300,
        )

        with patch("server.controller.time.monotonic", return_value=100.0):
            self.assertTrue(controller._record_crm_rate_limit(error))
            self.assertEqual(controller._crm_rate_limit_until, 400.0)
        with patch("server.controller.time.monotonic", return_value=101.0):
            with self.assertRaises(DashboardError) as caught:
                controller._require_crm_rate_limit_elapsed()
            self.assertEqual(caught.exception.status, 429)
            self.assertEqual(
                controller._get_crm_queue_snapshot(force=True),
                controller._crm_queue_snapshot,
            )
        self.assertEqual(queue_calls, [])

    def test_rate_limited_claimed_operation_does_not_issue_automatic_fail(self):
        controller = object.__new__(WorkerController)
        controller.config = SimpleNamespace(crm_worker_token="worker-secret")
        controller.store = FakeStore()
        controller._active_jobs = {1: {"id": 77}}
        controller._job_event = lambda *_args, **_kwargs: None
        fail_calls = []
        controller.crm = SimpleNamespace(
            fail_job=lambda *_args, **_kwargs: fail_calls.append(True)
        )

        controller._fail_local_job(
            1,
            CrmApiError(
                "Worker request rate limited",
                status=429,
                retry_after_seconds=17,
            ),
            notify_crm=False,
        )
        self.assertEqual(fail_calls, [])
        self.assertEqual(controller.store.updates[0][1]["status"], "failed")


if __name__ == "__main__":
    unittest.main()
