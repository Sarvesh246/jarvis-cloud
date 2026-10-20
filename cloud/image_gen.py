"""Image generation through the FreeLLMAPI router's /v1/images/generations.

None of the chat models in the cloud chain can draw, but the router fronts free FLUX
backends (NVIDIA, Cloudflare, SiliconFlow, Pollinations) and fails over between them.

The browser never sees tool results, only the written reply, and a megabyte of base64 is
no thing to ask a free model to copy. So the picture is kept here under a short
``vaelo-image:<token>`` reference that the model writes as a Markdown image; the relay
(same container, same HERMES_HOME) swaps that reference for the inline data URI that the
web already renders as a generated image.

Standard library only, plus Pillow when it is installed (the Hermes image ships it for the
vision tools) to shrink the picture to a JPEG small enough to keep in a conversation.
"""

import base64
from http.client import HTTPException
import io
import json
import os
import re
import secrets
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    from agent.image_gen_provider import ImageGenProvider, resolve_aspect_ratio
except ModuleNotFoundError as exc:
    if exc.name not in ("agent", "agent.image_gen_provider"):
        raise
    ImageGenProvider = object  # the relay and the tests import this module without Hermes

    def resolve_aspect_ratio(value):
        value = value.strip().lower() if isinstance(value, str) else ""
        return value if value in ("landscape", "square", "portrait") else "landscape"

NAME = "vaelo-freellmapi"
REFERENCE = re.compile(r"vaelo-image:([0-9a-f]{24})")
SIZES = {"landscape": "1024x768", "square": "1024x1024", "portrait": "768x1024"}
# A run has three minutes; FLUX on a free tier usually answers in ten to forty seconds.
TIMEOUT_SECONDS = 100
MAX_DOWNLOAD = 12 * 1024 * 1024
# Kept pictures are small and short-lived: long enough for a recovery or continuation of
# the same reply to reuse them, never a store of everyone's images.
KEEP_SECONDS = 60 * 60
KEEP_FILES = 24
LONG_SIDE = 1024
JPEG_QUALITY = 82
OFFLINE = ("The image router is offline right now, so no image was made. Tell the person "
           "plainly that image generation is unavailable at the moment and to try again later; "
           "do not substitute web search results or photos of existing things.")


def router(environ=os.environ):
    url = environ.get("FREELLMAPI_URL", "").strip().rstrip("/")
    if not url.startswith("https://") or not environ.get("FREELLMAPI_API_KEY", "").strip():
        return ""
    return url if url.endswith("/v1") else url + "/v1"


def folder(environ=os.environ):
    return Path(environ.get("HERMES_HOME") or "/opt/data") / "cache" / "vaelo-images"


def tidy(where, now=None):
    now = time.time() if now is None else now
    try:
        kept = sorted(where.glob("*.jpg"), key=lambda path: path.stat().st_mtime, reverse=True)
    except OSError:
        return
    for index, path in enumerate(kept):
        try:
            if index >= KEEP_FILES or now - path.stat().st_mtime > KEEP_SECONDS:
                path.unlink()
        except OSError:
            pass


def shrink(data):
    """A JPEG no longer than LONG_SIDE, or the original bytes when Pillow is missing."""
    try:
        from PIL import Image
    except ImportError:
        return data
    try:
        with Image.open(io.BytesIO(data)) as picture:
            picture = picture.convert("RGB")
            picture.thumbnail((LONG_SIDE, LONG_SIDE))
            out = io.BytesIO()
            picture.save(out, "JPEG", quality=JPEG_QUALITY, optimize=True)
            return out.getvalue()
    except Exception:
        return data


def mime(data):
    if data.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:3] == b"GIF":
        return "image/gif"
    return ""


def keep(data, environ=os.environ):
    """Store the picture and return its reference."""
    where = folder(environ)
    where.mkdir(parents=True, exist_ok=True)
    tidy(where)
    token = secrets.token_hex(12)
    path = where / f"{token}.jpg"  # the suffix only marks Vaelo's files; mime() reads the bytes
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)
    return f"vaelo-image:{token}"


def data_uri(token, environ=os.environ):
    """The inline image for a reference token, or "" when it is gone or not an image."""
    if not re.fullmatch(r"[0-9a-f]{24}", token or ""):
        return ""
    try:
        data = (folder(environ) / f"{token}.jpg").read_bytes()
    except OSError:
        return ""
    kind = mime(data)
    return f"data:{kind};base64,{base64.b64encode(data).decode()}" if kind else ""


