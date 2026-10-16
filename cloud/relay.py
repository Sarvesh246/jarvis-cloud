"""Vaelo's reply relay: fronts Hermes on the public port and holds each reply for the phone.

Hermes streams a reply over one HTTP connection and cancels the run when that connection
closes, so a reply used to live exactly as long as the phone held a request open through a
five-minute Vercel function. The relay owns that connection instead. It starts the run,
numbers and keeps every event, and lets any number of short-lived readers follow along and
pick up after the last event they saw. A phone that locks, switches networks or closes the
app loses nothing: the reply keeps going here and is waiting when it comes back.

Everything that isn't /vaelo/* passes straight through to Hermes on its private port.
Standard library only, so it adds no dependency to the image or to CI.
"""

from __future__ import annotations

import hmac
import http.client
import json
import os
import re
import threading
import time
try:
    from context_policy import CONTEXT_POLICY
except ModuleNotFoundError:
    from cloud.context_policy import CONTEXT_POLICY
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

RUN_ID = re.compile(r"^[a-f0-9-]{36}$")
# A finished reply stays readable for an hour, long enough to come back to after a call.
RETAIN_SECONDS = 3600
# No reply runs longer than this; Hermes also asks the model to wrap up at three minutes.
RUN_LIMIT_SECONDS = 15 * 60
# Hermes sends a keepalive every 10s, so this much silence means the stream is dead.
UPSTREAM_SILENCE_SECONDS = 90
# Memory bounds on a 512 MB instance. A long answer is one to two megabytes of frames.
RUN_BYTES = 6 * 1024 * 1024
# Past RUN_BYTES only thinking is dropped; this is the hard stop for answer frames too, so a
# runaway model can't hold memory for the whole fifteen minutes. Status frames still fit.
RUN_MAX_BYTES = 10 * 1024 * 1024
TOTAL_BYTES = 32 * 1024 * 1024
KEEPALIVE_SECONDS = 10
# A device listening for changes is let go after this long and simply asks again.
FEED_SECONDS = 270
BODY_LIMIT = 8 * 1024 * 1024
# A run that ended without an answer, or was cut off mid-answer, is tried again (up to three
# attempts in all) while this much time is left.
RECOVERY_MIN_SECONDS = 60
ATTEMPTS = 3
# Guests (the web app's "Continue as guest") are answered by the model provider directly,
# never by Hermes, so they get no terminal, files, memory or saved work. They are limited
# so one visitor can't use up the free provider allowance.
GUEST_OWNER = "web:guest:"
GUEST_CONCURRENT = 2
GUEST_PER_HOUR = 20
GUEST_ALL_PER_HOUR = 120
GUEST_MAX_TOKENS = 1500
GUEST_BUSY = "Guest mode is busy or has reached its hourly limit. Try again later, or sign in."
NO_ANSWER = "Vaelo finished working but the model didn’t write an answer. Try again; a second go usually works."
HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}


def recovery_note(tools):
    done = f" You already used: {'; '.join(tools)}." if tools else ""
    return (
        "[Vaelo request: your previous attempt at this message ended before you wrote an answer."
        f"{done} Write the full answer now from what you know and found; use at most one or two "
        "more tool calls, and only if the answer truly depends on them.]"
    )


CONTINUE_NOTE = (
    "[Vaelo request: your reply above was cut off partway. Continue it from exactly where it "
    "stops: don't repeat anything already written, don't start over, and don't mention the "
    "interruption. Use more tool calls only if the rest truly depends on them.]"
)
# How much of a cut-off answer is sent back so the model can carry it on.
ANSWER_KEEP = CONTEXT_POLICY["replyChars"]


def continuation(messages, answer):
    """The conversation with the partial answer as the assistant's own words, so the model
    carries on mid-thought instead of starting again."""
    if len(answer) > ANSWER_KEEP:
        answer = "[… the start of this reply is omitted …]\n\n" + answer[-ANSWER_KEEP:]
    note = {"role": "user", "content": CONTINUE_NOTE}
    return [*messages, {"role": "assistant", "content": answer}, note]


