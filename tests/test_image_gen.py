import base64
from http.client import BadStatusLine, HTTPResponse, IncompleteRead
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("image_gen", ROOT / "cloud/image_gen.py")
image_gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(image_gen)
relay_spec = importlib.util.spec_from_file_location("relay_for_images", ROOT / "cloud/relay.py")
relay_module = importlib.util.module_from_spec(relay_spec)
relay_spec.loader.exec_module(relay_module)

# The smallest valid PNG: one transparent pixel.
PIXEL = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


class Reply(io.BytesIO):
    headers = {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class ImageProviderTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.environ = {"FREELLMAPI_URL": "https://router.example", "FREELLMAPI_API_KEY": "secret",
                        "HERMES_HOME": self.home.name}
        self.sent = []

    def tearDown(self):
        self.home.cleanup()

    def provider(self, answer):
        def opener(request, timeout):
            self.sent.append(request)
            if isinstance(answer, Exception):
                raise answer
            return Reply(json.dumps(answer).encode())
        return image_gen.FreeLLMAPIImages(self.environ, opener)

    def test_generates_through_the_router_and_keeps_a_reference(self):
        result = self.provider({"data": [{"b64_json": base64.b64encode(PIXEL).decode()}],
                                "model": "flux.1-schnell"}).generate("a teardrop car", "portrait")
        self.assertTrue(result["success"])
        self.assertRegex(result["image"], r"^vaelo-image:[0-9a-f]{24}$")
        self.assertIn(result["image"], result["note"])
        request = self.sent[0]
        self.assertEqual(request.full_url, "https://router.example/v1/images/generations")
        self.assertEqual(request.get_header("Authorization"), "Bearer secret")
        self.assertEqual(json.loads(request.data)["size"], "768x1024")
        uri = image_gen.data_uri(result["image"].split(":")[1], self.environ)
        self.assertRegex(uri, r"^data:image/(png|jpeg);base64,")

    def test_router_down_says_so_plainly(self):
        for error in (URLError("refused"), HTTPError("u", 503, "down", {}, None), TimeoutError()):
            result = self.provider(error).generate("a car")
            self.assertFalse(result["success"])
            self.assertEqual(result["error_type"], "router_offline")
            self.assertIn("offline", result["error"])

    def test_spent_allowance_is_not_called_offline(self):
        result = self.provider(HTTPError("u", 429, "busy", {}, None)).generate("a car")
        self.assertEqual(result["error_type"], "rate_limited")

    def test_router_protocol_failures_return_offline_and_allow_recovery(self):
        for error in (IncompleteRead(b'{"data":'), BadStatusLine("invalid status")):
            for during_read in (False, True):
                with self.subTest(error=type(error).__name__, during_read=during_read):
                    provider = self.provider(error)
                    if during_read:
                        provider = self.provider({})
                        with patch.object(Reply, "read", side_effect=error):
                            result = provider.generate("a car")
                    else:
                        result = provider.generate("a car")
                    self.assertEqual(result["error_type"], "router_offline")
                    self.assertIsNone(result["image"])
        answer = {"data": [{"b64_json": base64.b64encode(PIXEL).decode()}]}
        self.assertTrue(self.provider(answer).generate("a car")["success"])

    def test_image_download_protocol_failures_do_not_cache_partial_images(self):
        answer = {"data": [{"url": "https://images.example/car.png"}]}
        for error in (IncompleteRead(PIXEL[:12]), BadStatusLine("invalid status")):
            for during_read in (False, True):
                with self.subTest(error=type(error).__name__, during_read=during_read), \
                        patch.object(image_gen, "keep") as keep:
                    with patch.object(image_gen, "urlopen") as opener:
                        if during_read:
                            opener.return_value.__enter__.return_value.read.side_effect = error
                        else:
                            opener.side_effect = error
                        result = self.provider(answer).generate("a car")
                    self.assertEqual(result["error_type"], "provider_error")
                    self.assertIsNone(result["image"])
                    keep.assert_not_called()
        with patch.object(image_gen, "urlopen", return_value=Reply(PIXEL)):
            self.assertTrue(self.provider(answer).generate("a car")["success"])

    def test_short_image_download_is_rejected_without_caching_and_can_recover(self):
        answer = {"data": [{"url": "https://images.example/car.png"}]}

        class Socket:
            def makefile(self, *args):
                return io.BytesIO(b"HTTP/1.1 200 OK\r\nContent-Length: "
                                  + str(len(PIXEL) + 100).encode() + b"\r\n\r\n" + PIXEL)

        # HTTPResponse.read(amount) returns these short bytes without raising
        # IncompleteRead, even though the advertised body is not complete.
        response = HTTPResponse(Socket())
        response.begin()
        with patch.object(image_gen, "urlopen", return_value=response), \
                patch.object(image_gen, "keep") as keep:
            result = self.provider(answer).generate("a car")
        self.assertFalse(result["success"])
        self.assertEqual(result["error_type"], "provider_error")
        self.assertIsNone(result["image"])
        keep.assert_not_called()
        self.assertTrue(response.closed)
        with patch.object(image_gen, "urlopen", return_value=Reply(PIXEL)):
            self.assertTrue(self.provider(answer).generate("a car")["success"])

    def test_download_length_checks_preserve_complete_and_unframed_images(self):
        for declared in (str(len(PIXEL)), None, "invalid", "-1"):
            with self.subTest(content_length=declared):
                response = Reply(PIXEL)
                response.headers = {} if declared is None else {"Content-Length": declared}
                with patch.object(image_gen, "urlopen", return_value=response):
                    self.assertEqual(image_gen.download("https://images.example/car.png"), PIXEL)
        with patch.object(image_gen, "MAX_DOWNLOAD", len(PIXEL) - 1), \
                patch.object(image_gen, "urlopen", return_value=Reply(PIXEL)):
            with self.assertRaisesRegex(ValueError, "too large"):
                image_gen.download("https://images.example/car.png")

    def test_chunked_download_uses_chunk_framing_instead_of_content_length(self):
        class Socket:
            def makefile(self, *args):
                return io.BytesIO(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n"
                                  b"Content-Length: 9999\r\n\r\n"
                                  + format(len(PIXEL), "x").encode() + b"\r\n"
                                  + PIXEL + b"\r\n0\r\n\r\n")

        response = HTTPResponse(Socket())
        response.begin()
        with patch.object(image_gen, "urlopen", return_value=response):
            self.assertEqual(image_gen.download("https://images.example/car.png"), PIXEL)
        self.assertTrue(response.closed)

    def test_without_the_router_there_is_no_image_tool(self):
        provider = image_gen.FreeLLMAPIImages({"FREELLMAPI_URL": "http://insecure", "FREELLMAPI_API_KEY": "x"})
        self.assertFalse(provider.is_available())
        self.assertEqual(provider.generate("a car")["error_type"], "router_unconfigured")

    def test_an_answer_without_an_image_is_an_error(self):
        result = self.provider({"data": [{"b64_json": base64.b64encode(b"not an image").decode()}]}).generate("x")
        self.assertFalse(result["success"])

    def test_malformed_router_payloads_fail_without_raising(self):
        answers = [None, [], "error", {"data": 1}, {"data": {"image": "x"}},
                   {"data": "image"}, {"data": []}, {"data": [None]},
                   {"data": [{"b64_json": "%%%"}]}, {"data": [{"b64_json": "é"}]},
                   {"data": [{"b64_json": 42}]}, {"data": [{"b64_json": [1]}]},
                   {"data": [{"url": 42}]}, {"data": [{"url": ["https://example.com"]}]}]
        for answer in answers:
            with self.subTest(answer=answer):
                result = self.provider(answer).generate("a car")
                self.assertFalse(result["success"])
                self.assertEqual(result["error_type"], "provider_error")
                self.assertIsNone(result["image"])

    def test_inline_images_obey_the_download_size_limit(self):
        answer = {"data": [{"b64_json": base64.b64encode(PIXEL).decode()}]}
        with patch.object(image_gen, "MAX_DOWNLOAD", len(PIXEL) - 1), \
                patch.object(image_gen, "shrink") as shrink:
            result = self.provider(answer).generate("a car")
        self.assertFalse(result["success"])
        self.assertEqual(result["error_type"], "provider_error")
        shrink.assert_not_called()
        with patch.object(image_gen, "MAX_DOWNLOAD", len(PIXEL)):
            self.assertTrue(self.provider(answer).generate("a car")["success"])

    def test_image_url_responses_still_produce_a_reference(self):
        with patch.object(image_gen, "download", return_value=PIXEL) as download:
            result = self.provider({"data": [{"url": "https://images.example/car.png"}]}).generate("a car")
        self.assertTrue(result["success"])
        self.assertRegex(result["image"], r"^vaelo-image:[0-9a-f]{24}$")
        download.assert_called_once_with("https://images.example/car.png")

    def test_cache_failure_returns_an_error_and_a_later_request_can_succeed(self):
        answer = {"data": [{"b64_json": base64.b64encode(PIXEL).decode()}]}
        with patch.object(image_gen, "keep", side_effect=OSError("disk full")):
            result = self.provider(answer).generate("a car")
        self.assertFalse(result["success"])
        self.assertEqual(result["error_type"], "provider_error")
        self.assertNotIn("disk full", result["error"])
        self.assertTrue(self.provider(answer).generate("a car")["success"])

    def test_unknown_or_malformed_references_give_nothing(self):
        self.assertEqual(image_gen.data_uri("0" * 24, self.environ), "")
        self.assertEqual(image_gen.data_uri("../../etc/passwd", self.environ), "")


class RelayImageTests(unittest.TestCase):
    def test_reader_gets_each_referenced_picture_once(self):
        with tempfile.TemporaryDirectory() as home:
            environ = {"HERMES_HOME": home}
            reference = image_gen.keep(PIXEL, environ)
            token = reference.split(":")[1]
            run = relay_module.Run("run", "owner")
            relay = relay_module.Relay.__new__(relay_module.Relay)
            answer = f"Here it is:\n\n![Concept car]({reference})"
            original = relay_module.data_uri
            relay_module.data_uri = lambda value: image_gen.data_uri(value, environ)
            try:
                relay.share_images(run, answer)
                relay.share_images(run, answer + " more words")
            finally:
                relay_module.data_uri = original
            events = [frame.decode() for frame in run.frames if b"jarvis.image" in frame]
            self.assertEqual(len(events), 1)
            payload = json.loads(events[0].split("data: ", 1)[1])
            self.assertEqual(payload["ref"], "vaelo-image:" + token)
            self.assertTrue(payload["src"].startswith("data:image/png;base64,"))


if __name__ == "__main__":
    unittest.main()