def download(url):
    if not isinstance(url, str) or not url.startswith("https://"):
        raise ValueError("The router returned an image address that is not HTTPS.")
    with urlopen(Request(url, headers={"User-Agent": "Vaelo"}), timeout=TIMEOUT_SECONDS) as response:
        data = response.read(MAX_DOWNLOAD + 1)
    if len(data) > MAX_DOWNLOAD:
        raise ValueError("The generated image was too large.")
    return data


def failure(error, error_type, prompt, aspect_ratio):
    return {"success": False, "image": None, "error": error, "error_type": error_type,
            "model": "", "prompt": prompt, "aspect_ratio": aspect_ratio, "provider": NAME}


class FreeLLMAPIImages(ImageGenProvider):
    """Text-to-image through the router; editing and reference images are not offered."""

    def __init__(self, environ=None, opener=urlopen):
        self.environ = os.environ if environ is None else environ
        self.opener = opener

    @property
    def name(self):
        return NAME

    @property
    def display_name(self):
        return "FreeLLMAPI router"

    def is_available(self):
        return bool(router(self.environ))

    def list_models(self):
        return [{"id": "auto", "display": "Router's choice (free FLUX)"}]

    def default_model(self):
        return "auto"

    def capabilities(self):
        return {"modalities": ["text"], "max_reference_images": 0}

    def generate(self, prompt, aspect_ratio="landscape", *, image_url=None,
                 reference_image_urls=None, **kwargs):
        aspect_ratio = resolve_aspect_ratio(aspect_ratio)
        prompt = (prompt or "").strip()
        if not prompt:
            return failure("A prompt is required.", "invalid_request", prompt, aspect_ratio)
        if image_url or reference_image_urls:
            return failure("Editing an existing image is not available here; describe the "
                           "picture as a new text prompt instead.", "modality_unsupported",
                           prompt, aspect_ratio)
        base = router(self.environ)
        if not base:
            return failure(OFFLINE, "router_unconfigured", prompt, aspect_ratio)
        body = json.dumps({"prompt": prompt[:2000], "n": 1, "size": SIZES[aspect_ratio],
                           "response_format": "b64_json"}).encode()
        request = Request(base + "/images/generations", data=body, method="POST", headers={
            "Authorization": "Bearer " + self.environ["FREELLMAPI_API_KEY"].strip(),
            "Content-Type": "application/json", "User-Agent": "Vaelo",
        })
        try:
            with self.opener(request, timeout=TIMEOUT_SECONDS) as response:
                reply = json.loads(response.read(MAX_DOWNLOAD * 2))
        except HTTPError as error:
            if error.code in (502, 503, 504, 530):
                return failure(OFFLINE, "router_offline", prompt, aspect_ratio)
            if error.code == 429:
                return failure("Today's free image allowance is used up, so no image was made. "
                               "Say so plainly and suggest trying again later.",
                               "rate_limited", prompt, aspect_ratio)
            return failure(f"The image router refused this request (HTTP {error.code}). Say "
                           "plainly that the image could not be made.", "provider_error",
                           prompt, aspect_ratio)
        except (URLError, TimeoutError, OSError, ValueError, HTTPException):
            return failure(OFFLINE, "router_offline", prompt, aspect_ratio)
        images = reply.get("data") if isinstance(reply, dict) else None
        first = images[0] if isinstance(images, list) and images else {}
        try:
            if isinstance(first, dict) and first.get("b64_json"):
                if not isinstance(first["b64_json"], str):
                    raise ValueError("invalid image encoding")
                data = base64.b64decode(first["b64_json"], validate=False)
            elif isinstance(first, dict) and first.get("url"):
                data = download(first["url"])
            else:
                raise ValueError("no image")
            if len(data) > MAX_DOWNLOAD:
                raise ValueError("image too large")
        except (ValueError, URLError, OSError, HTTPException):
            return failure("The image router answered without a usable image. Say plainly "
                           "that the image could not be made.", "provider_error",
                           prompt, aspect_ratio)
        data = shrink(data)
        if not mime(data):
            return failure("The image router returned something that is not an image.",
                           "provider_error", prompt, aspect_ratio)
        try:
            reference = keep(data, self.environ)
        except OSError:
            return failure("The generated image could not be saved. Say plainly that the "
                           "image is unavailable and suggest trying again later.",
                           "provider_error", prompt, aspect_ratio)
        model = str(reply.get("model") or "auto")
        return {
            "success": True, "image": reference, "model": model, "prompt": prompt,
            "aspect_ratio": aspect_ratio, "modality": "text", "provider": NAME,
            "markdown": f"![short caption]({reference})",
            "note": ("Show the picture by writing exactly this Markdown image in the reply, with "
                     "your own short caption in the brackets: ![caption](" + reference + "). "
                     "Keep the reference unchanged; Vaelo turns it into the picture. Do not "
                     "describe it as a photo of a real product."),
        }