def with_note(content, note):
    if isinstance(content, str):
        return f"{content}\n\n{note}"
    parts = list(content)
    for index, part in enumerate(parts):
        if isinstance(part, dict) and part.get("type") == "text":
            parts[index] = {"type": "text", "text": f"{part.get('text', '')}\n\n{note}"}
            return parts
    return [{"type": "text", "text": note}, *parts]


def answered(seen):
    text = seen["content"].strip()
    return bool(text) and text != "(empty)"


class Run:
    """One reply: its numbered frames, who may read them, and how it ended."""

    def __init__(self, run_id, owner):
        self.id, self.owner = run_id, owner
        self.frames, self.size = [], 0
        self.done = self.stopped = False
        self.outcome = "running"
        self.created = self.updated = time.time()
        self.cond = threading.Condition()
        self.connection = None
        self.timed_out = self.overflowed = False

    def emit(self, frame, optional=False, reserved=False):
        """Number and keep one SSE frame (without its trailing blank line). Relayed frames
        stop at RUN_MAX_BYTES and the run is stopped; ``reserved`` (Vaelo's own small status
        frames) always fit, so the reader still learns how the run ended."""
        overflow = False
        with self.cond:
            if self.done or (self.overflowed and not reserved):
                return
            if optional and self.size > RUN_BYTES:
                return  # past the budget, thinking text is dropped before the answer is
            data = f"id: {len(self.frames)}\n{frame}\n\n".encode()
            if not reserved and self.size + len(data) > RUN_MAX_BYTES:
                self.overflowed = overflow = True
            else:
                self.frames.append(data)
                self.size += len(data)
                self.updated = time.time()
                self.cond.notify_all()
        if overflow:
            self.stop()

    def event(self, name, data):
        self.emit(
            f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}", reserved=True
        )

    def finish(self, outcome):
        # A stopped run says so, so anyone else following it (another device, a second tab)
        # ends there instead of waiting on a reply that will never come.
        if outcome == "stopped" and not self.done:
            self.event("jarvis.stopped", {})
        with self.cond:
            if not self.done:
                self.done, self.outcome, self.updated = True, outcome, time.time()
                self.cond.notify_all()

    def wait(self, after, timeout):
        """Frames numbered after ``after``, waiting up to ``timeout`` for some; and whether
        the reader has now seen everything there will ever be."""
        with self.cond:
            self.cond.wait_for(
                lambda: len(self.frames) > after + 1 or self.done, timeout
            )
            fresh = self.frames[after + 1 :]
            return fresh, self.done

    def stop(self):
        self.stopped = True
        connection = self.connection
        if connection is not None and connection.sock is not None:
            try:
                connection.sock.shutdown(
                    2
                )  # Hermes sees the disconnect and cancels the run
            except OSError:
                pass


class Feed:
    """One account's change counter. Every signed-in device waits on it to hear, the moment it
    happens, that a conversation was saved or a reply started or ended, instead of asking
    storage over and over. It carries no content: devices fetch what changed themselves."""

    def __init__(self):
        self.seq = 0
        self.cond = threading.Condition()

    def bump(self):
        with self.cond:
            self.seq += 1
            self.cond.notify_all()

    def wait(self, after, timeout):
        """The counter once it differs from ``after`` (a restart resets it, which also counts
        as a change), or as it stands after ``timeout``."""
        with self.cond:
            self.cond.wait_for(lambda: self.seq != after, timeout)
            return self.seq


