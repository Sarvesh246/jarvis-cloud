"""Deterministic checks for explicit output contracts, never a semantic judge."""
import json
import re
from decimal import Decimal, InvalidOperation

ONLY_JSON = re.compile(r'(?:^|[.!?]\s+|\n)(?:please\s+)?(?:return|reply|respond|output|give)\s+(?:with\s+)?only\s+(?:(?:one|a|an|the|valid|single)\s+)*(?:json\b)|(?:^|[.!?]\s+|\n)(?:return|reply|respond|output)\s+(?:with\s+|as\s+)?raw json\b|\bjson[ -]only\b', re.I)
LIMIT = re.compile(r'\b(under|fewer than|at most|no more than|within|exactly|maximum(?: of)?)\s+(\d{1,5})\s+(words?|sentences?|lines?|characters?)\b', re.I)


def request_text(messages):
    last = next((m.get('content') for m in reversed(messages) if m.get('role') == 'user'), '')
    text = last if isinstance(last, str) else '\n'.join(p.get('text', '') for p in last or []
                                                        if isinstance(p, dict) and p.get('type') == 'text')
    return re.split(r'\n\n(?:Attached file: |\[Vaelo request:|\[Selected Vaelo workspace:)', text, maxsplit=1)[0]


def contract_for(messages):
    text = request_text(messages)
    text = re.sub(r'```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~','',text)
    limits = []
    for match in LIMIT.finditer(text):
        count = int(match[2]) - int(match[1].lower() in ('under', 'fewer than'))
        if 0 <= count <= 20000:
            limits.append((match[3].lower().rstrip('s'), 'exact' if match[1].lower() == 'exactly' else 'max', count))
    required=[]
    if ONLY_JSON.search(text):
        fields=re.search(r'\b(?:fields|keys|json(?: object)? with)\s+([^\n]{1,500})',text,re.I)
        if fields:
            candidate=fields[1]
            required=re.findall(r'"([^"\\\n]{1,80})"\s*:',candidate)[:24]
            if not required:
                candidate=re.split(r'[.!?]',candidate,1)[0]
                candidate=re.sub(r'^(?:these\s+)?(?:exact\s+)?(?:fields\s*)?[: ]*','',candidate,flags=re.I)
                names=re.split(r'\s*,\s*|\s+and\s+',candidate)
                if 1<=len(names)<=24 and all(re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]{0,63}',name) for name in names):
                    required=names
    return {'json': bool(ONLY_JSON.search(text)), 'limits': limits[:8],'required_keys':required}


def constrained(contract):
    return bool(contract.get('json') or contract.get('limits'))


def validate_answer(text, contract):
    result = text.strip()
    errors = []
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
            if contract.get('required_keys') and (not isinstance(value,dict) or
                    any(key not in value for key in contract['required_keys'])):
                errors.append('required_json_fields')
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
    return result, errors


def repair_instruction(errors):
    return ('[Vaelo request: the previous candidate failed explicit output checks: ' + ', '.join(errors) +
            '. Answer the original request afresh using its source input. Preserve factual completeness and correctness '
            'while obeying the requested format and length. Return no internal annotations, preamble or extra explanation. '
            'Do not quote or reuse the discarded candidate.]')
