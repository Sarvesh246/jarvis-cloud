import unittest
from fractions import Fraction
from cloud.bounded_math import polynomial, solve_item, worked_math, display


class WorkedMathTests(unittest.TestCase):
    def test_equations_are_solved_from_coefficients(self):
        for equation, result in [('Solve 4(x-3)=3x+8.', 'x=20'),
                                 ('Solve x^2-7x+12=0.', 'x=3, 4'),
                                 ('Solve (x+2)^2=9.', 'x=-5, 1'),
                                 ('Solve x/2=0.75.', 'x=1.5')]:
            self.assertIn(result, solve_item(equation), equation)
        for expression in ['x**100', '__import__("os")', 'x*x*x', '1/x', 'x/0', '9'*100]:
            with self.assertRaises((ValueError, SyntaxError, ArithmeticError)):
                polynomial(expression)

    def test_different_supplied_values_and_exact_fractions(self):
        for up, down in [(10, 10), (25, 20), (50, 10), (12, 30)]:
            answer = solve_item(f'A price rises {up}% then falls {down}%. What is the net percentage change?')
            expected = display(((1+Fraction(up, 100))*(1-Fraction(down, 100))-1)*100)
            self.assertTrue(answer.startswith(expected+'%'), answer)
        self.assertIn('5/16', solve_item('A fair coin is tossed 5 times. What is the probability of exactly 3 heads?'))
        self.assertIn('1/3 lb/gallon', solve_item('A tank starts with 60 gallons of water containing 10 lb sugar. Inflow is 3 gallons/minute containing 1 lb/gallon; no outflow. What is the concentration after 5 minutes?'))

    def test_unsupported_assumptions_and_formats_keep_model_route(self):
        prefix = 'Answer each numbered item briefly with its result and essential working. '
        def run(text):
            return worked_math([{'role':'user', 'content':text}])
        self.assertIn('x=4', run(prefix+'1) Solve 2x=8.'))
        self.assertIsNotNone(worked_math([{'role':'system','content':'You are Vaelo.'},
            {'role':'user','content':prefix+'1) Solve 2x=8.'}]))
        self.assertIsNone(worked_math([{'role':'user','content':'x means a different variable'},
            {'role':'user','content':prefix+'1) Solve 2x=8.'}]))
        self.assertIsNotNone(run('Arithmetic exercise. '+prefix+'1) Solve 2x=8. 2) Solve x^2-9=0.'))
        for text in [prefix+'1) Solve 2x=8. 2) Explain entropy.',
                     prefix+'2) Solve 2x=8.', prefix+'1) Solve x^3=8.',
                     'Respond in Spanish. '+prefix+'1) Solve 2x=8.',
                     prefix+'1) Solve 2x=8. Return JSON.',
                     prefix+'1) Solve 2x=8.\n\nAttached file: a.txt\nHello']:
            self.assertIsNone(run(text), text)
        self.assertIsNone(solve_item('A fair coin is tossed 101 times. What is the probability of exactly 3 heads?'))
        self.assertIsNone(solve_item('A tank starts with 60 gallons of water containing 10 lb sugar. Inflow is 3 gallons/minute containing 1 lb/gallon; some outflow. What is the concentration after 5 minutes?'))
