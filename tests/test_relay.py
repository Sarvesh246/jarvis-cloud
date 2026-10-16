import http.client
import importlib.util
import json
from pathlib import Path
import threading
import time
import unittest
from unittest import mock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("relay", ROOT / "cloud/relay.py")
relay_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay_module)

KEY = "k" * 40
OWNER = "web:owner"
RUN = "123e4567-e89b-12d3-a456-426614174000"


class ContextTests(unittest.TestCase):
    def test_long_continuations_keep_the_same_reply_budget_as_the_web(self):
        text = "beginning\n" + "x" * 80_000 + "\nend"
        messages = [{"role": "user", "content": "Continue the program"}]
        continued = relay_module.continuation(messages, text)
        self.assertEqual(continued[-2]["content"], text)
        self.assertEqual(relay_module.ANSWER_KEEP, relay_module.CONTEXT_POLICY["replyChars"])


def chunk(text=None, finish=None, **extra):
    delta = {} if text is None else {"content": text}
    return "data: " + json.dumps(
        {
            "id": "chatcmpl-abc12345",
            "choices": [{"delta": delta, "finish_reason": finish}],
            **extra,
        }
    )


class FakeHermes:
    """Plays scripted replies, one per request; a script entry is a list of frames, an int
    status, or a callable that writes the response itself."""

    def __init__(self, scripts):
        self.scripts, self.requests, self.disconnected = (
            list(scripts),
            [],
            threading.Event(),
        )
        fake = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.0"

            def log_message(self, *args):
                pass

            def do_GET(self):
                body = json.dumps({"status": "ok"}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                fake.requests.append(
                    {
                        "path": self.path,
                        "headers": dict(self.headers),
                        "body": json.loads(self.rfile.read(length) or b"{}"),
                    }
                )
                script = fake.scripts.pop(0) if fake.scripts else 500
                if callable(script):
                    return script(self)
                if isinstance(script, int):
                    self.send_response(script)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(
                        json.dumps(
                            {"error": {"message": "invalid_request: image too large"}}
                        ).encode()
                    )
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                try:
                    for frame in script:
                        self.wfile.write((frame + "\n\n").encode())
                        self.wfile.flush()
                except OSError:
                    pass  # the relay hung up (a stopped or oversized run)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.servers = []

    def tearDown(self):
        for server in self.servers:
            server.shutdown()
            server.server_close()

    def boot(self, scripts):
        hermes = FakeHermes(scripts)
        self.addCleanup(hermes.close)
        relay, server = relay_module.serve(
            0, hermes.server.server_port, KEY, host="127.0.0.1"
        )
        relay.sleep = lambda seconds: None
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.servers.append(server)
        return hermes, relay, server.server_port

    def call(self, port, method, path, body=None, owner=OWNER, key=KEY):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        headers = {
            "Authorization": f"Bearer {key}",
            "X-Hermes-Session-Key": owner,
            "Content-Type": "application/json",
        }
        connection.request(
            method,
            path,
            body=json.dumps(body) if body is not None else None,
            headers=headers,
        )
        response = connection.getresponse()
        return response.status, response.read().decode()

    def start(self, port, run_id=RUN, owner=OWNER, content="hi"):
        return self.call(
            port,
            "POST",
            "/vaelo/runs",
            {
                "id": run_id,
                "messages": [
                    {"role": "system", "content": "s"},
                    {"role": "user", "content": content},
                ],
                "model_options": {"reasoning_effort": "low"},
            },
            owner=owner,
        )

    def events(self, port, after=-1, owner=OWNER):
        status, text = self.call(
            port, "GET", f"/vaelo/runs/{RUN}/events?after={after}", owner=owner
        )
        frames = []
        for block in text.split("\n\n"):
            lines = block.split("\n")
            seq = next(
                (int(line[4:]) for line in lines if line.startswith("id: ")), None
            )
            if seq is None:
                continue
            name = next(
                (line[7:] for line in lines if line.startswith("event: ")), "message"
            )
            data = "\n".join(line[6:] for line in lines if line.startswith("data: "))
            frames.append((seq, name, data))
        return status, frames

    def finished(self, relay, timeout=5):
        deadline = time.time() + timeout
        while time.time() < deadline:
            run = relay.runs.get(RUN)
            if run is not None and run.done:
                return run
            time.sleep(0.02)
        self.fail("the run never finished")

    def test_a_negative_content_length_is_refused_instead_of_hanging(self):
        _, _, port = self.boot([])
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        connection.putrequest("POST", "/vaelo/runs")
        connection.putheader("Authorization", f"Bearer {KEY}")
        connection.putheader("X-Hermes-Session-Key", OWNER)
        connection.putheader("Content-Length", "-1")
        connection.endheaders()
        self.assertEqual(connection.getresponse().status, 400)

    def test_guest_replies_go_to_the_provider_with_no_tools_and_stay_off_hermes(self):
        guest = "web:guest:" + "a" * 8 + "-" + "b" * 4 + "-" + "c" * 4 + "-" + "d" * 4 + "-" + "e" * 12
        hermes, relay, port = self.boot([])
        provider = FakeHermes([[chunk("Hello.", "stop"), "data: [DONE]"]])
        self.addCleanup(provider.close)
        relay.guest_connect = lambda: http.client.HTTPConnection(
            "127.0.0.1", provider.server.server_port, timeout=10
        )
        with mock.patch.dict("os.environ", {"OPENROUTER_API_KEY": "or-key"}):
            self.assertEqual(self.start(port, owner=guest)[0], 202)
            run = self.finished(relay)
        self.assertEqual(run.outcome, "complete")
        self.assertEqual(hermes.requests, [])
        sent = provider.requests[0]
        self.assertEqual(sent["path"], "/api/v1/chat/completions")
        self.assertEqual(sent["headers"]["Authorization"], "Bearer or-key")
        self.assertNotIn("tools", sent["body"])
        self.assertEqual(relay.guest_active, 0)

    def test_guests_are_limited_per_hour_and_at_once(self):
        _, relay, _ = self.boot([])
        guest = "web:guest:x"
        for _ in range(relay_module.GUEST_PER_HOUR):
            self.assertIsNone(relay.guest_admit(guest))
            relay.guest_release()
        self.assertEqual(relay.guest_admit(guest)["status"], 429)
        self.assertIsNone(relay.guest_admit("web:guest:y"))
        self.assertIsNone(relay.guest_admit("web:guest:z"))
        self.assertEqual(relay.guest_admit("web:guest:w")["status"], 429)

    def test_devices_hear_at_once_when_a_conversation_or_reply_changes(self):
        with mock.patch.object(relay_module, "FEED_SECONDS", 1), \
                mock.patch.object(relay_module, "KEEPALIVE_SECONDS", 0.2):
            _, relay, port = self.boot([[chunk("Hi.", "stop"), "data: [DONE]"]])
            status, text = self.call(port, "GET", "/vaelo/feed?after=-1")
            self.assertEqual(status, 200)
            self.assertIn('event: feed\ndata: {"seq": 0}', text)
            self.assertTrue(text.endswith(": end\n\n"))
            # A saved conversation, then a reply starting and ending, each move the counter.
            self.assertEqual(self.call(port, "POST", "/vaelo/feed", {})[0], 200)
            self.start(port)
            self.finished(relay)
            deadline = time.time() + 5
            while relay.feed(OWNER).seq < 3 and time.time() < deadline:
                time.sleep(0.02)
            _, text = self.call(port, "GET", "/vaelo/feed?after=0")
            self.assertIn('data: {"seq": 3}', text)
            # Another account hears nothing of it.
            _, text = self.call(port, "GET", "/vaelo/feed?after=0", owner="web:someone-else")
            self.assertNotIn("event: feed", text)

    def test_a_reply_completes_and_is_kept_for_readers_who_come_later(self):
        hermes, relay, port = self.boot(
            [[chunk("Hello "), chunk("there.", "stop"), "data: [DONE]"]]
        )
        status, _ = self.start(port)
        self.assertEqual(status, 202)
        self.finished(relay)
        status, frames = self.events(port)
        self.assertEqual(status, 200)
        names = [name for _, name, _ in frames]
        self.assertEqual(names[0], "jarvis.status")
        self.assertEqual(names[-1], "jarvis.complete")
        self.assertIn("Hello ", "".join(data for _, _, data in frames))
        self.assertEqual([seq for seq, _, _ in frames], list(range(len(frames))))
        # The run was started as the signed-in person with the per-message options.
        request = hermes.requests[0]
        self.assertEqual(request["headers"]["X-Hermes-Session-Key"], OWNER)
        self.assertEqual(request["body"]["model_options"], {"reasoning_effort": "low"})
        self.assertTrue(request["body"]["stream"])

    def test_a_reader_resumes_after_the_last_event_it_saw(self):
        _, relay, port = self.boot(
            [[chunk("One. "), chunk("Two. "), chunk("Three.", "stop"), "data: [DONE]"]]
        )
        self.start(port)
        self.finished(relay)
        _, everything = self.events(port)
        _, rest = self.events(port, after=2)
        self.assertEqual(rest, everything[3:])

    def test_the_reply_keeps_going_with_nobody_listening(self):
        gate = threading.Event()

        def slow(handler):
            handler.send_response(200)
            handler.send_header("Content-Type", "text/event-stream")
            handler.end_headers()
            handler.wfile.write((chunk("Started. ") + "\n\n").encode())
            handler.wfile.flush()
            gate.wait(5)
            handler.wfile.write(
                (
                    chunk("Finished while you were away.", "stop")
                    + "\n\ndata: [DONE]\n\n"
                ).encode()
            )

        _, relay, port = self.boot([slow])
        self.start(port)
        time.sleep(0.2)  # nobody is reading: the phone is locked
        gate.set()
        self.finished(relay)
        _, frames = self.events(port)
        self.assertIn(
            "Finished while you were away.", "".join(data for _, _, data in frames)
        )
        self.assertEqual(frames[-1][1], "jarvis.complete")

    def test_a_live_reader_sees_events_as_they_happen(self):
        gate = threading.Event()

        def slow(handler):
            handler.send_response(200)
            handler.end_headers()
            handler.wfile.write((chunk("First. ") + "\n\n").encode())
            handler.wfile.flush()
            gate.wait(5)
            handler.wfile.write(
                (chunk("Second.", "stop") + "\n\ndata: [DONE]\n\n").encode()
            )

        _, relay, port = self.boot([slow])
        self.start(port)
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        connection.request(
            "GET",
            f"/vaelo/runs/{RUN}/events?after=-1",
            headers={"Authorization": f"Bearer {KEY}", "X-Hermes-Session-Key": OWNER},
        )
        response = connection.getresponse()
        seen = b""
        while b"First." not in seen:
            seen += response.read1(4096)
        gate.set()
        seen += response.read()
        self.assertIn(b"Second.", seen)
        self.assertIn(b"jarvis.complete", seen)

    def test_starting_the_same_reply_twice_follows_the_first(self):
        gate = threading.Event()

        def slow(handler):
            handler.send_response(200)
            handler.end_headers()
            gate.wait(5)
            handler.wfile.write(
                (chunk("Once.", "stop") + "\n\ndata: [DONE]\n\n").encode()
            )

        hermes, relay, port = self.boot([slow])
        self.start(port)
        self.start(port)
        gate.set()
        self.finished(relay)
        self.assertEqual(len(hermes.requests), 1)

    def test_retrying_a_completed_start_replays_the_answer_without_running_tools_again(self):
        hermes, relay, port = self.boot([[chunk("Once.", "stop"), "data: [DONE]"]])
        self.start(port)
        original = self.finished(relay)
        frames = list(original.frames)
        self.assertEqual(original.outcome, "complete")
        self.assertEqual(self.start(port)[0], 202)
        self.assertIs(relay.find(RUN, OWNER), original)
        self.assertEqual(original.frames, frames)
        self.assertEqual(len(hermes.requests), 1)

    def test_retrying_a_stopped_start_does_not_resurrect_the_run(self):
        hermes, relay, port = self.boot([])
        relay.stop_early(RUN, OWNER)
        self.start(port)
        original = self.finished(relay)
        self.assertEqual(original.outcome, "stopped")
        self.assertEqual(self.start(port)[0], 202)
        self.assertIs(relay.find(RUN, OWNER), original)
        self.assertEqual(len(hermes.requests), 0)

    def test_stop_cancels_the_hermes_run(self):
        closed = threading.Event()

        def endless(handler):
            handler.send_response(200)
            handler.end_headers()
            try:
                for _ in range(500):
                    handler.wfile.write((chunk("more ") + "\n\n").encode())
                    handler.wfile.flush()
                    time.sleep(0.01)
            except OSError:
                closed.set()

        _, relay, port = self.boot([endless])
        self.start(port)
        time.sleep(0.1)
        status, _ = self.call(port, "POST", f"/vaelo/runs/{RUN}/stop")
        self.assertEqual(status, 200)
        run = self.finished(relay)
        self.assertEqual(run.outcome, "stopped")
        self.assertTrue(closed.wait(3), "Hermes never saw the disconnect")
        # Another reader following the run learns it was stopped instead of waiting on a
        # reply that will never finish.
        _, frames = self.events(port)
        self.assertEqual([name for _, name, _ in frames][-1], "jarvis.stopped")

    def test_a_stop_that_arrives_before_its_start_still_stops_the_run(self):
        hermes, relay, port = self.boot([[chunk("Never sent.", "stop"), "data: [DONE]"]])
        # Someone else's stop for the same id changes nothing for this owner.
        self.call(port, "POST", f"/vaelo/runs/{RUN}/stop", owner="web:someone-else")
        status, _ = self.call(port, "POST", f"/vaelo/runs/{RUN}/stop")
        self.assertEqual(status, 200)
        self.start(port)
        run = self.finished(relay)
        self.assertEqual(run.outcome, "stopped")
        self.assertEqual(hermes.requests, [])
        _, frames = self.events(port)
        self.assertEqual([name for _, name, _ in frames], ["jarvis.stopped"])
        # The early stop is used up: starting the id again later runs normally.
        other, relay2, port2 = self.boot([[chunk("Hello.", "stop"), "data: [DONE]"]])
        self.call(port2, "POST", f"/vaelo/runs/{RUN}/stop", owner="web:someone-else")
        self.start(port2)
        self.assertEqual(self.finished(relay2).outcome, "complete")

    def test_a_run_without_an_answer_is_asked_once_more(self):
        hermes, relay, port = self.boot(
            [
                [
                    'event: hermes.tool.progress\ndata: {"tool":"web_search","label":"workout split research"}',
                    'data: {"choices":[{"delta":{},"finish_reason":"cancelled"}]}',
                    "data: [DONE]",
                ],
                [chunk("Train each muscle twice a week.", "stop"), "data: [DONE]"],
            ]
        )
        self.start(port)
        self.finished(relay)
        self.assertEqual(len(hermes.requests), 2)
        retried = hermes.requests[1]["body"]["messages"][-1]["content"]
        self.assertTrue(retried.startswith("hi"))
        self.assertIn("workout split research", retried)
        _, frames = self.events(port)
        names = [name for _, name, _ in frames]
        self.assertIn("jarvis.retry", names)
        self.assertEqual(names[-1], "jarvis.complete")

    def test_a_late_failure_is_held_back_while_the_recovery_runs(self):
        hermes, relay, port = self.boot(
            [
                [
                    'data: {"choices":[{"delta":{},"finish_reason":"error"}],"error":{"message":"provider failed"}}'
                ],
                429,
                [chunk("Here it is.", "stop"), "data: [DONE]"],
            ]
        )
        self.start(port)
        self.finished(relay)
        _, frames = self.events(port)
        self.assertNotIn("provider failed", "".join(data for _, _, data in frames))
        self.assertEqual(frames[-1][1], "jarvis.complete")

    def test_an_empty_recovery_is_reported_plainly(self):
        empty = [chunk("(empty)", "stop"), "data: [DONE]"]
        _, relay, port = self.boot([empty, empty, empty])
        self.start(port)
        self.finished(relay)
        _, frames = self.events(port)
        self.assertEqual(frames[-1][1], "jarvis.error")
        self.assertEqual(json.loads(frames[-1][2])["code"], "no_answer")

    def test_a_reply_waiting_on_approval_is_never_retried(self):
        hermes, relay, port = self.boot(
            [['event: approval.request\ndata: {"command":"npm run deploy"}']]
        )
        self.start(port)
        self.finished(relay)
        self.assertEqual(len(hermes.requests), 1)
        _, frames = self.events(port)
        self.assertEqual(frames[-1][1], "jarvis.complete")

    def test_an_answer_cut_off_partway_is_continued_from_where_it_stopped(self):
        hermes, relay, port = self.boot([
            [chunk("The first half of the answer, "),
             'data: {"choices":[{"delta":{},"finish_reason":"error"}],"error":{"message":"provider failed"}}'],
            [chunk("and the second half.", "stop"), "data: [DONE]"],
        ])
        self.start(port)
        self.finished(relay)
        follow_up = hermes.requests[1]["body"]["messages"]
        self.assertEqual(follow_up[-2], {"role": "assistant", "content": "The first half of the answer, "})
        self.assertIn("Continue it from exactly where it stops", follow_up[-1]["content"])
        _, frames = self.events(port)
        text = "".join(data for _, _, data in frames)
        self.assertNotIn("provider failed", text)  # the reader never sees the failure
        names = [name for _, name, _ in frames]
        self.assertIn("jarvis.continue", names)
        self.assertEqual(names[-1], "jarvis.complete")
        self.assertIn("second half", text)

    def test_a_dropped_stream_mid_answer_is_continued_too(self):
        hermes, relay, port = self.boot([
            [chunk("Begun but never finished")],
            [chunk(" and now finished.", "stop"), "data: [DONE]"],
        ])
        self.start(port)
        self.finished(relay)
        _, frames = self.events(port)
        self.assertEqual(frames[-1][1], "jarvis.complete")
        self.assertEqual(len(hermes.requests), 2)

    def test_an_answer_cut_off_by_hermes_is_never_reported_as_success(self):
        cut = [chunk("Partial answer")]
        _, relay, port = self.boot([cut, cut, cut])
        self.start(port)
        self.finished(relay)
        _, frames = self.events(port)
        self.assertIn("Partial answer", "".join(data for _, _, data in frames))
        self.assertEqual(frames[-1][1], "jarvis.error")

    def test_a_busy_cloud_is_reported_with_its_status(self):
        _, relay, port = self.boot([429])
        self.start(port)
        self.finished(relay)
        _, frames = self.events(port)
        self.assertEqual(frames[-1][1], "jarvis.error")
        self.assertEqual(json.loads(frames[-1][2])["status"], 429)

    def test_a_gateway_validation_message_is_shown_trimmed(self):
        _, relay, port = self.boot([400])
        self.start(port)
        self.finished(relay)
        _, frames = self.events(port)
        self.assertIn(
            "Vaelo couldn’t accept that: image too large",
            json.loads(frames[-1][2])["message"],
        )

    def test_runs_are_private_to_their_owner_and_key(self):
        _, relay, port = self.boot([[chunk("Secret.", "stop"), "data: [DONE]"]])
        self.start(port)
        self.finished(relay)
        status, _ = self.events(port, owner="web:someone-else")
        self.assertEqual(status, 404)
        status, _ = self.call(
            port, "GET", f"/vaelo/runs/{RUN}/events", key="wrong" * 10
        )
        self.assertEqual(status, 401)
        status, _ = self.start(port, owner="web:someone-else")
        self.assertEqual(status, 409)

    def test_everything_else_passes_through_to_hermes(self):
        _, _, port = self.boot([[chunk("direct", "stop"), "data: [DONE]"]])
        status, text = self.call(port, "GET", "/health")
        self.assertEqual((status, json.loads(text)["status"]), (200, "ok"))
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        connection.request("GET", "/health")
        response = connection.getresponse()
        self.assertEqual(response.getheader("X-Vaelo-Context-Window"), "128000")
        self.assertEqual(response.getheader("X-Vaelo-Compression-Cap"), "108800")
        response.read()
        connection.close()
        status, text = self.call(
            port, "POST", "/v1/chat/completions", {"model": "jarvis", "messages": []}
        )
        self.assertEqual(status, 200)
        self.assertIn("direct", text)

    def test_health_says_starting_while_hermes_boots(self):
        relay, server = relay_module.serve(
            0, 1, KEY, host="127.0.0.1"
        )  # nothing listens on port 1
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.servers.append(server)
        status, text = self.call(server.server_port, "GET", "/health")
        self.assertEqual(status, 503)
        self.assertEqual(json.loads(text)["status"], "starting")

    def test_finished_runs_are_forgotten_after_an_hour(self):
        _, relay, port = self.boot([[chunk("Old.", "stop"), "data: [DONE]"]])
        self.start(port)
        run = self.finished(relay)
        run.updated -= relay_module.RETAIN_SECONDS + 1
        relay.tidy()
        self.assertNotIn(RUN, relay.runs)

    def test_thinking_text_is_dropped_before_the_answer_when_a_run_grows_too_large(
        self,
    ):
        run = relay_module.Run(RUN, OWNER)
        run.size = relay_module.RUN_BYTES + 1
        run.emit(
            'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}', optional=True
        )
        run.emit(chunk("answer"))
        self.assertEqual(len(run.frames), 1)
        self.assertIn(b"answer", run.frames[0])

    def test_answer_frames_stop_at_the_hard_cap_but_status_frames_still_fit(self):
        run = relay_module.Run(RUN, OWNER)
        run.size = relay_module.RUN_MAX_BYTES - 10
        run.emit(chunk("too much"))
        run.emit(chunk("x"))  # nothing after the cut, or the reader would see a gap
        self.assertEqual(run.frames, [])
        self.assertTrue(run.overflowed and run.stopped)
        run.event("jarvis.error", {"code": "too_long"})
        self.assertEqual(len(run.frames), 1)

    def test_a_runaway_answer_ends_the_run_with_a_clear_error(self):
        frames = [chunk("y" * 200) for _ in range(200)] + [chunk(None, "stop"), "data: [DONE]"]
        hermes, relay, port = self.boot([frames])
        with mock.patch.object(relay_module, "RUN_MAX_BYTES", 4000):
            self.start(port)
            run = self.finished(relay)
        self.assertEqual(run.outcome, "error")
        self.assertLessEqual(run.size, 4000 + 1000)
        self.assertEqual(len(hermes.requests), 1)  # never retried or continued
        _, frames = self.events(port)
        self.assertEqual(frames[-1][1], "jarvis.error")
        self.assertIn("too_long", frames[-1][2])

    def boot_guest(self, replies):
        _, relay, port = self.boot([])
        provider = FakeHermes(replies)
        self.addCleanup(provider.close)
        relay.guest_connect = lambda: http.client.HTTPConnection(
            "127.0.0.1", provider.server.server_port, timeout=10
        )
        return provider, relay, port

    def test_every_guest_recovery_counts_against_the_hourly_allowance(self):
        guest = "web:guest:retry"
        empty = ['data: {"choices":[{"delta":{},"finish_reason":"cancelled"}]}', "data: [DONE]"]
        provider, relay, port = self.boot_guest([empty, empty, empty])
        with mock.patch.dict("os.environ", {"OPENROUTER_API_KEY": "or-key"}):
            self.start(port, owner=guest)
            self.finished(relay)
        self.assertEqual(len(provider.requests), relay_module.ATTEMPTS)
        self.assertEqual(len(relay.guest_log[guest]), relay_module.ATTEMPTS)
        self.assertEqual(relay.guest_active, 0)

    def test_a_guest_out_of_allowance_gets_no_recovery_calls(self):
        guest = "web:guest:last"
        empty = ['data: {"choices":[{"delta":{},"finish_reason":"cancelled"}]}', "data: [DONE]"]
        provider, relay, port = self.boot_guest([empty, empty, empty])
        relay.guest_log[guest] = [relay.clock()] * (relay_module.GUEST_PER_HOUR - 1)
        with mock.patch.dict("os.environ", {"OPENROUTER_API_KEY": "or-key"}):
            self.start(port, owner=guest)
            run = self.finished(relay)
        self.assertEqual(len(provider.requests), 1)
        self.assertEqual(run.outcome, "error")
        self.assertEqual(relay.guest_active, 0)


if __name__ == "__main__":
    unittest.main()
