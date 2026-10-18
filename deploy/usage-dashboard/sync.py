"""Refresh the installed dashboard's content-free local/cloud usage snapshot.

Run with --config <private JSON config>; --once performs one refresh.
The scoped read token is never written to the dashboard's public directory.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import time
import urllib.request
import urllib.error
from contextlib import closing
import tempfile
import logging
import os


def snapshot(config, previous=None):
    now = datetime.now(timezone.utc)
    month = now.strftime("%Y-%m")
    with closing(sqlite3.connect(Path(config["database"]).as_uri() + "?mode=ro", uri=True, timeout=5)) as db:
        row = db.execute("SELECT COALESCE(sum(input_tokens),0), COALESCE(sum(output_tokens),0) "
                         "FROM request_hourly WHERE substr(hour,1,7) = ?", (month,)).fetchone()
    result = {"month": month, "local": {"input": row[0], "output": row[1], "total": sum(row)},
              "checkedAt": now.isoformat(), "cloudAvailable": False}
    try:
        req = urllib.request.Request(config["url"] + ("&" if "?" in config["url"] else "?") + "month=" + month,
            headers={"Authorization": "Bearer " + config["readKey"]})
        with urllib.request.urlopen(req, timeout=15) as response:
            cloud = json.load(response)
        if cloud.get("month") != month or type(cloud.get("total")) is not int or cloud["total"] < 0:
            raise ValueError("Invalid cloud counters")
        result.update(cloud=cloud, cloudAvailable=True)
    except (OSError, ValueError):
        if previous and previous.get("month") == month and "cloud" in previous:
            result["cloud"] = previous["cloud"]
    return result


def refresh(config):
    output = Path(config["output"])
    try:
        previous = json.loads(output.read_text())
    except (OSError, ValueError):
        previous = None
    result = snapshot(config, previous)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent,
                                     prefix="usage-", suffix=".tmp", delete=False) as file:
        file.write(json.dumps(result))
        temporary = Path(file.name)
    temporary.replace(output)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    if args.once:
        result = refresh(config)
        print(json.dumps({"local": result["local"], "cloudAvailable": result["cloudAvailable"],
                          "cloud": result.get("cloud")}))
        return
    # A task restart must not leave a second poller behind. Keep the lock open
    # for this process's lifetime; Windows releases it even after a forced stop.
    lock_file = open(str(Path(args.config).with_suffix(".lock")), "a+b")
    if lock_file.tell() == 0:
        lock_file.write(b"0")
        lock_file.flush()
    lock_file.seek(0)
    if os.name == "nt":
        import msvcrt
        try:
            msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            lock_file.close()
            return
    logging.basicConfig(filename=Path(args.config).with_name("worker.log"),
                        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.info("Usage sync started")
    # A scheduled logon task uses IgnoreNew to keep this to one worker.
    while True:
        try:
            # Do not wake the cloud database while FreeLLMAPI is closed.
            try:
                urllib.request.urlopen("http://127.0.0.1:31415/health", timeout=2).close()
            except urllib.error.HTTPError:
                pass  # the local router may require authentication for health
            refresh(config)
        except Exception:
            logging.exception("Usage sync poll failed; retaining the previous snapshot")
        time.sleep(15)


if __name__ == "__main__":
    main()
