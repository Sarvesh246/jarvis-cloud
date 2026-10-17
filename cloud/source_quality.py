"""Conservative model identity checks; relevance is not claim verification."""

import re
from urllib.parse import unquote, urlsplit

VARIANTS = r"pro|max|ultra|plus|mini|air|lite|super|ti|fe|fold|flip"
MODEL = re.compile(
    rf"\b([a-z][a-z+#.]{{0,30}})(?:[ -]+([a-z]{{0,3}}\d{{1,6}}(?:\.\d+)*)|(\d{{1,6}}(?:\.\d+)*))"
    rf"((?:[ -]*(?:{VARIANTS})\b){{0,3}})(?![a-z0-9])", re.I,
)
GENERIC = set("a an the and or vs versus compare comparison between from to for at in of with under over than year years model models version page chapter section top best review reviews news update updated released release what who when where which why how battery ram storage display camera price weight september october november december january february march april may june july august".split())
FAMILIES = set("iphone ipad macbook imac airpods galaxy pixel oneplus playstation xbox geforce rtx gtx radeon rx ryzen core snapdragon surface thinkpad python node windows android ios claude gemini gpt".split())
COMPARISON = re.compile(r"\b(?:vs\.?|versus|comparison|compare)\b", re.I)
OFFICIAL = {
    "iphone": "apple.com", "ipad": "apple.com", "macbook": "apple.com",
    "airpods": "apple.com", "pixel": "google.com", "galaxy": "samsung.com",
    "oneplus": "oneplus.com", "geforce": "nvidia.com", "rtx": "nvidia.com",
    "radeon": "amd.com", "ryzen": "amd.com",
}


def subjects(text, strict=True):
    result = []
    previous_end = 0
    previous_family = None
    for match in MODEL.finditer(str(text)):
        family = match[1].lower().rstrip(".")
        if family in GENERIC:
            continue
        generation = match[2] or match[3]
        if strict and not (family in FAMILIES or match[4].strip() or match[3]
                           or re.match(r"[a-z]", generation, re.I) or match[1].isupper()):
            continue
        name = " ".join((family, match[2] or match[3], match[4].strip())).lower()
        name = re.sub(r"\s+", " ", name).strip()
        if name not in result:
            result.append(name)
        previous_family, previous_end = family, match.end()
    # Common shorthand: "iPhone 15 Pro vs 18 Pro Max". Expand only a
    # connector immediately following the last full model, never arbitrary numbers.
    if previous_family:
        tail = re.match(rf"\s*(?:and|or|vs\.?|versus|/|,)\s*([a-z]{{0,3}}\d{{1,6}})((?:[ -]+(?:{VARIANTS})\b){{0,3}})",
                        str(text)[previous_end:], re.I)
        if tail:
            name = f"{previous_family} {tail[1]}{tail[2]}".lower()
            if name not in result:
                result.append(name)
    return result[:4 if strict else 32]


def identity(name):
    return re.sub(r"[^a-z0-9.]", "", name.lower())


def comparison_source(hit):
    return bool(COMPARISON.search(str(hit.get("title", "")) + " " + unquote(str(hit.get("url", "")))))


def source_scope(hit, requested):
    """Only label subjects explicitly identified in the source; reject wrong-pair titles."""
    if not requested:
        return dict(hit)
    title = str(hit.get("title", ""))
    candidates = subjects(title + "\n" + str(hit.get("description", hit.get("content", ""))), strict=False)
    found = {identity(name) for name in candidates}
    covered = [name for name in requested if identity(name) in found]
    if not covered:
        return None
    title_models = {identity(name) for name in subjects(title, strict=False)}
    wanted = {identity(name) for name in requested}
    if title_models and not title_models.intersection(wanted):
        return None
    if comparison_source(hit) and title_models - wanted and not wanted.issubset(title_models):
        return None
    result = dict(hit)
    result["subjects"] = covered
    result["evidence_scope"] = "Identity match only; use this source only for these subjects and facts its passage actually supports."
    return result


def official_source(hit, requested):
    try:
        host = (urlsplit(hit.get("url", "")).hostname or "").lower()
    except ValueError:
        return False
    return any((host == domain or host.endswith("." + domain))
               for name in requested
               if (domain := OFFICIAL.get(name.split()[0])))


def relevant_sources(query, hits):
    requested = subjects(query)
    scoped = [source for hit in hits if (source := source_scope(hit, requested)) is not None]
    # Within each tier keep the search engine's fused ranking unchanged.
    if requested:
        scoped.sort(key=lambda hit: not official_source(hit, requested))
    return scoped
