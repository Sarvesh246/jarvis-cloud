"""Import reported token counters from a Render log export, before live coverage.

Defaults to a dry run. --apply submits idempotent, content-free events using the
existing private validation env file. Lines after the live cutoff are excluded.
Never estimate counts for logs which lack usage. Exported UI text uses the date
headings and local times displayed by Render; supply the matching UTC offset.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import urllib.request


def parse_history(text, cutoff, year, offset_hours=-5):
    day = clock = None
    zone = timezone(timedelta(hours=offset_hours))
    events = {}
    for raw in text.splitlines():
        line = raw.strip()
        if re.fullmatch(r"[A-Z][a-z]{2} \d{1,2}", line):
            day = datetime.strptime(f"{year} {line}", "%Y %b %d")
        elif re.fullmatch(r"\d{2}:\d{2}:\d{2} [AP]M", line):
            clock = datetime.strptime(line, "%I:%M:%S %p").time()
        elif re.match(r"^vaelo run [a-f0-9]{8} ", line):
            if day is None or clock is None:
                raise ValueError("A usage log has no displayed timestamp.")
            at = datetime.combine(day, clock, zone).astimezone(timezone.utc)
            # Completion is later than the accepted attempt timestamp. Requiring
            # completion before the cutoff excludes every live-tracked attempt.
            if at >= cutoff:
                continue
            run = re.search(r"^vaelo run ([a-f0-9]{8}) route=([a-z_-]+)", line)
            if not run:
                raise ValueError("Invalid usage log identity.")
            fields = dict(re.findall(r"(usage_reports|reported_prompt_tokens|reported_completion_tokens|reported_cached_tokens)=(\d+)", line))
            reported = int(fields.get("usage_reports", 0)) > 0
            counts = [int(fields.get(key, 0)) if reported else 0 for key in
                      ("reported_prompt_tokens", "reported_completion_tokens", "reported_cached_tokens")]
            event_id = f"history-{at.strftime('%Y%m%dT%H%M%S')}-{run[1]}"
            event = {"id": event_id, "at": at.isoformat(), "route": "history-" + run[2],
                     "reported": reported, "input": counts[0], "output": counts[1], "cached": counts[2]}
            if event_id in events and events[event_id] != event:
                raise ValueError("Conflicting historical usage for the same event.")
            events[event_id] = event
    return list(events.values())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("log")
    parser.add_argument("--cutoff", required=True)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--offset-hours", type=int, default=-5)
    parser.add_argument("--env", help="Private env file with JARVIS_API_KEY; only read with --apply")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    cutoff = datetime.fromisoformat(args.cutoff.replace("Z", "+00:00"))
    events = parse_history(Path(args.log).read_text(encoding="utf-8"), cutoff, args.year, args.offset_hours)
    print(json.dumps({"events": len(events), "reported_tokens": sum(e["input"] + e["output"] for e in events),
                      "unreported": sum(not e["reported"] for e in events),
                      "first": min((e["at"] for e in events), default=None), "applied": args.apply}))
    if args.apply:
        env = {}
        for line in Path(args.env).read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                key, value = line.split("=", 1)
                env[key] = json.loads(value)
        for event in events:
            request = urllib.request.Request("https://vaelochat.vercel.app/api/session?resource=usage",
                method="POST", data=json.dumps(event).encode(), headers={
                    "Authorization": "Bearer " + env["JARVIS_API_KEY"], "Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=20) as response:
                if json.load(response).get("ok") is not True:
                    raise OSError("Historical usage was not acknowledged.")
        print("Historical events acknowledged; reruns reuse the same event ids.")


if __name__ == "__main__":
    main()
