"""Deliver content-free token counters to the persistent usage ledger.

The SQLite outbox retries failed delivery; acknowledged events are removed.
The event id is retained across retries and the server upserts it atomically.
"""
import json
import os
from pathlib import Path
import sqlite3
import threading
import urllib.request
from contextlib import contextmanager


class UsageReporter:
    def __init__(self, url, key, path, send=None):
        self.url, self.key, self.path = url, key, str(path)
        self.send = send or self._send
        self.lock = threading.Lock()
        self.wake = threading.Event()
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, body TEXT NOT NULL)")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        try:
            with db:
                yield db
        finally:
            db.close()

    def record(self, event):
        with self.lock, self.connect() as db:
            db.execute("INSERT OR REPLACE INTO outbox VALUES (?, ?)", (event["id"], json.dumps(event)))
        self.wake.set()

    def _send(self, body):
        req = urllib.request.Request(self.url, data=body.encode(), method="POST", headers={
            "Authorization": "Bearer " + self.key, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status != 200 or json.load(response).get("ok") is not True:
                raise OSError("Usage ledger did not acknowledge the event")

    def flush(self):
        with self.lock, self.connect() as db:
            rows = db.execute("SELECT id, body FROM outbox ORDER BY rowid LIMIT 100").fetchall()
        for event_id, body in rows:
            try:
                self.send(body)
            except Exception:
                print("Usage ledger unavailable; token counters queued for retry", flush=True)
                return False
            with self.lock, self.connect() as db:
                db.execute("DELETE FROM outbox WHERE id = ? AND body = ?", (event_id, body))
        return True

    def worker(self):
        while True:
            self.wake.wait(15)
            self.wake.clear()
            self.flush()


def configured_reporter(environ=os.environ):
    url = environ.get("USAGE_LEDGER_URL", "https://vaelochat.vercel.app/api/usage")
    key = environ.get("USAGE_INGEST_KEY") or environ.get("API_SERVER_KEY", "")
    if not url.startswith("https://") or len(key) < 32:
        return None
    home = Path(environ.get("HERMES_HOME", "/tmp"))
    home.mkdir(parents=True, exist_ok=True)
    reporter = UsageReporter(url, key, home / "usage-outbox.sqlite")
    threading.Thread(target=reporter.worker, daemon=True, name="usage-ledger").start()
    return reporter
