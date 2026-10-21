import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock
from contextlib import contextmanager

spec = importlib.util.spec_from_file_location("usage", Path(__file__).resolve().parents[1] / "cloud/usage.py")
usage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(usage)


class UsageTests(unittest.TestCase):
    def test_worker_survives_database_read_failure_and_delivers_on_retry(self):
        with tempfile.TemporaryDirectory() as folder:
            delivered = []
            reporter = usage.UsageReporter("https://example.test", "secret", Path(folder) / "outbox.sqlite",
                                           send=delivered.append)
            reporter.record({"id": "event-123", "input": 100})
            connect = reporter.connect
            calls = 0

            @contextmanager
            def unavailable_once():
                nonlocal calls
                calls += 1
                if calls == 1:
                    raise usage.sqlite3.OperationalError("database is locked: secret")
                with connect() as db:
                    yield db

            class StopWorker(BaseException):
                pass

            with mock.patch.object(reporter, "connect", unavailable_once), \
                 mock.patch.object(reporter.wake, "wait", side_effect=[True, True, StopWorker]), \
                 mock.patch("builtins.print") as log:
                with self.assertRaises(StopWorker):
                    reporter.worker()
            self.assertEqual([json.loads(body) for body in delivered], [{"id": "event-123", "input": 100}])
            self.assertNotIn("secret", str(log.call_args_list))
            with reporter.connect() as db:
                self.assertEqual(db.execute("SELECT count(*) FROM outbox").fetchone()[0], 0)

    def test_worker_replays_same_id_after_acknowledgement_delete_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            delivered = []
            reporter = usage.UsageReporter("https://example.test", "secret", Path(folder) / "outbox.sqlite",
                                           send=delivered.append)
            reporter.record({"id": "event-123", "input": 100})
            connect = reporter.connect
            calls = 0

            @contextmanager
            def unavailable_delete_once():
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise usage.sqlite3.OperationalError("disk I/O error")
                with connect() as db:
                    yield db

            class StopWorker(BaseException):
                pass

            with mock.patch.object(reporter, "connect", unavailable_delete_once), \
                 mock.patch.object(reporter.wake, "wait", side_effect=[True, True, StopWorker]):
                with self.assertRaises(StopWorker):
                    reporter.worker()
            self.assertEqual(len(delivered), 2)
            self.assertEqual(delivered[0], delivered[1])
            self.assertTrue(reporter.flush())
            self.assertEqual(len(delivered), 2)

    def test_optional_reporter_startup_storage_failure_does_not_abort_relay(self):
        with tempfile.TemporaryDirectory() as folder:
            settings = {"USAGE_LEDGER_URL": "https://example.test", "API_SERVER_KEY": "s" * 40,
                        "HERMES_HOME": folder}
            failures = (mock.patch.object(usage.Path, "mkdir", side_effect=PermissionError("private path")),
                        mock.patch.object(usage, "UsageReporter", side_effect=usage.sqlite3.OperationalError("private database")))
            for failure in failures:
                with failure, \
                     mock.patch.object(usage.threading, "Thread") as thread, \
                     mock.patch("builtins.print") as log:
                    self.assertIsNone(usage.configured_reporter(settings))
                    thread.assert_not_called()
                    self.assertNotIn("private", str(log.call_args_list))

    def test_real_database_delete_failure_rolls_back_and_worker_recovers(self):
        with tempfile.TemporaryDirectory() as folder:
            delivered = []
            reporter = usage.UsageReporter("https://example.test", "secret", Path(folder) / "outbox.sqlite",
                                           send=delivered.append)
            reporter.record({"id": "event-123", "input": 100})
            with reporter.connect() as db:
                db.execute("CREATE TRIGGER fail_delete BEFORE DELETE ON outbox "
                           "BEGIN SELECT RAISE(ABORT, 'temporary storage failure'); END")
            waits = []

            class StopWorker(BaseException):
                pass

            def tick(timeout):
                waits.append(timeout)
                if len(waits) == 2:
                    with reporter.connect() as db:
                        self.assertEqual(db.execute("SELECT count(*) FROM outbox").fetchone()[0], 1)
                        db.execute("DROP TRIGGER fail_delete")
                if len(waits) == 3:
                    raise StopWorker
                return True

            with mock.patch.object(reporter.wake, "wait", side_effect=tick):
                with self.assertRaises(StopWorker):
                    reporter.worker()
            self.assertEqual(waits, [15, 15, 15])
            self.assertEqual(len(delivered), 2)
            self.assertEqual(delivered[0], delivered[1])
            with reporter.connect() as db:
                self.assertEqual(db.execute("SELECT count(*) FROM outbox").fetchone()[0], 0)

    def test_startup_failure_isolated_from_later_healthy_initialization(self):
        with tempfile.TemporaryDirectory() as folder:
            settings = {"USAGE_LEDGER_URL": "https://example.test", "API_SERVER_KEY": "s" * 40,
                        "HERMES_HOME": folder}
            path = Path(folder) / "usage-outbox.sqlite"
            path.mkdir()  # A real SQLite open failure, without permission assumptions.
            with mock.patch.object(usage.threading, "Thread") as thread:
                self.assertIsNone(usage.configured_reporter(settings))
                thread.assert_not_called()
                path.rmdir()
                reporter = usage.configured_reporter(settings)
                self.assertIsInstance(reporter, usage.UsageReporter)
                thread.assert_called_once_with(target=reporter.worker, daemon=True, name="usage-ledger")
                thread.return_value.start.assert_called_once()
                reporter.record({"id": "recovered", "input": 7})
                reporter.send = mock.Mock()
                self.assertTrue(reporter.flush())
                self.assertEqual(json.loads(reporter.send.call_args.args[0])["id"], "recovered")

    def test_bad_http_acknowledgements_retain_counters_until_explicit_success(self):
        with tempfile.TemporaryDirectory() as folder:
            reporter = usage.UsageReporter("https://example.test", "secret", Path(folder) / "outbox.sqlite")
            reporter.record({"id": "event-123", "input": 100})
            bodies = []
            responses = [(201, b'{"ok":true}'), (200, b'{"ok":false}'), (200, b'{}'),
                         (200, b'[]'), (200, b'null'), (200, b'broken'), (200, b'{"ok":true}')]
            for status, body in responses:
                with self.subTest(status=status, body=body):
                    response = io.BytesIO(body)
                    response.status = status
                    def deliver(request, timeout):
                        bodies.append(request.data)
                        self.assertEqual(timeout, 10)
                        return response
                    with mock.patch.object(usage.urllib.request, "urlopen", side_effect=deliver):
                        self.assertEqual(reporter.flush(), body == b'{"ok":true}' and status == 200)
                    self.assertTrue(response.closed)
            self.assertEqual(len(set(bodies)), 1)
            with reporter.connect() as db:
                self.assertEqual(db.execute("SELECT count(*) FROM outbox").fetchone()[0], 0)

    def test_acknowledgement_cannot_delete_counters_updated_during_delivery(self):
        with tempfile.TemporaryDirectory() as folder:
            delivered = []
            reporter = usage.UsageReporter("https://example.test", "secret", Path(folder) / "outbox.sqlite")
            reporter.record({"id": "event-123", "input": 100})
            def send(body):
                delivered.append(json.loads(body))
                if len(delivered) == 1:
                    producer = threading.Thread(target=reporter.record, args=({"id": "event-123", "input": 200},), daemon=True)
                    producer.start()
                    producer.join(timeout=2)
                    self.assertFalse(producer.is_alive(), "network delivery must not hold the queue lock")
            reporter.send = send
            self.assertTrue(reporter.flush())
            self.assertTrue(reporter.flush())
            self.assertTrue(reporter.flush())
            self.assertEqual(delivered, [{"id": "event-123", "input": 100}, {"id": "event-123", "input": 200}])

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
