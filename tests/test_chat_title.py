import unittest
from cloud.chat_title import TitleFilter


class ChatTitleTests(unittest.TestCase):
    def test_every_chunk_boundary_preserves_exact_answer(self):
        source = '<vaelo-title>Plan a Chicago weekend</vaelo-title>\n{"ok":true}'
        for split in range(len(source) + 1):
            reader = TitleFilter()
            answer = reader.feed(source[:split]) + reader.feed(source[split:], final=True)
            self.assertEqual(answer.lstrip('\n'), '{"ok":true}')
            self.assertEqual(reader.title, 'Plan a Chicago weekend')

    def test_missing_metadata_preserves_answer(self):
        for source in ['Hello café', '{"ok":true}', '<svg>example</svg>', '  exact text']:
            reader = TitleFilter()
            self.assertEqual(''.join(reader.feed(char) for char in source) + reader.feed('', final=True), source)
            self.assertIsNone(reader.title)

    def test_partial_metadata_never_leaks(self):
        reader = TitleFilter()
        self.assertEqual(reader.feed('<vaelo-title>unfinished', final=True), '')
        self.assertIsNone(reader.title)

    def test_oversized_title_is_not_accepted(self):
        reader = TitleFilter()
        self.assertEqual(reader.feed('<vaelo-title>' + 'a' * 121 + '</vaelo-title>\nanswer'), 'answer')
        self.assertIsNone(reader.title)
