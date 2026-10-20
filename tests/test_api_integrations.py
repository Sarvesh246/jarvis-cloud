import json
import os
from pathlib import Path
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.parse import urlsplit

from cloud import data_sources as data
from cloud import api_directory, extended_sources, research


class ApiIntegrationTests(unittest.TestCase):
    def setUp(self):
        with data._lock:
            data._cache.clear()
            data._next.clear()
            data._daily_usage.clear()

    def test_directory_tracks_every_candidate_without_promising_implementation(self):
        entries = api_directory.ENTRIES
        self.assertEqual(len(entries), 520)
        self.assertEqual(len({e["id"] for e in entries}), 520)
        self.assertEqual(sum(e["name"] == "GNews" for e in entries), 1)
        self.assertTrue(any(e["status"] == "pending_contract" and not e["tools"] for e in entries))
        for e in entries:
            self.assertTrue(set(e["tools"]) <= set(data.CATALOG), e["name"])
        gmail = api_directory.search({"id": 199})
        self.assertEqual(gmail["entries"][0]["status"], "requires_user_connection")
        self.assertIn("not evidence", gmail["notice"])

    def test_directory_and_catalog_are_searchable_bounded_and_offline(self):
        with patch.object(data, "fetch") as fetch:
            result = data.search('api:directory {"query":"manga"}')
            self.assertLessEqual(len(result["entries"]), 5)
            self.assertTrue(any(e["name"] == "MangaDex" for e in result["entries"]))
            result = data.search('api:catalog {"query":"manga"}')
            self.assertIn("mangadex", result["sources"])
            self.assertLess(len(json.dumps(result)), 10000)
            self.assertFalse(data.search('api:directory {"url":"http://localhost"}')["success"])
            self.assertFalse(data.search('api:directory {"offset":true}')["success"])
            self.assertFalse(data.search('api:catalog {"offset":-1}')["success"])
        fetch.assert_not_called()

    def test_every_declarative_operation_uses_its_fixed_https_host_and_rejects_extra_arguments(self):
        for source, spec in extended_sources.SPECS.items():
            self.assertEqual(urlsplit(spec["endpoint"]).scheme, "https")
            self.assertNotIn("@", urlsplit(spec["endpoint"]).netloc)
            with self.subTest(source=source), patch.object(data, "fetch") as fetch:
                result = data.lookup(source, {**spec["sample"], "url": "http://127.0.0.1"})
                self.assertFalse(result["success"])
                fetch.assert_not_called()

    def test_query_encoding_path_validation_and_provider_shape_drift(self):
        with patch.object(data, "get", return_value={"data": [{"id": "m1", "attributes": {"title": {"en": "Title"}}}]}) as get:
            result = data.lookup("mangadex", {"query": "x&apikey=secret"})
        self.assertTrue(result["success"])
        self.assertEqual(get.call_args.args[0], "https://api.mangadex.org/manga")
        self.assertEqual(get.call_args.args[1]["title"], "x&apikey=secret")
        with patch.object(data, "get") as get:
            self.assertFalse(data.lookup("pokemon", {"name": "../../localhost"})["success"])
            get.assert_not_called()
        data._next.clear()
        with patch.object(data, "get", return_value={"new_schema": []}):
            result = data.lookup("mangadex", {"query": "title"})
        self.assertFalse(result["success"])

    def test_credential_operations_project_records_and_never_publish_keys(self):
        for source, spec in extended_sources.SPECS.items():
            auth = spec.get("credential")
            if not auth:
                continue
            payload = [{"id": "1", "name": "Public metadata"}]
            for key in reversed(spec.get("results", "").split(".")):
                if key:
                    payload = {key: payload}
            if not spec.get("results"):
                payload = {"id": "1", "name": "Public metadata"}
            with self.subTest(source=source), patch.dict(os.environ, {auth["env"]: "private-value"}, clear=True), patch.object(data, "get", return_value=payload) as get:
                result = data.lookup(source, spec["sample"])
                self.assertTrue(result["success"], result)
                self.assertNotIn("private-value", json.dumps(result))
                if auth.get("header"):
                    self.assertIn(auth["header"], get.call_args.args[2])
                else:
                    self.assertEqual(get.call_args.args[1][auth["parameter"]], "private-value")

    def test_provider_error_envelopes_are_not_returned_as_data(self):
        for error in ({"error": "private"}, {"errors": ["private"]}, {"retCode": 10003}, {"status": "0", "message": "Invalid key"}):
            data._cache.clear(); data._next.clear()
            with patch.object(data, "get", return_value=error):
                result = data.lookup("binance", {"symbol": "BTCUSDT"})
            self.assertFalse(result["success"])
            self.assertNotIn("private", json.dumps(result))

    def test_ckan_checks_success_and_preserves_license_and_metadata_dates(self):
        row = {"id": "123", "title": "Water", "metadata_modified": "2020-01-01", "license_id": "cc-by", "resources": [{"url": "http://localhost/metadata"}]}
        with patch.object(data, "get", return_value={"success": True, "result": {"results": [row]}}) as get:
            result = data.lookup("toronto", {"query": "water"})
        self.assertTrue(result["success"])
        self.assertEqual(get.call_count, 1)  # Returned resource URLs are never followed.
        description = result["data"]["web"][0]["description"]
        self.assertIn('"license_id": "cc-by"', description)
        self.assertIn("not the observation date", description)
        data._next.clear(); data._cache.clear()
        with patch.object(data, "get", return_value={"success": False, "result": {"results": [row]}}):
            self.assertFalse(data.lookup("toronto", {"query": "water"})["success"])

    def test_hacker_news_bounds_ids_and_skips_deleted_or_failed_items(self):
        def response(url, *args):
            if url.endswith("stories.json"):
                return [1, 2, 3, "../bad", True, 4]
            if url.endswith("/1.json"):
                return {"id": 1, "type": "story", "title": "Public news", "time": time.time(), "url": "https://publisher.example/story"}
            if url.endswith("/2.json"):
                return {"id": 2, "type": "story", "deleted": True}
            raise TimeoutError("private details")
        with patch.object(data, "get", side_effect=response) as get:
            result = data.lookup("hackernews", {"feed": "new"})
        self.assertEqual(get.call_count, 4)
        self.assertEqual(len(result["data"]["web"]), 1)
        self.assertIn("news.ycombinator.com/item?id=1", result["data"]["web"][0]["url"])

    def test_product_hunt_only_sends_fixed_public_read_queries(self):
        row = {"id": "1", "name": "Launch", "url": "https://www.producthunt.com/posts/launch", "createdAt": datetime.now(timezone.utc).isoformat()}
        with patch.dict(os.environ, {"PRODUCTHUNT_TOKEN": "private-token"}, clear=True), patch.object(data, "fetch", return_value={"data": {"posts": {"nodes": [row]}}}) as fetch:
            result = data.lookup("producthunt", {})
        self.assertTrue(result["success"])
        url, headers, payload = fetch.call_args.args
        self.assertEqual(url, "https://api.producthunt.com/v2/api/graphql")
        self.assertEqual(headers["Authorization"], "Bearer private-token")
        for forbidden in ("mutation", "viewer", "private", "userId"):
            self.assertNotIn(forbidden, payload["query"])
        self.assertNotIn("private-token", json.dumps(result))
        data._cache.clear(); data._next.clear()
        with patch.dict(os.environ, {"PRODUCTHUNT_TOKEN": "private", "PUBLIC_DATA_NONCOMMERCIAL": "0"}, clear=True), patch.object(data, "fetch") as fetch:
            self.assertFalse(data.lookup("producthunt", {})["success"])
            fetch.assert_not_called()

    def test_gnews_preserves_publisher_date_without_exposing_authentication(self):
        row = {"title": "Article", "url": "https://publisher.example/story", "publishedAt": "2020-01-01T00:00:00Z", "source": {"name": "Publisher"}}
        with patch.dict(os.environ, {"GNEWS_API_KEY": "private-key"}, clear=True), patch.object(data, "get", return_value={"articles": [row]}) as get:
            result = data.lookup("gnews", {"query": "NASA", "country": "us"})
        self.assertTrue(result["success"])
        self.assertEqual(get.call_args.args[1]["apikey"], "private-key")
        self.assertNotIn("private-key", json.dumps(result))
        self.assertIn("2020-01-01", json.dumps(result))
        with patch.object(data, "get") as get:
            self.assertFalse(data.search("latest news about NASA")["success"])
            get.assert_not_called()  # Known 12h delay cannot answer breaking news.

    def test_newsapi_free_key_never_enables_production_access(self):
        for env in ({"NEWSAPI_API_KEY": "private"}, {"NEWSAPI_API_KEY": "private", "NEWSAPI_LOCAL_DEVELOPMENT": "1", "RENDER": "true"}):
            data._next.clear()
            with patch.dict(os.environ, env, clear=True), patch.object(data, "get") as get:
                result = data.lookup("newsapi", {"query": "NASA"})
            self.assertFalse(result["success"])
            get.assert_not_called()
        data._next.clear()
        with patch.dict(os.environ, {"NEWSAPI_API_KEY": "private", "NEWSAPI_LOCAL_DEVELOPMENT": "1"}, clear=True), patch.object(data, "get", return_value={"status": "ok", "articles": [{"title": "A", "url": "https://example.com/a"}]}):
            self.assertTrue(data.lookup("newsapi", {"query": "NASA"})["success"])

    def test_free_news_budget_fails_closed_without_a_network_call(self):
        day = datetime.now(timezone.utc).date().isoformat()
        data._daily_usage["gnews"] = (day, 45)
        with patch.object(data, "get") as get:
            result = data.lookup("gnews", {})
        self.assertFalse(result["success"])
        self.assertIn("budget exhausted", result["error"])
        get.assert_not_called()

    def test_stale_observations_are_not_refreshed_by_recent_retrieval(self):
        def result(record):
            return {"success": True, "data": {"web": [{"description": json.dumps({"data": record}), "retrieved_at": datetime.now(timezone.utc).isoformat()}]}}
        old = datetime.now(timezone.utc) - timedelta(days=20)
        self.assertFalse(data.fresh_result("hackernews", result({"time": old.timestamp()}))["success"])
        self.assertFalse(data.fresh_result("usobservation", result({"timestamp": old.isoformat()}))["success"])
        self.assertFalse(data.fresh_result("currency", result({"date": old.date().isoformat()}))["success"])
        self.assertFalse(data.fresh_result("weather", result({"current": {"time": old.isoformat()}, "utc_offset_seconds": 0}))["success"])
        self.assertTrue(data.fresh_result("books", result({"first_publish_year": 1800}))["success"])
        # Local modeled weather time is interpreted with its UTC offset.
        now = datetime.now(timezone.utc)
        local = (now - timedelta(hours=5)).replace(tzinfo=None).isoformat()
        self.assertTrue(data.fresh_result("weather", result({"current": {"time": local}, "utc_offset_seconds": -18000}))["success"])

    def test_api_and_web_run_concurrently_without_waiting_for_a_failed_api(self):
        started, release = threading.Event(), threading.Event()
        def slow_api(_):
            started.set()
            release.wait(3)
            return {"success": False}
        def web(*_):
            self.assertTrue(started.wait(1))
            return {"success": True, "provider": "web", "data": {"web": [{"url": "https://example.com"}]}}
        try:
            with patch.object(research, "data_search", side_effect=slow_api), patch.object(research.Research, "web_search", side_effect=web):
                before = time.monotonic()
                result = research.Research().search("define serendipity")
                self.assertLess(time.monotonic() - before, 1)
                self.assertEqual(result["provider"], "web")
        finally:
            release.set()

    def test_provider_intents_remain_explicit_and_respect_offline_instructions(self):
        self.assertEqual(data.natural_query("search One Piece on MangaDex"), ("mangadex", {"query": "One Piece"}))
        self.assertEqual(data.natural_query("pokemon pikachu"), ("pokemon", {"name": "pikachu"}))
        self.assertEqual(data.natural_query("top Hacker News stories"), ("hackernews", {"feed": "top"}))
        for q in ("Translate: pokemon pikachu", "Don't search One Piece on MangaDex", "Explain how Hacker News works", "Write code to search One Piece on MangaDex"):
            self.assertIsNone(data.natural_query(q))

    def test_qualified_weather_geocoding_never_substitutes_another_country(self):
        with patch.object(data, "get", side_effect=[{"results": []}, {"results": [
                {"name": "London", "country_code": "CA", "admin1": "Ontario"},
                {"name": "London", "country_code": "GB", "admin1": "England"}]}]) as get:
            rows = data.geocode("London, UK")
        self.assertEqual([r["country_code"] for r in rows], ["GB"])
        self.assertEqual(get.call_args.args[1]["countryCode"], "GB")
        self.assertEqual(data.natural_query("whats the weather today in Chicago, Illinois"), ("weather", {"location": "Chicago, Illinois"}))


if __name__ == "__main__":
    unittest.main()
