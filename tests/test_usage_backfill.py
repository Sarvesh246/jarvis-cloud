from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("backfill", Path(__file__).resolve().parents[1] /
                                              "deploy/usage-dashboard/backfill.py")
backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backfill)


class BackfillTests(unittest.TestCase):
    def test_excludes_live_coverage_deduplicates_and_never_guesses(self):
        text = """Oct 18
05:00:00 PM
vaelo run 1234abcd route=hermes usage_reports=1 reported_prompt_tokens=100 reported_completion_tokens=20 reported_cached_tokens=80
05:00:00 PM
vaelo run 1234abcd route=hermes usage_reports=1 reported_prompt_tokens=100 reported_completion_tokens=20 reported_cached_tokens=80
05:30:00 PM
vaelo run 2345abcd route=hermes outcome=complete
06:20:00 PM
vaelo run 3456abcd route=hermes usage_reports=1 reported_prompt_tokens=999 reported_completion_tokens=999
"""
        cutoff = datetime(2026, 10, 18, 23, 19, tzinfo=timezone.utc)
        events = backfill.parse_history(text, cutoff, 2026)
        self.assertEqual(len(events), 2)
        self.assertEqual(sum(e["input"] + e["output"] for e in events), 120)
        self.assertEqual(sum(not e["reported"] for e in events), 1)
        self.assertTrue(all(datetime.fromisoformat(e["at"]) < cutoff for e in events))
        self.assertEqual(events, backfill.parse_history(text, cutoff, 2026))

    def test_ambiguous_timestamp_and_conflicting_duplicate_fail_closed(self):
        cutoff = datetime(2026, 10, 18, 23, 19, tzinfo=timezone.utc)
        with self.assertRaises(ValueError):
            backfill.parse_history("vaelo run 1234abcd route=hermes", cutoff, 2026)
        text = "Oct 18\n05:00:00 PM\nvaelo run 1234abcd route=hermes usage_reports=1 reported_prompt_tokens=1\n"
        with self.assertRaises(ValueError):
            backfill.parse_history(text + "vaelo run 1234abcd route=hermes usage_reports=1 reported_prompt_tokens=2", cutoff, 2026)


if __name__ == "__main__":
    unittest.main()
