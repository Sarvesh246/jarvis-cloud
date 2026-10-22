"""Deterministic checks for explicit output contracts, never a semantic judge."""
import json
import ast
import re
from pathlib import Path
from decimal import Decimal, InvalidOperation

_path = Path(__file__).with_name('output-policy.json')
if not _path.exists():
    _path = Path(__file__).parents[1] / 'web/shared/output-policy.json'
POLICY = json.loads(_path.read_text(encoding='utf-8'))
ONLY_JSON = re.compile(POLICY['json'], re.I)
LIMIT = re.compile(POLICY['limit'], re.I)
REPLY_LENGTH = re.compile(POLICY['replyLength'], re.I)
NUMBERS = {word: i for i, word in enumerate(('zero','one','two','three','four','five','six','seven','eight','nine','ten'))}
NUMBERS['single'] = 1


def number(text):
    return int(text) if text.isdigit() else NUMBERS[text.lower()]


def request_text(messages):
    last = next((m.get('content') for m in reversed(messages) if m.get('role') == 'user'), '')
    text = last if isinstance(last, str) else '\n'.join(p.get('text', '') for p in last or []
                                                        if isinstance(p, dict) and p.get('type') == 'text')
    return re.split(r'\n\n(?:Attached file: |\[Vaelo request:|\[Selected Vaelo workspace:)', text, maxsplit=1)[0]


def contract_for(messages, tools_available=True):
    text = request_text(messages)
    text = re.sub(r'```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~','',text)
    limits = []
    for match in LIMIT.finditer(text):
        count = number(match[2]) - int(match[1].lower() in ('under', 'fewer than'))
        if 0 <= count <= 20000:
            limits.append((match[3].lower().rstrip('s'), 'exact' if match[1].lower() == 'exactly' else 'max', count))
    for match in REPLY_LENGTH.finditer(text):
        limits.append((match[2].lower().rstrip('s'), 'exact', number(match[1])))
    required=[]
    if ONLY_JSON.search(text):
        fields=(re.search(r'\b(?:fields|keys)\s*:?\s+([^\n]{1,500})',text,re.I)
                or re.search(r'\bjson(?: object)? with\s+([^\n]{1,500})',text,re.I))
        if fields:
            candidate=fields[1]
            required=re.findall(r'"([^"\\\n]{1,80})"\s*:',candidate)[:24]
            if not required:
                candidate=re.split(r'[.!?]',candidate,1)[0]
                candidate=re.sub(r'\s*\([^)]*\)', '', candidate)
                candidate=re.sub(r'^(?:these\s+)?(?:exact\s+)?(?:fields\s*)?[: ]*','',candidate,flags=re.I)
                names=re.split(r'\s*,\s*|\s+and\s+',candidate)
                if 1<=len(names)<=24 and all(re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]{0,63}',name) for name in names):
                    required=names
    tools=re.findall(r'(?:^|[.!?]\s+|\n)(?:please\s+|actually\s+)?(?:use|run|execute|invoke|call)\s+(?:the\s+)?(python_verify|javascript_verify|calculate|date_difference|evaluate_constraints)\b',text,re.I)
    supplied_constraints = bool(re.search(r'\b(?:hard|numerical|numeric) constraints?\b', text, re.I)
                                and re.search(r'\b(?:at most|at least|less than|greater than)\s+\$?\d', text, re.I))
    if tools_available and supplied_constraints and not re.search(r'\b(?:do not|don.t|without)\s+(?:use|run|execute)\s+(?:any )?tools?\b', text, re.I):
        tools.append('evaluate_constraints')
    code_tests = bool(re.search(r'\bpython\b', text, re.I) and
                      re.search(r'\b(?:include|provide|show|supply|return|with)\s+(?:runnable\s+|unit\s+|the\s+|assertion\s+)?tests\b', text, re.I))
    return {'json': bool(ONLY_JSON.search(text)), 'limits': list(dict.fromkeys(limits))[:8],'required_keys':required,
            'exact_keys': bool(re.search(r'\b(?:exact(?:ly)?|only)\s+(?:these\s+)?(?:fields|keys)\b|\bthese exact fields\b',text,re.I)),
            'python_tests': code_tests,
            'images': any(isinstance(m.get('content'),list) and any(isinstance(p,dict) and p.get('type')=='image_url' for p in m['content']) for m in messages),
            'required_tools':list(dict.fromkeys(tool.lower() for tool in tools))}


def constrained(contract):
    return bool(contract.get('json') or contract.get('limits') or contract.get('required_tools') or contract.get('python_tests'))


def validate_answer(text, contract, executed_tools=()):
    result = text.strip()
    errors = []
    for tool in contract.get('required_tools',[]):
        if tool not in executed_tools: errors.append('missing_tool_'+tool)
    if len(result) > 160000:
        return result, ['answer_size']
    if contract.get('json'):
        # Only a single enclosing fence can be removed, after the inner value
        # parses. No extraction of an arbitrary object from surrounding prose.
        fence = re.fullmatch(r'```(?:json)?\s*\n([\s\S]*?)\n```', result, re.I)
        candidate = fence[1].strip() if fence else result
        try:
            def unique_object(pairs):
                value={}
                for key,item in pairs:
                    if key in value: raise ValueError('Duplicate JSON field')
                    value[key]=item
                return value
            value=json.loads(candidate, parse_float=Decimal, object_pairs_hook=unique_object,
                             parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
            if contract.get('images') and isinstance(value, dict) and len(value) > 1 and all(v is None for v in value.values()):
                errors.append('image_reading_empty')
            if contract.get('required_keys') and (not isinstance(value,dict) or
                    any(key not in value for key in contract['required_keys'])):
                errors.append('required_json_fields')
            if contract.get('exact_keys') and contract.get('required_keys') and isinstance(value,dict) and set(value) != set(contract['required_keys']):
                errors.append('exact_json_fields')
            result = candidate
        except (ValueError, RecursionError, InvalidOperation):
            errors.append('raw_json')
    counts = {
        'word': len(result.split()), 'line': len(result.splitlines()), 'character': len(result),
        'sentence': len([p for p in re.split(r'(?<=[.!?。！？])\s+(?=[\w"“])', result) if p.strip()]),
    }
    for unit, mode, limit in contract.get('limits', []):
        if mode == 'exact' and counts[unit] != limit or mode == 'max' and counts[unit] > limit:
            errors.append(f'{unit}_{mode}_{limit}')
    if contract.get('python_tests'):
        blocks = re.findall(r'```(?:python|py)?\s*\n([\s\S]*?)\n```', result, re.I)
        try:
            tree = ast.parse('\n\n'.join(blocks) if blocks else result)
            definitions = any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and not n.name.startswith('test') for n in ast.walk(tree))
            assertions = any(isinstance(n, ast.Assert) or isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr.startswith('assert') for n in ast.walk(tree))
            if not definitions or not assertions: errors.append('missing_runnable_tests')
        except (ValueError, SyntaxError, RecursionError):
            errors.append('invalid_python_tests')
    return result, errors


def repair_instruction(errors):
    return ('[Vaelo request: the previous candidate failed explicit output checks: ' + ', '.join(errors) +
            '. Answer the original request afresh using its source input. Preserve factual completeness and correctness '
            'while obeying the requested format and length. Return no internal annotations, preamble or extra explanation. '
            'For a missing_tool check, actually invoke that exact named tool; another runtime is not a substitute. '
            'If it is unavailable, do not claim execution. Do not quote or reuse the discarded candidate.]')
