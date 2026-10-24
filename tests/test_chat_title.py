import unittest
import json
from cloud.chat_title import TitleFilter, concise_title, fallback_title, title_messages


class ChatTitleTests(unittest.TestCase):
    def test_json_mode_extracts_title_without_changing_the_requested_object(self):
        source = '{"_vaelo_title":"Image color counts","_vaelo_answer":{"red":2,"blue":1}}'
        for split in range(len(source) + 1):
            reader = TitleFilter(json_mode=True)
            answer = reader.feed(source[:split]) + reader.feed(source[split:], final=True)
            self.assertEqual(json.loads(answer), {'red': 2, 'blue': 1})
            self.assertEqual(reader.title, 'Image color counts')
        reader = TitleFilter(json_mode=True)
        raw = '{"red":2,"blue":1}'
        self.assertEqual(reader.feed(raw, final=True), raw)
        self.assertIsNone(reader.title)

    def test_titles_do_not_require_a_second_call_when_metadata_is_omitted(self):
        for prompt, expected in [
            ('Can you please help me parse CSV files in Python?', 'parse CSV files in Python'),
            ('What is 17 times 23?', '17 times 23'),
            ('Weather in College Station today', 'Weather in College Station today'),
        ]:
            self.assertEqual(fallback_title([{'role': 'user', 'content': prompt}]), expected)
        self.assertEqual(fallback_title([{'role': 'user', 'content': [{'type': 'image_url'}]}]), 'Image discussion')
        private = fallback_title([{'role': 'user', 'content': 'Help me email alice@example.com about invoice 123456789.'}])
        self.assertNotIn('alice', private)
        self.assertNotIn('123456789', private)

    def test_guidance_is_added_at_the_transport_boundary_without_mutating_history(self):
        original = [{'role': 'system', 'content': 'Specialized coding instructions.'}, {'role': 'user', 'content': 'Write a parser.'}]
        titled = title_messages(original, True)
        self.assertIn('<vaelo-title>', titled[0]['content'])
        self.assertEqual(original[0]['content'], 'Specialized coding instructions.')
        self.assertIs(title_messages(original, False), original)
        self.assertIn('_vaelo_title', title_messages(original, True, json_mode=True)[0]['content'])

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
