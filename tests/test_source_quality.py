import unittest

from cloud.source_quality import subjects, source_scope, relevant_sources, official_source


class SourceQualityTests(unittest.TestCase):
    def test_exact_model_names_and_shorthand(self):
        self.assertEqual(subjects("Compare iPhone 15 Pro and iPhone 18 Pro Max"), ["iphone 15 pro", "iphone 18 pro max"])
        self.assertEqual(subjects("iPhone 15 Pro vs 18 Pro Max"), ["iphone 15 pro", "iphone 18 pro max"])
        self.assertEqual(subjects("Galaxy S26 Ultra vs S25 Ultra"), ["galaxy s26 ultra", "galaxy s25 ultra"])
        self.assertEqual(subjects("Nebula 8 Mini vs Nebula 9 Ultra"), ["nebula 8 mini", "nebula 9 ultra"])
        self.assertEqual(subjects("Compare the latest phones in 2026"), [])
        self.assertEqual(subjects("Who won 2026 elections?"), [])
        self.assertEqual(subjects("Chicago weather October 16"), [])
        self.assertEqual(subjects("average income over 2026"), [])

    def test_wrong_comparison_pair_is_rejected(self):
        hit = {"title": "Compare OnePlus 16 vs Apple iPhone 15 Pro", "url": "https://example.com/compare",
               "description": "OnePlus 16 is compared with the iPhone 15 Pro."}
        self.assertIsNone(source_scope(hit, subjects("iPhone 15 Pro vs iPhone 18 Pro Max")))

    def test_single_model_source_is_scoped_to_only_that_model(self):
        hit = {"title": "iPhone 15 Pro - Technical Specifications", "description": "A17 Pro chip", "url": "https://support.apple.com/15"}
        scoped = source_scope(hit, subjects("iPhone 15 Pro vs iPhone 18 Pro Max"))
        self.assertEqual(scoped["subjects"], ["iphone 15 pro"])

    def test_max_and_non_max_generations_are_not_interchangeable(self):
        for title in ["iPhone 15 Pro Max specifications", "iPhone 18 Pro specifications", "iPhone 18 Pro Max specifications"]:
            with self.subTest(title=title):
                self.assertIsNone(source_scope({"title": title}, ["iphone 15 pro"]))
        self.assertIsNone(source_scope({"title": "iPhone 18 Pro specifications"}, ["iphone 18 pro max"]))
        self.assertIsNone(source_scope({"title": "Python 31.4 release notes"}, ["python 3.14"]))

    def test_wrong_variant_title_cannot_be_rescued_by_a_passing_reference(self):
        hit = {"title": "iPhone 18 Pro specifications", "description": "Its display differs from the iPhone 18 Pro Max."}
        self.assertIsNone(source_scope(hit, ["iphone 18 pro max"]))

    def test_other_products_in_body_do_not_invalidate_a_correct_primary_source(self):
        hit = {"title": "iPhone 18 Pro Max specifications", "description": "iPhone 18 Pro Max, compared with iPhone 17 Pro Max.", "url": "https://apple.com/18"}
        self.assertEqual(source_scope(hit, ["iphone 18 pro max"])["subjects"], ["iphone 18 pro max"])

    def test_correct_comparison_may_cover_both_subjects(self):
        hit = {"title": "iPhone 15 Pro vs iPhone 18 Pro Max", "url": "https://example.com/compare"}
        wanted = ["iphone 15 pro", "iphone 18 pro max"]
        self.assertEqual(source_scope(hit, wanted)["subjects"], wanted)

    def test_official_sources_rank_first_without_trusting_lookalike_domains(self):
        hits = [{"title": "iPhone 15 Pro review", "url": "https://review.example/15"},
                {"title": "iPhone 15 Pro specifications", "url": "https://support.apple.com/15"}]
        result = relevant_sources("iPhone 15 Pro specifications", hits)
        self.assertEqual(result[0]["url"], hits[1]["url"])
        self.assertFalse(official_source({"url": "https://apple.com.evil.example/"}, ["iphone 15 pro"]))

    def test_non_product_research_keeps_the_existing_ranking(self):
        hits = [{"title": "A study", "url": "https://example.com/study"}]
        self.assertEqual(relevant_sources("How does photosynthesis work?", hits), hits)
