import unittest
from cloud.chat_title import TitleFilter, concise_title


class ChatTitleTests(unittest.TestCase):
    def test_every_chunk_boundary_preserves_exact_answer(self):
        source = '<vaelo-title>Plan a Chicago weekend</vaelo-title>\n{"ok":true}'
        for split in range(len(source) + 1):
            reader = TitleFilter()
            answer = reader.feed(source[:split]) + reader.feed(source[split:], final=True)
            self.assertEqual(answer, '{"ok":true}')
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

    def test_metadata_newline_is_removed_across_individual_chunks(self):
        for newline in ('\n', '\r\n'):
            source = '<vaelo-title>Python CSV parsing</vaelo-title>' + newline + '  exact\n\ntext'
            reader = TitleFilter()
            answer = ''.join(reader.feed(char) for char in source) + reader.feed('', final=True)
            self.assertEqual(answer, '  exact\n\ntext')
            self.assertEqual(reader.title, 'Python CSV parsing')

    def test_short_search_keywords_and_unicode_are_preserved(self):
        for title in ('iPhone 18 battery comparison', 'Chicago weekend itinerary', 'Python CSV parsing', '日本語の旅行計画', 'Café menu ☕'):
            self.assertEqual(concise_title(title), title)
        self.assertEqual(concise_title('  "Python   CSV parsing"  '), 'Python CSV parsing')
        self.assertEqual(concise_title('Compare iPhone 18 battery life and camera performance in detail'), 'Compare iPhone 18 battery life and')
        self.assertEqual(concise_title('PostgreSQL connection pooling configuration troubleshooting'), 'PostgreSQL connection pooling configuration')
        for title in ('', '   ', '<script>bad</script>', '**Markdown title**', 'x' * 121):
            self.assertIsNone(concise_title(title))
