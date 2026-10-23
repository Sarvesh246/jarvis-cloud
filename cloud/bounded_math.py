"""Small complete grammars for worked arithmetic; unsupported prose stays with the model.

Every accepted question is consumed in full. No extracted number is treated as
an answer to a question with extra assumptions, units or instructions.
"""
import ast
from fractions import Fraction
from math import comb, isqrt
import re

NUMBER = r'(\d+(?:\.\d+)?)'


def display(value):
    value = Fraction(value)
    if value.denominator == 1:
        return str(value.numerator)
    denominator = value.denominator
    for factor in (2, 5):
        while denominator % factor == 0:
            denominator //= factor
    if denominator == 1:
        from decimal import Decimal, localcontext
        with localcontext() as context:
            context.prec = 2048
            return format(Decimal(value.numerator) / Decimal(value.denominator), 'f')
    return f'{value.numerator}/{value.denominator}'


def polynomial(expression):
    expression = expression.strip().replace('^', '**')
    expression = re.sub(r'(\d|\))(?=x|\()', r'\1*', expression)
    expression = re.sub(r'x(?=\()', 'x*', expression)
    if len(expression) > 180 or not re.fullmatch(r'[\dx\s.+*/()\-]+', expression):
        raise ValueError('Unsupported equation')
    root = ast.parse(expression.strip(), mode='eval')
    if sum(1 for _ in ast.walk(root)) > 70:
        raise ValueError('Equation too complex')

    def evaluate(node):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            source = ast.get_source_segment(expression, node)
            if len(source) > 18:
                raise ValueError('Constant too large')
            return [Fraction(source), Fraction(0), Fraction(0)]
        if isinstance(node, ast.Name) and node.id == 'x':
            return [Fraction(0), Fraction(1), Fraction(0)]
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            return [(-v if isinstance(node.op, ast.USub) else v) for v in evaluate(node.operand)]
        if not isinstance(node, ast.BinOp):
            raise ValueError('Unsupported equation')
        left = evaluate(node.left)
        if isinstance(node.op, ast.Pow):
            if not isinstance(node.right, ast.Constant) or type(node.right.value) is not int or node.right.value != 2:
                raise ValueError('Only squares supported')
            right = left
        else:
            right = evaluate(node.right)
        if isinstance(node.op, (ast.Add, ast.Sub)):
            return [a + (b if isinstance(node.op, ast.Add) else -b) for a, b in zip(left, right)]
        if isinstance(node.op, ast.Div) and right[1:] == [0, 0] and right[0]:
            return [v / right[0] for v in left]
        if isinstance(node.op, (ast.Mult, ast.Pow)):
            product = [sum(left[i] * right[k-i] for i in range(3) if 0 <= k-i < 3) for k in range(5)]
            if any(product[3:]):
                raise ValueError('Degree exceeds two')
            return product[:3]
        raise ValueError('Unsupported equation')
    return evaluate(root.body)


def solve_item(question):
    equation = re.fullmatch(r'Solve\s+([^=]+)=([^=.]+(?:\.\d+[^=]*)?)\.', question, re.I)
    if equation:
        left, right = map(polynomial, equation.groups())
        c, b, a = [v-w for v, w in zip(left, right)]
        if not a:
            if not b:
                return None
            result = display(-c / b)
            return f'\\(x={result}\\). Combining terms gives \\({display(b)}x+({display(c)})=0\\).'
        discriminant = b*b - 4*a*c
        if discriminant < 0:
            return None
        numerator, denominator = isqrt(discriminant.numerator), isqrt(discriminant.denominator)
        if numerator*numerator != discriminant.numerator or denominator*denominator != discriminant.denominator:
            return None
        root = Fraction(numerator, denominator)
        roots = sorted({(-b-root)/(2*a), (-b+root)/(2*a)})
        values = ', '.join(display(v) for v in roots)
        return f'\\(x={values}\\). The discriminant is \\(({display(b)})^2-4({display(a)})({display(c)})={display(discriminant)}\\); apply the quadratic formula.'
    percent = re.fullmatch(rf'A price (rises|falls) {NUMBER}% then (rises|falls) {NUMBER}%\. What is the net percentage change\?', question, re.I)
    if percent:
        direction1, number1, direction2, number2 = percent.groups()
        p, q = Fraction(number1)/100, Fraction(number2)/100
        p = p if direction1.lower() == 'rises' else -p
        q = q if direction2.lower() == 'rises' else -q
        if p < -1 or q < -1:
            return None
        factor1, factor2 = 1+p, 1+q
        return f'{display((factor1*factor2-1)*100)}%. The remaining price factor is \\({display(factor1)}\\times {display(factor2)}={display(factor1*factor2)}\\).'
    coin = re.fullmatch(r'A fair coin is tossed (\d+) times\. What is the probability of exactly (\d+) heads\?', question, re.I)
    if coin:
        n, k = map(int, coin.groups())
        if not 0 <= k <= n <= 100:
            return None
        ways, outcomes = comb(n, k), 2**n
        result = Fraction(ways, outcomes)
        return f'\\({result}\\). There are \\({ways}\\) qualifying sequences among \\({outcomes}\\) equally likely outcomes.'
    tank = re.fullmatch(rf'A tank starts with {NUMBER} gallons of water containing {NUMBER} lb sugar\. Inflow is {NUMBER} gallons/minute containing {NUMBER} lb/gallon; no outflow\. What is the concentration after {NUMBER} minutes\?', question, re.I)
    if tank:
        volume, mass, rate, concentration, minutes = map(Fraction, tank.groups())
        final_volume, final_mass = volume+rate*minutes, mass+rate*concentration*minutes
        if final_volume <= 0:
            return None
        return f'{display(final_mass/final_volume)} lb/gallon. Sugar: \\({display(mass)}+{display(rate)}\\times {display(concentration)}\\times {display(minutes)}={display(final_mass)}\\) lb; volume: \\({display(volume)}+{display(rate)}\\times {display(minutes)}={display(final_volume)}\\) gallons.'
    return None


def worked_math(messages):
    """Return worked answers only for an explicitly requested, fully supported list."""
    content = next((m.get('content') for m in reversed(messages) if m.get('role') == 'user'), '')
    if not isinstance(content, str) or len(content) > 2500 or len(messages) != 1:
        return None
    content = content.split('\n\n[Vaelo request:')[0].strip()
    prefix, *parts = re.split(r'(?<!\S)(\d+)\)\s+', content)
    # Extra instructions, quoted source material and format requests must retain
    # the normal model/contract route. Labels and a memory opt-out are harmless.
    instruction = 'Answer each numbered item briefly with its result and essential working. '
    if not prefix.endswith(instruction) or not parts or len(parts) > 20:
        return None
    label = prefix[:-len(instruction)].strip()
    label = re.sub(r'These are synthetic test questions; do not save memories\.$', '', label).strip()
    if label and (not re.fullmatch(r'[\w -]+[.;:]', label) or
                  re.search(r'\b(?:respond|answer|return|write|use|only|in|with|without)\b', label, re.I)):
        return None
    answers = []
    try:
        for index in range(0, len(parts), 2):
            if int(parts[index]) != len(answers)+1:
                return None
            answer = solve_item(parts[index+1].strip())
            if answer is None:
                return None
            answers.append(f'{len(answers)+1}. {answer}')
    except (ValueError, SyntaxError, ArithmeticError, RecursionError):
        return None
    return '\n\n'.join(answers)
