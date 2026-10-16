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

    def test_one_malformed_link_does_not_break_fusing_results(self):
        hits = [{"url": "http://[x", "title": "bad"}, {"url": "https://example.com/a", "title": "good"}]
        fused = self.module.fuse([hits], 5)
        self.assertIn("https://example.com/a", [hit["url"] for hit in fused])

    def test_search_falls_back_without_exposing_provider_errors(self):
        mod = self.module
        def response(name, path, payload, timeout=None):
            if name == "exa":
                raise ValueError("private provider detail")
            return {"results": [{"url": "https://example.com", "content": "Evidence"}]}
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "fake", "TAVILY_API_KEY": "fake"}, clear=True), \
             patch.object(mod, "post", side_effect=response) as post:
            result = mod.Research().search("question", limit=100)
        self.assertTrue(result["success"])
        self.assertEqual(result["provider"], "tavily")
        tavily = next(call for call in post.call_args_list if call.args[0] == "tavily")
        self.assertEqual(tavily.args[2]["max_results"], mod.SEARCH_LIMIT)
        self.assertNotIn("private", json.dumps(result))

    def test_exa_search_asks_for_passages_the_model_can_answer_from(self):
        mod = self.module
        rows = {"results": [{"url": "https://example.com", "title": "T", "highlights": ["First fact.", "Second fact."],
                             "publishedDate": "2026-10-14T09:30:00.000Z"}]}
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "fake"}, clear=True), patch.object(mod, "post", return_value=rows) as post:
            result = mod.Research().search("question")
        self.assertIn("highlights", post.call_args.args[2]["contents"])
        hit = result["data"]["web"][0]
        self.assertIn("First fact.", hit["description"])
        self.assertIn("Second fact.", hit["description"])
        self.assertEqual(hit["published"], "2026-10-14")

    def test_both_indexes_are_asked_at_once_and_agreement_ranks_first(self):
        mod = self.module
        import threading
        both = threading.Barrier(2, timeout=5)
        def response(name, path, payload, timeout=None):
            both.wait()  # Exa and Tavily must be in flight together, or this times out
            if name == "exa":
                return {"results": [{"url": "https://solo.example/a", "highlights": ["only exa"]},
                                    {"url": "https://www.shared.example/page/", "highlights": ["short"]}]}
            return {"results": [{"url": "https://shared.example/page?utm_source=x", "content": "a longer passage from tavily"},
                                {"url": "https://other.example/b", "content": "only tavily"}]}
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "k", "TAVILY_API_KEY": "k"}, clear=True), \
             patch.object(mod, "post", side_effect=response):
            result = mod.Research().search("question")
        hits = result["data"]["web"]
        self.assertEqual(result["provider"], "exa+tavily")
        self.assertEqual(len(hits), 3)  # the shared page appears once
        self.assertIn("shared.example", hits[0]["url"])
        self.assertEqual(hits[0]["description"], "a longer passage from tavily")
        self.assertEqual([hit["position"] for hit in hits], [1, 2, 3])

    def test_one_site_cannot_crowd_out_the_rest(self):
        mod = self.module
        rows = {"results": [{"url": f"https://big.example/{i}", "highlights": ["x"]} for i in range(4)]
                + [{"url": "https://small.example/1", "highlights": ["y"]}]}
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "k"}, clear=True), patch.object(mod, "post", return_value=rows):
            hits = mod.Research().search("question", limit=3)["data"]["web"]
        self.assertEqual([mod.site(hit["url"]) for hit in hits], ["big.example", "big.example", "small.example"])

    def test_news_questions_ask_for_recent_reporting(self):
        mod = self.module
        payloads = {}
        def response(name, path, payload, timeout=None):
            payloads[payload["query"]] = payload
            return {"results": [{"url": "https://n.example", "content": "c", "published_date": "Tue, 14 Oct 2026"}]}
        with patch.dict(mod.os.environ, {"TAVILY_API_KEY": "k"}, clear=True), patch.object(mod, "post", side_effect=response):
            mod.Research().search("latest news on the Fed")
            mod.Research().search("how do index funds work")
        self.assertEqual(payloads["latest news on the Fed"]["topic"], "news")
        self.assertNotIn("topic", payloads["how do index funds work"])
        self.assertEqual(mod.day("Tue, 14 Oct 2026 09:00:00 GMT"), "2026-10-14")
        self.assertEqual(mod.day("sometime last week"), "")

    def test_long_pages_keep_the_passages_the_search_was_about(self):
        mod = self.module
        filler = "\n\n".join(f"Unrelated paragraph {i} about gardening and weather patterns in spring." * 3 for i in range(200))
        page = "Intro to the company.\n\n" + filler + "\n\nThe battery capacity is 5000 mAh and charging is 45W.\n\n" + filler
        def response(name, path, payload, timeout=None):
            if path == "/search":
                return {"results": [{"url": "https://phone.example/spec", "highlights": ["specs"]}]}
            return {"results": [{"text": page}]}
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "k"}, clear=True), patch.object(mod, "post", side_effect=response):
            research = mod.Research()
            research.search("phone battery capacity mAh")
            content = asyncio.run(research.extract(["https://phone.example/spec"]))[0]["content"]
        self.assertLessEqual(len(content), mod.PAGE_CHARS)
        self.assertIn("Intro to the company.", content)
        self.assertIn("5000 mAh", content)
        self.assertIn("[…]", content)

    def test_long_pages_keep_what_follows_a_matching_heading(self):
        mod = self.module
        filler = "\n\n".join(f"Unrelated paragraph {i} about gardening and weather patterns in spring." * 3 for i in range(200))
        steps = "\n\n".join(f"{n}. Hold the button marked {n} for ten seconds, then release it." for n in range(1, 5))
        page = "Router manual.\n\n" + filler + "\n\n## How to factory reset the Archer AX55\n\n" + steps + "\n\n" + filler
        focused = mod.focus(page, "factory reset Archer AX55")
        self.assertIn("How to factory reset", focused)
        for n in range(1, 5):
            self.assertIn(f"{n}. Hold the button marked {n}", focused)
        self.assertLessEqual(len(focused), mod.PAGE_CHARS)
        # The rest of the room is used rather than left empty.
        self.assertGreater(len(focused), mod.PAGE_CHARS * 0.8)

    def test_pages_from_nowhere_keep_their_opening_and_end(self):
        mod = self.module
        text = "Opening.\n\n" + "\n\n".join("Middle filler sentence number %d." % i for i in range(2000)) + "\n\nThe conclusion."
        focused = mod.focus(text, "")
        self.assertTrue(focused.startswith("[Long page"))
        self.assertIn("Opening.", focused)
        self.assertIn("The conclusion.", focused)
        self.assertLessEqual(len(focused), mod.PAGE_CHARS)

    def test_a_page_every_provider_misses_is_read_directly(self):
        mod = self.module
        html = b"<html><head><title>Spec sheet</title><script>var x=1</script></head><body><nav>Menu</nav><h1>Phone</h1><p>Battery: 5000 mAh.</p></body></html>"
        class Response:
            headers = mod.Request("https://x").headers  # replaced below
            def __enter__(self): return self
            def __exit__(self, *args): pass
            body = __import__("io").BytesIO(html)
            def read1(self, size): return self.body.read(size)
        import email.message
        headers = email.message.Message()
        headers["Content-Type"] = "text/html; charset=utf-8"
        Response.headers = headers
        opener = types.SimpleNamespace(open=lambda req, timeout: Response())
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "k"}, clear=True), \
             patch.object(mod, "post", side_effect=TimeoutError("down")), \
             patch.object(mod, "public_host", return_value=True), patch.object(mod, "build_opener", return_value=opener):
            page = asyncio.run(mod.Research().extract(["https://phone.example/spec"]))[0]
        self.assertEqual(page["provider"], "direct")
        self.assertEqual(page["title"], "Spec sheet")
        self.assertIn("Battery: 5000 mAh.", page["content"])
        self.assertNotIn("var x", page["content"])
        self.assertNotIn("Menu", page["content"])

    def test_a_page_that_trickles_in_is_given_up_on_in_time(self):
        mod = self.module
        clock = iter(range(0, 1000, 5))  # five seconds pass between reads
        class Trickle:
            def read1(self, size): return b"<p>a"
        with patch.object(mod.time, "monotonic", side_effect=lambda: next(clock)):
            with self.assertRaises(TimeoutError):
                mod.read_within(Trickle(), mod.PAGE_BYTES, deadline=20)

    def test_every_provider_shares_one_deadline_per_page(self):
        mod = self.module
        now = [0.0]
        timeouts = []
        def slow(name, url, timeout):
            timeouts.append((name, timeout))
            now[0] += timeout  # each attempt uses all the time it was given
            raise TimeoutError(name)
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "k", "TAVILY_API_KEY": "k", "FIRECRAWL_API_KEY": "k"}, clear=True), \
             patch.object(mod.time, "monotonic", side_effect=lambda: now[0]):
            research = mod.Research()
            research.read = slow
            page = research.extract_one("https://slow.example/")
        self.assertIn("error", page)
        self.assertLessEqual(now[0], mod.PAGE_SECONDS)
        self.assertEqual(timeouts[0][1], mod.REQUEST_TIMEOUT)
        self.assertLess(len(timeouts), 4)

    def test_page_furniture_never_counts_as_a_page(self):
        mod = self.module
        nav = "<nav><ul>" + "<li><a href=/x>Link</a></li>" * 30 + "</ul></nav>"
        parser = mod.PageText()
        parser.feed("<title>Real</title><svg><title>icon</title></svg>" + nav + "<form><h1>Notice</h1><p>Office hours are 9 to 5.</p></form>")
        parser.close()
        self.assertEqual(parser.title, "Real")
        self.assertTrue(parser.text().startswith("# Notice"), parser.text()[:80])
        self.assertIn("Office hours are 9 to 5.", parser.text())

    def test_direct_reads_never_reach_private_addresses(self):
        mod = self.module
        for url in ("http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "file:///etc/passwd"):
            self.assertFalse(mod.public_host(url), url)
        with self.assertRaises(ValueError):
            mod.fetch_page("http://127.0.0.1/")

    def test_ipv6_forms_carrying_a_private_ipv4_address_are_private(self):
        mod = self.module
        for address in ("64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::a00:5",
                        "::ffff:10.0.0.1", "2002:7f00:1::1", "2001:0:4136:e378::1"):
            self.assertFalse(mod.public_ip(address), address)
        for address in ("8.8.8.8", "64:ff9b::808:808", "2606:4700::1111"):
            self.assertTrue(mod.public_ip(address), address)

    def test_a_host_rebound_to_a_private_address_after_the_check_is_refused(self):
        # public_host saw a public address; the connection's own lookup landed on loopback.
        mod = self.module
        closed = []
        sock = types.SimpleNamespace(getpeername=lambda: ("127.0.0.1", 80), close=lambda: closed.append(True))
        def connect(self):
            self.sock = sock
        for cls, base in ((mod.PublicHTTPConnection, mod.HTTPConnection),
                          (mod.PublicHTTPSConnection, mod.HTTPSConnection)):
            closed.clear()
            with patch.object(base, "connect", connect):
                with self.assertRaises(ValueError):
                    cls("rebind.example").connect()
            self.assertEqual(closed, [True])
        public = types.SimpleNamespace(getpeername=lambda: ("93.184.216.34", 80), close=lambda: None)
        with patch.object(mod.HTTPConnection, "connect", lambda self: setattr(self, "sock", public)):
            mod.PublicHTTPConnection("example.com").connect()

    def test_direct_reads_use_the_peer_checking_connections_without_proxies(self):
        mod = self.module
        built = []
        real = mod.build_opener
        with patch.object(mod, "public_host", return_value=True), \
             patch.object(mod, "build_opener", side_effect=lambda *h: built.extend(h) or real(*h)), \
             patch.object(mod.HTTPConnection, "connect", lambda self: setattr(self, "sock", types.SimpleNamespace(
                 getpeername=lambda: ("127.0.0.1", 80), close=lambda: None))):
            with self.assertRaises(Exception):
                mod.fetch_page("http://rebind.example/")
        self.assertTrue(any(isinstance(h, mod.PublicHTTP) for h in built))
        self.assertTrue(any(isinstance(h, mod.ProxyHandler) for h in built))

    def test_pages_are_read_at_the_same_time(self):
        mod = self.module
        import threading
        arrived = threading.Barrier(3, timeout=5)
        def response(name, path, payload, timeout=None):
            arrived.wait()  # all three pages must be in flight together, or this times out
            return {"results": [{"text": "page " + payload["urls"][0]}]}
        urls = [f"https://example.com/{i}" for i in range(3)]
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "fake"}, clear=True), patch.object(mod, "post", side_effect=response):
            results = asyncio.run(mod.Research().extract(urls))
        self.assertEqual([r["content"] for r in results], ["page " + url for url in urls])

    def test_pages_are_bounded_and_not_duplicated(self):
        mod = self.module
        urls = [f"https://example.com/{i}" for i in range(6)] + ["https://example.com/0"]
        def response(name, path, payload, timeout=None):
            self.assertEqual(len(payload["urls"]), 1)
            return {"results": [{"url": payload["urls"][0], "text": "x" * 100000}]}
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "fake"}, clear=True), patch.object(mod, "post", side_effect=response) as post:
            results = asyncio.run(mod.Research().extract(urls))
        self.assertEqual(post.call_count, 4)
        self.assertEqual(len(results), 6)
        self.assertLessEqual(len(results[0]["content"]), mod.PAGE_CHARS)
        self.assertGreater(len(results[0]["content"]), mod.PAGE_CHARS * 0.8)
        self.assertNotIn("raw_content", results[0])
        self.assertIn("error", results[4])

    def test_failed_page_does_not_discard_other_pages(self):
        mod = self.module
        def response(name, path, payload, timeout=None):
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
            sizes = []
            def read1(self, size):
                self.sizes.append(size)
                return b"x" * size  # an endless body
        response = Response()
        with patch.dict(mod.os.environ, {"EXA_API_KEY": "fake"}, clear=True), \
             patch.object(mod, "urlopen", return_value=response) as request, patch.object(mod.json, "loads") as decode:
            with self.assertRaisesRegex(ValueError, "size limit"):
                mod.post("exa", "/contents", {})
        self.assertEqual(sum(response.sizes), mod.RESPONSE_BYTES + 1)
        self.assertEqual(request.call_args.kwargs["timeout"], mod.REQUEST_TIMEOUT)
        decode.assert_not_called()


if __name__ == "__main__":
    unittest.main()
