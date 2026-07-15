import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from server.store import WorkerStore


class TenantWorkerStateTest(unittest.TestCase):
    def test_sqlite_partitions_by_tenant_job_attempt_and_never_persists_lease_or_pii(self):
        with tempfile.TemporaryDirectory() as directory:
            db_path = str(Path(directory) / "worker.sqlite3")
            store = WorkerStore(db_path)
            payload = {
                "id": 77,
                "telephonyCallId": 998877,
                "call": {
                    "id": 998877,
                    "clientPhone": "+7 999 123-45-67",
                    "client": {"name": "Private Client"},
                    "recordingUrl": "https://recordings.invalid/audio?token=private",
                },
                "tenant": {
                    "organizationKey": "org_12345678",
                    "clubKey": "club_12345678",
                },
                "_lease": {
                    "attempt": 3,
                    "claimId": "160dca15-56e8-41df-885f-b91793733f5c",
                    "claimToken": "lease-secret",
                },
                "protocolVersion": 2,
                "status": "processing",
            }
            saved = store.create_job(payload, "small", "/models/model.bin")
            self.assertEqual(saved["organizationKey"], "org_12345678")
            self.assertEqual(saved["clubKey"], "club_12345678")
            self.assertEqual(saved["attempt"], 3)
            self.assertEqual(saved["claimId"], "160dca15-56e8-41df-885f-b91793733f5c")
            self.assertEqual(saved["callId"], "")
            self.assertNotIn("clientPhone", json.dumps(saved["crmJob"]))

            raw_db = Path(db_path).read_bytes()
            for private in [
                b"lease-secret",
                b"Private Client",
                b"999 123",
                b"recordings.invalid",
                b"998877",
            ]:
                self.assertNotIn(private, raw_db)

            with self.assertRaises(sqlite3.IntegrityError):
                store.create_job(payload, "small", "/models/model.bin")

            next_attempt = {
                **payload,
                "_lease": {**payload["_lease"], "attempt": 4, "claimId": "260dca15-56e8-41df-885f-b91793733f5c"},
            }
            other = store.create_job(next_attempt, "small", "/models/model.bin")
            self.assertEqual(other["attempt"], 4)


if __name__ == "__main__":
    unittest.main()
