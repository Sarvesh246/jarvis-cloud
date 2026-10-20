import base64
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
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

    def test_without_the_router_there_is_no_image_tool(self):
        provider = image_gen.FreeLLMAPIImages({"FREELLMAPI_URL": "http://insecure", "FREELLMAPI_API_KEY": "x"})
        self.assertFalse(provider.is_available())
        self.assertEqual(provider.generate("a car")["error_type"], "router_unconfigured")

    def test_an_answer_without_an_image_is_an_error(self):
        result = self.provider({"data": [{"b64_json": base64.b64encode(b"not an image").decode()}]}).generate("x")
        self.assertFalse(result["success"])

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
