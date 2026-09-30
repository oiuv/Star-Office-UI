"""OpenAI-compatible Image API transport, using only the Python standard library."""
from __future__ import annotations
import base64
import json
import mimetypes
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-image-2"
MAX_RESPONSE = 64 * 1024 * 1024

def validate_base_url(value):
    if not isinstance(value, str):
        raise ValueError("base_url must be a string")
    value = value.strip().rstrip("/") or DEFAULT_BASE_URL
    parts = urllib.parse.urlsplit(value)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise ValueError("base_url must be an absolute HTTP(S) URL")
    if parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError("base_url cannot contain credentials, query parameters or fragments")
    try:
        parts.port
    except ValueError:
        raise ValueError("base_url has an invalid port") from None
    return value

class NoRedirect(urllib.request.HTTPRedirectHandler):
    # Never forward API credentials to a redirected host.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def multipart(fields, reference):
    boundary = "staroffice" + uuid.uuid4().hex
    chunks = []
    for key, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n".encode(),
            str(value).encode("utf-8"), b"\r\n",
        ])
    mime = mimetypes.guess_type(reference.name)[0] or "image/png"
    chunks.extend([
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"reference{reference.suffix}\"\r\nContent-Type: {mime}\r\n\r\n".encode(),
        reference.read_bytes(), b"\r\n", f"--{boundary}--\r\n".encode(),
    ])
    return b"".join(chunks), "multipart/form-data; boundary=" + boundary

def generate_image(config, prompt, reference=None, speed_mode="quality", opener=None):
    api_key = config.get("api_key", "").strip()
    if not api_key:
        raise RuntimeError("MISSING_API_KEY")
    base_url = validate_base_url(config.get("base_url", ""))
    model = config.get("model", "").strip() or DEFAULT_MODEL
    fields = {"model": model, "prompt": prompt, "n": 1}
    # Vendor-specific models can choose their native dimensions/quality.
    # Do not force GPT-only optional parameters on compatible gateways.
    if model.startswith("gpt-image-"):
        fields.update(size="1536x1024", quality="low" if speed_mode == "fast" else "high")
    mode = config.get("image_mode", "edit")
    ref = Path(reference) if reference else None
    if mode == "edit":
        if not ref or not ref.is_file():
            raise RuntimeError("Reference image missing; select generation mode explicitly to omit it")
        data, content_type = multipart(fields, ref)
        endpoint = "/images/edits"
    elif mode == "generate":
        data = json.dumps(fields).encode("utf-8")
        content_type, endpoint = "application/json", "/images/generations"
    else:
        raise ValueError("image_mode must be edit or generate")
    request = urllib.request.Request(
        base_url + endpoint, data=data, method="POST",
        headers={"Authorization": "Bearer " + api_key, "Content-Type": content_type},
    )
    opener = opener or urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(request, timeout=180) as response:
            raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise RuntimeError("Image API response exceeds 64 MB")
        result = json.loads(raw)
    except urllib.error.HTTPError as error:
        # The provider may echo submitted credentials; scrub before displaying.
        raw = error.read(8192).decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw).get("error", {}).get("message", "")
        except (ValueError, AttributeError):
            detail = ""
        detail = re.sub(r"sk-[A-Za-z0-9_-]+", "[redacted]", str(detail).replace(api_key, "[redacted]"))[:400]
        raise RuntimeError(f"Image API HTTP {error.code}: {detail or 'request rejected'}") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise RuntimeError("Image API connection failed or timed out") from None
    except (ValueError, TypeError):
        raise RuntimeError("Image API returned invalid JSON") from None
    items = result.get("data") if isinstance(result, dict) else None
    if not items or not isinstance(items, list) or not isinstance(items[0], dict):
        raise RuntimeError("Image API returned no image")
    image = items[0]
    if image.get("b64_json"):
        try:
            return base64.b64decode(image["b64_json"], validate=True)
        except (ValueError, TypeError):
            raise RuntimeError("Image API returned invalid base64 data") from None
    url = image.get("url")
    if isinstance(url, str) and urllib.parse.urlsplit(url).scheme in {"http", "https"}:
        # Download without the provider Authorization header.
        try:
            with opener.open(urllib.request.Request(url), timeout=30) as response:
                data = response.read(MAX_RESPONSE + 1)
        except (urllib.error.URLError, OSError):
            raise RuntimeError("Generated image download failed") from None
        if len(data) > MAX_RESPONSE:
            raise RuntimeError("Generated image exceeds 64 MB")
        return data
    raise RuntimeError("Image API returned neither b64_json nor an HTTP(S) image URL")
