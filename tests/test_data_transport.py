"""Offline HTTP integrity and resource ownership for public-data reads."""
import gzip
import io
import json
import threading
import unittest
from http.client import IncompleteRead
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import HTTPHandler, ProxyHandler, build_opener

from cloud import data_sources as data


class Response(io.BytesIO):
    def __init__(self, body, headers=None):
        super().__init__(body)
        self.headers = headers or {}


class DataTransportTests(unittest.TestCase):
    def fetch(self, body, headers=None):
        response = Response(body, headers)
        with patch.object(data, "build_opener", return_value=Mock(open=Mock(return_value=response))):
            try:
                return data.fetch("https://provider.example/records")
            finally:
                self.assertTrue(response.closed)

    def test_complete_unicode_records_and_request_configuration_are_preserved(self):
        record = {"title": "Café 東京", "value": None, "units": "µg/m³", "date": "2026-10-21",
                  "text": "| A | B |\n```python\nprint('λ')\n```\n$x^2$"}
        raw = json.dumps(record, ensure_ascii=False).encode()
        response = Response(raw, {"Content-Length": str(len(raw))})
        opener = Mock(open=Mock(return_value=response))
        with patch.object(data, "build_opener", return_value=opener):
            self.assertEqual(data.fetch("https://provider.example/records", {"Authorization": "Bearer private"},
                                        {"query": "value"}), record)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_header("Accept-encoding"), "identity")
        self.assertEqual(request.get_header("Authorization"), "Bearer private")
        self.assertEqual(json.loads(request.data), {"query": "value"})
        self.assertEqual(opener.open.call_args.kwargs, {"timeout": data.TIMEOUT})
        self.assertTrue(response.closed)

    def test_short_wire_bodies_are_rejected_even_when_json_or_gzip_is_complete(self):
        for body, headers in [(b'{"value":1}', {}), (gzip.compress(b'{"value":1}'), {"Content-Encoding": "gzip"})]:
            with self.subTest(headers=headers), self.assertRaises(data.Unavailable):
                self.fetch(body, {**headers, "Content-Length": str(len(body) + 10)})

    def test_chunk_framing_and_absent_or_invalid_lengths_remain_usable(self):
        for headers in [{}, {"Content-Length": "invalid"}, {"Content-Length": "-1"},
                        {"Content-Length": "999", "Transfer-Encoding": "ChUnKeD"}]:
            with self.subTest(headers=headers):
                self.assertEqual(self.fetch(b'{"value":1}', headers), {"value": 1})

    def test_limits_apply_to_both_wire_and_decompressed_bytes(self):
        exact = b'"' + b'a' * 126 + b'"'
        with patch.object(data, "MAX_BYTES", 128):
            self.assertEqual(self.fetch(exact, {"Content-Length": "128"}), "a" * 126)
            compressed = gzip.compress(exact)
            self.assertEqual(self.fetch(compressed, {"Content-Encoding": "gzip", "Content-Length": str(len(compressed))}), "a" * 126)
            for body in [exact + b' ', gzip.compress(exact + b' ')]:
                with self.subTest(size=len(body)), self.assertRaises(data.Unavailable):
                    self.fetch(body)

    def test_corrupt_gzip_and_utf8_never_become_successful_json(self):
        compressed = gzip.compress(b'{"value":1}')
        corrupt = compressed[:-8] + b'\0' * 8
        for body in [compressed[:-4], corrupt, b'{"value":"\xff"}']:
            with self.subTest(body=body), self.assertRaises((OSError, EOFError, ValueError)):
                self.fetch(body, {"Content-Length": str(len(body))})

    def test_read_and_deadline_failures_close_the_response(self):
        response = Response(b'{}')
        with patch.object(data, "build_opener", return_value=Mock(open=Mock(return_value=response))), \
             patch.object(response, "read1", side_effect=IncompleteRead(b'{')):
            with self.assertRaises(IncompleteRead):
                data.fetch("https://provider.example")
        self.assertTrue(response.closed)
        response = Response(b'{}')
        with patch.object(data, "build_opener", return_value=Mock(open=Mock(return_value=response))), \
             patch.object(data.time, "monotonic", side_effect=[0, data.TIMEOUT]):
            with self.assertRaises(TimeoutError):
                data.fetch("https://provider.example")
        self.assertTrue(response.closed)

    def test_open_http_errors_close_their_body_and_keep_retry_headers(self):
        body = io.BytesIO(b'private provider error')
        error = HTTPError("https://provider.example?apikey=private", 429, "private", {"Retry-After": "120"}, body)
        with patch.object(data, "build_opener", return_value=Mock(open=Mock(side_effect=error))):
            with self.assertRaises(HTTPError) as caught:
                data.fetch("https://provider.example")
        self.assertIs(caught.exception, error)
        self.assertEqual(error.headers["Retry-After"], "120")
        self.assertTrue(body.closed)

    def test_error_cleanup_failure_does_not_replace_the_original_http_error(self):
        body = Mock()
        body.close.side_effect = OSError("close failed")
        error = HTTPError("https://provider.example", 503, "private", {}, body)
        with patch.object(data, "build_opener", return_value=Mock(open=Mock(side_effect=error))):
            with self.assertRaises(HTTPError) as caught:
                data.fetch("https://provider.example")
        self.assertIs(caught.exception, error)
        body.close.assert_called_once()

    def test_refused_redirect_closes_original_body_without_exposing_target(self):
        for fail_close in [False, True]:
            body = Mock()
            if fail_close:
                body.close.side_effect = OSError("private")
            with self.subTest(fail_close=fail_close), self.assertRaises(data.Unavailable) as caught:
                data.NoRedirect().redirect_request(None, body, 302, "", {}, "http://127.0.0.1/private")
            body.close.assert_called_once()
            self.assertNotIn("127.0.0.1", str(caught.exception))

    def test_lookup_rejects_incomplete_evidence_without_caching_and_recovers(self):
        raw = b'{"docs":[{"title":"A book","key":"/works/1"}]}'
        short = Response(raw, {"Content-Length": str(len(raw) + 5)})
        complete = Response(raw, {"Content-Length": str(len(raw))})
        with patch.object(data, "_cache", data.OrderedDict()), patch.object(data, "_next", {}), \
             patch.object(data.time, "monotonic", return_value=100) as now, \
             patch.object(data, "build_opener", return_value=Mock(open=Mock(side_effect=[short, complete]))) as opener:
            first = data.lookup("books", {"query": "test"})
            self.assertFalse(first["success"])
            self.assertFalse(data._cache)
            now.return_value = 102
            second = data.lookup("books", {"query": "test"})
            self.assertTrue(second["success"], second)
            self.assertEqual(data.lookup("books", {"query": "test"}), second)
            self.assertEqual(opener.call_count, 2)
        self.assertTrue(short.closed)
        self.assertTrue(complete.closed)

    def test_http_error_lookup_preserves_backoff_and_hides_private_body(self):
        body = io.BytesIO(b'private body')
        error = HTTPError("https://provider.example?apikey=private", 429, "private", {"Retry-After": "120"}, body)
        with patch.object(data, "_cache", data.OrderedDict()), patch.object(data, "_next", {}), \
             patch.object(data.time, "monotonic", return_value=100), \
             patch.object(data, "build_opener", return_value=Mock(open=Mock(side_effect=error))):
            first = data.lookup("books", {"query": "test"})
            second = data.lookup("books", {"query": "other"})
            self.assertFalse(first["success"])
            self.assertIn("cooling down", second["error"])
            self.assertEqual(data._next["books"], 220)
            self.assertNotIn("private", json.dumps([first, second]))
        self.assertTrue(body.closed)

    def test_real_http_short_reads_chunk_framing_redirects_and_recovery(self):
        paths = []
        raw = '{"value":"Café λ"}'.encode()

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                paths.append(self.path)
                if self.path.startswith("/redirect/"):
                    self.send_response(int(self.path.rsplit("/", 1)[1]))
                    self.send_header("Location", "/target")
                    self.end_headers()
                    return
                self.send_response(200)
                if self.path == "/chunked":
                    self.send_header("Transfer-Encoding", "chunked")
                    self.send_header("Content-Length", "999")
                    self.end_headers()
                    self.wfile.write(f"{len(raw):x}\r\n".encode() + raw + b"\r\n0\r\n\r\n")
                else:
                    self.send_header("Content-Length", str(len(raw) + (10 if self.path == "/short" else 0)))
                    self.end_headers()
                    self.wfile.write(raw)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        # Only the test opener permits local HTTP; production's public HTTPS
        # connection, proxy policy and redirect handler remain unchanged.
        opener = build_opener(ProxyHandler({}), HTTPHandler(), data.NoRedirect())
        root = f"http://127.0.0.1:{server.server_port}"
        try:
            with patch.object(data, "build_opener", return_value=opener):
                with self.assertRaises(data.Unavailable):
                    data.fetch(root + "/short")
                for code in [301, 302, 303, 307, 308]:
                    with self.subTest(code=code), self.assertRaises(data.Unavailable):
                        data.fetch(root + f"/redirect/{code}")
                self.assertEqual(data.fetch(root + "/chunked"), json.loads(raw))
                self.assertEqual(data.fetch(root + "/ok"), json.loads(raw))
            self.assertEqual(paths, ["/short", *[f"/redirect/{code}" for code in [301, 302, 303, 307, 308]],
                                     "/chunked", "/ok"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
