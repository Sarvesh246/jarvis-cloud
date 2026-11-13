"""Optional shared run journal. Never restarts a tool-bearing request after a crash.

The relay keeps serving its in-memory stream while a worker batches numbered frames.
A restarted relay replays saved frames and explicitly ends an interrupted reply.
"""
import json
import os
import threading
import time
from urllib.request import Request, urlopen


class RunJournal:
    def __init__(self, url, key, max_pending_bytes=16 * 1024 * 1024):
        if not url.startswith("https://") or len(key) < 32:
            raise ValueError("Run storage needs an HTTPS URL and a separate 32-character key")
        self.url, self.key = url, key
        self.condition = threading.Condition()
        self.pending = {}
        self.pending_bytes = 0
        self.max_pending_bytes = max_pending_bytes
        self.disabled = {}
        self.worker = threading.Thread(target=self._work, daemon=True, name="vaelo-journal")
        self.worker.start()

    def request(self, method, value):
        request = Request(self.url, data=json.dumps(value).encode(), method=method,
                          headers={"Authorization": "Bearer " + self.key, "Content-Type": "application/json"})
        with urlopen(request, timeout=5) as response:
            return json.load(response)

    def load(self, run_id, owner):
        after, frames, metadata = -1, [], None
        while True:
            if len(frames) > 100000 or sum(map(len, frames)) > 12 * 1024 * 1024:
                raise ValueError("Saved run exceeds the recovery budget")
            result = self.request("POST", {"action": "read", "id": run_id, "owner": owner, "after": after})
            if not result.get("run"):
                return None
            metadata = result["run"]
            batch = result.get("frames", [])
            frames.extend(item["frame"].encode() for item in batch)
            if not result.get("more"):
                return {**metadata, "frames": frames}
            after = batch[-1]["seq"]

    def create(self, run):
        # Acknowledged before generation: a retried start cannot repeat tools.
        self.request("POST", {"action": "create", "id": run.id, "owner": run.owner, "created": run.created})

    def append(self, run, seq, frame):
        key = (run.id, run.owner)
        with self.condition:
            now = time.monotonic()
            self.disabled = {key: at for key, at in self.disabled.items() if now - at < 3600}
            if key in self.disabled:
                return
            if self.pending_bytes + len(frame) > self.max_pending_bytes:
                previous = self.pending.pop(key, None)
                self.pending_bytes -= previous["bytes"] if previous else 0
                self.disabled[key] = time.monotonic()
                return  # A missing terminal checkpoint recovers as interrupted.
            entry = self.pending.setdefault(key, {"frames": [], "bytes": 0, "done": False, "outcome": "running"})
            entry["frames"].append({"seq": seq, "frame": frame.decode()})
            entry["bytes"] += len(frame)
            self.pending_bytes += len(frame)
            self.condition.notify_all()

    def finish(self, run):
        key = (run.id, run.owner)
        with self.condition:
            if key in self.disabled:
                self.disabled.pop(key, None)
                return
            entry = self.pending.setdefault(key, {"frames": [], "bytes": 0})
            entry.update(done=True, outcome=run.outcome)
            self.condition.notify_all()

    def _work(self):
        while True:
            with self.condition:
                self.condition.wait_for(lambda: bool(self.pending))
                # One small batch rather than one database request per token.
                deadline = time.monotonic() + 0.25
                while time.monotonic() < deadline:
                    self.condition.wait(timeout=max(0, deadline - time.monotonic()))
                if not self.pending:
                    continue
                key = next(iter(self.pending))
                entry = self.pending.pop(key)
                self.pending_bytes -= entry["bytes"]
            frames = entry["frames"]
            try:
                # Bound every payload below the serverless body limit, even for
                # unusually large individual provider frames.
                batch, size = [], 0
                for frame in frames:
                    length = len(json.dumps(frame).encode())
                    if batch and size + length > 1_000_000:
                        self._write(key, batch, False, "running")
                        batch, size = [], 0
                    batch.append(frame)
                    size += length
                self._write(key, batch, entry.get("done", False), entry.get("outcome", "running"))
            except Exception:
                with self.condition:
                    newer = self.pending.pop(key, None)
                    if newer:
                        self.pending_bytes -= newer["bytes"]
                        entry["frames"].extend(newer["frames"])
                        entry["bytes"] += newer["bytes"]
                        entry.update({k: v for k, v in newer.items() if k not in ("frames", "bytes")})
                    if key not in self.disabled and self.pending_bytes + entry["bytes"] <= self.max_pending_bytes:
                        self.pending[key] = entry
                        self.pending_bytes += entry["bytes"]
                    else:
                        self.disabled[key] = time.monotonic()
                time.sleep(1)

    def _write(self, key, frames, done, outcome):
        self.request("POST", {"action": "append", "id": key[0], "owner": key[1],
                              "frames": frames, "done": done, "outcome": outcome})


def configured_journal():
    url, key = os.environ.get("VAELO_RUN_STORE_URL"), os.environ.get("RUN_STORE_KEY")
    if not url and not key:
        return None
    return RunJournal(url or "", key or "")
