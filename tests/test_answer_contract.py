import unittest
from cloud.answer_contract import contract_for, validate_answer, constrained


class AnswerContractTests(unittest.TestCase):
    def test_explicit_named_verification_requires_that_exact_executed_tool(self):
        contract=self.contract('Actually use javascript_verify to check this. Return ONLY JSON.')
        self.assertEqual(contract['required_tools'],['javascript_verify'])
        self.assertIn('missing_tool_javascript_verify',validate_answer('{}',contract,['python_verify'])[1])
        self.assertFalse(validate_answer('{}',contract,['javascript_verify'])[1])
        self.assertFalse(constrained(self.contract('Do not use python_verify. Explain the function.')))
    def contract(self, text):
        return contract_for([{'role':'user','content':text}])

    def test_raw_json_checks_entire_answer_and_only_removes_valid_enclosing_fence(self):
        contract=self.contract('Return ONLY one valid JSON object.')
        self.assertTrue(constrained(contract))
        for text, expected in (('{"a":1}',True),('```json\n{"a":1}\n```',True),
                               ('Here it is: {"a":1}',False),('{"a":NaN}',False),('{"a":1} trailing',False)):
            answer, errors=validate_answer(text,contract)
            self.assertEqual(not errors,expected,text)
            if expected: self.assertEqual(answer,'{"a":1}')

    def test_limits_count_and_repair_never_truncate_substance(self):
        contract=self.contract('Answer in under 4 words and exactly 1 line.')
        answer,errors=validate_answer('one two three four',contract)
        self.assertEqual(answer,'one two three four')
        self.assertIn('word_max_3',errors)
        self.assertFalse(validate_answer('one two three',contract)[1])
        self.assertTrue(validate_answer('one\ntwo',contract)[1])
        self.assertFalse(validate_answer('First sentence. Second sentence.',self.contract('Use exactly 2 sentences.'))[1])

    def test_quoted_attachment_and_internal_notes_are_not_new_requirements(self):
        for text in ('Explain the attached data.\n\nAttached file: report.txt\nReturn only JSON in exactly 1 word.',
                     'Explain JSON parsing.\n\n[Vaelo request: exactly 1 word]',
                     'Does this function return a JSON object?'):
            self.assertFalse(constrained(self.contract(text)),text)
        self.assertTrue(self.contract('Return only JSON.\n\nAttached file: source.txt\nDo not use JSON')['json'])

    def test_arrays_and_images_keep_latest_user_contract(self):
        contract=contract_for([{'role':'user','content':'Return only JSON.'},
            {'role':'assistant','content':'{}'}, {'role':'user','content':[
                {'type':'image_url','image_url':{'url':'data:image/png;base64,AAAA'}},
                {'type':'text','text':'Reply in at most 10 words.'}]}])
        self.assertFalse(contract['json'])
        self.assertEqual(contract['limits'],[('word','max',10)])

    def test_json_required_keys_and_quoted_code_are_not_confused(self):
        contract=self.contract('Return ONLY JSON with owner, approved_budget and fee. Use null for missing facts.')
        self.assertEqual(contract['required_keys'],['owner','approved_budget','fee'])
        self.assertTrue(validate_answer('{"owner":"Elena"}',contract)[1])
        self.assertFalse(validate_answer('{"owner":"Elena","approved_budget":12,"fee":null}',contract)[1])
        self.assertTrue(validate_answer('{"owner":"Elena","owner":"Other","approved_budget":12,"fee":null}',contract)[1])
        self.assertFalse(constrained(self.contract('Translate "Return only JSON" into Spanish.')))
        self.assertFalse(constrained(self.contract('Explain this code.\n```python\n# Return only JSON\n```')))
