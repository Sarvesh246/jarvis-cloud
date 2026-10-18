import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("usage", Path(__file__).resolve().parents[1] / "cloud/usage.py")
usage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(usage)


class UsageTests(unittest.TestCase):
    def test_outage_restart_and_retry_keep_one_event_id(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "outbox.sqlite"
            def offline(body):
                raise OSError("offline")
            reporter = usage.UsageReporter("https://example.test", "key", path, send=offline)
            reporter.record({"id": "event-123", "input": 100})
            reporter.record({"id": "event-123", "input": 100})
            self.assertFalse(reporter.flush())
            delivered = []
            recovered = usage.UsageReporter("https://example.test", "key", path, send=delivered.append)
            self.assertTrue(recovered.flush())
            self.assertTrue(recovered.flush())
            self.assertEqual([json.loads(body) for body in delivered], [{"id": "event-123", "input": 100}])


if __name__ == "__main__":
    unittest.main()
