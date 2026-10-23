"""Prepare the returned test source for the existing confined verifier."""
import ast
import re


def standalone_python(text,messages,body,contract):
    """A small, self-contained code deliverable that can be verified locally."""
    users=[message for message in messages if message.get('role')=='user']
    return bool(contract.get('verify_returned_python') and not contract.get('required_tools')
        and not contract.get('images') and not body.get('freshness') and not body.get('research')
        and len(users)==1 and isinstance(users[0].get('content'),str)
        and not any(message.get('role')=='assistant' for message in messages)
        and len(text)<=1800 and re.search(r'\b(?:write|implement|create|generate)\b',text,re.I)
        and re.search(r'\b(?:function|code|algorithm|class)\b',text,re.I)
        and not re.search(r'https?://|\b(?:workspace|saved|previous|earlier|attached|uploaded|filesystem|network|package|library|dependencies|install)\b',text,re.I)
        and not re.search(r'Attached file:|Selected Vaelo workspace:',
            '\n'.join(str(message.get('content','')) for message in messages),re.I))


def returned_python(answer, preserve_input=False):
    blocks=re.findall(r'```(?:python|py)?\s*\n([\s\S]*?)\n```',answer,re.I)
    code='\n\n'.join(blocks) if blocks else answer
    tree=ast.parse(code)
    calls=[]
    top_level=[part for node in tree.body if not isinstance(node,(ast.FunctionDef,ast.ClassDef))
               for part in ast.walk(node)]
    called={node.func.id for node in top_level if isinstance(node,ast.Call)
            and isinstance(node.func,ast.Name)}
    local_functions={node.name:node for node in tree.body if isinstance(node,ast.FunctionDef)}
    reachable=set(called)
    pending=list(called)
    while pending:
        function=local_functions.get(pending.pop())
        if function is None:
            continue
        for node in ast.walk(function):
            if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id not in reachable:
                reachable.add(node.func.id)
                pending.append(node.func.id)
    for node in tree.body:
        if isinstance(node,ast.FunctionDef) and node.name.startswith('test') and not node.args.args and node.name not in called:
            calls.append(node.name+'()')
        if isinstance(node,ast.ClassDef) and any(
                isinstance(base,ast.Attribute) and base.attr=='TestCase' for base in node.bases):
            calls += [f'_vaelo_result=unittest.TestResult()',
                      f'unittest.defaultTestLoader.loadTestsFromTestCase({node.name}).run(_vaelo_result)',
                      'assert _vaelo_result.wasSuccessful(), str(_vaelo_result.failures)+str(_vaelo_result.errors)']
    runnable_tests=bool(calls) or any(name.startswith('test') for name in called) or any(
        any(isinstance(node,ast.Assert) for node in ast.walk(local_functions[name]))
        for name in reachable if name in local_functions)
    # Derive independent mutation checks from literal inputs already supplied
    # in the returned assertions, without guessing task-specific answers.
    functions={node.name for node in tree.body if isinstance(node,ast.FunctionDef)
               and not node.name.startswith('test') and len(node.args.args)==1}
    if preserve_input:
        for node in ast.walk(tree):
            if not isinstance(node,ast.Call) or not isinstance(node.func,ast.Name) or node.func.id not in functions or len(node.args)!=1 or node.keywords:
                continue
            try: value=ast.literal_eval(node.args[0])
            except (ValueError,TypeError,RecursionError): continue
            if not isinstance(value,(list,dict)): continue
            calls += [f'_vaelo_input={value!r}', '_vaelo_before=copy.deepcopy(_vaelo_input)',
                      f'{node.func.id}(_vaelo_input)', "assert _vaelo_input==_vaelo_before, 'Submitted function mutated its input'"]
    source=blocks[0] if len(blocks)>1 else code
    tests='\n\n'.join(blocks[1:]) if len(blocks)>1 else ''
    top_level_assertions=any(isinstance(child,ast.Assert) for node in tree.body
        if not isinstance(node,(ast.FunctionDef,ast.ClassDef)) for child in ast.walk(node))
    if not runnable_tests and not top_level_assertions:
        calls.append("raise AssertionError('No runnable assertion tests were found')")
    return {'source':source,'tests':tests+'\nimport copy\nimport unittest\n'+'\n'.join(calls)+'\nassert True'}


JAVASCRIPT_BLOCK=r'```(?:javascript|js|mjs)\s*\n([\s\S]*?)\n```'


def returned_javascript(answer):
    """Split returned JavaScript into implementation and synchronous tests.

    The first block is the implementation and later blocks are tests. A single
    block carries both, so it runs whole with an inert test suffix."""
    blocks=re.findall(JAVASCRIPT_BLOCK,answer,re.I)
    if not blocks:
        raise ValueError('No JavaScript code block was returned')
    return {'source':blocks[0],'tests':'\n\n'.join(blocks[1:]) if len(blocks)>1 else 'true;'}
