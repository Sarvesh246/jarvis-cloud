import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class ResearchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # The cloud plugin needs only Hermes's base interface, not the local
        # Hermes installation or any vendor SDK, for these contract checks.
        interface = types.ModuleType("agent.web_search_provider")
        interface.WebSearchProvider = object
        spec = importlib.util.spec_from_file_location("cloud_research", Path(__file__).resolve().parents[1] / "cloud/research.py")
        cls.module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"agent": types.ModuleType("agent"), "agent.web_search_provider": interface}):
            spec.loader.exec_module(cls.module)

    def test_search_falls_back_without_exposing_provider_errors(self):
        mod = self.module
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "fake", "TAVILY_API_KEY": "fake"}, clear=True), \
             patch.object(mod, "post", side_effect=[ValueError("private provider detail"), {"results": [{"url": "https://example.com", "content": "Evidence"}]}]) as post:
            result = mod.Research().search("question", limit=100)
        self.assertTrue(result["success"])
        self.assertEqual(result["provider"], "tavily")
        self.assertEqual(post.call_args.args[2]["max_results"], 5)
        self.assertNotIn("private", json.dumps(result))

    def test_exa_search_asks_for_passages_the_model_can_answer_from(self):
        mod = self.module
        rows = {"results": [{"url": "https://example.com", "title": "T", "highlights": ["First fact.", "Second fact."]}]}
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "fake"}, clear=True), patch.object(mod, "post", return_value=rows) as post:
            result = mod.Research().search("question")
        self.assertEqual(post.call_args.args[2]["contents"], {"highlights": True})
        self.assertIn("First fact.", result["data"]["web"][0]["description"])
        self.assertIn("Second fact.", result["data"]["web"][0]["description"])

    def test_pages_are_read_at_the_same_time(self):
        mod = self.module
        import threading
        arrived = threading.Barrier(3, timeout=5)
        def response(name, path, payload):
            arrived.wait()  # all three pages must be in flight together, or this times out
            return {"results": [{"text": "page " + payload["urls"][0]}]}
        urls = [f"https://example.com/{i}" for i in range(3)]
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "fake"}, clear=True), patch.object(mod, "post", side_effect=response):
            results = asyncio.run(mod.Research().extract(urls))
        self.assertEqual([r["content"] for r in results], ["page " + url for url in urls])

    def test_pages_are_bounded_and_not_duplicated(self):
        mod = self.module
        urls = [f"https://example.com/{i}" for i in range(6)] + ["https://example.com/0"]
        def response(name, path, payload):
            self.assertEqual(len(payload["urls"]), 1)
            return {"results": [{"url": payload["urls"][0], "text": "x" * 100000}]}
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "fake"}, clear=True), patch.object(mod, "post", side_effect=response) as post:
            results = asyncio.run(mod.Research().extract(urls))
        self.assertEqual(post.call_count, 4)
        self.assertEqual(len(results), 6)
        self.assertEqual(len(results[0]["content"]), mod.PAGE_CHARS)
        self.assertNotIn("raw_content", results[0])
        self.assertIn("error", results[4])

    def test_failed_page_does_not_discard_other_pages(self):
        mod = self.module
        def response(name, path, payload):
            if payload["urls"] == ["https://bad.example"]:
                raise TimeoutError("private detail")
            return {"results": [{"text": "Useful evidence"}]}
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "fake"}, clear=True), patch.object(mod, "post", side_effect=response):
            results = asyncio.run(mod.Research().extract(["https://bad.example", "https://good.example"]))
        self.assertIn("error", results[0])
        self.assertEqual(results[1]["content"], "Useful evidence")

    def test_oversized_download_is_rejected_before_json_decoding(self):
        mod = self.module
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size):
                self.size = size
                return b"x" * size
        response = Response()
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "fake"}, clear=True), \
             patch.object(mod, "urlopen", return_value=response) as request, patch.object(mod.json, "loads") as decode:
            with self.assertRaisesRegex(ValueError, "size limit"):
                mod.post("exa", "/contents", {})
        self.assertEqual(response.size, mod.RESPONSE_BYTES + 1)
        self.assertEqual(request.call_args.kwargs["timeout"], mod.REQUEST_TIMEOUT)
        decode.assert_not_called()


if __name__ == "__main__":
    unittest.main()
