import json
import unittest
from unittest import mock

from cloud.freshness import source_context


class FreshnessTests(unittest.TestCase):
    def test_each_subject_lookup_keeps_the_actual_question_and_region(self):
        search = mock.Mock(return_value={"success": False})
        query = "Is Python 3.14 affected by this security advisory in October 2026?"
        source_context(query, search)
        self.assertIn("security advisory in October 2026", search.call_args.args[0])
        self.assertEqual(search.call_args.args[0].lower().count("python 3.14"), 1)
        self.assertNotIn("official specifications", search.call_args.args[0])

    def test_four_requested_models_all_receive_a_lookup(self):
        search = mock.Mock(return_value={"success": False})
        query = "Compare iPhone 15 Pro, Pixel 10, Galaxy S26 Ultra and OnePlus 16 prices in India"
        source_context(query, search)
        self.assertEqual(search.call_count, 4)
        for call in search.call_args_list:
            self.assertIn("prices in India", call.args[0])
            self.assertEqual(sum(name in call.args[0].lower() for name in
                ["iphone 15 pro", "pixel 10", "galaxy s26 ultra", "oneplus 16"]), 1)

    def test_shorthand_comparisons_do_not_pollute_individual_searches(self):
        search = mock.Mock(return_value={"success": False})
        source_context("iPhone 15 Pro vs 18 Pro Max prices in India", search)
        queries = [call.args[0].lower() for call in search.call_args_list]
        self.assertEqual(len(queries), 2)
        self.assertNotIn("18 pro max", queries[0])
        self.assertNotIn("15 pro", queries[1])
        self.assertTrue(all("prices in india" in query for query in queries))

    def test_malformed_result_for_one_subject_does_not_erase_healthy_evidence(self):
        def search(query, limit):
            if query.startswith("iphone 18"):
                return {"success": True, "data": {"web": None}}
            return {"success": True, "data": {"web": [{
                "url": "https://apple.com/15", "title": "iPhone 15 Pro specifications",
                "description": "iPhone 15 Pro technical information",
            }]}}
        context = source_context("iPhone 15 Pro vs iPhone 18 Pro Max", search)["content"]
        self.assertEqual(len(json.loads(context.split("\n")[-1])), 1)
        self.assertIn('Subjects without matching evidence: ["iphone 18 pro max"]', context)

    def test_retrieval_supplies_bounded_evidence_and_preserves_exact_subjects(self):
        search = mock.Mock(return_value={"success": True, "data": {"web": [{
            "url": f"https://example.com/release/{i}", "title": "Official release",
            "description": "verified passage" * 500, "published": "2026-09-09",
        } for i in range(20)]}})
        result = source_context("latest phones", search)
        search.assert_called_once_with("latest phones", limit=6)
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
            self.assertTrue(Research().is_available())  # Public read APIs need no index key.
            result = source_context("latest phones")
        self.assertIn("could not verify", result["content"])

    def test_comparison_searches_each_exact_model_and_rejects_the_wrong_pair(self):
        def search(query, limit):
            if query.startswith("iphone 15 pro official sources:"):
                return {"success": True, "data": {"web": [
                    {"url": "https://other.example/compare", "title": "OnePlus 16 vs iPhone 15 Pro", "description": "OnePlus 16 has 16GB RAM. iPhone 15 Pro has 8GB."},
                    {"url": "https://support.apple.com/15", "title": "iPhone 15 Pro - Technical Specifications", "description": "iPhone 15 Pro has A17 Pro."},
                ]}}
            return {"success": True, "data": {"web": [
                {"url": "https://apple.com/18", "title": "iPhone 18 Pro and iPhone 18 Pro Max specifications", "description": "iPhone 18 Pro Max display information."}
            ]}}
        lookup = mock.Mock(side_effect=search)
        result = source_context("Compare iPhone 15 Pro and iPhone 18 Pro Max", lookup)["content"]
        self.assertEqual(lookup.call_count, 2)
        hits = json.loads(result.split("\n")[-1])
        self.assertEqual({h["url"] for h in hits}, {"https://support.apple.com/15", "https://apple.com/18"})
        self.assertEqual(hits[0]["subjects"], ["iphone 15 pro"])
        self.assertIn('Subjects without matching evidence: []', result)
        self.assertNotIn("OnePlus", result)

    def test_one_failed_subject_does_not_discard_other_evidence_or_invent_coverage(self):
        def search(query, limit):
            if query.startswith("iphone 18"):
                raise OSError("private provider error")
            return {"success": True, "data": {"web": [
                {"url": "https://apple.com/15", "title": "iPhone 15 Pro specifications"}
            ]}}
        result = source_context("iPhone 15 Pro vs iPhone 18 Pro Max", search)["content"]
        self.assertIn('Subjects without matching evidence: ["iphone 18 pro max"]', result)
        self.assertEqual(len(json.loads(result.split("\n")[-1])), 1)
        self.assertNotIn("private provider", result)

    def test_source_budget_reserves_coverage_for_both_models_and_removes_duplicates(self):
        def search(query, limit):
            number = "15" if query.startswith("iphone 15") else "18"
            variant = "pro" if number == "15" else "pro max"
            return {"success": True, "data": {"web": [
                {"url": f"https://apple.com/{number}/{i}", "title": f"iPhone {number} {variant} specs"}
                for i in range(6)
            ]}}
        hits = json.loads(source_context("iPhone 15 Pro vs iPhone 18 Pro Max", search)["content"].split("\n")[-1])
        self.assertEqual(len(hits), 6)
        self.assertEqual({name for h in hits for name in h["subjects"]}, {"iphone 15 pro", "iphone 18 pro max"})
        duplicate = mock.Mock(return_value={"success": True, "data": {"web": [
            {"url": "https://example.com/specs", "title": "iPhone 15 Pro vs iPhone 18 Pro Max"}
        ]}})
        read = lambda url: {"title": "iPhone 15 Pro vs iPhone 18 Pro Max", "content": "iPhone 15 Pro and iPhone 18 Pro Max comparison."}
        hits = json.loads(source_context("iPhone 15 Pro vs iPhone 18 Pro Max", duplicate, read)["content"].split("\n")[-1])
        self.assertEqual(len(hits), 1)

    def test_comparison_url_with_misleading_indexed_title_is_checked_and_discarded(self):
        search = mock.Mock(return_value={"success": True, "data": {"web": [{
            "url": "https://example.com/compare?phone1=wrong&phone2=15",
            "title": "iPhone 15 Pro vs iPhone 18 Pro Max",
            "description": "Indexed title looks correct but the URL opens another phone.",
        }]}})
        read = mock.Mock(return_value={"title": "OnePlus 16 vs iPhone 15 Pro",
            "content": "OnePlus 16 and Apple iPhone 15 Pro specifications."})
        result = source_context("iPhone 15 Pro vs iPhone 18 Pro Max", search, read)["content"]
        read.assert_called_once()
        self.assertTrue(result.endswith("[]"))
        self.assertIn("could not verify", result)

    def test_unreadable_comparison_pages_cannot_be_used_as_verified_evidence(self):
        search = mock.Mock(return_value={"success": True, "data": {"web": [{
            "url": "https://example.com/compare", "title": "iPhone 15 Pro vs iPhone 18 Pro Max",
        }]}})
        for read in [None, mock.Mock(side_effect=OSError("private failure")),
                     mock.Mock(return_value={"content": "", "error": "failed"})]:
            result = source_context("iPhone 15 Pro vs iPhone 18 Pro Max", search, read)["content"]
            self.assertTrue(result.endswith("[]"))
            self.assertNotIn("private failure", result)
