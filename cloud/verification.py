"""Bounded execution of generated Python and explicit test assertions."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import secrets
import threading

_workers=threading.BoundedSemaphore(1)

SCHEMA = {"name": "python_verify", "description":
    "Execute self-contained Python code and explicit tests in a disposable interpreter. "
    "No filesystem, network, subprocesses or third-party packages. 2 CPU seconds, 5 seconds wall time, "
    "192 MB memory and 32 KB output. Standard math, collections, statistics, unittest and typing are preloaded. "
    "Use assertion tests, including independent expected results and boundary cases; inspect failures before claiming correctness. "
    "This tool verifies only the supplied code and tests, not general correctness.",
    "parameters": {"type": "object", "properties": {
        "source": {"type": "string", "description": "Complete Python implementation, up to 24000 characters."},
        "tests": {"type": "string", "description": "Executable assertion tests with independently checked expected values, up to 12000 characters."}},
        "required": ["source", "tests"], "additionalProperties": False}}


def verify(arguments):
    if not isinstance(arguments, dict) or set(arguments) != {"source", "tests"}:
        return {"status": "invalid", "error": "Provide source and tests."}
    for key, limit in (("source", 24_000), ("tests", 12_000)):
        if not isinstance(arguments[key], str) or not arguments[key].strip() or len(arguments[key]) > limit:
            return {"status": "invalid", "error": "Source or tests are missing or too long."}
    token=secrets.token_hex(16)
    payload = json.dumps({**arguments,'completion_token':token}, ensure_ascii=False).encode("utf-8")
    if len(payload) > 50_000:
        return {"status": "invalid", "error": "Verification input exceeds its byte limit."}
    if sys.platform != "linux":
        return {"status": "unavailable", "error": "Isolated Linux verification is unavailable; no code was run."}
    if not _workers.acquire(blocking=False):
        return {'status':'busy','error':'One verification is already running. No additional code was run.'}
    try:
        return _run_worker(payload,token)
    finally:
        _workers.release()


def _run_worker(payload,token):
    worker = Path(__file__).with_name("verification_worker.py")
    # Output goes to a regular file so the child's file-size limit also bounds
    # an infinite print loop. No model-controlled paths or shell are involved.
    with tempfile.TemporaryDirectory(prefix="vaelo-verify-") as directory:
        with tempfile.TemporaryFile() as output:
            try:
                result = subprocess.run([sys.executable, "-I", "-S", str(worker)],
                    input=payload, stdout=output, stderr=output, cwd=directory,
                    env={}, close_fds=True, timeout=5, check=False)
            except subprocess.TimeoutExpired:
                return {"status": "limited", "error": "Verification exceeded the wall-time limit."}
            except OSError:
                return {"status": "unavailable", "error": "Could not start the isolated verifier."}
            output.seek(0)
            text = output.read(32_768).decode("utf-8", errors="replace")
            completed='\nVAELO_VERIFIED_' + token in text
            status='unavailable' if result.returncode==78 else 'passed' if result.returncode==0 and completed else 'failed'
            text=text.replace('\nVAELO_VERIFIED_'+token,'')
            return {"status": status,
                    'tests_completed':completed,
                    "exit_code": result.returncode, "output": text,
                    "scope": "Only the supplied implementation and tests were executed."}


def verification_tool(arguments, **kwargs):
    return json.dumps(verify(arguments), ensure_ascii=False)
