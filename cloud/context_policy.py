"""The context contract shared with Vaelo's browser and API."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
POLICY_PATH = HERE / "context-policy.json"
if not POLICY_PATH.exists():
    POLICY_PATH = HERE.parent / "web/shared/context-policy.json"
CONTEXT_POLICY = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
