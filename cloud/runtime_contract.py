"""Align the pinned cloud gateway's normalization limit with our request budget."""
import ast
from pathlib import Path
import sys

try:
    from context_policy import CONTEXT_POLICY
except ModuleNotFoundError:
    from cloud.context_policy import CONTEXT_POLICY


def align_normalization(source, limit=CONTEXT_POLICY["requestChars"]):
    tree = ast.parse(source)
    assignments = [node for node in tree.body if isinstance(node, ast.Assign)
                   and any(isinstance(target, ast.Name) and target.id == "MAX_NORMALIZED_TEXT_LENGTH"
                           for target in node.targets)]
    if len(assignments) != 1 or not isinstance(assignments[0].value, ast.Constant):
        raise ValueError("Pinned gateway normalization contract changed")
    value = assignments[0].value
    if type(value.value) is not int or value.value not in (65_536, limit):
        raise ValueError("Unexpected gateway normalization limit")
    functions = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}
    for name in ("_cap_text", "_normalize_chat_content"):
        if name not in functions or "MAX_NORMALIZED_TEXT_LENGTH" not in ast.dump(functions[name]):
            raise ValueError("Pinned gateway normalizer changed")
    lines = source.splitlines(keepends=True)
    line = lines[value.lineno - 1]
    lines[value.lineno - 1] = line[:value.col_offset] + str(limit) + line[value.end_col_offset:]
    result = "".join(lines)
    ast.parse(result)
    return result


def fail_closed_vision(source):
    """A failed auxiliary analysis is an error, never evidence for an answer.

    Verify the pinned boundary before modifying it; fail the image build on drift.
    Do not cache an error string as though it described the pixels.
    """
    before = '        note = f"[The {role_label} attached an image. Here\'s what it contains:\\n{description or \'Image analysis failed.\'}]"'
    if source.count(before) != 1:
        raise ValueError('Pinned vision fallback contract changed')
    after = ("        if not description or description.startswith('Image analysis failed:'):\n"
             "            raise ValueError('image_processing_unavailable: The attached image could not be analyzed. Please retry.')\n" + before)
    result = source.replace(before, after)
    ast.parse(result)
    return result


def isolated_vision_cache(source):
    before = '    cache_dir = get_hermes_dir(new_subpath, old_name)'
    if source.count(before) != 1:
        raise ValueError('Pinned vision cache contract changed')
    after = ("    cache_override = os.environ.get('VAELO_VISION_CACHE_DIR') if new_subpath == 'cache/vision' else None\n"
             "    cache_dir = Path(cache_override) if cache_override else get_hermes_dir(new_subpath, old_name)")
    result = source.replace(before, after)
    ast.parse(result)
    return result


if __name__ == "__main__":
    path = Path(sys.argv[1])
    path.write_text(align_normalization(path.read_text(encoding="utf-8")), encoding="utf-8")
    vision = path.parents[2] / 'agent/vision_message_prep.py'
    vision.write_text(fail_closed_vision(vision.read_text(encoding='utf-8')), encoding='utf-8')
    cache = path.parents[2] / 'tools/vision_tools.py'
    cache.write_text(isolated_vision_cache(cache.read_text(encoding='utf-8')), encoding='utf-8')
