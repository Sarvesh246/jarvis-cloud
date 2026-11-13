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
    def __init__(self, url, key):
        if not url.startswith("https://") or len(key) < 32:
            raise ValueError("Run storage needs an HTTPS URL and a separate 32-character key")
        self.url, self.key = url, key
        self.condition = threading.Condition()
        self.pending = {}
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
        with self.condition:
            entry = self.pending.setdefault((run.id, run.owner), {"frames": [], "done": False, "outcome": "running"})
            entry["frames"].append({"seq": seq, "frame": frame.decode()})
            self.condition.notify_all()

    def finish(self, run):
        with self.condition:
            entry = self.pending.setdefault((run.id, run.owner), {"frames": []})
            entry.update(done=True, outcome=run.outcome)
            self.condition.notify_all()

    def _work(self):
        while True:
            with self.condition:
                self.condition.wait_for(lambda: bool(self.pending))
                # One small batch rather than one database request per token.
                self.condition.wait(timeout=0.25)
                key = next(iter(self.pending))
                entry = self.pending.pop(key)
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
                        entry["frames"].extend(newer["frames"])
                        entry.update({k: v for k, v in newer.items() if k != "frames"})
                    if sum(len(item["frame"]) for item in entry["frames"]) <= 12 * 1024 * 1024:
                        self.pending[key] = entry
                time.sleep(1)

    def _write(self, key, frames, done, outcome):
        self.request("POST", {"action": "append", "id": key[0], "owner": key[1],
                              "frames": frames, "done": done, "outcome": outcome})


def configured_journal():
    url, key = os.environ.get("VAELO_RUN_STORE_URL"), os.environ.get("RUN_STORE_KEY")
    if not url and not key:
        return None
    return RunJournal(url or "", key or "")
