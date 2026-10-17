import importlib.util
import json
import sys
import types
from pathlib import Path
import tempfile
import threading
import unittest
import unittest.mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("bootstrap", ROOT / "cloud/bootstrap.py")
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class BootstrapTests(unittest.TestCase):
    def test_installed_research_plugin_loads_its_packaged_source_checks(self):
        interface = types.ModuleType("agent.web_search_provider")
        interface.WebSearchProvider = object
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            bootstrap.prepare_profile(home, {})
            plugin = home / "plugins" / "jarvis-cloud-research"
            spec = importlib.util.spec_from_file_location("test_installed_research", plugin / "__init__.py")
            module = importlib.util.module_from_spec(spec)
            with unittest.mock.patch.dict(sys.modules, {"test_installed_research": module,
                    "agent": types.ModuleType("agent"), "agent.web_search_provider": interface}):
                spec.loader.exec_module(module)
                self.assertEqual(module.subjects.__module__, "test_installed_research.source_quality")
                self.assertEqual(module.subjects("iPhone 15 Pro vs 18 Pro Max"), ["iphone 15 pro", "iphone 18 pro max"])

    def test_context_policy_stays_consistent_across_cloud_routes_and_web(self):
        policy = bootstrap.CONTEXT_POLICY
        self.assertEqual(policy["windowTokens"], 128000)
        self.assertGreater(policy["compressionCapTokens"], 64000)
        self.assertLessEqual(policy["compressionCapTokens"], policy["windowTokens"] * policy["compressionRatio"])
        for environ in ({}, {"NVIDIA_API_KEY": "x", "GEMINI_API_KEY": "x"},
                        {"FREELLMAPI_URL": "https://router.example", "FREELLMAPI_API_KEY": "x", "NVIDIA_API_KEY": "x"}):
            cfg = bootstrap.configuration(environ)
            for provider in cfg["providers"].values():
                self.assertGreaterEqual(provider["context_length"], policy["windowTokens"])
            primary = cfg["model"]["provider"].removeprefix("custom:")
            self.assertEqual(cfg["model"]["context_length"], cfg["providers"][primary]["context_length"])
            self.assertEqual(cfg["compression"]["threshold"], policy["compressionRatio"])
            self.assertEqual(cfg["compression"]["threshold_tokens"], policy["compressionCapTokens"])
        dockerfile = (ROOT / "Dockerfile").read_text()
        self.assertIn("COPY web/shared/context-policy.json /opt/jarvis/context-policy.json", dockerfile)

    def test_missing_credentials_never_enable_chat(self):
        self.assertTrue(bootstrap.missing_configuration({}))
        self.assertTrue(bootstrap.missing_configuration({"API_SERVER_KEY": "short", "OPENROUTER_API_KEY": "example"}))
        self.assertEqual(bootstrap.missing_configuration({"API_SERVER_KEY": "a" * 64, "OPENROUTER_API_KEY": "example"}), [])

    def test_setup_health_is_reachable_but_chat_is_not(self):
        server = bootstrap.setup_server(0, ["OPENROUTER_API_KEY"])
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = "http://127.0.0.1:" + str(server.server_port)
        try:
            with urlopen(base + "/health") as response:
                self.assertEqual(json.load(response)["chat_enabled"], False)
            with self.assertRaises(HTTPError) as error:
                urlopen(base + "/v1/models")
            error.exception.close()
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(base + "/v1/chat/completions", data=b"{}"))
            error.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_generated_profile_contains_references_not_keys(self):
        secret = "test-key-not-a-real-provider-credential"
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            bootstrap.prepare_profile(home, {
                "OPENROUTER_API_KEY": secret, "GROQ_API_KEY": secret,
                "NVIDIA_API_KEY": secret, "GEMINI_API_KEY": secret,
            })
            text = (home / "config.yaml").read_text()
            self.assertNotIn(secret, text)
            cfg = json.loads(text)
            self.assertEqual(cfg["gateway"]["api_server"]["max_concurrent_runs"], 1)
            self.assertEqual(cfg["model"]["default"], "openrouter/free")
            self.assertGreaterEqual(cfg["model"]["context_length"], 64000)
            self.assertEqual(cfg["model"]["context_length"], cfg["providers"]["cloud-openrouter"]["context_length"])
            for provider in cfg["providers"].values():
                if "context_length" in provider:
                    self.assertGreaterEqual(provider["context_length"], 64000)
            self.assertEqual([f["provider"] for f in cfg["fallback_providers"]], ["custom:cloud-nvidia", "gemini"])
            self.assertNotIn("ollama", text)
            self.assertTrue((home / "plugins/jarvis-cloud-research/plugin.yaml").exists())
            self.assertTrue((home / "SOUL.md").exists())

    def test_groq_never_joins_the_chat_chain(self):
        # Groq's per-minute token cap is smaller than one agent request; its 413 ends the turn
        # instead of falling through, so a configured key must not put it in the chain.
        cfg = bootstrap.configuration({"GROQ_API_KEY": "x", "NVIDIA_API_KEY": "x"})
        self.assertNotIn("cloud-groq", cfg["providers"])
        self.assertNotIn("groq", json.dumps(cfg["fallback_providers"]))

    def test_gemini_uses_the_native_provider_after_nvidia(self):
        cfg = bootstrap.configuration({"NVIDIA_API_KEY": "x", "GEMINI_API_KEY": "x"})
        gemini = cfg["fallback_providers"][-1]
        self.assertEqual(gemini["provider"], "gemini")
        self.assertEqual(gemini["model"], "gemini-2.5-flash")
        # The native v1beta surface, not /openai: only the native client sanitizes tool schemas.
        self.assertEqual(gemini["base_url"], "https://generativelanguage.googleapis.com/v1beta")
        self.assertEqual(gemini["key_env"], "GEMINI_API_KEY")
        self.assertNotIn("api_key", gemini)
        # A named providers block would shadow Hermes's built-in Gemini profile.
        self.assertNotIn("gemini", cfg["providers"])

    def test_gemini_model_can_be_overridden_and_stands_alone(self):
        cfg = bootstrap.configuration({"GEMINI_API_KEY": "x", "GEMINI_MODEL": " gemini-3.5-flash "})
        self.assertEqual([(f["provider"], f["model"]) for f in cfg["fallback_providers"]], [("gemini", "gemini-3.5-flash")])
        self.assertEqual(bootstrap.configuration({"GEMINI_API_KEY": "  ", "GEMINI_MODEL": "x"})["fallback_providers"], [])

    def test_missing_optional_keys_do_not_add_fallbacks(self):
        self.assertEqual(bootstrap.configuration({})["fallback_providers"], [])

    def test_long_tasks_get_room_to_finish(self):
        cfg = bootstrap.configuration({"NVIDIA_API_KEY": "x"})
        self.assertGreaterEqual(cfg["agent"]["max_turns"], 40)
        self.assertGreaterEqual(cfg["terminal"]["timeout"], 120)
        for provider in cfg["providers"].values():
            self.assertGreaterEqual(provider["request_timeout_seconds"], 120)

    def test_a_hung_provider_hands_over_well_inside_one_reply_window(self):
        # One reply streams through a five-minute Vercel function. A silent model has to give
        # way to the next provider early, after one attempt, so a fallback still has time.
        cfg = bootstrap.configuration({"NVIDIA_API_KEY": "x", "FREELLMAPI_URL": "https://r.example", "FREELLMAPI_API_KEY": "k"})
        for provider in cfg["providers"].values():
            self.assertLessEqual(provider["stale_timeout_seconds"], 90)
            self.assertGreaterEqual(provider["stale_timeout_seconds"], 45)
        self.assertEqual(cfg["agent"]["api_max_retries"], 1)
        self.assertLessEqual(cfg["agent"]["auto_recovery_cycles"], 1)
        # The model is told to write up what it has before the window closes.
        self.assertLess(cfg["agent"]["run_budget_seconds"], 240)

    def test_no_hidden_model_calls_or_skill_detours(self):
        cfg = bootstrap.configuration({})
        # Hermes's skills prompt makes the model load a skill before most replies: one more
        # full model round trip per message, for guides written for the desktop.
        self.assertNotIn("skills", cfg["platform_toolsets"]["api_server"])
        self.assertIs(cfg["auxiliary"]["title_generation"]["model_upgrade_enabled"], False)
        self.assertIs(cfg["auxiliary"]["background_review"]["enabled"], False)

    def test_free_instance_has_explicit_memory_bounds(self):
        cfg = bootstrap.configuration({})
        cache = cfg["agent"]["agent_cache"]
        self.assertEqual(cache["max_size"], 1)
        self.assertLess(cache["memory_high_mb"], 512)
        self.assertEqual(cache["protect_recent"], 0)
        # Compression is a summarizing model call of its own; it waits for histories that need it.
        self.assertEqual(cfg["compression"]["threshold_tokens"], bootstrap.CONTEXT_POLICY["compressionCapTokens"])
        self.assertEqual(cfg["compression"]["threshold"], 0.85)
        self.assertLessEqual(cfg["web"]["extract_char_limit"], 10000)

    def test_freellmapi_router_leads_and_openrouter_falls_back(self):
        secret = "router-key-not-real"
        cfg = bootstrap.configuration({
            "FREELLMAPI_URL": "https://router.example/", "FREELLMAPI_API_KEY": secret,
            "NVIDIA_API_KEY": "x", "GEMINI_API_KEY": "x",
        })
        self.assertEqual(cfg["model"]["provider"], "custom:cloud-freellmapi")
        self.assertEqual(cfg["model"]["default"], "auto")
        self.assertEqual(cfg["providers"]["cloud-freellmapi"]["api"], "https://router.example/v1")
        self.assertNotIn(secret, json.dumps(cfg))
        self.assertEqual([f["provider"] for f in cfg["fallback_providers"]],
                         ["custom:cloud-openrouter", "custom:cloud-nvidia", "gemini"])

    def test_freellmapi_needs_https_and_a_key(self):
        for environ in ({"FREELLMAPI_URL": "http://router.example", "FREELLMAPI_API_KEY": "k"},
                        {"FREELLMAPI_URL": "https://router.example"}):
            cfg = bootstrap.configuration(environ)
            self.assertNotIn("cloud-freellmapi", cfg["providers"])
            self.assertEqual(cfg["model"]["default"], "openrouter/free")

    def test_hermes_listens_privately_beside_the_relay(self):
        with unittest.mock.patch.dict(bootstrap.os.environ, {}, clear=True):
            self.assertEqual(bootstrap.internal_port(10000), 10001)
            self.assertEqual(bootstrap.internal_port(65535), 65534)
        with unittest.mock.patch.dict(bootstrap.os.environ, {"HERMES_INTERNAL_PORT": "10000"}, clear=True):
            with self.assertRaises(SystemExit):
                bootstrap.internal_port(10000)

    def test_keep_awake_targets_render_health_unless_disabled(self):
        url = "https://jarvis.example.onrender.com"
        self.assertEqual(bootstrap.keep_awake_url({"RENDER_EXTERNAL_URL": url + "/"}), url + "/health")
        self.assertEqual(bootstrap.keep_awake_url({"RENDER_EXTERNAL_URL": url, "KEEP_AWAKE": "0"}), "")
        self.assertEqual(bootstrap.keep_awake_url({}), "")

    def test_keep_awake_pings_before_the_idle_cutoff_and_survives_failures(self):
        pings, pauses = [], []

        class Done(Exception):
            pass

        def sleep(seconds):
            pauses.append(seconds)
            if len(pauses) > 2:
                raise Done

        def request(req, timeout):
            pings.append(req.full_url)
            raise OSError("edge hiccup")

        with self.assertRaises(Done):
            bootstrap.keep_awake("https://x.example/health", sleep=sleep, request=request)
        self.assertEqual(pings, ["https://x.example/health"] * 2)
        self.assertTrue(all(seconds < 15 * 60 for seconds in pauses))


if __name__ == "__main__":
    unittest.main()
