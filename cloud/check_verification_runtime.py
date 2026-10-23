"""Exercise supported test runners and confinement in the pinned image."""
from code_answer import returned_python
from verification import verify


def main():
    assert verify({'source': 'const result=17*23;',
                   'tests': 'if(result!==391) throw Error("bad result");'},
                  language='javascript')['status'] == 'passed'
    assert verify({'source': 'value=17*23', 'tests': 'assert value==391'})['status'] == 'passed'
    source = ('import unittest\nclass TestSimple(unittest.TestCase):\n'
              '    def test_sum(self): self.assertEqual(2+2,4)\n'
              'unittest.main(argv=["verify"],exit=False)\n')
    result = verify(returned_python('```python\n'+source+'```'))
    assert result['status'] == 'passed', result
    assert 'Ran 1 test' in result['output'], result
    assert verify(returned_python('```python\n'+source.replace('2+2,4', '2+2,5')+'```'))['status'] == 'failed'
    assert verify({'source': 'open("/etc/passwd").read()', 'tests': 'assert True'})['status'] == 'failed'
    print('Production image: Python, JavaScript, unittest discovery and confinement passed.')


if __name__ == '__main__':
    main()