class Relay:
    def __init__(
        self,
        upstream_port,
        api_key,
        upstream_host="127.0.0.1",
        clock=time.time,
        sleep=time.sleep,
    ):
        self.host, self.port, self.key = upstream_host, upstream_port, api_key
        self.runs, self.lock = {}, threading.Lock()
        self.feeds = {}
        self.clock, self.sleep = clock, sleep
        self.guest_active, self.guest_log = 0, {}
        self.guest_connect = lambda: http.client.HTTPSConnection(
            "openrouter.ai", timeout=UPSTREAM_SILENCE_SECONDS
        )

    def guest_admit(self, owner, retry=False):
        """Count a guest reply in, or say why not: too many at once, or too many this hour.
        Every provider call counts against the hour, so a ``retry`` (a recovery within a reply
        already admitted) is logged too, but takes no extra concurrent slot."""
        now = self.clock()
        with self.lock:
            for key in list(self.guest_log):
                self.guest_log[key] = [t for t in self.guest_log[key] if now - t < 3600]
                if not self.guest_log[key]:
                    del self.guest_log[key]
            mine = self.guest_log.get(owner, [])
            total = sum(len(times) for times in self.guest_log.values())
            if (
                (not retry and self.guest_active >= GUEST_CONCURRENT)
                or len(mine) >= GUEST_PER_HOUR
                or total >= GUEST_ALL_PER_HOUR
            ):
                return {"message": GUEST_BUSY, "status": 429}
            self.guest_log[owner] = [*mine, now]
            if not retry:
                self.guest_active += 1
        return None

    def guest_release(self):
        with self.lock:
            self.guest_active = max(0, self.guest_active - 1)

    def open_guest(self, run, messages):
        """Ask the model provider directly, with no tools, in the same streamed shape."""
        key = os.environ.get("OPENROUTER_API_KEY", "")
        if not key:
            return None, {"message": "Guest mode is not available right now.", "status": 503}
        payload = {
            "model": "openrouter/free",
            "messages": messages,
            "stream": True,
            "max_tokens": GUEST_MAX_TOKENS,
        }
        connection = self.guest_connect()
        run.connection = connection
        try:
            connection.request(
                "POST",
                "/api/v1/chat/completions",
                body=json.dumps(payload).encode(),
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            )
            response = connection.getresponse()
        except OSError:
            connection.close()
            if run.stopped:
                return None, None
            return None, {"message": "Vaelo is temporarily unavailable. Please try again.", "status": 503}
        if response.status == 200:
            return response, None
        response.read(64 * 1024)
        connection.close()
        if response.status == 429:
            return None, {"message": GUEST_BUSY, "status": 429}
        return None, {"message": "Vaelo is temporarily unavailable. Please try again.", "status": 503}

    # ---- run bookkeeping -------------------------------------------------------------------

    def tidy(self):
        """Forget finished runs past their hour, then the oldest finished ones over budget."""
        now = self.clock()
        with self.lock:
            for run_id, run in list(self.runs.items()):
                if run.done and now - run.updated > RETAIN_SECONDS:
                    del self.runs[run_id]
            finished = sorted(
                (run for run in self.runs.values() if run.done),
                key=lambda run: run.updated,
            )
            while (
                finished and sum(run.size for run in self.runs.values()) > TOTAL_BYTES
            ):
                del self.runs[finished.pop(0).id]

    def start(self, run_id, owner, body):
        """Start a reply, or hand back the one already running under this id."""
        self.tidy()
        with self.lock:
            existing = self.runs.get(run_id)
            if existing is not None and existing.owner != owner:
                return None
            # The same id again while it runs (a retried request): follow the original.
            # After it ended (a busy cloud, a failed start): start over.
            if existing is not None and not existing.done:
                return existing
            run = self.runs[run_id] = Run(run_id, owner)
        self.feed(owner).bump()
        threading.Thread(
            target=self.execute,
            args=(run, body),
            daemon=True,
            name=f"vaelo-run-{run_id[:8]}",
        ).start()
        return run

    def feed(self, owner):
        with self.lock:
            return self.feeds.setdefault(owner, Feed())

    def find(self, run_id, owner):
        with self.lock:
            run = self.runs.get(run_id)
        return (
            run if run is not None and hmac.compare_digest(run.owner, owner) else None
        )

    # ---- talking to Hermes -----------------------------------------------------------------

    def open(self, run, body, messages, recovering=False):
        """POST the chat to Hermes; the response to stream, or an error event's payload."""
        if run.owner.startswith(GUEST_OWNER):
            return self.open_guest(run, messages)
        payload = {"model": "jarvis", "messages": messages, "stream": True}
        if isinstance(body.get("model_options"), dict):
            payload["model_options"] = body["model_options"]
        data = json.dumps(payload).encode()
        for attempt in range(4):
            connection = http.client.HTTPConnection(
                self.host, self.port, timeout=UPSTREAM_SILENCE_SECONDS
            )
            run.connection = connection
            try:
                connection.request(
                    "POST",
                    "/v1/chat/completions",
                    body=data,
                    headers={
                        "Authorization": f"Bearer {self.key}",
                        "Content-Type": "application/json",
                        "X-Hermes-Session-Key": run.owner,
                    },
                )
                response = connection.getresponse()
            except OSError:
                connection.close()
                if run.stopped:
                    return None, None
                return None, {
                    "message": "Vaelo is temporarily unavailable. Please try again.",
                    "status": 503,
                }
            if response.status == 200:
                return response, None
            detail = response.read(64 * 1024)
            connection.close()
            # The cloud runs one reply at a time; the run that just ended may still be
            # letting go of its slot when the recovery asks.
            if (
                recovering
                and response.status == 429
                and attempt < 3
                and not run.stopped
            ):
                self.sleep(3)
                continue
            if response.status == 429:
                return None, {
                    "message": "Vaelo is busy finishing something else, or a provider limit was reached. Try again shortly.",
                    "status": 429,
                }
            if response.status == 401:
                return None, {
                    "message": "The cloud connection needs its API key updated.",
                    "status": 503,
                }
            message = "Vaelo is temporarily unavailable. Please try again."
            if response.status == 400:
                # A 400 is the gateway's own wording about this request (an unsupported image,
                # say): safe and useful to show, trimmed. Other bodies are never echoed.
                try:
                    text = json.loads(detail)["error"]["message"]
                    if isinstance(text, str) and text.strip():
                        message = (
                            "Vaelo couldn’t accept that: "
                            + re.sub(r"^[a-z_]+:", "", text).strip()[:180]
                        )
                except (ValueError, KeyError, TypeError):
                    pass
            return None, {
                "message": message,
                "status": 400 if response.status == 400 else 503,
            }
        return None, {
            "message": "Vaelo is busy finishing something else. Try again shortly.",
            "status": 429,
        }

    def relay(self, run, response, seen):
        """Keep Hermes's frames as they are, reading only enough to know whether an answer
        arrived and how the attempt ended. Failure frames are held back, so a recovery or a
        continuation can still take their place."""
        seen.update(finished=False, failed=False, dropped=False, held=None)
        lines = []
        try:
            for raw in iter(response.readline, b""):
                if run.stopped:
                    break
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                if line:
                    lines.append(line)
                    continue
                if lines:
                    self.inspect(run, "\n".join(lines), seen)
                lines = []
            if lines and not run.stopped:
                self.inspect(run, "\n".join(lines), seen)
        except (OSError, http.client.HTTPException, ValueError):
            seen["dropped"] = True
        finally:
            run.connection.close()
        return seen

    def inspect(self, run, frame, seen):
        name, data = "message", []
        for line in frame.split("\n"):
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].lstrip())
        if not data:
            return  # keepalive comments: readers get their own
        text = "\n".join(data)
        if text == "[DONE]":
            seen["finished"] = True
            run.emit(frame)
            return
        try:
            payload = json.loads(text)
        except ValueError:
            run.emit(frame)
            return
        if not isinstance(payload, dict):
            run.emit(frame)
            return
        if name == "approval.request":
            seen["approval"] = True
        if name == "hermes.tool.progress" and payload.get("status") != "completed":
            label = str(
                payload.get("label") or payload.get("tool") or payload.get("name") or ""
            ).strip()[:160]
            if label and label not in seen["tools"] and len(seen["tools"]) < 12:
                seen["tools"].append(label)
        choices = payload.get("choices")
        choice = (
            choices[0]
            if isinstance(choices, list) and choices and isinstance(choices[0], dict)
            else {}
        )
        delta = choice.get("delta") if isinstance(choice.get("delta"), dict) else {}
        content = delta.get("content")
        if isinstance(content, str):
            # A short prefix tells an empty reply from a real one; the answer itself is kept
            # (bounded) so a cut-off reply can be continued from where it stopped.
            seen["content"] = (seen["content"] + content).lstrip()[:64]
            seen["answer"] = (seen["answer"] + content)[-ANSWER_KEEP * 2:]
        finish = choice.get("finish_reason")
        if finish in ("stop", "length"):
            seen["finished"] = True
        if finish == "error" or (payload.get("error") and finish != "length"):
            seen["failed"] = True
            seen["held"] = frame
            return
        thinking_only = (
            not isinstance(content, str)
            and delta.get("reasoning_content")
            and not finish
            and name == "message"
        )
        run.emit(frame, optional=bool(thinking_only))

    def execute(self, run, body):
        """Run the reply to a written answer. An attempt that ends with nothing written is
        asked again for the write-up; one cut off partway (a provider failing mid-answer, a
        dropped stream) is continued from where it stopped. The reader sees one reply."""
        started = self.clock()
        messages = body["messages"]
        guest = run.owner.startswith(GUEST_OWNER)
        if guest:
            refusal = self.guest_admit(run.owner)
            if refusal:
                run.event("jarvis.error", refusal)
                run.finish("error")
                return
        timer = threading.Timer(RUN_LIMIT_SECONDS, self.time_out, args=(run,))
        timer.daemon = True
        timer.start()
        seen = {"content": "", "answer": "", "approval": False, "tools": [], "held": None,
                "finished": False, "failed": False, "dropped": False}
        try:
            run.event("jarvis.status", {"message": "Vaelo is working…"})
            request = messages
            for attempt in range(ATTEMPTS):
                if guest and attempt > 0 and self.guest_admit(run.owner, retry=True):
                    break  # out of guest allowance: end with what arrived, like a last attempt
                response, failure = self.open(run, body, request, recovering=attempt > 0)
                if failure:
                    run.event("jarvis.error", failure)
                    return run.finish("error")
                if response is None:
                    return run.finish("stopped")
                self.relay(run, response, seen)
                cut_off = seen["dropped"] or seen["failed"] or not seen["finished"]
                left = RUN_LIMIT_SECONDS - (self.clock() - started)
                if run.stopped or seen["approval"] or (answered(seen) and not cut_off) \
                        or attempt == ATTEMPTS - 1 or left < RECOVERY_MIN_SECONDS:
                    break
                if answered(seen):
                    run.event("jarvis.continue", {})
                    request = continuation(messages, seen["answer"])
                else:
                    run.event("jarvis.retry", {"message": "Writing up what Vaelo found"})
                    seen.update(content="", answer="")
                    request = [*messages[:-1], {**messages[-1], "content": with_note(
                        messages[-1]["content"], recovery_note(seen["tools"]))}]
            if run.stopped:
                if run.overflowed:
                    run.event("jarvis.error", {"code": "too_long", "message":
                              "This reply grew past Vaelo’s size limit and was stopped. What arrived is kept."})
                    return run.finish("error")
                if run.timed_out:
                    run.event("jarvis.error", {"code": "time_limit", "message":
                              "This reply ran past fifteen minutes. What arrived is kept; choose Continue to pick up from there."})
                    return run.finish("error")
                return run.finish("stopped")
            if not answered(seen) and not seen["approval"]:
                if seen["held"]:
                    run.emit(seen["held"])
                    run.event("jarvis.error", {"message": "Vaelo stopped before finishing. Please try again."})
                elif seen["dropped"]:
                    run.event("jarvis.error", {"message": "Vaelo’s server stopped before the answer. Please try again."})
                else:
                    run.event("jarvis.error", {"code": "no_answer", "message": NO_ANSWER})
                return run.finish("error")
            if not seen["approval"] and (seen["dropped"] or not seen["finished"] or seen["failed"]):
                run.event("jarvis.error", {"message": "Vaelo’s server stopped before the answer finished. What arrived is kept; please retry or continue."})
                return run.finish("error")
            run.event("jarvis.complete", {"ok": True})
            run.finish("complete")
        except Exception:
            run.event("jarvis.error", {"message": "Vaelo hit an unexpected problem. Please try again."})
            run.finish("error")
        finally:
            timer.cancel()
            if guest:
                self.guest_release()
            self.feed(run.owner).bump()

    def time_out(self, run):
        if not run.done:
            run.timed_out = True
            run.stop()


