"""Prepare an isolated Hermes profile and start its native API gateway."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = Path(__file__).resolve().parent
DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"


def configuration(environ):
    cfg = json.loads((HERE / "profile.json").read_text(encoding="utf-8"))
    cfg["providers"]["cloud-openrouter"]["api"] = DEFAULT_BASE_URL
    cfg["fallback_providers"] = []
    for provider, variable, model, url in (
        ("cloud-groq", "GROQ_API_KEY", "qwen/qwen3.8-27b", "https://api.groq.com/openai/v1"),
        ("cloud-nvidia", "NVIDIA_API_KEY", "nvidia/nemotron-3-ultra-550b-a55b", "https://integrate.api.nvidia.com/v1"),
    ):
        if environ.get(variable, "").strip():
            cfg["providers"][provider] = {
                "name": provider, "api": url, "api_key": "${" + variable + "}",
                "transport": "chat_completions", "default_model": model,
                "context_length": 32768, "models": [model],
            }
            cfg["fallback_providers"].append({
                "provider": "custom:" + provider, "model": model,
                "base_url": url, "api_key": "${" + variable + "}",
                "api_mode": "chat_completions",
            })
    cfg["web"] = {"search_backend": "jarvis-cloud-research", "extract_backend": "jarvis-cloud-research"}
    return cfg


def missing_configuration(environ):
    missing = []
    if len(environ.get("API_SERVER_KEY", "").strip()) < 32:
        missing.append("API_SERVER_KEY (at least 32 characters)")
    if not environ.get("OPENROUTER_API_KEY", "").strip():
        missing.append("OPENROUTER_API_KEY")
    return missing


def prepare_profile(home, environ):
    home.mkdir(parents=True, exist_ok=True)
    (home / "workspace").mkdir(exist_ok=True)
    # Render environment variables are the configuration source for this cloud copy.
    # JSON is valid YAML and avoids adding a bootstrap dependency.
    temporary = home / "config.yaml.tmp"
    temporary.write_text(json.dumps(configuration(environ), indent=2) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(home / "config.yaml")
    plugin = home / "plugins" / "jarvis-cloud-research"
    plugin.mkdir(parents=True, exist_ok=True)
    shutil.copy2(HERE / "research.py", plugin / "__init__.py")
    shutil.copy2(HERE / "research-plugin.yaml", plugin / "plugin.yaml")
    # An explicit cloud SOUL overrides the image's example personality.
    shutil.copy2(HERE / "SOUL.md", home / "SOUL.md")


def setup_server(port, missing):
    """A deployment can become healthy before credentials are supplied, without exposing chat."""
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path not in ("/health", "/"):
                self.send_error(404)
                return
            body = json.dumps({"status": "setup_required", "chat_enabled": False, "missing": missing}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            pass
    return ThreadingHTTPServer(("0.0.0.0", port), Handler)


def main():
    port = int(os.environ.get("PORT", "10000"))
    if not 1 <= port <= 65535:
        raise SystemExit("PORT must be between 1 and 65535")
    missing = missing_configuration(os.environ)
    if missing:
        print("Jarvis API is waiting for Render environment settings: " + ", ".join(missing), flush=True)
        setup_server(port, missing).serve_forever()
        return
    home = Path(os.environ.get("HERMES_HOME", "/opt/data"))
    prepare_profile(home, os.environ)
    os.environ.update({
        "API_SERVER_ENABLED": "true", "API_SERVER_HOST": "0.0.0.0",
        "API_SERVER_PORT": str(port), "API_SERVER_MODEL_NAME": "jarvis",
        "HERMES_GATEWAY_NO_SUPERVISE": "1", "HERMES_HOME": str(home),
    })
    executable = shutil.which("hermes")
    if not executable:
        raise SystemExit("The Hermes executable is missing from the container")
    print("Starting the private Jarvis API gateway", flush=True)
    os.execv(executable, [executable, "gateway", "run"])


if __name__ == "__main__":
    main()
