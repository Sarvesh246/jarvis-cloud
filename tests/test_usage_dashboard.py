from contextlib import closing
from datetime import datetime, timezone
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("usage_dashboard", Path(__file__).resolve().parents[1] /
                                              "deploy/usage-dashboard/sync.py")
dashboard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dashboard)


class DashboardUsageTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        root = Path(self.folder.name)
        self.config = {"url": "https://example.test/api/session?resource=usage", "readKey": "private-read-key",
                       "database": str(root / "local.sqlite"), "output": str(root / "snapshot.json")}
        with closing(sqlite3.connect(self.config["database"])) as db:
            db.execute("CREATE TABLE request_hourly (hour TEXT, input_tokens INTEGER, output_tokens INTEGER)")
            db.executemany("INSERT INTO request_hourly VALUES (?,?,?)", [
                ("2026-10-18 20:00:00", 100, 20), ("2026-09-18 20:00:00", 500, 50)])
            db.commit()
        self.clock = mock.patch.object(dashboard, "datetime")
        clock = self.clock.start()
        clock.now.return_value = datetime(2026, 10, 18, 20, tzinfo=timezone.utc)
        self.addCleanup(self.clock.stop)

    def test_refresh_fetches_cloud_and_publishes_only_current_month_counters(self):
        cloud = {"month": "2026-10", "total": 60, "checkedAt": "2026-10-18T20:00:00Z"}
        with mock.patch.object(dashboard.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(cloud).encode())) as fetch:
            result = dashboard.refresh(self.config)
        self.assertTrue(result["cloudAvailable"])
        self.assertEqual(result["local"]["total"], 120)
        self.assertEqual(fetch.call_args.args[0].full_url, self.config["url"] + "&month=2026-10")
        output = Path(self.config["output"]).read_text()
        self.assertNotIn(self.config["readKey"], output)
        self.assertEqual(json.loads(output)["cloud"]["total"], 60)
        self.assertEqual(list(Path(self.folder.name).glob("usage-*.tmp")), [])

    def test_failed_sync_preserves_last_known_counts_with_an_unavailable_flag(self):
        previous = {"month": "2026-10", "cloud": {"month": "2026-10", "total": 60}}
        Path(self.config["output"]).write_text(json.dumps(previous))
        with mock.patch.object(dashboard.urllib.request, "urlopen", side_effect=OSError("offline")):
            result = dashboard.refresh(self.config)
        self.assertFalse(result["cloudAvailable"])
        self.assertEqual(result["cloud"]["total"], 60)
        previous["month"] = "2026-09"
        with mock.patch.object(dashboard.urllib.request, "urlopen", side_effect=OSError("offline")):
            self.assertNotIn("cloud", dashboard.snapshot(self.config, previous))


if __name__ == "__main__":
    unittest.main()
