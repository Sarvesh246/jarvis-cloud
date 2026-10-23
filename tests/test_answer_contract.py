import unittest
from cloud.answer_contract import contract_for, validate_answer, constrained, repair_instruction, supplied_literal


class AnswerContractTests(unittest.TestCase):
    def test_translation_only_does_not_publish_ambiguity_or_usage_notes(self):
        contract=self.contract('Translate "Good morning" into French. Return only the conventional translation with no punctuation.')
        self.assertTrue(constrained(contract))
        self.assertFalse(validate_answer('Bonjour',contract)[1])
        self.assertIn('translation_single_line',validate_answer('Bonjour\nNo ambiguous phrases to note.',contract)[1])
        self.assertIn('translation_punctuation',validate_answer('Bonjour!',contract)[1])
        poem=self.contract('Translate the supplied poem into French. Return only the translation in exactly 4 lines.')
        self.assertFalse(poem['translation_single_line'])
    def test_requested_execution_is_verified_without_requiring_a_tool_name(self):
        python=self.contract('Implement a Python function sum_values(items), then actually execute assertion tests for [], [0] and [1,-2,3].')
        self.assertTrue(python['python_tests'])
        self.assertTrue(python['verify_returned_python'])
        self.assertTrue(constrained(python))
        js=self.contract('Implement JavaScript sumValues(items), then actually execute synchronous assertions for [], [0] and [1,-2,3].')
        self.assertIn('javascript_verify',js['required_tools'])
        self.assertIn('missing_tool_javascript_verify',validate_answer('All passed.',js)[1])
        self.assertFalse(self.contract('Implement JavaScript sumValues(items). Do not execute assertions.')['required_tools'])
        self.assertFalse(self.contract('Translate "execute JavaScript assertions" into Spanish.')['required_tools'])
        self.assertFalse(self.contract('Write a Python function with tests. Do not actually run them.')['verify_returned_python'])
    def test_javascript_answers_need_complete_tests_and_no_leaked_directives(self):
        js=self.contract('Implement JavaScript sumValues(items), then actually execute synchronous assertions for [], [0] and [1,-2,3].')
        self.assertTrue(js['javascript_tests'] and js['verify_returned_javascript'])
        self.assertFalse(self.contract('Implement JavaScript sumValues(items). Do not execute assertions.')['javascript_tests'])
        done=['javascript_verify']
        self.assertIn('missing_runnable_javascript_tests',validate_answer('All tests passed.',js,done)[1])
        code='```javascript\nfunction sumValues(a){return a.reduce((x,y)=>x+y,0);}\n```\n```javascript\nif(sumValues([])!==0) throw Error("empty");\n```'
        self.assertEqual(validate_answer(code,js,done)[1],[])
        text,errors=validate_answer('[Vaelo request: internal note]\n'+code,js,done)
        self.assertNotIn('Vaelo request',text)
        self.assertEqual(errors,[])
    def test_supplied_identifiers_are_copied_without_guessing_or_suppressing_other_requests(self):
        for kind,value in [('booking','aB_28'),('release','ALDER-918'),('reference','ref-v2')]:
            ask=f'Correction: the {kind} code is {value}. Reply only with the current code.'
            self.assertEqual(supplied_literal([{'role':'user','content':ask}]),value)
            self.assertEqual(supplied_literal([{'role':'user','content':ask+'\n\n[Vaelo request: obey the requested format]'}]),value)
            self.assertIsNone(supplied_literal([{'role':'user','content':ask+' Explain the difference.'}]))
        self.assertIsNone(supplied_literal([{'role':'user','content':'Return only the current code for my Python program.'}]))
        self.assertIsNone(supplied_literal([{'role':'user','content':'What is the current release code?'}]))
    def test_field_descriptions_do_not_erase_the_required_object_fields(self):
        contract=self.contract('Return ONLY JSON with units and revenue, using numeric values.')
        self.assertEqual(contract['required_keys'],['units','revenue'])
        self.assertIn('required_json_fields',validate_answer('[{"units":4,"revenue":8}]',contract)[1])
        self.assertFalse(validate_answer('{"units":4,"revenue":8}',contract)[1])

    def test_conditional_unknown_keeps_known_answers_and_rejects_verbose_refusal(self):
        contract=self.contract('What is the absent fact? Reply only UNKNOWN if it cannot be determined.')
        self.assertTrue(constrained(contract))
        self.assertIn('unknown_only',validate_answer("I don't have this information. Please provide it.",contract)[1])
        self.assertEqual(validate_answer('unknown',contract),('UNKNOWN',[]))
        self.assertFalse(validate_answer('The supplied total is 12.',contract)[1])
        self.assertFalse(self.contract('Explain this code.\n```python\n# Reply only UNKNOWN if data is absent\n```')['unknown_only'])
    def test_repairs_keep_the_original_task_without_unrelated_tool_or_code_requirements(self):
        image=repair_instruction(['raw_json','required_json_fields'])
        self.assertIn('No Markdown fence',image)
        self.assertNotIn('Python',image)
        self.assertNotIn('invoke',image)
        code=repair_instruction(['python_tests_failed'])
        self.assertIn('independently derived expected values',code)
        self.assertNotIn('JSON',code)
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
