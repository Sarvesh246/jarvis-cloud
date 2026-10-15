import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("bootstrap", ROOT / "cloud/bootstrap.py")
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class BootstrapTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
