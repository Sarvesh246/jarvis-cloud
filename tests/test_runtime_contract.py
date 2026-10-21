import unittest
from cloud.runtime_contract import align_normalization

NORMALIZER = '''MAX_NORMALIZED_TEXT_LENGTH = 65_536
def _cap_text(text):
    return text[:MAX_NORMALIZED_TEXT_LENGTH]
def _normalize_chat_content(content):
    return _cap_text(content)[:MAX_NORMALIZED_TEXT_LENGTH]
'''


class RuntimeContractTests(unittest.TestCase):
    def test_middle_end_and_cumulative_sources_survive_existing_budget(self):
        source = align_normalization(NORMALIZER)
        namespace = {}
        exec(source, namespace)
        text = "START" + "x" * 73495 + "MIDDLE" + "x" * 72494 + "END"
        self.assertEqual(namespace["_normalize_chat_content"](text), text)
        self.assertEqual(namespace["_normalize_chat_content"](text * 2), text * 2)
        self.assertEqual(len(namespace["_cap_text"]("x" * 400000)), 360000)
        self.assertEqual(align_normalization(source), source)
        self.assertEqual(source.replace("360000", "65_536"), NORMALIZER)

    def test_upstream_contract_drift_fails_build(self):
        for source in (NORMALIZER.replace("65_536", "1000"),
                       NORMALIZER + "MAX_NORMALIZED_TEXT_LENGTH = 65536\n",
                       NORMALIZER.replace("_cap_text", "_changed"),
                       NORMALIZER.replace("65_536", "True")):
            with self.subTest(source=source), self.assertRaises(ValueError):
                align_normalization(source)
