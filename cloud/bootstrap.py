"""Prepare an isolated Hermes profile and start its native API gateway."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import threading
import time
import tempfile
try:
    from context_policy import CONTEXT_POLICY
except ModuleNotFoundError:
    from cloud.context_policy import CONTEXT_POLICY
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
GEMINI_NATIVE_URL = "https://generativelanguage.googleapis.com/v1beta"
# The newest Flash that answered reliably in the free-capacity audit; the 3.x previews were
# returning 503 under load. GEMINI_MODEL overrides it without a code change.
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
# Seconds a model stream may stay completely silent before Hermes gives up on it and moves to
# the next provider. A reply has one five-minute Vercel window, so a hung free model must not
# eat half of it. Hermes otherwise defaults to 180s and raises it further for reasoning models.
STALE_SECONDS = 60
# NVIDIA's 550B model is slow to its first token on a long context; it gets a little more room.
SLOW_STALE_SECONDS = 90


def freellmapi_url(environ):
    """The router's /v1 base, or "" when it is unset or not served over HTTPS."""
    url = environ.get("FREELLMAPI_URL", "").strip().rstrip("/")
    if not url.startswith("https://") or not environ.get("FREELLMAPI_API_KEY", "").strip():
        return ""
    return url if url.endswith("/v1") else url + "/v1"


def configuration(environ):
    cfg = json.loads((HERE / "profile.json").read_text(encoding="utf-8"))
    window = CONTEXT_POLICY["windowTokens"]
    # One reply at a time keeps the free 512 MB instance safe. Setting
    # VAELO_MAX_CONCURRENT_RUNS=2 lets two conversations generate together;
    # it costs memory, not money, and has not been measured on Render yet.
    try:
        runs = min(3, max(1, int(environ.get("VAELO_MAX_CONCURRENT_RUNS", "1"))))
    except ValueError:
        runs = 1
    cfg["gateway"]["max_concurrent_runs"] = runs
    cfg["gateway"]["api_server"]["max_concurrent_runs"] = runs
    cfg["model"]["context_length"] = CONTEXT_POLICY["openrouterWindowTokens"]
    cfg["providers"]["cloud-openrouter"]["context_length"] = CONTEXT_POLICY["openrouterWindowTokens"]
    cfg["compression"].update({
        "threshold": CONTEXT_POLICY["compressionRatio"],
        "threshold_tokens": CONTEXT_POLICY["compressionCapTokens"],
    })
    cfg["providers"]["cloud-openrouter"]["api"] = DEFAULT_BASE_URL
    # These are modality-aware routers, not text model IDs in models.dev.
    # Their request filters select a vision model when image parts are present.
    cfg['providers']['cloud-openrouter']['models'] = {'openrouter/free': {'supports_vision': True}}
    cfg["fallback_providers"] = []
    # A reachable FreeLLMAPI router (the same pool local Jarvis uses) leads when it is
    # configured: it already fails over across its own providers, so OpenRouter's 50 daily
    # requests become the first fallback instead of the whole budget. When the router is
    # down (the PC hosting it is off, say) Hermes falls through to the chain below.
    router = freellmapi_url(environ)
    if router:
        cfg["providers"]["cloud-freellmapi"] = {
            "name": "FreeLLMAPI router", "api": router, "api_key": "${FREELLMAPI_API_KEY}",
            "transport": "chat_completions", "default_model": "auto", "models": {'auto': {'supports_vision': True}},
            "context_length": window, "request_timeout_seconds": 180, "stale_timeout_seconds": STALE_SECONDS,
        }
        cfg["model"] = {"provider": "custom:cloud-freellmapi", "default": "auto", "context_length": window}
        cfg["fallback_providers"].append({
            "provider": "custom:cloud-openrouter", "model": "openrouter/free",
            "base_url": DEFAULT_BASE_URL, "api_key": "${OPENROUTER_API_KEY}",
            "api_mode": "chat_completions",
        })
        # No chat model in the chain can draw; the router also fronts free FLUX image
        # backends. Without the router there is no image tool, and SOUL.md says so plainly.
        cfg["image_gen"] = {"provider": "vaelo-freellmapi"}
        cfg["platform_toolsets"]["api_server"].append("image_gen")
    # Groq is deliberately absent. Its free tier caps tokens per minute below the size of a
    # single agent request (system prompt + tool schemas + history) and answers with HTTP 413.
    # Hermes reads any 413 as "conversation too large", compresses the history away and ends
    # the turn without trying the next fallback, so one Groq entry broke every conversation
    # once the OpenRouter daily pool ran out.
    for provider, variable, model, url in (
        ("cloud-nvidia", "NVIDIA_API_KEY", "nvidia/nemotron-3-ultra-550b-a55b", "https://integrate.api.nvidia.com/v1"),
    ):
        if environ.get(variable, "").strip():
            cfg["providers"][provider] = {
                "name": provider, "api": url, "api_key": "${" + variable + "}",
                "transport": "chat_completions", "default_model": model,
                "models": [model],
                "context_length": window,
                # A 550B model is slow to its first token on a long context.
                "request_timeout_seconds": 180, "stale_timeout_seconds": SLOW_STALE_SECONDS,
            }
            cfg["fallback_providers"].append({
                "provider": "custom:" + provider, "model": model,
                "base_url": url, "api_key": "${" + variable + "}",
                "api_mode": "chat_completions",
            })
    # Gemini goes last and through Hermes's built-in provider, not a custom entry: the native
    # v1beta route sanitizes tool schemas for Google, while the /openai compatibility path sends
    # them raw. Google reports exhausted free quota (per minute, per day, tokens) as 429, which
    # Hermes treats as a rate limit and falls through on, never as the 413 that compresses history.
    if environ.get("GEMINI_API_KEY", "").strip():
        cfg["fallback_providers"].append({
            "provider": "gemini", "model": environ.get("GEMINI_MODEL", "").strip() or DEFAULT_GEMINI_MODEL,
            "base_url": GEMINI_NATIVE_URL, "key_env": "GEMINI_API_KEY",
            "api_mode": "chat_completions",
        })
    cfg["web"] = {
        "search_backend": "jarvis-cloud-research", "extract_backend": "jarvis-cloud-research",
        "extract_char_limit": 10000,
    }
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
    shutil.copy2(HERE / "source_quality.py", plugin / "source_quality.py")
    shutil.copy2(HERE / "data_sources.py", plugin / "data_sources.py")
    for name in ("extended_sources.py", "news_sources.py", "image_gen.py", "weather.py", "calculation.py", "constraints.py", "verification.py", "verification_worker.py", "api_directory.py", "api_operations.json", "api_directory.json"):
        shutil.copy2(HERE / name, plugin / name)
    shutil.copy2(HERE / "research-plugin.yaml", plugin / "plugin.yaml")
    # An explicit cloud SOUL overrides the image's example personality.
    shutil.copy2(HERE / "SOUL.md", home / "SOUL.md")


