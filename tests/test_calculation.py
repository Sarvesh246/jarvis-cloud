import json
import unittest
from cloud.calculation import calculate, date_difference, direct_calculation
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
try:
    ZoneInfo('America/Chicago')
    TZ_AVAILABLE=True
except ZoneInfoNotFoundError:
    TZ_AVAILABLE=False


class CalculationTests(unittest.TestCase):
    def test_direct_route_is_exact_and_rejects_uncertain_prose_or_sources(self):
        def direct(text,tier='normal'):
            return direct_calculation([{'role':'user','content':text}],tier)
        self.assertEqual(direct('What is 17 times 23? Answer with just the number.'),'391')
        self.assertEqual(direct('What is 15% of 200? Reply only the number.'),'30')
        self.assertEqual(direct('0.1+0.2','quick'),'0.3')
        for value in ('1/3. Reply only the number.','Explain 2+2 in detail.',
                      'What is 2+2? Return only JSON.','What is my balance? Answer only the number.',
                      '2+2\n\nAttached file: source.txt\nSubtract 1.'):
            self.assertIsNone(direct(value),value)
    def value(self, expression, **values):
        return json.loads(calculate({'expression':expression,'values':values}))

    def test_decimal_arithmetic_boundaries_rounding_and_supplied_values(self):
        for expression, expected in (('0.1+0.2','0.3'),('17*23','391'),('-5//2','-3'),
                                      ('-5%2','1'),('round(2.345,2)','2.34'),('sqrt(81)','9'),
                                      ('sum([1,2,3])','6'),('max(1,9,-3)','9')):
            self.assertEqual(self.value(expression)['value'],expected)
        self.assertEqual(self.value('owed-settled',owed='100',settled='40')['value'],'60')

    def test_invalid_code_nonfinite_and_expensive_expressions_fail_closed(self):
        for expression in ("__import__('os').system('echo unsafe')",'1/0','2**100000',
                           '[0]*1000000','[x for x in [1]]','(1).__class__','2**0.5','unknown',
                           '9'*101,'-'*100+'1'):
            self.assertFalse(self.value(expression)['success'],expression)
        self.assertFalse(self.value('x',x='NaN')['success'])
        self.assertFalse(self.value('x',x='Infinity')['success'])

    @unittest.skipUnless(TZ_AVAILABLE,'Requires installed IANA timezone data; exercised on Linux')
    def test_calendar_and_elapsed_time_differ_across_dst(self):
        result=json.loads(date_difference({'start':'2026-03-08','end':'2026-03-09','timezone':'America/Chicago'}))
        self.assertTrue(result['success'],result)
        self.assertEqual(result['calendar_days'],1)
        self.assertEqual(result['elapsed_hours'],23)

    @unittest.skipUnless(TZ_AVAILABLE,'Requires installed IANA timezone data; exercised on Linux')
    def test_ambiguous_nonexistent_and_invalid_dates_require_explicit_input(self):
        for start in ('2026-11-01T01:30:00','2026-03-08T02:30:00','2026-02-30','tomorrow'):
            result=json.loads(date_difference({'start':start,'end':'2026-12-01','timezone':'America/Chicago'}))
            self.assertFalse(result['success'],start)
        result=json.loads(date_difference({'start':'2026-11-01T01:30:00-05:00','end':'2026-11-01T01:30:00-06:00','timezone':'America/Chicago'}))
        self.assertEqual(result['elapsed_hours'],1)
