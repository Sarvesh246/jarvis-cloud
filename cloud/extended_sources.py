"""Declarative fixed-host GET operations; no user URLs, SQL or account access."""
import base64
import json
import math
import os
import re
from pathlib import Path
from urllib.parse import quote, urlencode

try:
    from . import news_sources
except ImportError:
    import news_sources

SPECS = json.loads((Path(__file__).with_name("api_operations.json")).read_text(encoding="utf-8"))
CATALOG = {k: (s["description"], " ".join(s.get("parameters", {})), s["documentation"], s["qualification"]) for k, s in SPECS.items()}
CATALOG.update(news_sources.CATALOG)


def value_at(row, path):
    for name in path.split(".") if path else []:
        if not isinstance(row, dict):
            raise ValueError("Provider response no longer matches the operation contract")
        row = row[name]
    return row


def intent(query):
    for source, spec in SPECS.items():
        required = {k for k, v in spec.get("parameters", {}).items() if v.get("required")}
        if required != {"query"}:
            continue
        names = [source, *spec.get("aliases", [])]
        match = re.fullmatch(r"(?:search|find|look up)(?: for)?\s+(.{1,240}?)\s+(?:on|using|via)\s+(?:" + "|".join(re.escape(n) for n in names) + r")[?.!]?", query, re.I)
        if match:
            return source, {"query": match[1]}
    for pattern, source, key in (
        (r"(?:look up\s+)?pokemon\s+([a-z0-9-]+)[?.!]?", "pokemon", "name"),
        (r"(?:look up\s+)?UK postcode\s+([a-z0-9 ]{3,9})[?.!]?", "postcodes", "postcode"),
        (r"(?:find|look up)\s+(?:the\s+)?Magic card\s+(.{1,100}?)[?.!]?", "scryfall", "name"),
    ):
        match = re.fullmatch(pattern, query, re.I)
        if match:
            return source, {key: match[1]}
    return None


def adapter(source, a, *, get, fetch, text, credential, item, unavailable):
    if source in news_sources.CATALOG:
        return news_sources.adapter(source, a, get=get, fetch=fetch, text=text, credential=credential, item=item, unavailable=unavailable)
    spec = SPECS[source]
    if spec.get("noncommercial") and os.environ.get("PUBLIC_DATA_NONCOMMERCIAL", "1") != "1":
        raise unavailable("This free operation is restricted to noncommercial use")
    params = dict(spec.get("defaults", {}))
    url = spec["endpoint"]
    for name, rule in spec.get("parameters", {}).items():
        if name not in a and not rule.get("required"):
            continue
        value = text(a, name, rule.get("pattern"))
        if name in ("latitude", "longitude"):
            limit = 90 if name == "latitude" else 180
            if not math.isfinite(float(value)) or not -limit <= float(value) <= limit:
                raise unavailable("Coordinates are outside their valid range")
        if rule.get("path"):
            url = url.replace("{" + name + "}", quote(value, safe=""))
        else:
            params[rule.get("remote", name)] = value
    # Citations never include credential-bearing parameters.
    citation = url + ("?" + urlencode(params) if params else "")
    headers = dict(spec.get("headers", {}))
    auth = spec.get("credential")
    if auth:
        key = credential(auth["env"])
        if auth.get("encoding") == "basic":
            key = base64.b64encode((key + ":").encode()).decode("ascii")
        if auth.get("header"):
            headers[auth["header"]] = auth.get("prefix", "") + key
        else:
            params[auth["parameter"]] = key
    data = get(url, params, headers or None)
    if isinstance(data, dict) and (data.get("error") or data.get("errors") or data.get("success") is False
                                  or data.get("status") in ("error", "fail", "FAILED", "0")
                                  or data.get("retCode", 0) != 0):
        raise unavailable("The provider rejected the public read operation; use web research")
    if spec.get("protocol") == "ckan" and data.get("success") is not True:
        raise unavailable("The public data portal rejected this query")
    rows = value_at(data, spec.get("results", ""))
    if not isinstance(rows, (dict, list)):
        raise unavailable("Provider returned an unexpected result type")
    if isinstance(rows, dict):
        rows = [rows]
    results = []
    for row in rows[:5]:
        if not isinstance(row, dict):
            continue
        # Projection makes large objects useful without changing their meaning.
        fields = spec.get("fields")
        record = {k: row[k] for k in fields if k in row} if fields else row
        if not record:
            continue
        title = row.get(spec.get("title", "name")) or spec["description"]
        if not isinstance(title, (str, int, float)):
            title = spec["description"]
        results.append(item(title, citation, record))
    return results