def vision_cache_writable(home):
    """Probe the exact scratch directory using the gateway's runtime identity.

    No broad chmod/chown: a failed probe is diagnostic, and native image
    routing can continue without this auxiliary cache.
    """
    try:
        cache = home / 'cache' / 'vision'
        cache.mkdir(parents=True, exist_ok=True, mode=0o700)
        with tempfile.TemporaryFile(dir=cache) as probe:
            probe.write(b'vaelo-vision-cache-check')
            probe.seek(0)
            return probe.read() == b'vaelo-vision-cache-check'
    except OSError:
        return False


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


KEEP_AWAKE_SECONDS = 600


def keep_awake_url(environ):
    """Render spins a free service down after 15 idle minutes, and waking it takes minutes.
    Render sets RENDER_EXTERNAL_URL; a request to it arrives through Render's edge, which
    counts as inbound traffic. KEEP_AWAKE=0 turns this off (one always-on free service uses
    about 744 of the workspace's 750 free hours a month)."""
    if environ.get("KEEP_AWAKE", "").strip().lower() in ("0", "false", "off", "no"):
        return ""
    url = environ.get("RENDER_EXTERNAL_URL", "").strip().rstrip("/")
    return url + "/health" if url.startswith("https://") else ""


def keep_awake(url, interval=KEEP_AWAKE_SECONDS, sleep=time.sleep, request=urlopen):
    while True:
        sleep(interval)
        try:
            with request(Request(url, headers={"User-Agent": "vaelo-keep-awake"}), timeout=30) as response:
                response.read(256)
        except Exception:
            pass  # a missed ping only means the next request may wake the service


def start_keep_awake(environ):
    url = keep_awake_url(environ)
    if not url:
        return None
    thread = threading.Thread(target=keep_awake, args=(url,), daemon=True, name="keep-awake")
    thread.start()
    return thread


def internal_port(port):
    """Hermes listens privately; the relay owns the public port in front of it."""
    value = int(os.environ.get("HERMES_INTERNAL_PORT") or (port + 1 if port < 65535 else port - 1))
    if value == port or not 1 <= value <= 65535:
        raise SystemExit("HERMES_INTERNAL_PORT must be a free port other than PORT")
    return value


def supervise(hermes, server):
    """The container lives as long as Hermes does. If it exits, so does the relay, and Render
    restarts the service; a stop signal from Render reaches Hermes before the relay closes."""
    def stop(signum, frame):
        hermes.terminate()
        try:
            hermes.wait(timeout=25)
        except subprocess.TimeoutExpired:
            hermes.kill()
        os._exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def watch():
        code = hermes.wait()
        print(f"Hermes exited ({code}); stopping so the service restarts", flush=True)
        server.shutdown()
        os._exit(code or 1)

    threading.Thread(target=watch, daemon=True, name="hermes-watch").start()


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
    os.environ['VAELO_VISION_CACHE_WRITABLE'] = '1' if vision_cache_writable(home) else '0'
    print('Vision runtime cache: ' + ('ready' if os.environ['VAELO_VISION_CACHE_WRITABLE'] == '1' else 'unavailable'), flush=True)
    private = internal_port(port)
    os.environ.update({
        "API_SERVER_ENABLED": "true", "API_SERVER_HOST": "127.0.0.1",
        "API_SERVER_PORT": str(private), "API_SERVER_MODEL_NAME": "jarvis",
        "HERMES_GATEWAY_NO_SUPERVISE": "1", "HERMES_HOME": str(home),
    })
    # Built-in providers (Gemini) have no providers block to carry a stale timeout; an explicit
    # environment value is used as-is instead of Hermes's 180s default and reasoning floors.
    os.environ.setdefault("HERMES_STREAM_STALE_TIMEOUT", str(SLOW_STALE_SECONDS))
    executable = shutil.which("hermes")
    if not executable:
        raise SystemExit("The Hermes executable is missing from the container")
    print("Starting the private Jarvis API gateway", flush=True)
    hermes = subprocess.Popen([executable, "gateway", "run"], stdin=subprocess.DEVNULL)
    sys.path.insert(0, str(HERE))
    from relay import serve
    _, server = serve(port, private, os.environ["API_SERVER_KEY"])
    supervise(hermes, server)
    if start_keep_awake(os.environ):
        print("Keeping the service awake between conversations", flush=True)
    print(f"Vaelo relay listening on {port}; Hermes on 127.0.0.1:{private}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
