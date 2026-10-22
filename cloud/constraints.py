"""Evaluate supplied option constraints once for tables and recommendations."""
from decimal import Decimal, InvalidOperation
import json

UNITS = {
    'g': ('mass', '1'), 'kg': ('mass', '1000'), 'lb': ('mass', '453.59237'),
    'minutes': ('time', '1'), 'hours': ('time', '60'), 'days': ('time', '1440'),
    'cm': ('length', '1'), 'm': ('length', '100'), 'km': ('length', '100000'),
}
SCHEMA = {'name': 'evaluate_constraints', 'description':
    'Evaluate every supplied numerical hard constraint for every option before making a decision table. '
    'Use identical returned checks in the table, reasons and recommendation. Missing values are unknown, never passing. '
    'Supports inclusive and strict limits and conversions of mass, duration and length. Currency units must match.',
    'parameters': {'type': 'object', 'properties': {
        'options': {'type': 'array', 'items': {'type': 'object', 'properties': {
            'name': {'type': 'string'}, 'values': {'type': 'object', 'additionalProperties': {
                'type': 'object', 'properties': {'value': {'type': ['number', 'string']}, 'unit': {'type': 'string'}}, 'required': ['value']}}}, 'required': ['name', 'values']}},
        'constraints': {'type': 'array', 'items': {'type': 'object', 'properties': {
            'field': {'type': 'string'}, 'operator': {'type': 'string', 'enum': ['<=', '>=', '<', '>', '==']},
            'value': {'type': ['number', 'string']}, 'unit': {'type': 'string'}}, 'required': ['field', 'operator', 'value']}},
    }, 'required': ['options', 'constraints'], 'additionalProperties': False}}


def quantity(item):
    if not isinstance(item, dict) or isinstance(item.get('value'), bool): raise ValueError('Invalid quantity')
    raw = str(item['value'])
    if len(raw) > 80: raise ValueError('Quantity too long')
    value = Decimal(raw)
    if not value.is_finite() or abs(value.adjusted()) > 100: raise ValueError('Quantity out of range')
    unit = str(item.get('unit', '')).strip().lower()
    dimension, scale = UNITS.get(unit, (unit, '1'))
    return value * Decimal(scale), dimension


def evaluate_constraints(arguments, **kwargs):
    try:
        options, constraints = arguments['options'], arguments['constraints']
        if not isinstance(options, list) or not 1 <= len(options) <= 32 or not isinstance(constraints, list) or not 1 <= len(constraints) <= 16:
            raise ValueError('Use 1-32 options and 1-16 constraints')
        names = [option['name'] for option in options]
        if any(not isinstance(name, str) or not 0 < len(name) <= 120 for name in names) or len(set(names)) != len(names):
            raise ValueError('Use unique option names')
        rows = []
        for option in options:
            checks = []
            for constraint in constraints:
                field, operator = constraint['field'], constraint['operator']
                target, unit = quantity(constraint)
                item = option['values'].get(field)
                passed, reason = None, 'missing_value'
                if item is not None:
                    value, source_unit = quantity(item)
                    if source_unit == unit:
                        passed = {'<=': value <= target, '>=': value >= target, '<': value < target,
                                  '>': value > target, '==': value == target}[operator]
                        reason = 'meets_constraint' if passed else 'outside_limit'
                    else: reason = 'incompatible_units'
                checks.append({'field': field, 'operator': operator, 'limit': constraint['value'],
                               'unit': constraint.get('unit', ''), 'passes': passed, 'reason': reason})
            rows.append({'name': option['name'], 'checks': checks, 'eligible': all(check['passes'] is True for check in checks)})
        return json.dumps({'success': True, 'options': rows, 'eligible': [row['name'] for row in rows if row['eligible']]})
    except (ValueError, KeyError, TypeError, AttributeError, InvalidOperation):
        return json.dumps({'success': False, 'error': 'Provide valid named options, quantities and comparison constraints.'})
