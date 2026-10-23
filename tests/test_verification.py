import json
import sys
import unittest
from unittest import mock
from cloud import verification
from cloud.verification import verify


class VerificationInputTests(unittest.TestCase):
    def test_parallel_verifiers_do_not_exhaust_cloud_memory(self):
        verification._workers.acquire()
        try:
            with mock.patch.object(verification.sys,'platform','linux'):
                self.assertEqual(verify({'source':'pass','tests':'assert True'})['status'],'busy')
        finally:
            verification._workers.release()
    def test_invalid_and_oversized_input_never_executes(self):
        for value in ({}, None, {"source": "pass", "tests": ""},
                      {"source": "x" * 24001, "tests": "pass"},
                      {"source": "pass", "tests": "pass", "path": "/tmp"}):
            self.assertEqual(verify(value)["status"], "invalid")

    @unittest.skipIf(sys.platform == "linux", "Non-Linux boundary")
    def test_non_linux_fails_closed(self):
        self.assertEqual(verify({"source": "raise Exception('must not run')", "tests": "pass"})["status"], "unavailable")


@unittest.skipUnless(sys.platform == "linux", "Requires actual Linux seccomp")
class LinuxVerificationTests(unittest.TestCase):
    def test_assertion_runner_names_and_main_guard_execute_real_checks(self):
        from cloud.code_answer import returned_python
        source = ('def sum_values(items): return sum(items)\n'
                  'def check_values():\n    assert sum_values([1,-2,3])==2\n'
                  'def run_checks(): check_values()\n'
                  'if __name__ == "__main__": run_checks()\n')
        self.assertEqual(verify(returned_python('```python\n'+source+'```'))['status'],'passed')
        bad=source.replace('==2','==3')
        self.assertEqual(verify(returned_python('```python\n'+bad+'```'))['status'],'failed')
        uncalled=source.replace('if __name__ == "__main__": run_checks()','')
        self.assertEqual(verify(returned_python('```python\n'+uncalled+'```'))['status'],'failed')

    def test_returned_unittest_main_uses_submitted_module_without_terminal_access(self):
        from cloud.code_answer import returned_python
        source = ('import unittest\n'
                  'class TestSimple(unittest.TestCase):\n'
                  '    def test_sum(self): self.assertEqual(2+2,4)\n'
                  'unittest.main(argv=["verify"],exit=False)\n')
        result = verify(returned_python('```python\n'+source+'```'))
        self.assertEqual(result['status'], 'passed', result)
        self.assertIn('Ran 1 test', result['output'])
        bad = verify(returned_python('```python\n'+source.replace('2+2,4','2+2,5')+'```'))
        self.assertEqual(bad['status'], 'failed', bad)

    def test_returned_answer_executes_uncalled_tests_and_detects_mutation(self):
        from cloud.code_answer import returned_python
        answer='```python\ndef f(items):\n    items[0]=9\n    return items\n```\n```python\ndef test_case():\n    assert f([1]) == [9]\n```'
        self.assertEqual(verify(returned_python(answer,True))['status'],'failed')
        good=answer.replace('items[0]=9\n    return items','return [9]')
        self.assertEqual(verify(returned_python(good,True))['status'],'passed')
    def test_operator_selected_runtime_is_used_and_missing_runtime_fails_closed(self):
        with mock.patch.dict('os.environ',{'VAELO_VERIFIER_PYTHON':'/nonexistent/vaelo-python'}):
            self.assertEqual(self.run_code('pass')['status'],'unavailable')
        with mock.patch.dict('os.environ',{'VAELO_VERIFIER_PYTHON':sys.executable}):
            self.assertEqual(self.run_code('value=17*23','assert value==391')['status'],'passed')
    def run_code(self, source, tests="assert True"):
        return verify({"source": source, "tests": tests})

    def test_implementation_and_independent_expected_results(self):
        source = '''def merge_intervals(intervals):
    result = []
    for start, end in sorted(intervals):
        if result and start <= result[-1][1]:
            result[-1][1] = max(end, result[-1][1])
        else:
            result.append([start, end])
    return result
'''
        tests = '''original = [[0,4],[-5,-3],[-2,1]]
before = [row[:] for row in original]
assert merge_intervals(original) == [[-5,-3],[-2,4]]
assert original == before
assert merge_intervals([]) == []
assert merge_intervals([[1,2],[2,3]]) == [[1,3]]
assert merge_intervals([[1,5],[2,3]]) == [[1,5]]
'''
        result = self.run_code(source, tests)
        self.assertEqual(result["status"], "passed", result)
        wrong = self.run_code(source, "assert merge_intervals([[-5,-3],[-2,1],[0,4]]) == [[-5,4]], 'incorrect bridge expectation'")
        self.assertEqual(wrong["status"], "failed", wrong)
        self.assertIn("incorrect bridge expectation", wrong["output"])

    def test_stdlib_calculation(self):
        result = self.run_code("import math, collections\nx = math.sqrt(81)", "assert x == 9")
        self.assertEqual(result["status"], "passed", result)

    def test_no_files_network_processes_or_privileged_syscalls(self):
        for source in ("open('/etc/passwd').read()", "open('created', 'w').write('x')",
                       "import os; os.fork()", "import os; os.system('true')",
                       "import ctypes; ctypes.CDLL(None).socket(2,1,0)",
                       "import ctypes; ctypes.CDLL(None).ptrace(0,0,0,0)"):
            with self.subTest(source=source):
                result = self.run_code(source)
                self.assertEqual(result["status"], "failed", result)

    def test_cpu_output_and_early_exit_limits(self):
        for source in ("while True: pass", "while True: print('x' * 4096)", "raise SystemExit(0)", "import os; os._exit(0)"):
            result = self.run_code(source)
            self.assertNotEqual(result["status"], "passed", result)
            self.assertLessEqual(len(result.get("output", "").encode()), 32768)


if __name__ == "__main__":
    unittest.main()
