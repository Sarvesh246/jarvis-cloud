import gzip
import io
import json
import os
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from cloud import data_sources as data
from cloud.freshness import source_context
from cloud.research import Research


class DataSourceTests(unittest.TestCase):
    def test_shared_coordinates_use_weather_adapter_without_city_geocoding(self):
        self.assertEqual(data.natural_query("What's the weather today in 41.88, -87.63"),
                         ("weather", {"latitude": 41.88, "longitude": -87.63}))
        self.assertIsNone(data.natural_query("weather in 200, -87"))

    def setUp(self):
        with data._lock:
            data._cache.clear()
            data._next.clear()

    def test_catalog_is_available_without_network_and_uses_web_contract(self):
        with patch.object(data, "fetch") as fetch:
            catalog = Research().search("api:catalog {}")
        self.assertEqual(catalog["total"], len(data.CATALOG))
        self.assertEqual(set(catalog["sources"]), set(list(data.CATALOG)[:12]))
        self.assertTrue(catalog["data"]["web"])
        fetch.assert_not_called()

    def test_explicit_failure_never_sends_arguments_to_search_indexes(self):
        with patch("cloud.research.search_index") as index:
            for query in ['api:unknown {"query":"private"}', 'api:weather {"url":"http://localhost"}', 'api:currency {bad}', 'api:currency {"base":"USD","quote":"EUR","apikey":"private"}']:
                self.assertFalse(Research().search(query)["success"])
        index.assert_not_called()

    def test_validation_rejects_nonfinite_coordinates_and_invalid_ids_before_http(self):
        cases = [("weather", {"latitude": v, "longitude": 0}) for v in [float("nan"), float("inf"), True, 91, "41"]]
        cases += [("holidays", {"country": "../../", "year": "2026"}), ("currency", {"base": "USD", "quote": "http://localhost"}),
                  ("vin", {"vin": "123"}), ("earthquakes", {"start": "2026-02-30"}),
                  ("earthquakes", {"start": "2026-10-19", "end": "2026-10-18"})]
        with patch.object(data, "get") as get:
            for source, args in cases:
                data._next.clear()
                self.assertFalse(data.lookup(source, args)["success"], (source, args))
        get.assert_not_called()

    def test_path_and_query_values_cannot_change_host(self):
        with patch.object(data, "fetch", return_value={"docs": []}) as fetch:
            data.lookup("books", {"query": "a&apikey=secret/#https://localhost"})
        url = fetch.call_args.args[0]
        self.assertTrue(url.startswith("https://openlibrary.org/search.json?q="))
        self.assertIn("%26apikey%3D", url)

    def test_failed_natural_lookup_retains_general_web_fallback(self):
        with patch("cloud.research.data_search", return_value={"success": False}), patch("cloud.research.configured", return_value=True), \
             patch("cloud.research.search_index", return_value=[{"url": "https://example.com", "description": "Definition"}]):
            self.assertTrue(Research().search("define serendipity")["success"])

    def test_routing_is_conservative_and_preserves_offline_math_and_transformations(self):
        self.assertEqual(data.natural_query("100 USD to INR"), ("currency", {"base": "USD", "quote": "INR"}))
        self.assertEqual(data.natural_query("Define serendipity"), ("dictionary", {"word": "serendipity"}))
        self.assertEqual(data.natural_query("What's the weather in Chicago today?"), ("weather", {"location": "Chicago"}))
        self.assertEqual(data.natural_query("Air quality in London, UK"), ("airquality", {"location": "London, UK"}))
        for query in ["Convert 100 USD to INR using a rate of 83", "Don't search: define serendipity", "Rewrite: weather in Chicago", "Write code using npm package react", "Explain what research papers are"]:
            self.assertIsNone(data.natural_query(query), query)

    def test_cache_preserves_retrieval_timestamp_and_does_not_repeat_http(self):
        with patch.object(data, "get", return_value={"base": "USD", "quote": "EUR", "rate": 0.9, "date": "2026-10-19"}) as get:
            first = data.lookup("currency", {"base": "USD", "quote": "EUR"})
            first["data"]["web"][0]["title"] = "mutated"
            second = data.lookup("currency", {"base": "USD", "quote": "EUR"})
        self.assertEqual(get.call_count, 1)
        self.assertNotEqual(second["data"]["web"][0]["title"], "mutated")
        self.assertIn("2026-10-19", second["data"]["web"][0]["description"])
        self.assertEqual(first["data"]["web"][0]["retrieved_at"], second["data"]["web"][0]["retrieved_at"])

    def test_rate_limit_backoff_and_exception_secrets_are_not_exposed(self):
        error = HTTPError("https://provider?apikey=secret", 429, "secret", {"Retry-After": "120"}, None)
        with patch.object(data, "get", side_effect=error) as get:
            first = data.lookup("books", {"query": "test"})
            second = data.lookup("books", {"query": "another"})
        self.assertEqual(get.call_count, 1)
        self.assertFalse(first["success"])
        self.assertIn("cooling down", second["error"])
        self.assertNotIn("secret", json.dumps([first, second]))

    def test_empty_results_do_not_imply_nonexistence(self):
        with patch.object(data, "get", return_value={"docs": []}):
            result = data.lookup("books", {"query": "missing"})
        self.assertFalse(result["success"])
        self.assertIn("does not establish nonexistence", result["error"])

    def test_weather_defaults_to_noncommercial_and_can_be_disabled(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(data, "get", return_value={"current": {"temperature_2m": 15}, "current_units": {"temperature_2m": "°C"}}) as get:
            result = data.lookup("weather", {"latitude": 51.5, "longitude": 0})
            self.assertTrue(result["success"])
            self.assertTrue(get.call_args.args[0].startswith("https://api.open-meteo.com/"))
        data._cache.clear()
        data._next.clear()
        with patch.dict(os.environ, {"OPEN_METEO_NONCOMMERCIAL": "0"}, clear=True), patch.object(data, "get") as get:
            self.assertFalse(data.lookup("airquality", {"latitude": 51.5, "longitude": 0})["success"])
            get.assert_not_called()

    def test_commercial_weather_uses_customer_endpoint_without_key_in_evidence(self):
        with patch.dict(os.environ, {"OPEN_METEO_API_KEY": "private-key"}, clear=True), patch.object(data, "get", return_value={"current": {}}) as get:
            result = data.lookup("airquality", {"latitude": 51.5, "longitude": 0})
        self.assertIn("customer-air-quality-api", get.call_args.args[0])
        self.assertEqual(get.call_args.args[1]["apikey"], "private-key")
        self.assertNotIn("private-key", json.dumps(result))

    def test_nws_uses_validated_grid_identifiers_and_preserves_period_units(self):
        point = {"properties": {"gridId": "LOT", "gridX": 75, "gridY": 72, "forecast": "http://127.0.0.1/private", "timeZone": "America/Chicago"}}
        forecast = {"properties": {"generatedAt": "2026-10-19T12:00:00Z", "periods": [{"temperature": 65, "temperatureUnit": "F", "startTime": "2026-10-19T06:00:00-05:00"}]}}
        with patch.object(data, "get", side_effect=[point, forecast]) as get:
            result = data.lookup("usweather", {"latitude": 41.88, "longitude": -87.63})
        self.assertTrue(result["success"])
        self.assertEqual(get.call_args.args[0], "https://api.weather.gov/gridpoints/LOT/75,72/forecast")
        self.assertIn('"temperatureUnit": "F"', result["data"]["web"][0]["description"])

    def test_us_weather_prefers_nws_and_falls_back_after_nws_outage(self):
        forecast = {"properties": {"periods": []}}
        point = {"properties": {"gridId": "LOT", "gridX": 75, "gridY": 72}}
        with patch.object(data, "get", side_effect=[point, forecast]) as get:
            result = data.lookup("weather", {"latitude": 41.88, "longitude": -87.63})
        self.assertTrue(result["success"])
        self.assertIn("api.weather.gov", result["data"]["web"][0]["url"])
        data._cache.clear()
        data._next.clear()
        with patch.dict(os.environ, {}, clear=True), patch.object(data, "get", side_effect=[TimeoutError(), {"current": {"temperature_2m": 15}}]) as get:
            result = data.lookup("weather", {"latitude": 41.88, "longitude": -87.63})
        self.assertTrue(result["success"])
        self.assertIn("Open-Meteo", result["data"]["web"][0]["description"])

    def test_nws_empty_alerts_are_valid_point_specific_evidence(self):
        with patch.object(data, "get", return_value={"features": [], "updated": "2026-10-19T12:00:00Z"}) as get:
            result = data.lookup("usalerts", {"latitude": 41.88, "longitude": -87.63})
        self.assertTrue(result["success"])
        self.assertEqual(get.call_args.args[0], "https://api.weather.gov/alerts")
        self.assertEqual(get.call_args.args[1]["point"], "41.88,-87.63")
        self.assertIn('"alerts": []', result["data"]["web"][0]["description"])

    def test_keyed_sources_are_disabled_without_network_calls(self):
        cases = {"country": {"name": "Canada"}, "stocks": {"symbol": "IBM"}, "crypto": {"coin": "bitcoin"}, "movies": {"query": "Dune"}, "space": {}, "music": {"query": "Beatles"}}
        with patch.dict(os.environ, {}, clear=True), patch.object(data, "get") as get:
            for source, args in cases.items():
                self.assertFalse(data.lookup(source, args)["success"], source)
        get.assert_not_called()

    def test_structured_context_preserves_json_dates_and_units_without_slicing(self):
        payload = {"unit": "USD", "description": "x" * 2500, "date": "2026-10-19"}
        hit = {"url": "https://example.com", "title": "Reference", "description": json.dumps(payload), "source": "currency", "retrieved_at": "2026-10-19"}
        context = source_context("USD to INR", search=lambda *args, **kwargs: {"success": True, "data": {"web": [hit]}})
        rows = json.loads(context["content"].rsplit("\n", 1)[1])
        self.assertEqual(json.loads(rows[0]["passage"]), payload)
        self.assertEqual(rows[0]["retrieved_at"], "2026-10-19")

    def test_paper_topic_version_is_not_rewritten_as_a_product_specs_query(self):
        search = Mock(return_value={"success": False})
        query = "Find research papers on Python 3.14"
        source_context(query, search=search)
        search.assert_called_once_with(query, limit=6)

    def test_gzip_expansion_is_bounded_and_malformed_json_is_not_success(self):
        for raw in [gzip.compress(b"x" * (data.MAX_BYTES + 1)), b"not json"]:
            response = Mock()
            response.__enter__ = Mock(return_value=response)
            response.__exit__ = Mock(return_value=False)
            stream = io.BytesIO(raw)
            response.read1.side_effect = stream.read
            response.headers = {}
            opener = Mock()
            opener.open.return_value = response
            with patch.object(data, "build_opener", return_value=opener):
                with self.assertRaises((data.Unavailable, ValueError)):
                    data.fetch("https://example.com")

    def test_redirects_are_not_followed(self):
        with self.assertRaises(data.Unavailable):
            data.NoRedirect().redirect_request(None, None, 302, "", {}, "http://localhost")

    def test_meteo_budget_stops_requests_without_waiting_or_opening_socket(self):
        saved = dict(data._meteo_usage)
        try:
            with patch.object(data, "_meteo_minute", data.deque([data.time.monotonic()] * 100)), patch.object(data, "build_opener") as opener:
                with self.assertRaises(data.Unavailable):
                    data.fetch("https://api.open-meteo.com/v1/forecast")
                opener.assert_not_called()
        finally:
            data._meteo_usage.update(saved)

    def test_optional_credentials_use_current_schemas_and_do_not_leak(self):
        cases = [
            ("country", {"name": "Canada"}, "REST_COUNTRIES_API_KEY", {"data": {"objects": [{"names": {"common": "Canada"}, "population": 1}]}}),
            ("crypto", {"coin": "bitcoin"}, "COINGECKO_API_KEY", {"bitcoin": {"usd": 100, "last_updated_at": 123}}),
            ("movies", {"query": "Dune"}, "TMDB_READ_TOKEN", {"results": [{"id": 1, "title": "Dune", "release_date": "2021-01-01"}]}),
            ("space", {}, "NASA_API_KEY", {"title": "Space", "date": "2026-10-19", "copyright": "Photographer"}),
            ("music", {"query": "Beatles"}, "MUSICBRAINZ_ENABLED", {"artists": [{"id": "123", "name": "The Beatles", "country": "GB"}]}),
        ]
        for source, args, variable, payload in cases:
            with self.subTest(source=source), patch.dict(os.environ, {variable: "1" if source == "music" else "private-value"}, clear=True), patch.object(data, "get", return_value=payload):
                result = data.lookup(source, args)
                self.assertTrue(result["success"])
                self.assertNotIn("private-value", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