def make_handler(relay):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = (
            "HTTP/1.0"  # bodies end when the connection closes: streaming-friendly
        )
        # A client that stops sending mid-request must not hold a thread forever.
        timeout = 60

        def log_message(self, format, *args):
            pass

        # ---- helpers -----------------------------------------------------------------------

        def send_json(self, status, data):
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def authorized(self):
            supplied = self.headers.get("Authorization", "")
            return hmac.compare_digest(
                supplied.encode(), f"Bearer {relay.key}".encode()
            )

        def owner(self):
            owner = self.headers.get("X-Hermes-Session-Key", "").strip()
            return owner if 0 < len(owner) <= 256 else ""

        def body(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length < 0 or length > BODY_LIMIT:
                raise ValueError("too large")
            return self.rfile.read(length) if length else b""

        # ---- routing -----------------------------------------------------------------------

        def do_GET(self):
            self.route("GET")

        def do_POST(self):
            self.route("POST")

        def do_PUT(self):
            self.route("PUT")

        def do_DELETE(self):
            self.route("DELETE")

        def do_PATCH(self):
            self.route("PATCH")

        def route(self, method):
            path = urlsplit(self.path).path
            if not path.startswith("/vaelo/"):
                return self.forward(method)
            if not self.authorized():
                return self.send_json(401, {"error": "unauthorized"})
            owner = self.owner()
            if not owner:
                return self.send_json(400, {"error": "missing session key"})
            parts = path.strip("/").split("/")
            try:
                if parts == ["vaelo", "feed"]:
                    if method == "GET":
                        return self.listen(relay.feed(owner))
                    if method == "POST":
                        relay.feed(owner).bump()
                        return self.send_json(200, {"ok": True})
                if method == "POST" and parts == ["vaelo", "runs"]:
                    return self.start(owner)
                if len(parts) >= 3 and parts[1] == "runs" and RUN_ID.match(parts[2]):
                    run = relay.find(parts[2], owner)
                    if run is None:
                        return self.send_json(404, {"error": "run not found"})
                    if method == "GET" and len(parts) == 4 and parts[3] == "events":
                        return self.follow(run)
                    if method == "POST" and len(parts) == 4 and parts[3] == "stop":
                        run.stop()
                        return self.send_json(200, {"stopped": True})
                    if method == "GET" and len(parts) == 3:
                        return self.send_json(
                            200,
                            {
                                "run_id": run.id,
                                "done": run.done,
                                "outcome": run.outcome,
                                "events": len(run.frames),
                            },
                        )
            except (ValueError, KeyError, TypeError):
                return self.send_json(400, {"error": "invalid request"})
            return self.send_json(404, {"error": "not found"})

        def start(self, owner):
            body = json.loads(self.body())
            run_id = str(body.get("id", ""))
            messages = body.get("messages")
            if (
                not RUN_ID.match(run_id)
                or not isinstance(messages, list)
                or not messages
                or not all(
                    isinstance(m, dict)
                    and m.get("role") in ("system", "user", "assistant")
                    for m in messages
                )
                or messages[-1].get("role") != "user"
            ):
                return self.send_json(400, {"error": "invalid run"})
            run = relay.start(
                run_id,
                owner,
                {"messages": messages, "model_options": body.get("model_options")},
            )
            if run is None:
                return self.send_json(409, {"error": "run belongs to another session"})
            return self.send_json(202, {"run_id": run.id})

        def follow(self, run):
            query = parse_qs(urlsplit(self.path).query)
            try:
                after = max(-1, int(query.get("after", ["-1"])[0]))
            except ValueError:
                after = -1
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store, no-transform")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            try:
                self.wfile.write(b": open\n\n")
                self.wfile.flush()
                while True:
                    fresh, done = run.wait(after, KEEPALIVE_SECONDS)
                    if fresh:
                        self.wfile.write(b"".join(fresh))
                        after += len(fresh)
                    elif not done:
                        self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                    if done and not fresh and after >= len(run.frames) - 1:
                        self.wfile.write(b": end\n\n")
                        self.wfile.flush()
                        return
            except OSError:
                return  # the reader left; the run carries on without it

        def listen(self, feed):
            """Tell this device each time the account's counter moves, until it has listened
            for FEED_SECONDS; then it reconnects with the last number it heard."""
            query = parse_qs(urlsplit(self.path).query)
            try:
                after = int(query.get("after", ["-1"])[0])
            except ValueError:
                after = -1
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store, no-transform")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            until = relay.clock() + FEED_SECONDS
            try:
                self.wfile.write(b": open\n\n")
                self.wfile.flush()
                while relay.clock() < until:
                    seq = feed.wait(after, KEEPALIVE_SECONDS)
                    if seq != after:
                        after = seq
                        self.wfile.write(f"event: feed\ndata: {json.dumps({'seq': seq})}\n\n".encode())
                    else:
                        self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                self.wfile.write(b": end\n\n")
                self.wfile.flush()
            except OSError:
                return  # the device left

        def forward(self, method):
            """Everything else goes to Hermes untouched, streamed back as it arrives."""
            try:
                body = self.body()
            except ValueError:
                return self.send_json(413, {"error": "too large"})
            headers = {
                k: v for k, v in self.headers.items() if k.lower() not in HOP_HEADERS
            }
            connection = http.client.HTTPConnection(relay.host, relay.port, timeout=600)
            try:
                connection.request(
                    method, self.path, body=body or None, headers=headers
                )
                response = connection.getresponse()
            except OSError:
                connection.close()
                if urlsplit(self.path).path in ("/health", "/"):
                    return self.send_json(
                        503, {"status": "starting", "chat_enabled": False}
                    )
                return self.send_json(502, {"error": "Hermes is not reachable yet"})
            try:
                self.send_response(response.status, response.reason)
                for key, value in response.getheaders():
                    if key.lower() not in HOP_HEADERS:
                        self.send_header(key, value)
                if urlsplit(self.path).path == "/health":
                    self.send_header("X-Vaelo-Context-Window", str(CONTEXT_POLICY["windowTokens"]))
                    self.send_header("X-Vaelo-Compression-Cap", str(CONTEXT_POLICY["compressionCapTokens"]))
                self.end_headers()
                while True:
                    chunk = response.read1(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
            except OSError:
                pass  # the caller left; closing the upstream connection tells Hermes
            finally:
                connection.close()

    return Handler


def serve(port, upstream_port, api_key, host="0.0.0.0"):
    relay = Relay(upstream_port, api_key)
    server = ThreadingHTTPServer((host, port), make_handler(relay))
    server.daemon_threads = True
    return relay, server


if __name__ == "__main__":
    _, server = serve(
        int(os.environ.get("PORT", "10000")),
        int(os.environ["HERMES_INTERNAL_PORT"]),
        os.environ["API_SERVER_KEY"],
    )
    server.serve_forever()
