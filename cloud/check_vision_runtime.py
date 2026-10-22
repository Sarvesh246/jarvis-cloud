"""Offline production-image check, run as the gateway identity, without API keys."""
import base64
import tempfile
from pathlib import Path
import os
import sys

sys.path.insert(0, '/opt/hermes')
sys.path.insert(0, '/opt/jarvis')
from bootstrap import prepare_profile, vision_cache_writable


def check():
    with tempfile.TemporaryDirectory() as directory:
        home = Path(directory)
        os.environ['HERMES_HOME'] = str(home)
        prepare_profile(home, {'FREELLMAPI_URL': 'https://router.example', 'FREELLMAPI_API_KEY': 'fixture'})
        assert vision_cache_writable(home)
        from agent.image_routing import _supports_vision_override
        import json
        cfg = json.loads((home / 'config.yaml').read_text())
        assert _supports_vision_override(cfg, 'custom:cloud-freellmapi', 'auto') is True
        assert _supports_vision_override(cfg, 'custom:cloud-openrouter', 'openrouter/free') is True
        assert _supports_vision_override(cfg, 'custom:cloud-nvidia', 'nvidia/nemotron-3-ultra-550b-a55b') is None
        from tools.vision_tools import _secure_cache_dir, _write_private_bytes
        cache = _secure_cache_dir('cache/vision', 'temp_vision_images')
        assert cache == home / 'vaelo-vision-cache'
        pixels = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
        image = cache / 'runtime-check.png'
        _write_private_bytes(image, pixels)
        from PIL import Image
        with Image.open(image) as decoded:
            decoded.load()
            assert decoded.size == (1, 1)
        assert image.read_bytes() == pixels
        from agent.vision_message_prep import VisionMessagePrepMixin
        class Native(VisionMessagePrepMixin):
            def _model_supports_vision(self): return True
        messages = [{'role': 'user', 'content': [{'type': 'image_url', 'image_url': {
            'url': 'data:image/png;base64,' + base64.b64encode(pixels).decode()}}]}]
        assert Native()._prepare_messages_for_non_vision_model(messages) is messages
        print('Vision: runtime cache write/read, pixel decode, capability routing and native image preservation passed.')


if __name__ == '__main__':
    check()
