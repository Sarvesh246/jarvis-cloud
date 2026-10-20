"""Searchable coverage ledger. A directory listing is never returned as fact evidence."""
import json
import re
from pathlib import Path

ENTRIES = json.loads(Path(__file__).with_name("api_directory.json").read_text(encoding="utf-8"))


def search(args):
    if not isinstance(args, dict) or set(args) - {"query", "category", "id", "offset"}:
        return {"success": False, "error": "Directory accepts query, category, id or offset"}
    query = args.get("query", "")
    category = args.get("category", "")
    offset = args.get("offset", 0)
    ident = args.get("id")
    if (not isinstance(query, str) or len(query) > 120 or not isinstance(category, str) or len(category) > 80
            or type(offset) is not int or not 0 <= offset <= len(ENTRIES)
            or ident is not None and (type(ident) is not int or ident <= 0)):
        return {"success": False, "error": "Invalid directory filters"}
    terms = re.findall(r"\w+", query.lower())
    ranked = []
    for e in ENTRIES:
        if ident is not None and e["id"] != ident or category and category.lower() != e["category"].lower():
            continue
        title = e["name"].lower()
        haystack = title + " " + e["category"].lower() + " " + e["description"].lower()
        if not all(t in haystack for t in terms):
            continue
        score = (100 if query.lower() == title else 0) + sum(5 if t in title else 1 for t in terms)
        ranked.append((score, e))
    ranked.sort(key=lambda pair: -pair[0])
    entries = [entry for _, entry in ranked[offset:offset + 5]]
    message = ("Coverage metadata only; not evidence for the user's factual question. "
               "Only listed tools are callable. Missing credentials, user connections and pending contracts are unavailable; "
               "use ordinary web search for public facts. Never send account data to public APIs.")
    payload = {"notice": message, "total_directory": len(ENTRIES), "matches": len(ranked), "offset": offset, "entries": entries}
    return {"success": True, **payload,
            "data": {"web": [{"title": "Vaelo API coverage directory", "url": "https://vaelochat.vercel.app", "description": json.dumps(payload, ensure_ascii=False)}]}}
