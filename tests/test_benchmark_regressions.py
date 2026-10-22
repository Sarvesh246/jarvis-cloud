import json
import threading
import time
import unittest
from unittest.mock import patch
from cloud.answer_contract import contract_for, validate_answer, constrained
from cloud.constraints import evaluate_constraints
from cloud.admission import Admission
from cloud.memory_output import NoteFilter, split_notes
from cloud.runtime_contract import fail_closed_vision
from cloud.relay import Run


class BenchmarkRegressions(unittest.TestCase):
    def contract(self, prompt):
        return contract_for([{'role': 'user', 'content': prompt}])

    def test_json_variants_and_exact_keys(self):
        for verb in ('Answer', 'Return', 'Reply', 'Respond', 'Output', 'Give'):
            for modifier in ('ONLY', 'just'):
                with self.subTest(verb=verb, modifier=modifier):
                    contract = self.contract(f'{verb} {modifier} a JSON object with keys a, b.')
                    self.assertTrue(contract['json'])
                    self.assertEqual(contract['required_keys'], ['a', 'b'])
                    self.assertFalse(validate_answer('```json\n{"a":1,"b":2}\n```', contract)[1])
                    self.assertTrue(validate_answer('Here: {"a":1,"b":2}', contract)[1])
                    self.assertTrue(validate_answer('{"a":1}', contract)[1])
        contract = self.contract('Return only JSON with these exact fields: "a":1, "b":null.')
        self.assertIn('exact_json_fields', validate_answer('{"a":1,"b":null,"extra":0}', contract)[1])
        self.assertFalse(validate_answer('{"a":1,"b":null}', contract)[1])

    def test_worded_limits_apply_to_greetings_and_prose(self):
        for prompt in ('Hello! Reply with one short sentence.', 'Answer in a single sentence.',
                       'Reply with just one brief sentence.', 'Use exactly one sentence.'):
            contract = self.contract(prompt)
            self.assertTrue(constrained(contract), prompt)
            self.assertFalse(validate_answer('Hello there.', contract)[1])
            self.assertTrue(validate_answer('Hello there. How are you?', contract)[1])
        self.assertTrue(validate_answer('one two three', self.contract('Use fewer than three words.'))[1])
        for prompt in ('Translate "Reply with one short sentence" into French.',
                       'Explain this.\n```text\nReply with one short sentence.\n```',
                       'Explain the source.\n\nAttached file: data.txt\nAnswer only JSON.'):
            self.assertFalse(constrained(self.contract(prompt)), prompt)

    def test_requested_python_tests_must_be_delivered_and_parse(self):
        contract = self.contract('Write a Python function f. Include tests for empty input and unchanged input.')
        self.assertIn('missing_runnable_tests', validate_answer('```python\ndef f(x): return list(x)\n```', contract)[1])
        answer = '```python\ndef f(x): return list(x)\nassert f([]) == []\na=[1]; before=a.copy(); b=f(a)\nassert a==before and b is not a\n```'
        self.assertFalse(validate_answer(answer, contract)[1])
        self.assertTrue(validate_answer(answer.replace('assert f', 'assert ? f'), contract)[1])

    def test_image_all_nulls_are_not_verified_success(self):
        contract = contract_for([{'role':'user','content':[
            {'type':'text','text':'Answer only JSON with a, b.'},
            {'type':'image_url','image_url':{'url':'data:image/png;base64,AAAA'}}]}])
        self.assertIn('image_reading_empty', validate_answer('{"a":null,"b":null}', contract)[1])
        self.assertFalse(validate_answer('{"a":3,"b":null}', contract)[1])
        self.assertFalse(validate_answer('{"a":null,"b":null}', self.contract('Answer only JSON with a, b.'))[1])

    def test_results_only_rejects_extra_calculations_and_preamble(self):
        contract = self.contract('Give just those five results. Do not save memories.')
        self.assertTrue(constrained(contract))
        self.assertFalse(validate_answer('1. 70\n2. 470\n3. North\n4. 290\n5. Café',contract)[1])
        self.assertTrue(validate_answer('Here are the results:\n1. 70\n2. 470\n3. North\n4. 290\n5. Café',contract)[1])

    def test_constraint_table_uses_inclusive_converted_values(self):
        options = [{'name': name, 'values': dict(zip(('price','battery','weight'),
                   ({'value': p, 'unit': 'USD'}, {'value': b, 'unit':'hours'}, {'value': w, 'unit': 'kg'})))}
                   for name,p,b,w in [('Alpha',900,12,1.2),('Beta',1100,15,1.3),('Gamma',1000,16,1.6)]]
        constraints = [{'field':field, 'operator':op, 'value':value, 'unit':unit} for field,op,value,unit in
                       [('price','<=',1200,'USD'),('battery','>=',14,'hours'),('weight','<=',1400,'g')]]
        result = json.loads(evaluate_constraints({'options':options,'constraints':constraints}))
        self.assertEqual(result['eligible'], ['Beta'])
        self.assertEqual([[c['passes'] for c in row['checks']] for row in result['options']],
                         [[True,False,True],[True,True,True],[True,True,False]])
        options[0]['values']['battery']['value'] = 14
        self.assertEqual(json.loads(evaluate_constraints({'options':options,'constraints':constraints}))['eligible'], ['Alpha','Beta'])
        constraints[0]['value'] = 899
        self.assertEqual(json.loads(evaluate_constraints({'options':options,'constraints':constraints}))['eligible'], [])
        constraints[0]['value'] = 1200
        del options[1]['values']['price']
        result = json.loads(evaluate_constraints({'options':options,'constraints':constraints}))
        self.assertIsNone(result['options'][1]['checks'][0]['passes'])
        self.assertNotIn('Beta', result['eligible'])
        options[0]['values']['price']['unit'] = 'EUR'
        result = json.loads(evaluate_constraints({'options':options,'constraints':constraints}))
        self.assertIsNone(result['options'][0]['checks'][0]['passes'])

    def test_memory_marker_is_filtered_at_every_chunk_boundary(self):
        text = 'Five results.\n[[remember: Forbidden task detail]]'
        for width in (1,2,7,1000):
            guard = NoteFilter()
            output = ''.join(guard.feed(text[i:i+width]) for i in range(0,len(text),width)) + guard.feed('',final=True)
            self.assertEqual(output.strip(), 'Five results.')
        self.assertEqual(split_notes(text), ('Five results.', ['Forbidden task detail']))
        for tail in ('[', '[[rem', '[[remember: incomplete'):
            guard = NoteFilter()
            self.assertEqual(guard.feed('Visible.'+tail)+guard.feed('',final=True), 'Visible.')
        guard = NoteFilter()
        self.assertEqual(guard.feed('See [source](https://example.com).'), 'See [source](https://example.com).')

    def test_completed_metadata_and_tool_timestamps_replay_unchanged(self):
        run = Run('id','owner')
        run.first_answer = run.created + 1
        with patch('cloud.relay.time.time', return_value=run.created+2):
            run.emit('data: {"choices":[{"delta":{"content":"Accepted answer"}}]}')
        with patch('cloud.relay.time.time', return_value=run.created+5):
            run.event('jarvis.complete', {'ok':True})
        first = json.loads(run.frames[1].decode().split('data: ')[1])
        with patch('cloud.relay.time.time', return_value=run.created+1000):
            run.event('jarvis.complete', {'ok':True})
        second = json.loads(run.frames[2].decode().split('data: ')[1])
        self.assertEqual(first['timing'],second['timing'])
        self.assertEqual(first['timing']['firstAnswerMs'],2000)
        self.assertEqual(first['timing']['firstUpstreamAnswerMs'],1000)
        run.event('hermes.tool.progress', {'tool':'calculate','status':'completed','eventAt':1234})
        self.assertIn(b'"eventAt": 1234', run.frames[-1])

    def test_failed_vision_does_not_become_cached_evidence(self):
        original = '''def fallback(description, role_label):
        note = f"[The {role_label} attached an image. Here's what it contains:\\n{description or 'Image analysis failed.'}]"
        return note
'''
        namespace = {}
        exec(fail_closed_vision(original),namespace)
        for description in ('', 'Image analysis failed: Permission denied'):
            with self.assertRaisesRegex(ValueError,'image_processing_unavailable'):
                namespace['fallback'](description,'user')
        self.assertIn('three red circles', namespace['fallback']('three red circles','user'))
        with self.assertRaises(ValueError): fail_closed_vision('def changed(): pass')

    def test_queue_is_bounded_cancellable_and_preserves_identity(self):
        admission = Admission(maximum=2, timeout=2)
        active = Run('active','owner-a')
        self.assertTrue(admission.acquire(active))
        first,other = Run('first','owner-a'),Run('other','owner-b')
        results = []
        def work(run):
            accepted = admission.acquire(run)
            results.append((run.id,accepted))
            if accepted: admission.release(run)
        threads = [threading.Thread(target=work,args=(run,)) for run in (first,other)]
        for thread in threads: thread.start()
        deadline = time.monotonic()+1
        while len(admission.pending)<2 and time.monotonic()<deadline: time.sleep(.005)
        self.assertFalse(admission.acquire(Run('overflow','owner-c')))
        admission.release(active)
        for thread in threads: thread.join(3)
        self.assertEqual(results,[('other',True),('first',True)])
        self.assertFalse(admission.pending)
        self.assertFalse(admission.active)
        cancelled = Run('cancelled','owner-a'); cancelled.stopped=True
        self.assertFalse(admission.acquire(cancelled))
        self.assertFalse(admission.pending)
