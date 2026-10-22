"""Bounded deterministic arithmetic and timezone-aware date differences."""
import ast
from datetime import datetime, timezone
from decimal import Decimal, localcontext, ROUND_HALF_EVEN, Inexact, Rounded
import json
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

SCHEMA = {'name':'calculate', 'description':
    'Calculate an arithmetic expression with exact decimal inputs. Use this for supplied numeric facts, '
    'percentages, totals, unit arithmetic and independent checks. No Python execution, files or network. '
    'Supports + - * / // % ** and abs, min, max, sum, sqrt, round(value,digits). '
    'Round uses half-even. Supply values as decimal strings to preserve precision. The result does not validate units or assumptions.',
    'parameters':{'type':'object','properties':{'expression':{'type':'string'},
        'values':{'type':'object','additionalProperties':{'type':'string'}}},'required':['expression'],'additionalProperties':False}}
DATE_SCHEMA = {'name':'date_difference', 'description':
    'Compute calendar-day and elapsed-time differences between ISO dates or timezone-aware datetimes. '
    'For local datetimes supply an IANA timezone. Ambiguous or nonexistent local times must be disambiguated '
    'with an explicit UTC offset; no dates are inferred. Calendar days and elapsed hours differ across daylight-saving transitions.',
    'parameters':{'type':'object','properties':{'start':{'type':'string'},'end':{'type':'string'},
        'timezone':{'type':'string'}},'required':['start','end'],'additionalProperties':False}}


def decimal(value):
    if isinstance(value, bool) or len(str(value))>100:
        raise ValueError('Use finite decimal values of at most 100 characters.')
    result=Decimal(str(value))
    if not result.is_finite() or result and abs(result.adjusted())>1000:
        raise ValueError('The numeric magnitude is outside the calculation limit.')
    return result


def calculate(arguments, **kwargs):
    try:
        if not isinstance(arguments,dict) or set(arguments)-{'expression','values'}:
            raise ValueError('Provide an expression and optional named decimal values.')
        expression=arguments.get('expression')
        values=arguments.get('values',{})
        if not isinstance(expression,str) or not 0<len(expression)<=2000 or not isinstance(values,dict) or len(values)>64:
            raise ValueError('Calculation input exceeds its limit.')
        names={name:decimal(value) for name,value in values.items() if isinstance(name,str) and name.isidentifier()}
        if len(names)!=len(values): raise ValueError('Variable names must be identifiers.')
        root=ast.parse(expression,mode='eval')
        if sum(1 for _ in ast.walk(root))>256: raise ValueError('The expression is too complex.')
        def evaluate(node, depth=0):
            if depth>32: raise ValueError('The expression is too deeply nested.')
            if isinstance(node,ast.Constant) and type(node.value) in (int,float):
                return decimal(ast.get_source_segment(expression,node))
            if isinstance(node,ast.Name) and node.id in names: return names[node.id]
            if isinstance(node,ast.UnaryOp) and isinstance(node.op,(ast.UAdd,ast.USub)):
                value=evaluate(node.operand,depth+1)
                return -value if isinstance(node.op,ast.USub) else value
            if isinstance(node,(ast.List,ast.Tuple)) and len(node.elts)<=64:
                return [evaluate(item,depth+1) for item in node.elts]
            if isinstance(node,ast.BinOp):
                left,right=evaluate(node.left,depth+1),evaluate(node.right,depth+1)
                if not isinstance(left,Decimal) or not isinstance(right,Decimal): raise ValueError('Arithmetic needs numeric operands.')
                if isinstance(node.op,ast.Pow):
                    if right!=right.to_integral_value() or abs(right)>100: raise ValueError('Use an integer exponent between -100 and 100.')
                    result=left**int(right)
                elif isinstance(node.op,ast.Add): result=left+right
                elif isinstance(node.op,ast.Sub): result=left-right
                elif isinstance(node.op,ast.Mult): result=left*right
                elif isinstance(node.op,ast.Div): result=left/right
                elif isinstance(node.op,ast.FloorDiv): result=(left/right).to_integral_value(rounding='ROUND_FLOOR')
                elif isinstance(node.op,ast.Mod): result=left-(left/right).to_integral_value(rounding='ROUND_FLOOR')*right
                else: raise ValueError('Unsupported arithmetic operator.')
                return decimal(result)
            if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and not node.keywords:
                args=[evaluate(item,depth+1) for item in node.args]
                name=node.func.id
                if name=='abs' and len(args)==1: return abs(args[0])
                if name=='sqrt' and len(args)==1: return args[0].sqrt()
                if name in ('min','max','sum'):
                    items=args[0] if len(args)==1 and isinstance(args[0],list) else args
                    if not items or not all(isinstance(value,Decimal) for value in items): raise ValueError('Supply numeric values.')
                    return {'min':min,'max':max,'sum':sum}[name](items)
                if name=='round' and 1<=len(args)<=2:
                    digits=args[1] if len(args)==2 else Decimal(0)
                    if digits!=digits.to_integral_value() or abs(digits)>50: raise ValueError('Rounding precision is outside its limit.')
                    return args[0].quantize(Decimal(1).scaleb(-int(digits)),rounding=ROUND_HALF_EVEN)
            raise ValueError('Only supported arithmetic expressions are allowed.')
        with localcontext() as context:
            context.prec=64
            result=decimal(evaluate(root.body))
            rendered=format(result,'f')
            approximate=bool(context.flags[Inexact] or context.flags[Rounded])
        if len(rendered)>1200: raise ValueError('The result exceeds the display limit.')
        return json.dumps({'success':True,'value':rendered,'approximate':approximate,'precision_digits':64,'rounding':'half_even',
                           'scope':'Computed from supplied values; units and assumptions were not independently verified.'})
    except (ValueError,TypeError,SyntaxError,ArithmeticError,RecursionError):
        return json.dumps({'success':False,'error':'Invalid, unsupported or out-of-range arithmetic. Check numeric inputs and expression.'})


