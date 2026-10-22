import sys
import unittest
from cloud.verification import verify


@unittest.skipUnless(sys.platform=='linux','Requires actual Linux confinement')
class JavaScriptVerificationTests(unittest.TestCase):
    def run_code(self, source, tests='if (true !== true) throw Error("failed");'):
        return verify({'source':source,'tests':tests},language='javascript')

    def test_implementation_expected_values_and_mutation_checks(self):
        source='function sum(values) { return values.reduce((a,b)=>a+b,0); }'
        tests='const input=[3,-2,5], before=JSON.stringify(input); if(sum(input)!==6 || JSON.stringify(input)!==before || sum([])!==0) throw Error("sum failed");'
        result=self.run_code(source,tests)
        self.assertEqual(result['status'],'passed',result)
        result=self.run_code(source,'if(sum([3,-2,5])!==7) throw Error("wrong expected result");')
        self.assertEqual(result['status'],'failed',result)
        self.assertIn('wrong expected result',result['output'])

    def test_no_host_runtime_or_network_bridges(self):
        for source in ('process.exit(0)','require("fs").readFileSync("/etc/passwd")',
                       'fetch("https://example.com")','std.open("/etc/passwd")'):
            result=self.run_code(source)
            self.assertEqual(result['status'],'failed',result)

    def test_cpu_memory_and_async_results_are_bounded(self):
        for source,tests in (('while(true){}','true'),('const a=new Array(100000000).fill(1);','true'),
                             ('function f(){return Promise.resolve(1);}','f()')):
            result=self.run_code(source,tests)
            self.assertEqual(result['status'],'failed',result)
            self.assertFalse(result['tests_completed'])
