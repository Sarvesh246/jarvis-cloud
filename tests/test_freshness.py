import json
import unittest
from unittest import mock

from cloud.freshness import source_context


class FreshnessTests(unittest.TestCase):
    def test_retrieval_supplies_bounded_evidence_and_preserves_exact_subjects(self):
        search = mock.Mock(return_value={"success": True, "data": {"web": [{
            "url": "https://example.com/release", "title": "Official release",
            "description": "verified passage" * 500, "published": "2026-09-09",
        }] * 20}})
        result = source_context("Compare phone 15 and phone 18", search)
        search.assert_called_once_with("Compare phone 15 and phone 18", limit=6)
        self.assertEqual(result["role"], "user")
        self.assertIn("exact subjects", result["content"])
        self.assertIn("untrusted third-party", result["content"])
        sources = json.loads(result["content"].split("\n")[-1])
        self.assertEqual(len(sources), 6)
        self.assertEqual(len(sources[0]["passage"]), 1500)

    def test_retrieval_failure_does_not_invent_evidence_or_leak_provider_errors(self):
        for search in [mock.Mock(side_effect=OSError("secret")),
                       mock.Mock(return_value={"success": False}),
                       mock.Mock(return_value={"success": True, "data": {"web": []}})]:
            result = source_context("latest phones", search)["content"]
            self.assertIn("could not verify", result)
            self.assertIn("not evidence", result)
            self.assertNotIn("secret", result)
            self.assertTrue(result.endswith("[]"))

    def test_bad_and_oversized_source_urls_do_not_reach_model_context(self):
        search = lambda *args, **kwargs: {"success": True, "data": {"web": [
            {"url": "javascript:bad"}, {"url": "https://example.com/" + "x" * 3000},
            {"url": "https://good.example/", "description": "fact"},
        ]}}
        result = source_context("latest phones", search)["content"]
        sources = json.loads(result.split("\n")[-1])
        self.assertEqual([s["url"] for s in sources], ["https://good.example/"])

    def test_relay_can_import_research_without_the_hermes_sdk(self):
        from cloud.research import Research
        with mock.patch.dict("os.environ", {}, clear=True):
            self.assertFalse(Research().is_available())
            result = source_context("latest phones")
        self.assertIn("could not verify", result["content"])