def direct_calculation(messages, tier='normal'):
    """A complete numeric-only grammar; uncertain prose retains the model route."""
    last=next((m.get('content') for m in reversed(messages) if m.get('role')=='user'),'')
    if not isinstance(last,str) or len(last)>1000 or re.search(r'Attached file:|Selected Vaelo workspace:',last):
        return None
    ask=last.split('\n\n[Vaelo request:')[0].strip()
    only=re.search(r'\b(?:answer|reply|respond|return)\s+(?:with\s+)?(?:just|only)\s+(?:the\s+)?number\.?$',ask,re.I)
    if only: ask=ask[:only.start()].strip()
    elif tier!='quick': return None
    ask=re.sub(r'^(?:what is|what\'s|calculate|compute)\s+','',ask,flags=re.I).rstrip('?. ')
    percent=re.fullmatch(r'([+-]?\d+(?:\.\d+)?)\s*(?:%|percent)\s+of\s+([+-]?\d+(?:\.\d+)?)',ask,re.I)
    expression=f'({percent[1]})/100*({percent[2]})' if percent else re.sub(r'\b(?:times|multiplied by)\b','*',ask,flags=re.I)
    expression=expression.replace('×','*').replace('÷','/').replace('^','**')
    if not re.fullmatch(r'[\d\s.+*/%()\-]{1,300}',expression) or not re.search(r'[+*/%\-]',expression): return None
    result=json.loads(calculate({'expression':expression}))
    if not result.get('success') or result.get('approximate'): return None
    value=result['value']
    return value.rstrip('0').rstrip('.') if '.' in value else value


def date_difference(arguments, **kwargs):
    try:
        if not isinstance(arguments,dict) or set(arguments)-{'start','end','timezone'}:
            raise ValueError('Invalid date arguments.')
        zone=arguments.get('timezone','UTC')
        if not isinstance(zone,str) or len(zone)>64: raise ValueError('Invalid timezone.')
        tz=timezone.utc if zone=='UTC' else ZoneInfo(zone)
        def read(value):
            if not isinstance(value,str) or len(value)>40: raise ValueError('Supply ISO dates.')
            parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
            if parsed.tzinfo is not None: return parsed.astimezone(tz)
            a,b=parsed.replace(tzinfo=tz,fold=0),parsed.replace(tzinfo=tz,fold=1)
            if a.utcoffset()!=b.utcoffset() or a.astimezone(timezone.utc).astimezone(tz).replace(tzinfo=None)!=parsed:
                raise ValueError('Ambiguous or nonexistent local time.')
            return a
        start,end=read(arguments.get('start')),read(arguments.get('end'))
        seconds=(end.astimezone(timezone.utc)-start.astimezone(timezone.utc)).total_seconds()
        return json.dumps({'success':True,'calendar_days':(end.date()-start.date()).days,
                           'elapsed_seconds':seconds,'elapsed_hours':seconds/3600,'timezone':zone,
                           'start':start.isoformat(),'end':end.isoformat()})
    except (ValueError,TypeError,OverflowError,ZoneInfoNotFoundError):
        return json.dumps({'success':False,'error':'Supply valid ISO dates and an IANA timezone; use explicit offsets for ambiguous local times.'})
