import http.client
import io
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
    def test_internal_output_variants_are_detected_across_chunk_boundaries(self):
        bad = [
            '{"parameters":{"urls":[]},"name":"web_extract"}',
            '[{"function":{"arguments":"{}","name":"web_search"}}]',
            '<tool_call>{"name":"web_search"}</tool_call>',
            "<function_call>web_extract()</function_call>",
            "<think>I need to search first.</think>Answer",
            "Let me compare them.\n<analysis>Choose web_search</analysis>",
            "<|im_start|>assistant to=web_search",
            '[TOOL_CALLS] [{"name":"web_search"}]',
            'Here is the tool call:\n{"name":"web_extract"}',
            "Thought: I need current facts.\nAction: web_search\nAction Input: phones",
            'web_extract({"urls":[]})',
            '<function=web_extract>{"urls":[]}</function>',
            "Some context first.\nThe function call that best answers is:\n{}",
            '```JSON\n{"name":"web_extract","arguments":{}}\n```',
            '{"name":"web_extract","parameters":{"text":"' + "x" * 12000 + '"}}',
        ]
        for answer in bad:
            for width in (1, 7, len(answer)):
                with self.subTest(answer=answer[:60], width=width):
                    guard = relay_module.ToolOutputGuard(
                        [{"role": "user", "content": "Compare the phones"}]
                    )
                    for offset in range(0, len(answer), width):
                        guard.feed("frame", answer[offset : offset + width])
                        if guard.invalid:
                            break
                    self.assertTrue(guard.invalid)

    def test_normal_prose_code_and_named_entities_do_not_disable_the_guard(self):
        for prompt in [
            "Compare the phones as JSON",
            "Write code to compare phones",
            "What function does this phone have?",
        ]:
            guard = relay_module.ToolOutputGuard([{"role": "user", "content": prompt}])
            guard.feed("frame", '{"name":"web_extract","arguments":{}}', final=True)
            self.assertTrue(guard.invalid, prompt)
        for answer in [
            "The tool calls were unsuccessful, so I could not verify it.",
            '```python\nprint("hello")\n```',
            "[Apple](https://apple.com) lists the specifications.",
            '{"name":"iPhone","parameters":{"weight":187}}',
        ]:
            guard = relay_module.ToolOutputGuard(
                [{"role": "user", "content": "Compare phones"}]
            )
            output = []
            for char in answer:
                output.extend(guard.feed(char, char))
            output.extend(guard.feed("END", final=True))
            self.assertFalse(guard.invalid, answer)
            self.assertEqual("".join(output), answer + "END")

    def test_tool_output_guard_preserves_requested_examples_and_normal_json(self):
        call = '{"name":"web_extract","parameters":{"urls":["https://apple.com"]}}'
        for prompt, answer in [
            ("Show the tool-call JSON", call),
            ("Return a JSON example", "```json\n" + call + "\n```"),
            ("Compare these phones", '{"phones": ["A", "B"]}'),
            ("Explain the error", "The function calls are described below."),
            (
                "Write a function to add numbers",
                "Here is the function call:\nadd(2, 3)",
            ),
            ("Explain ChatML", "ChatML uses tokens such as `<|im_start|>assistant`."),
            (
                "Write a Python tokenizer",
                'Here is the parser.\n```python\ntoken = "<|im_start|>"\n```',
            ),
        ]:
            with self.subTest(prompt=prompt, answer=answer):
                guard = relay_module.ToolOutputGuard(
                    [{"role": "user", "content": prompt}]
                )
                output = []
                for char in answer:
                    output.extend(guard.feed(char, char))
                output.extend(guard.feed("END", final=True))
                self.assertFalse(guard.invalid)
                self.assertEqual("".join(output), answer + "END")

    def test_long_continuations_keep_the_same_reply_budget_as_the_web(self):
        text = "beginning\n" + "x" * 80_000 + "\nend"
        messages = [{"role": "user", "content": "Continue the program"}]
        continued = relay_module.continuation(messages, text)
        self.assertEqual(continued[-2]["content"], text)
        self.assertEqual(
            relay_module.ANSWER_KEEP, relay_module.CONTEXT_POLICY["replyChars"]
        )


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
    def test_keepalive_only_streams_recover_but_approval_waits_remain_open(self):
        for approval in (False, True):
            with self.subTest(approval=approval):
                _, relay, _ = self.boot([])
                ticks = iter([0, 121, 122, 123, 124])
                relay.clock = lambda: next(ticks, 125)
                response = io.BytesIO(b": keepalive\n\n: keepalive\n\n")
                run = relay_module.Run(RUN, OWNER)
                run.connection = mock.Mock()
                seen = {"content": "", "answer": "", "tools": [], "approval": approval}
                relay.relay(run, response, seen)
                self.assertEqual(seen["dropped"], not approval)
                self.assertTrue(response.closed)

    def test_done_finishes_while_provider_keeps_connection_open(self):
        release = threading.Event()
        self.addCleanup(release.set)

        def held_open(handler):
            handler.send_response(200)
            handler.send_header("Content-Type", "text/event-stream")
            handler.end_headers()
            for frame in [
                chunk("Finished answer.", "stop"),
                'data: {"usage":{"prompt_tokens":12,"completion_tokens":5}}',
                "data: [DONE]",
            ]:
                handler.wfile.write((frame + "\n\n").encode())
                handler.wfile.flush()
            release.wait(4)

        _, relay, port = self.boot([held_open])
        self.start(port)
        try:
            run = self.finished(relay, timeout=2)
            self.assertEqual(run.outcome, "complete")
            self.assertEqual(run.completion_tokens, 5)
        finally:
            release.set()

    def test_error_frame_tool_text_is_discarded_without_poisoning_recovery(self):
        bad = '{"name":"web_extract","arguments":{}}'
        hermes, relay, port = self.boot(
            [
                [
                    chunk(bad, "error", error={"message": "upstream stopped"}),
                    "data: [DONE]",
                ],
                [chunk("Supported answer.", "stop"), "data: [DONE]"],
            ]
        )
        self.start(port)
        self.assertEqual(self.finished(relay).outcome, "complete")
        self.assertNotIn(bad, json.dumps(hermes.requests[1]["body"]))
        self.assertFalse(
            any(
                m["role"] == "assistant" for m in hermes.requests[1]["body"]["messages"]
            )
        )
        _, frames = self.events(port)
        self.assertNotIn("web_extract", json.dumps(frames))

    def test_withheld_error_content_is_not_used_as_visible_continuation_context(self):
        hermes, relay, port = self.boot(
            [
                [
                    chunk('{"answer": '),
                    chunk('"unpublished"}', "error"),
                    "data: [DONE]",
                ],
                [chunk("42}", "stop"), "data: [DONE]"],
            ]
        )
        self.start(port, content="Give the answer as JSON")
        self.assertEqual(self.finished(relay).outcome, "complete")
        assistant = [
            m["content"]
            for m in hermes.requests[1]["body"]["messages"]
            if m["role"] == "assistant"
        ]
        self.assertEqual(assistant, ['{"answer": '])
        _, frames = self.events(port)
        self.assertNotIn("unpublished", json.dumps(frames))

    def test_unsuccessful_finish_reasons_are_not_overridden_by_done(self):
        for finish in [
            "cancelled",
            "content_filter",
            "unexpected",
            "",
            {"bad": "type"},
        ]:
            with self.subTest(finish=finish):
                hermes, relay, port = self.boot(
                    [
                        [
                            chunk("The partial answer "),
                            chunk(finish=finish),
                            "data: [DONE]",
                        ],
                        [chunk("is now complete.", "stop"), "data: [DONE]"],
                    ]
                )
                self.start(port)
                self.assertEqual(self.finished(relay).outcome, "complete")
                self.assertEqual(len(hermes.requests), 2)

    def test_native_terminal_tool_calls_require_a_fresh_answer(self):
        for finish in ["tool_calls", "function_call"]:
            with self.subTest(finish=finish):
                hermes, relay, port = self.boot(
                    [
                        [
                            chunk("I will look it up. "),
                            chunk(finish=finish),
                            "data: [DONE]",
                        ],
                        [chunk("The supported answer.", "stop"), "data: [DONE]"],
                    ]
                )
                self.start(port)
                self.assertEqual(self.finished(relay).outcome, "complete")
                _, frames = self.events(port)
                self.assertIn("jarvis.retry", [name for _, name, _ in frames])
                self.assertNotIn("jarvis.continue", [name for _, name, _ in frames])
                self.assertEqual(len(hermes.requests), 2)
                self.assertFalse(
                    any(
                        m["role"] == "assistant"
                        for m in hermes.requests[1]["body"]["messages"]
                    )
                )

    def test_read_failure_keeps_buffered_legitimate_json_for_continuation(self):
        _, relay, _ = self.boot([])
        run = relay_module.Run(RUN, OWNER)
        run.connection = mock.Mock()
        response = mock.Mock()
        response.readline.side_effect = [
            (chunk('{"phones": [') + "\n").encode(),
            b"\n",
            OSError("cut"),
        ]
        seen = {"content": "", "answer": "", "tools": [], "approval": False}
        relay.relay(run, response, seen)
        self.assertTrue(seen["dropped"])
        self.assertEqual(len(run.frames), 1)
        self.assertIn('{\\"phones\\": [', run.frames[0].decode())
        response.close.assert_called_once()

    def test_printed_tool_call_is_discarded_and_retried_without_continuation(self):
        bad = (
            "The function call that best answers the given prompt is:\n"
            '{"name": "web_extract", "parameters": {"char_limit": 15000, '
            '"urls": ["[https://www.apple.com/iphone/compare/](https://www.apple.com/iphone/compare/)"]}}'
        )
        for step in (1, 7, len(bad)):
            with self.subTest(step=step):
                hermes, relay, port = self.boot(
                    [
                        [
                            *[
                                chunk(bad[i : i + step])
                                for i in range(0, len(bad), step)
                            ],
                            chunk(finish="stop"),
                            "data: [DONE]",
                        ],
                        [
                            chunk("Here is the supported comparison.", "stop"),
                            "data: [DONE]",
                        ],
                    ]
                )
                self.start(port, content="Compare iPhone 15 Pro and iPhone 18 Pro Max")
                run = self.finished(relay)
                _, frames = self.events(port)
                self.assertEqual(run.outcome, "complete")
                self.assertEqual(len(hermes.requests), 2)
                self.assertNotIn("jarvis.continue", [name for _, name, _ in frames])
                content = "".join(
                    json.loads(data)["choices"][0]["delta"].get("content", "")
                    for _, name, data in frames
                    if name == "message" and data != "[DONE]"
                )
                self.assertEqual(content, "Here is the supported comparison.")
                self.assertNotIn(
                    '"role": "assistant"', json.dumps(hermes.requests[1]["body"])
                )

    def test_repeated_raw_tool_json_fails_without_publishing_or_completing(self):
        bad = '```json\n{"name": "web_extract", "parameters": {"urls": ["https://apple.com"]}}\n```'
        hermes, relay, port = self.boot([[chunk(bad, "stop"), "data: [DONE]"]] * 3)
        self.start(port, content="Compare the phones")
        run = self.finished(relay)
        _, frames = self.events(port)
        self.assertEqual(run.outcome, "error")
        self.assertEqual(len(hermes.requests), 3)
        self.assertIn("invalid_output", json.dumps(frames))
        self.assertNotIn("web_extract", json.dumps(frames))
        self.assertNotIn("jarvis.complete", [name for _, name, _ in frames])

    def setUp(self):
        self.servers = []

    def tearDown(self):
        for server in self.servers:
            server.shutdown()
            server.server_close()

    def test_repeating_comparison_is_stopped_without_continuing_the_loop(self):
        row = "| | 249g | 187g |\n"
        answer = "| Feature | New phone | Current phone |\n|---|---|---|\n" + row * 42
        # Providers can split a row at any character, or put the whole loop in
        # one frame, including a token-limit finish that previously continued it.
        for width in (1, 7, len(answer)):
            with self.subTest(width=width):
                pieces = [
                    chunk(answer[i : i + width]) for i in range(0, len(answer), width)
                ]
                script = [
                    *pieces,
                    chunk(finish="length"),
                    "data: [DONE]",
                ]
                hermes, relay, port = self.boot([script, script])
                self.start(port)
                run = self.finished(relay)
                _, frames = self.events(port)
                output = json.dumps(frames)
                self.assertEqual(run.outcome, "error")
                self.assertIn("repetitive_output", output)
                self.assertNotIn("jarvis.continue", output)
                self.assertNotIn("jarvis.complete", output)
                self.assertEqual(len(hermes.requests), 2)
                self.assertNotIn("249g", json.dumps(hermes.requests[1]["body"]))
                visible = "".join(
                    json.loads(data)["choices"][0]["delta"].get("content", "")
                    for _, name, data in frames
                    if name == "message" and data != "[DONE]"
                )
                self.assertLess(visible.count(row), 32)

    def test_inline_loop_is_stopped_before_upstream_completion(self):
        script = [
            chunk("Here is the comparison. "),
            *[chunk("The phones weigh 249g and 187g. ") for _ in range(100)],
        ]
        hermes, relay, port = self.boot([script, script])
        self.start(port)
        run = self.finished(relay)
        _, frames = self.events(port)
        self.assertEqual(run.outcome, "error")
        self.assertIn("repetitive_output", json.dumps(frames))
        self.assertEqual(len(hermes.requests), 2)

    def test_detected_loop_closes_the_unfinished_upstream_response(self):
        _, relay, _ = self.boot([])
        run = relay_module.Run(RUN, OWNER)
        run.connection = mock.Mock()
        raw = ((chunk("| | 249g | 187g |\n") + "\n\n") * 100).encode()
        response = io.BytesIO(raw)
        seen = {"content": "", "answer": "", "tools": [], "approval": False}
        relay.relay(run, response, seen)
        self.assertTrue(seen["repetitive"])
        self.assertFalse(seen["finished"])
        self.assertTrue(response.closed)
        run.connection.close.assert_called_once()

    def test_repetition_recovery_replaces_the_answer_from_clean_context(self):
        answer = "Here is the concise comparison with each feature listed once."
        hermes, relay, port = self.boot(
            [
                [chunk("| | 249g | 187g |\n" * 42, "length"), "data: [DONE]"],
                [chunk(answer, "stop"), "data: [DONE]"],
            ]
        )
        self.start(port)
        run = self.finished(relay)
        _, frames = self.events(port)
        self.assertEqual(run.outcome, "complete")
        names = [name for _, name, _ in frames]
        self.assertEqual(names.count("jarvis.retry"), 1)
        self.assertNotIn("jarvis.continue", names)
        self.assertNotIn("249g", json.dumps(hermes.requests[1]["body"]))
        self.assertEqual(
            hermes.requests[1]["body"]["messages"][:-1],
            hermes.requests[0]["body"]["messages"],
        )
        self.assertIn(answer, json.dumps(frames))

    def test_equal_values_with_distinct_row_labels_are_preserved(self):
        answer = (
            "| Feature | A | B |\n|---|---|---|\n"
            + "".join(f"| Measurement {i} | 249g | 187g |\n" for i in range(42))
            + "\n"
            + "Again, " * 3
            + "these values match.\n```python\n"
            + "\n".join(f"result_{i} = calculate({i})" for i in range(40))
            + "\n```"
        )
        hermes, relay, port = self.boot([[chunk(answer, "stop"), "data: [DONE]"]])
        self.start(port)
        run = self.finished(relay)
        _, frames = self.events(port)
        self.assertEqual(run.outcome, "complete")
        self.assertIn(
            answer,
            [
                json.loads(data)["choices"][0]["delta"].get("content")
                for _, name, data in frames
                if name == "message" and data != "[DONE]"
            ],
        )
        self.assertEqual(len(hermes.requests), 1)

    def test_loop_detection_carries_across_token_limit_continuations(self):
        row = "| | 249g | 187g |\n"
        hermes, relay, port = self.boot(
            [
                [chunk(row * 7, "length"), "data: [DONE]"],
                [chunk(row * 7, "length"), "data: [DONE]"],
                [chunk("A fresh comparison.", "stop"), "data: [DONE]"],
            ]
        )
        self.start(port)
        run = self.finished(relay)
        _, frames = self.events(port)
        names = [name for _, name, _ in frames]
        self.assertEqual(run.outcome, "complete")
        self.assertEqual(names.count("jarvis.continue"), 1)
        self.assertEqual(names.count("jarvis.retry"), 1)
        self.assertNotIn("249g", json.dumps(hermes.requests[2]["body"]))

    def test_corrupt_answer_chunks_trigger_recovery_instead_of_false_success(self):
        hermes, relay, port = self.boot(
            [
                [chunk("The answer is "), 'data: {"choices":broken}', "data: [DONE]"],
                [chunk("42.", "stop"), "data: [DONE]"],
            ]
        )
        self.start(port)
        run = self.finished(relay)
        _, frames = self.events(port)
        output = json.dumps(frames)
        self.assertEqual(len(hermes.requests), 2)
        self.assertIn("jarvis.continue", output)
        self.assertNotIn("broken", output)
        self.assertEqual(run.outcome, "complete")

    def test_non_text_deltas_cannot_leak_object_strings_into_the_answer(self):
        malformed = [
            {"choices": [{"delta": {"content": {"text": "bad"}}}]},
            {"choices": [{"delta": {"reasoning_content": ["bad"]}}]},
            {"choices": [{"delta": "bad"}]},
            {"choices": {"delta": {"content": "bad"}}},
            {"choices": [{"delta": {"role": "tool", "content": "bad"}}]},
            {"choices": [{"delta": {"role": "system", "content": "bad"}}]},
        ]
        for payload in malformed:
            with self.subTest(payload=payload):
                hermes, relay, port = self.boot(
                    [
                        ["data: " + json.dumps(payload), "data: [DONE]"],
                        [chunk("A valid answer.", "stop"), "data: [DONE]"],
                    ]
                )
                self.start(port)
                run = self.finished(relay)
                _, frames = self.events(port)
                self.assertEqual(run.outcome, "complete")
                self.assertEqual(len(hermes.requests), 2)
                self.assertNotIn("bad", json.dumps(frames))

    def test_invalid_utf8_is_not_silently_replaced_inside_an_answer(self):
        _, relay, _ = self.boot([])
        response = io.BytesIO(
            b'data: {"choices":[{"delta":{"content":"bad\xff"}}]}\n\n'
        )
        run = relay_module.Run(RUN, OWNER)
        run.connection = mock.Mock()
        seen = {"content": "", "answer": "", "tools": [], "approval": False}
        relay.relay(run, response, seen)
        self.assertTrue(seen["dropped"])
        self.assertEqual(run.frames, [])
        self.assertTrue(response.closed)

    def test_unfinished_stream_frames_are_bounded_before_parsing(self):
        _, relay, _ = self.boot([])
        for raw in [b"data: " + b"x" * 200, b"data: x\n" * 30]:
            with (
                self.subTest(raw=raw[:20]),
                mock.patch.object(relay_module, "FRAME_BYTES", 128),
            ):
                run = relay_module.Run(RUN, OWNER)
                run.connection = mock.Mock()
                seen = {"content": "", "answer": "", "tools": [], "approval": False}

                class TrackedResponse(io.BytesIO):
                    bytes_read = 0

                    def readline(self, size=-1):
                        line = super().readline(size)
                        self.bytes_read += len(line)
                        return line

                response = TrackedResponse(raw)
                relay.relay(run, response, seen)
                self.assertTrue(seen["dropped"])
                self.assertFalse(seen["finished"])
                self.assertEqual(run.frames, [])
                self.assertLessEqual(
                    response.bytes_read, 136, "read stops near the frame budget"
                )
                self.assertTrue(response.closed)
                run.connection.close.assert_called_once()

    def boot(self, scripts):
        hermes = FakeHermes(scripts)
        self.addCleanup(hermes.close)
        relay, server = relay_module.serve(
            0, hermes.server.server_port, KEY, host="127.0.0.1"
        )
        relay.sleep = lambda seconds: None
        relay.report = lambda line: None
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

    def test_model_trace_accepts_bounded_identifiers_without_echoing_secret_like_metadata(self):
        frames=['data: '+json.dumps({'model':model,'choices':[]}) for model in
                ['vendor/model-1','auto','sk-private-token','private data with spaces']]
        _,relay,port=self.boot([frames+[chunk('Done.','stop'),'data: [DONE]']])
        self.start(port)
        run=self.finished(relay)
        record=run.trace.record(run.id,run.outcome,run.route,run.upstream_requests)
        self.assertEqual(record['model_ids'],['vendor/model-1'])
        self.assertEqual(record['model_identity'],'upstream_reported')
        self.assertNotIn('private',str(record))

    def test_wrong_execution_runtime_cannot_satisfy_an_explicit_named_tool(self):
        def progress(name,status):
            return 'event: hermes.tool.progress\ndata: '+json.dumps({'tool':name,'toolCallId':name,'status':status})
        wrong=[progress('python_verify','running'),progress('python_verify','completed'),
               chunk('{"runtime":"python"}','stop'),'data: [DONE]']
        correct=[progress('javascript_verify','running'),progress('javascript_verify','completed'),
                 chunk('{"runtime":"javascript"}','stop'),'data: [DONE]']
        hermes,relay,port=self.boot([wrong,correct])
        self.start(port,content='Actually use javascript_verify to execute the tests. Return ONLY JSON.')
        run=self.finished(relay)
        self.assertEqual(run.outcome,'complete')
        self.assertEqual(len(hermes.requests),2)
        self.assertEqual(run.trace.counts['contract_recoveries'],1)
        self.assertEqual(run.trace.executed_tools,{'python_verify','javascript_verify'})
        wire=b''.join(run.frames).decode()
        self.assertNotIn(json.dumps('{"runtime":"python"}'),wire)
        self.assertNotIn(json.dumps('{"runtime":"python"}'),json.dumps(hermes.requests[1]))

    def test_exact_arithmetic_needs_no_provider_call(self):
        hermes,relay,port=self.boot([])
        self.start(port,content='What is 17 times 23? Answer with just the number.')
        run=self.finished(relay)
        self.assertEqual(run.outcome,'complete')
        self.assertEqual(run.route,'calculator')
        self.assertEqual(len(hermes.requests),0)
        self.assertIn('391',b''.join(run.frames).decode())

    def test_explicit_json_withholds_bad_candidate_and_repairs_once(self):
        hermes, relay, port=self.boot([[chunk('Here is the answer: {"value":7}', 'stop'),'data: [DONE]'],
                                      [chunk('```json\n{"value":7}\n```','stop'),'data: [DONE]']])
        self.start(port,content='Return only one valid JSON object with value 7.')
        run=self.finished(relay)
        self.assertEqual(run.outcome,'complete')
        wire=b''.join(run.frames).decode()
        self.assertNotIn('Here is the answer',wire)
        emitted=[]
        for frame in run.frames:
            for line in frame.decode().splitlines():
                if line.startswith('data: {"choices"'):
                    emitted.append(json.loads(line[6:])['choices'][0]['delta'].get('content',''))
        self.assertEqual(''.join(emitted),'{"value":7}')
        self.assertEqual(len(hermes.requests),2)
        self.assertNotIn('Here is the answer',json.dumps(hermes.requests[1]))
        self.assertEqual(run.trace.counts['contract_recoveries'],1)

    def test_repeated_length_contract_failure_is_an_error_without_partial_leak(self):
        hermes,relay,port=self.boot([[chunk('One two three four five.','stop'),'data: [DONE]']]*3)
        self.start(port,content='Answer in at most 2 words.')
        run=self.finished(relay)
        self.assertEqual(run.outcome,'error')
        wire=b''.join(run.frames).decode()
        self.assertIn('answer_contract',wire)
        self.assertNotIn('One two three',wire)
        self.assertNotIn('jarvis.complete',wire)
        self.assertEqual(len(hermes.requests),2)

    def test_a_negative_content_length_is_refused_instead_of_hanging(self):
        _, _, port = self.boot([])
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        connection.putrequest("POST", "/vaelo/runs")
        connection.putheader("Authorization", f"Bearer {KEY}")
        connection.putheader("X-Hermes-Session-Key", OWNER)
        connection.putheader("Content-Length", "-1")
        connection.endheaders()
        self.assertEqual(connection.getresponse().status, 400)

    def test_non_object_run_requests_are_refused_without_starting_a_reply(self):
        hermes, relay, port = self.boot([])
        for body in ([], ["message"], "text", 42, True):
            with self.subTest(body=body):
                status, response = self.call(port, "POST", "/vaelo/runs", body)
                self.assertEqual(status, 400)
                self.assertEqual(json.loads(response), {"error": "invalid run"})
        self.assertEqual(relay.runs, {})
        self.assertEqual(hermes.requests, [])

    def test_guest_replies_expose_only_public_weather_and_stay_off_hermes(self):
        guest = (
            "web:guest:"
            + "a" * 8
            + "-"
            + "b" * 4
            + "-"
            + "c" * 4
            + "-"
            + "d" * 4
            + "-"
            + "e" * 12
        )
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
        self.assertEqual([tool["function"]["name"] for tool in sent["body"]["tools"]], ["weather_forecast"])
        self.assertEqual(relay.guest_active, 0)

    def test_guests_use_the_router_with_only_public_weather_and_no_host_access(self):
        hermes, relay, port = self.boot([])
        provider, _ = self.fast_provider(
            relay, [[chunk("No code was executed.", "stop"), "data: [DONE]"]]
        )
        with mock.patch.dict(
            "os.environ",
            {
                "FREELLMAPI_URL": "https://router.example",
                "FREELLMAPI_API_KEY": "router-key",
            },
            clear=True,
        ):
            self.start(port, owner="web:guest:test")
            run = self.finished(relay)
        self.assertEqual(run.outcome, "complete")
        self.assertEqual(run.route, "router")
        self.assertEqual(hermes.requests, [])
        sent = provider.requests[0]
        self.assertEqual(sent["body"]["model"], "auto")
        self.assertEqual(sent["headers"]["X-FreeLLM-Task-Type"], "chat")
        self.assertEqual(sent["body"]["max_tokens"], relay_module.GUEST_MAX_TOKENS)
        self.assertEqual([tool["function"]["name"] for tool in sent["body"]["tools"]], ["weather_forecast"])

    def test_guest_router_failure_falls_back_to_openrouter_without_hermes(self):
        hermes, relay, port = self.boot([])
        router, _ = self.fast_provider(relay, [503])
        provider = FakeHermes([[chunk("Hello.", "stop"), "data: [DONE]"]])
        self.addCleanup(provider.close)
        relay.guest_connect = lambda: http.client.HTTPConnection(
            "127.0.0.1", provider.server.server_port, timeout=10
        )
        with mock.patch.dict(
            "os.environ",
            {
                "FREELLMAPI_URL": "https://router.example",
                "FREELLMAPI_API_KEY": "router-key",
                "OPENROUTER_API_KEY": "or-key",
            },
            clear=True,
        ):
            self.start(port, owner="web:guest:test")
            run = self.finished(relay)
        self.assertEqual(run.outcome, "complete")
        self.assertEqual(run.route, "openrouter")
        self.assertEqual(len(router.requests), 1)
        self.assertEqual(hermes.requests, [])
        self.assertEqual(provider.requests[0]["body"]["model"], "openrouter/free")
        self.assertEqual(
            provider.requests[0]["headers"]["Authorization"], "Bearer or-key"
        )
        self.assertEqual([tool["function"]["name"] for tool in provider.requests[0]["body"]["tools"]], ["weather_forecast"])

    def start_fast(self, port, fast="You are Vaelo, briefly.", effort="minimal"):
        return self.call(
            port,
            "POST",
            "/vaelo/runs",
            {
                "id": RUN,
                "messages": [
                    {"role": "system", "content": "full prompt"},
                    {"role": "user", "content": "hello"},
                ],
                "model_options": {"reasoning_effort": effort},
                "fast": fast,
            },
        )

    def fast_provider(self, relay, scripts):
        provider = FakeHermes(scripts)
        self.addCleanup(provider.close)
        targets = []

        def connect(host, port):
            targets.append((host, port))
            return http.client.HTTPConnection(
                "127.0.0.1", provider.server.server_port, timeout=10
            )

        relay.fast_connect = connect
        return provider, targets

    def test_a_quick_reply_exposes_only_public_weather_and_stays_off_hermes(
        self,
    ):
        hermes, relay, port = self.boot([])
        provider, targets = self.fast_provider(
            relay, [[chunk("Hi there.", "stop"), "data: [DONE]"]]
        )
        env = {
            "FREELLMAPI_URL": "https://router.example/v1",
            "FREELLMAPI_API_KEY": "fk",
            "OPENROUTER_API_KEY": "or-key",
        }
        with mock.patch.dict("os.environ", env):
            self.assertEqual(self.start_fast(port)[0], 202)
            run = self.finished(relay)
        self.assertEqual(run.outcome, "complete")
        self.assertEqual(run.route, "router")
        self.assertEqual(hermes.requests, [])
        self.assertEqual(targets, [("router.example", None)])
        sent = provider.requests[0]
        self.assertEqual(sent["path"], "/v1/chat/completions")
        self.assertEqual(sent["headers"]["Authorization"], "Bearer fk")
        self.assertEqual(sent["headers"]["X-FreeLLM-Task-Type"], "chat")
        body = sent["body"]
        self.assertEqual(body["model"], "auto")
        self.assertEqual(
            body["messages"][0],
            {"role": "system", "content": "You are Vaelo, briefly." + relay_module.WEATHER_GUIDANCE},
        )
        self.assertEqual([m["role"] for m in body["messages"]], ["system", "user"])
        self.assertEqual(body["reasoning"], {"effort": "minimal"})
        self.assertEqual([tool["function"]["name"] for tool in body["tools"]], ["weather_forecast"])

    def test_without_a_router_a_quick_reply_uses_openrouter_free(self):
        hermes, relay, port = self.boot([])
        provider, targets = self.fast_provider(
            relay, [[chunk("Hi.", "stop"), "data: [DONE]"]]
        )
        with mock.patch.dict(
            "os.environ", {"OPENROUTER_API_KEY": "or-key", "FREELLMAPI_URL": ""}
        ):
            self.start_fast(port)
            run = self.finished(relay)
        self.assertEqual((run.outcome, run.route), ("complete", "openrouter"))
        self.assertEqual(targets, [("openrouter.ai", None)])
        self.assertEqual(provider.requests[0]["path"], "/api/v1/chat/completions")
        self.assertEqual(provider.requests[0]["body"]["model"], "openrouter/free")
        self.assertEqual(hermes.requests, [])

    def test_a_failing_fast_route_falls_back_to_hermes_with_the_full_prompt(self):
        hermes, relay, port = self.boot(
            [[chunk("From Hermes.", "stop"), "data: [DONE]"]]
        )
        provider, _ = self.fast_provider(relay, [503])
        with mock.patch.dict(
            "os.environ", {"OPENROUTER_API_KEY": "or-key", "FREELLMAPI_URL": ""}
        ):
            self.start_fast(port)
            run = self.finished(relay)
        self.assertEqual((run.outcome, run.route), ("complete", "hermes"))
        self.assertEqual(len(provider.requests), 1)
        self.assertEqual(
            hermes.requests[0]["body"]["messages"][0]["content"], "full prompt"
        )
        self.assertEqual(
            hermes.requests[0]["body"]["model_options"], {"reasoning_effort": "minimal"}
        )

    def test_an_empty_fast_reply_is_recovered_by_hermes_not_retried_fast(self):
        hermes, relay, port = self.boot(
            [[chunk("Written by Hermes.", "stop"), "data: [DONE]"]]
        )
        provider, _ = self.fast_provider(relay, [[chunk("", "stop"), "data: [DONE]"]])
        with mock.patch.dict(
            "os.environ", {"OPENROUTER_API_KEY": "or-key", "FREELLMAPI_URL": ""}
        ):
            self.start_fast(port)
            run = self.finished(relay)
        self.assertEqual(run.outcome, "complete")
        self.assertEqual(len(provider.requests), 1)
        self.assertEqual(len(hermes.requests), 1)

    def test_a_partial_fast_answer_continues_without_agent_overhead(self):
        hermes, relay, port = self.boot([])
        provider, _ = self.fast_provider(
            relay,
            [
                [chunk("First half ")],
                [chunk("second half.", "stop"), "data: [DONE]"],
            ],
        )
        with mock.patch.dict(
            "os.environ", {"OPENROUTER_API_KEY": "key", "FREELLMAPI_URL": ""}
        ):
            self.start_fast(port)
            run = self.finished(relay)
        self.assertEqual(run.outcome, "complete")
        self.assertEqual(len(provider.requests), 2)
        self.assertEqual(hermes.requests, [])
        messages = provider.requests[1]["body"]["messages"]
        self.assertEqual(messages[-2], {"role": "assistant", "content": "First half "})
        self.assertIn(
            "Continue it from exactly where it stops", messages[-1]["content"]
        )
        self.assertEqual([t["function"]["name"] for t in provider.requests[1]["body"]["tools"]], ["weather_forecast"])

    def test_a_failed_direct_continuation_still_falls_back_to_hermes(self):
        hermes, relay, port = self.boot([[chunk("finished.", "stop")]])
        provider, _ = self.fast_provider(relay, [[chunk("Started ")], 503])
        with mock.patch.dict(
            "os.environ", {"OPENROUTER_API_KEY": "key", "FREELLMAPI_URL": ""}
        ):
            self.start_fast(port)
            run = self.finished(relay)
        self.assertEqual(run.outcome, "complete")
        self.assertEqual(len(provider.requests), 2)
        self.assertEqual(len(hermes.requests), 1)
        self.assertEqual(
            hermes.requests[0]["body"]["messages"][0]["content"], "full prompt"
        )

    def test_an_empty_direct_continuation_escalates_to_hermes(self):
        hermes, relay, port = self.boot([[chunk("finished.", "stop")]])
        provider, _ = self.fast_provider(
            relay, [[chunk("Started ")], [chunk("", "stop")]]
        )
        with mock.patch.dict(
            "os.environ", {"OPENROUTER_API_KEY": "key", "FREELLMAPI_URL": ""}
        ):
            self.start_fast(port)
            run = self.finished(relay)
        self.assertEqual(run.outcome, "complete")
        self.assertEqual(len(provider.requests), 2)
        self.assertEqual(len(hermes.requests), 1)

    def test_length_finish_is_continued_even_when_done_arrives(self):
        hermes, relay, port = self.boot(
            [
                [chunk("Partial ", "length"), "data: [DONE]"],
                [chunk("complete.", "stop"), "data: [DONE]"],
            ]
        )
        self.start(port)
        self.assertEqual(self.finished(relay).outcome, "complete")
        self.assertEqual(len(hermes.requests), 2)
        self.assertEqual(
            hermes.requests[1]["body"]["messages"][-2]["content"], "Partial "
        )

    def test_exhausted_length_continuations_are_not_false_success(self):
        _, relay, port = self.boot([[chunk("Partial ", "length"), "data: [DONE]"]] * 3)
        self.start(port)
        self.assertEqual(self.finished(relay).outcome, "error")

    def test_a_completed_answer_with_a_late_socket_error_is_not_regenerated(self):
        _, relay, port = self.boot([])
        run = relay_module.Run(RUN, OWNER)
        response = mock.Mock()
        response.readline.side_effect = [
            (chunk("Complete answer.", "stop") + "\n").encode(),
            b"\n",
            OSError("closed"),
        ]
        with mock.patch.object(relay, "open", return_value=(response, None)) as opened:
            run.connection = mock.Mock()
            relay.execute(run, {"messages": [{"role": "user", "content": "hello"}]})
        self.assertEqual(run.outcome, "complete")
        self.assertEqual(opened.call_count, 1)

    def test_usage_is_counted_once_per_attempt_and_summed_across_recovery(self):
        usage = 'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":80}}}'
        hermes, relay, port = self.boot(
            [
                [chunk("Partial "), usage, usage],
                [chunk("finished.", "stop"), usage, "data: [DONE]"],
            ]
        )
        reports = []
        relay.report = reports.append
        relay.usage_reporter = mock.Mock()
        self.start(port)
        run = self.finished(relay)
        self.assertEqual(
            (run.prompt_tokens, run.completion_tokens, run.cached_tokens),
            (200, 40, 160),
        )
        self.assertEqual((run.usage_reports, run.upstream_requests), (2, 2))
        events = [call.args[0] for call in relay.usage_reporter.record.call_args_list]
        self.assertEqual(len(events), 2)
        self.assertEqual(len({event["id"] for event in events}), 2)
        self.assertEqual(sum(event["input"] + event["output"] for event in events), 240)
        self.assertTrue(all(event["reported"] for event in events))
        self.assertEqual(len(hermes.requests), 2)
        traces = [json.loads(line) for line in reports if line.startswith('{"schema": 1, "kind": "vaelo.trace"')]
        self.assertEqual(len(traces), 1)
        self.assertEqual(traces[0]["run"], RUN)
        self.assertEqual(traces[0]["counts"]["upstream_requests"], 2)
        self.assertEqual(traces[0]["outcome"], "complete")
        self.assertNotIn("Partial", json.dumps(traces))

    def test_reposting_a_failed_generated_run_replays_without_model_calls(self):
        empty = [chunk("", "stop"), "data: [DONE]"]
        hermes, relay, port = self.boot([empty] * 3)
        self.start(port)
        original = self.finished(relay)
        self.assertEqual(original.outcome, "error")
        self.assertEqual(len(hermes.requests), 3)
        self.start(port)
        self.assertIs(self.finished(relay), original)
        self.assertEqual(len(hermes.requests), 3)

    def test_a_malformed_fast_prompt_is_ignored_and_hermes_answers(self):
        for fast in (42, "", "x" * (relay_module.FAST_SYSTEM_CHARS + 1)):
            with self.subTest(fast=type(fast).__name__):
                hermes, relay, port = self.boot(
                    [[chunk("Hermes.", "stop"), "data: [DONE]"]]
                )
                provider, _ = self.fast_provider(relay, [])
                with mock.patch.dict("os.environ", {"OPENROUTER_API_KEY": "or-key"}):
                    self.start_fast(port, fast=fast)
                    run = self.finished(relay)
                    relay.runs.clear()
                self.assertEqual(run.route, "hermes")
                self.assertEqual(provider.requests, [])

    def test_guests_send_the_requested_reasoning_depth_never_none(self):
        guest = "web:guest:depth"
        for effort, expected in (
            ("low", {"effort": "low"}),
            ("none", {"effort": "minimal"}),
            (None, None),
        ):
            with self.subTest(effort=effort):
                _, relay, port = self.boot([])
                provider = FakeHermes([[chunk("Hello.", "stop"), "data: [DONE]"]])
                self.addCleanup(provider.close)
                relay.guest_connect = lambda: http.client.HTTPConnection(
                    "127.0.0.1", provider.server.server_port, timeout=10
                )
                with mock.patch.dict("os.environ", {"OPENROUTER_API_KEY": "or-key"}):
                    self.call(
                        port,
                        "POST",
                        "/vaelo/runs",
                        {
                            "id": RUN,
                            "messages": [{"role": "user", "content": "hi"}],
                            **(
                                {"model_options": {"reasoning_effort": effort}}
                                if effort
                                else {}
                            ),
                        },
                        owner=guest,
                    )
                    self.finished(relay)
                self.assertEqual(
                    provider.requests[0]["body"].get("reasoning"), expected
                )

    def test_fast_route_prefers_an_https_router_and_needs_a_key(self):
        route = relay_module.fast_route
        self.assertIsNone(route({}))
        self.assertEqual(route({"OPENROUTER_API_KEY": "k"})["name"], "openrouter")
        self.assertEqual(
            route(
                {
                    "FREELLMAPI_URL": "http://plain.example",
                    "FREELLMAPI_API_KEY": "f",
                    "OPENROUTER_API_KEY": "k",
                }
            )["name"],
            "openrouter",
        )
        router = route(
            {"FREELLMAPI_URL": "https://r.example:8443/", "FREELLMAPI_API_KEY": "f"}
        )
        self.assertEqual(
            (router["host"], router["port"], router["path"]),
            ("r.example", 8443, "/v1/chat/completions"),
        )

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
        with (
            mock.patch.object(relay_module, "FEED_SECONDS", 1),
            mock.patch.object(relay_module, "KEEPALIVE_SECONDS", 0.2),
        ):
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
            _, text = self.call(
                port, "GET", "/vaelo/feed?after=0", owner="web:someone-else"
            )
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

    def test_retrying_a_completed_start_replays_the_answer_without_running_tools_again(
        self,
    ):
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
        hermes, relay, port = self.boot(
            [[chunk("Never sent.", "stop"), "data: [DONE]"]]
        )
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

    def test_unresolved_live_citations_recover_with_links_or_fail_explicitly(self):
        for recovered, outcome in (('Verified [source](https://official.example/current).', 'complete'),
                                   ('Still unsupported 【1】.', 'error')):
            with self.subTest(outcome=outcome):
                hermes, relay, port = self.boot([
                    [chunk('An unsupported claim 【1】.', 'stop'), 'data: [DONE]'],
                    [chunk(recovered, 'stop'), 'data: [DONE]'],
                ])
                with mock.patch.object(relay_module, 'source_context', return_value={'content': 'Retrieved evidence'}):
                    self.call(port, 'POST', '/vaelo/runs', {'id': RUN,
                        'messages': [{'role': 'user', 'content': 'Current facts?'}], 'freshness': 'Current facts?'})
                    run = self.finished(relay)
                self.assertEqual(run.outcome, outcome)
                self.assertEqual(run.trace.counts['source_recoveries'], 1)
                self.assertEqual(len(hermes.requests), 2)
                self.assertIn('actual tool results', hermes.requests[1]['body']['messages'][-1]['content'])
                _, frames = self.events(port)
                self.assertIn('jarvis.retry', [name for _, name, _ in frames])
                if outcome == 'error':
                    self.assertIn('unverified_sources', json.dumps(frames))

    def test_fresh_sources_are_fetched_before_generation_and_reused_on_recovery(self):
        hermes, relay, port = self.boot(
            [
                [chunk("", "stop"), "data: [DONE]"],
                [chunk("An answer with sources.", "stop"), "data: [DONE]"],
            ]
        )
        evidence = {
            "role": "user",
            "content": "Live-source context: https://official.example/release",
        }
        body = {
            "id": RUN,
            "messages": [
                {"role": "system", "content": "s"},
                {"role": "user", "content": "Compare phone 15 and phone 18"},
            ],
            "freshness": "Compare phone 15 and phone 18",
            "fast": "short prompt",
        }
        with mock.patch.object(
            relay_module, "source_context", return_value=evidence
        ) as lookup:
            self.assertEqual(self.call(port, "POST", "/vaelo/runs", body)[0], 202)
            self.assertEqual(self.finished(relay).outcome, "complete")
            self.call(port, "POST", "/vaelo/runs", body)
        lookup.assert_called_once_with(body["freshness"])
        self.assertEqual(len(hermes.requests), 2)
        first = hermes.requests[0]["body"]["messages"]
        self.assertEqual(len(first), 2, "evidence is not a separate trailing message")
        self.assertEqual(first[0], body["messages"][0])
        self.assertTrue(
            first[-1]["content"].startswith("Compare phone 15 and phone 18")
        )
        self.assertIn(evidence["content"], first[-1]["content"])
        self.assertIn(
            "official.example", hermes.requests[1]["body"]["messages"][-1]["content"]
        )

    def test_fresh_sources_stay_attached_to_a_request_with_an_attached_file(self):
        hermes, relay, port = self.boot([[chunk("Sized.", "stop"), "data: [DONE]"]])
        request = (
            "I grow cotton near College Station. What size pump do I need?\n\n"
            "Attached file: season.csv\n```csv\ndate,et\n2026-04-15,0.21\n```"
        )
        evidence = {
            "role": "user",
            "content": "Live-source context: https://texasET.example",
        }
        body = {
            "id": RUN,
            "messages": [{"role": "user", "content": request}],
            "freshness": "irrigation pump College Station",
        }
        with mock.patch.object(relay_module, "source_context", return_value=evidence):
            self.assertEqual(self.call(port, "POST", "/vaelo/runs", body)[0], 202)
            self.assertEqual(self.finished(relay).outcome, "complete")
        sent = hermes.requests[0]["body"]["messages"]
        self.assertEqual(len(sent), 1)
        self.assertTrue(sent[0]["content"].startswith(request))
        self.assertIn("texasET.example", sent[0]["content"])

    def test_stopping_during_source_lookup_prevents_generation(self):
        _, relay, _ = self.boot([])
        run = relay_module.Run(RUN, OWNER)

        def stopped(query):
            run.stopped = True
            return {"role": "user", "content": "evidence"}

        with (
            mock.patch.object(relay_module, "source_context", side_effect=stopped),
            mock.patch.object(relay, "open") as opened,
        ):
            relay.execute(
                run,
                {
                    "messages": [{"role": "user", "content": "latest phone"}],
                    "freshness": "latest phone",
                },
            )
        self.assertEqual(run.outcome, "stopped")
        opened.assert_not_called()

    def test_weather_requests_always_reach_language_model_interpretation(self):
        for prompt in ('Give me the outlook for the coming seven days', '¿Y el resto de la semana?', 'इस हफ्ते मौसम कैसा रहेगा?', '这周呢？'):
            hermes, relay, port = self.boot([[chunk('A model interpreted the request.', 'stop'), 'data: [DONE]']])
            self.start(port, content=prompt)
            self.assertEqual(self.finished(relay).outcome, 'complete')
            self.assertIn(prompt, json.dumps(hermes.requests[0]['body'], ensure_ascii=False))

    def test_hermes_weather_reference_appends_exact_provider_result(self):
        marker = '[[vaelo-weather:' + 'a'*24 + ']]'
        _, relay, port = self.boot([[chunk(marker, 'stop'), 'data: [DONE]']])
        with mock.patch.object(relay_module, 'read_forecast', return_value='VERIFIED FORECAST') as read:
            self.start(port, content='And for the whole week?')
            self.assertEqual(self.finished(relay).outcome, 'complete')
        self.assertEqual(read.call_args.args, ('a'*24,))
        self.assertGreater(read.call_args.kwargs['not_before'], 0)
        _, frames = self.events(port)
        self.assertIn('VERIFIED FORECAST', json.dumps(frames))

    def test_direct_weather_tool_calls_are_executed_not_printed(self):
        args = json.dumps({'days':7})
        pieces = [
            'data: ' + json.dumps({'choices':[{'delta':{'tool_calls':[{'index':0,'function':{'name':'weather_forecast','arguments':args[:5]}}]}}]}),
            'data: ' + json.dumps({'choices':[{'delta':{'tool_calls':[{'index':0,'function':{'arguments':args[5:]}}]},'finish_reason':'tool_calls'}]}),
            'data: [DONE]',
        ]
        _, relay, port = self.boot([])
        marker = '[[vaelo-weather:' + 'b'*24 + ']]'
        provider, _ = self.fast_provider(relay, [pieces, [chunk(marker, 'stop'), 'data: [DONE]']])
        with mock.patch.dict('os.environ', {'FREELLMAPI_URL':'https://router.example','FREELLMAPI_API_KEY':'test'}), mock.patch.object(relay_module,'weather_tool',return_value=json.dumps({'success':True,'reference':marker})) as tool, mock.patch.object(relay_module,'read_forecast',return_value='SEVEN VERIFIED DAYS'):
            self.call(port, 'POST', '/vaelo/runs', {'id': RUN, 'messages':[{'role':'user','content':'¿Y esta semana?'}], 'fast':'You are Vaelo.', 'place':{'lat':30.6,'lon':-96.3}})
            run = self.finished(relay)
        tool.assert_called_once_with({'days':7,'latitude':30.6,'longitude':-96.3})
        self.assertEqual(run.outcome, 'complete')
        _, frames = self.events(port)
        self.assertIn('SEVEN VERIFIED DAYS', json.dumps(frames))
        self.assertNotIn('tool_calls', json.dumps(frames))
        progress = [json.loads(data) for _, name, data in frames if name == 'hermes.tool.progress']
        self.assertEqual([item['status'] for item in progress], ['running', 'completed'])
        self.assertTrue(all(item['tool'] == 'weather_forecast' for item in progress))
        self.assertEqual(run.trace.counts['tool_starts'], 1)
        self.assertFalse(run.trace.active_tools)
        self.assertEqual(len(provider.requests), 2)
        self.assertNotIn('tools', provider.requests[1]['body'])
        self.assertEqual(provider.requests[1]['body']['messages'][-1]['role'], 'tool')

    def test_completed_forecast_survives_a_failed_model_writeup(self):
        for success in (True, False):
            with self.subTest(success=success):
                _, relay, port = self.boot([])
                call = 'data: ' + json.dumps({'choices': [{'delta': {'tool_calls': [{'index': 0,
                    'function': {'name': 'weather_forecast', 'arguments': json.dumps({'location': 'Chicago', 'output': 'data'})}}]}, 'finish_reason': 'tool_calls'}]})
                self.fast_provider(relay, [[call, 'data: [DONE]']])
                original = relay.open
                def open_once(run, body, messages, recovering=False):
                    if run.upstream_requests:
                        return None, {'code': 'provider_unavailable', 'message': 'Unavailable'}
                    return original(run, body, messages, recovering=recovering)
                result = json.dumps({'success': success, 'forecast': 'Chicago 2026-10-21: 71 F. https://open-meteo.com/'})
                with mock.patch.dict('os.environ', {'FREELLMAPI_URL': 'https://router.example', 'FREELLMAPI_API_KEY': 'test'}), mock.patch.object(relay_module, 'weather_tool', return_value=result), mock.patch.object(relay, 'open', side_effect=open_once):
                    self.start_fast(port)
                    run = self.finished(relay)
                _, frames = self.events(port)
                if success:
                    self.assertEqual(run.outcome, 'complete')
                    self.assertEqual(run.trace.counts['forecast_evidence_fallbacks'], 1)
                    self.assertIn('could not finish', json.dumps(frames))
                    self.assertIn('Chicago 2026-10-21: 71 F', json.dumps(frames))
                    self.assertTrue(any(json.loads(data).get('degraded') for _, name, data in frames if name == 'jarvis.complete'))
                else:
                    self.assertEqual(run.outcome, 'error')
                    self.assertNotIn('Chicago 2026-10-21: 71 F', json.dumps(frames))

    def test_widget_forecast_is_shown_when_the_model_drops_or_mangles_the_reference(self):
        token = 'c'*24
        args = json.dumps({'days':7})
        call = 'data: ' + json.dumps({'choices':[{'delta':{'tool_calls':[{'index':0,'function':{'name':'weather_forecast','arguments':args}}]},'finish_reason':'tool_calls'}]})
        for answer in ('Mostly overcast this week.\n\n[Vaelo request: reference]', '[vaelo-weather:' + token + ']', ''):
            _, relay, port = self.boot([])
            self.fast_provider(relay, [[call, 'data: [DONE]'], [chunk(answer or 'Here you go.', 'stop'), 'data: [DONE]']])
            result = json.dumps({'success':True,'reference':'[[vaelo-weather:' + token + ']]'})
            with mock.patch.dict('os.environ', {'FREELLMAPI_URL':'https://router.example','FREELLMAPI_API_KEY':'test'}), mock.patch.object(relay_module,'weather_tool',return_value=result), mock.patch.object(relay_module,'read_forecast',return_value='VERIFIED WEEK') as read:
                self.call(port, 'POST', '/vaelo/runs', {'id': RUN, 'messages':[{'role':'user','content':'And the week?'}], 'fast':'You are Vaelo.'})
                self.assertEqual(self.finished(relay).outcome, 'complete')
            read.assert_called_once()
            self.assertEqual(read.call_args.args, (token,))
            _, frames = self.events(port)
            self.assertEqual(json.dumps(frames).count('VERIFIED WEEK'), 1)

    def test_text_and_data_weather_outputs_are_not_forced_into_widgets(self):
        _, relay, port = self.boot([])
        call = lambda out: 'data: ' + json.dumps({'choices':[{'delta':{'tool_calls':[{'index':0,'function':{'name':'weather_forecast','arguments':json.dumps({'output':out})}}]},'finish_reason':'tool_calls'}]})
        self.fast_provider(relay, [[call('text'), 'data: [DONE]'], [chunk('| Day | High |', 'stop'), 'data: [DONE]']])
        result = json.dumps({'success':True,'reference':'[[vaelo-weather:' + 'd'*24 + ']]'})
        with mock.patch.dict('os.environ', {'FREELLMAPI_URL':'https://router.example','FREELLMAPI_API_KEY':'test'}), mock.patch.object(relay_module,'weather_tool',return_value=result), mock.patch.object(relay_module,'read_forecast') as read:
            self.call(port, 'POST', '/vaelo/runs', {'id': RUN, 'messages':[{'role':'user','content':'Table please'}], 'fast':'You are Vaelo.'})
            self.assertEqual(self.finished(relay).outcome, 'complete')
        read.assert_not_called()

    def test_stop_during_weather_tool_never_emits_forecast(self):
        _, relay, port = self.boot([])
        call = 'data: ' + json.dumps({'choices':[{'delta':{'tool_calls':[{'index':0,'function':{'name':'weather_forecast','arguments':'{}'}}]},'finish_reason':'tool_calls'}]})
        self.fast_provider(relay, [[call,'data: [DONE]']])
        def stopped(*args):
            relay.runs[RUN].stopped = True
            return '{}'
        with mock.patch.dict('os.environ', {'FREELLMAPI_URL':'https://router.example','FREELLMAPI_API_KEY':'test'}), mock.patch.object(relay_module,'weather_tool',side_effect=stopped):
            self.start_fast(port)
            run = self.finished(relay)
        self.assertEqual(run.outcome,'stopped')
        self.assertFalse(any(b'jarvis.complete' in frame for frame in run.frames))

    def test_failed_weather_tool_is_given_back_to_model_without_old_forecast(self):
        _, relay, port = self.boot([])
        call = 'data: ' + json.dumps({'choices':[{'delta':{'tool_calls':[{'index':0,'function':{'name':'weather_forecast','arguments':'{}'}}]},'finish_reason':'tool_calls'}]})
        provider, _ = self.fast_provider(relay, [[call, 'data: [DONE]'], [chunk('Which city would you like?', 'stop'), 'data: [DONE]']])
        result = json.dumps({'success':False,'error':'No location supplied'})
        with mock.patch.dict('os.environ', {'FREELLMAPI_URL':'https://router.example','FREELLMAPI_API_KEY':'test'}), mock.patch.object(relay_module,'weather_tool',return_value=result), mock.patch.object(relay_module,'read_forecast') as read:
            self.start_fast(port)
            run = self.finished(relay)
        self.assertEqual(run.outcome,'complete')
        read.assert_not_called()
        self.assertEqual(provider.requests[1]['body']['messages'][-1]['content'], result)
        self.assertNotIn('tools',provider.requests[1]['body'])

    def test_direct_model_can_request_multiple_forecast_locations(self):
        _, relay, port = self.boot([])
        call = 'data: ' + json.dumps({'choices':[{'delta':{'tool_calls':[{'index':i,'function':{'name':'weather_forecast','arguments':json.dumps({'location':city,'days':2})}} for i,city in enumerate(['Paris','London'])]},'finish_reason':'tool_calls'}]})
        provider, _ = self.fast_provider(relay, [[call,'data: [DONE]'], [chunk('Both forecasts were checked.','stop'),'data: [DONE]']])
        with mock.patch.dict('os.environ', {'FREELLMAPI_URL':'https://router.example','FREELLMAPI_API_KEY':'test'}), mock.patch.object(relay_module,'weather_tool',return_value=json.dumps({'success':False,'error':'Unavailable'})) as tool:
            self.start_fast(port)
            run = self.finished(relay)
        self.assertEqual(run.outcome,'complete')
        self.assertEqual([call.args[0]['location'] for call in tool.call_args_list], ['Paris','London'])
        self.assertEqual([m['role'] for m in provider.requests[1]['body']['messages']][-3:], ['assistant','tool','tool'])

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
        hermes, relay, port = self.boot(
            [
                [
                    chunk("The first half of the answer, "),
                    'data: {"choices":[{"delta":{},"finish_reason":"error"}],"error":{"message":"provider failed"}}',
                ],
                [chunk("and the second half.", "stop"), "data: [DONE]"],
            ]
        )
        self.start(port)
        self.finished(relay)
        follow_up = hermes.requests[1]["body"]["messages"]
        self.assertEqual(
            follow_up[-2],
            {"role": "assistant", "content": "The first half of the answer, "},
        )
        self.assertIn(
            "Continue it from exactly where it stops", follow_up[-1]["content"]
        )
        _, frames = self.events(port)
        text = "".join(data for _, _, data in frames)
        self.assertNotIn("provider failed", text)  # the reader never sees the failure
        names = [name for _, name, _ in frames]
        self.assertIn("jarvis.continue", names)
        self.assertEqual(names[-1], "jarvis.complete")
        self.assertIn("second half", text)

    def test_a_dropped_stream_mid_answer_is_continued_too(self):
        hermes, relay, port = self.boot(
            [
                [chunk("Begun but never finished")],
                [chunk(" and now finished.", "stop"), "data: [DONE]"],
            ]
        )
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
        frames = [chunk("y" * 200) for _ in range(200)] + [
            chunk(None, "stop"),
            "data: [DONE]",
        ]
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
        empty = [
            'data: {"choices":[{"delta":{},"finish_reason":"cancelled"}]}',
            "data: [DONE]",
        ]
        provider, relay, port = self.boot_guest([empty, empty, empty])
        with mock.patch.dict("os.environ", {"OPENROUTER_API_KEY": "or-key"}):
            self.start(port, owner=guest)
            self.finished(relay)
        self.assertEqual(len(provider.requests), relay_module.ATTEMPTS)
        self.assertEqual(len(relay.guest_log[guest]), relay_module.ATTEMPTS)
        self.assertEqual(relay.guest_active, 0)

    def test_a_guest_out_of_allowance_gets_no_recovery_calls(self):
        guest = "web:guest:last"
        empty = [
            'data: {"choices":[{"delta":{},"finish_reason":"cancelled"}]}',
            "data: [DONE]",
        ]
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
