"""Cloud research over bounded HTTP requests, without loading provider SDKs."""
import asyncio
import json
import os
from urllib.request import Request, urlopen

from agent.web_search_provider import WebSearchProvider

REQUEST_TIMEOUT = 20
RESPONSE_BYTES = 512 * 1024
PAGE_CHARS = 10000
MAX_URLS = 4
SEARCH_LIMIT = 5
KEYS = {"exa": "EXA_API_KEY", "tavily": "TAVILY_API_KEY", "firecrawl": "FIRECRAWL_API_KEY"}
BASES = {"exa": "https://api.exa.ai", "tavily": "https://api.tavily.com", "firecrawl": "https://api.firecrawl.dev/v2"}


def post(provider, path, payload):
    key = os.environ.get(KEYS[provider], "").strip()
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    headers["x-api-key" if provider == "exa" else "Authorization"] = key if provider == "exa" else "Bearer " + key
    req = Request(BASES[provider] + path, data=json.dumps(payload).encode(), headers=headers, method="POST")
    with urlopen(req, timeout=REQUEST_TIMEOUT) as response:
        # Bound the download before decoding or allocating the parsed JSON tree.
        data = response.read(RESPONSE_BYTES + 1)
    if len(data) > RESPONSE_BYTES:
        raise ValueError("Research response exceeded its size limit")
    return json.loads(data)


def configured(name):
    return bool(os.environ.get(KEYS[name], "").strip())


class Research(WebSearchProvider):
    name = "jarvis-cloud-research"
    display_name = "Exa / Tavily / Firecrawl"

    def is_available(self):
        return any(configured(name) for name in KEYS)

    def supports_extract(self):
        return True

    def search(self, query, limit=5):
        limit = max(1, min(int(limit), SEARCH_LIMIT))
        for name in KEYS:
            if not configured(name):
                continue
            try:
                if name == "exa":
                    data = post(name, "/search", {"query": query, "numResults": limit})
                    rows = data.get("results", [])
                elif name == "tavily":
                    data = post(name, "/search", {"query": query, "max_results": limit, "include_raw_content": False})
                    rows = data.get("results", [])
                else:
                    data = post(name, "/search", {"query": query, "limit": limit})
                    rows = data.get("data", {})
                    rows = rows.get("web", []) if isinstance(rows, dict) else rows
                results = [{"url": row["url"], "title": str(row.get("title", ""))[:500],
                            "description": str(row.get("description") or row.get("content") or "")[:1500]}
                           for row in rows[:limit] if isinstance(row, dict) and row.get("url")]
                if results:
                    return {"success": True, "data": {"web": results}, "provider": name}
            except Exception:
                continue
        return {"success": False, "error": "No configured research provider returned results"}

    def extract_one(self, url):
        for name in ("exa", "tavily", "firecrawl"):
            if not configured(name):
                continue
            try:
                if name == "exa":
                    data = post(name, "/contents", {"urls": [url], "text": {"maxCharacters": PAGE_CHARS}})
                    rows = data.get("results", [])
                elif name == "tavily":
                    data = post(name, "/extract", {"urls": [url], "extract_depth": "basic", "format": "text"})
                    rows = data.get("results", [])
                else:
                    data = post(name, "/scrape", {"url": url, "formats": ["markdown"], "onlyMainContent": True, "timeout": 15000})
                    rows = [data.get("data", {})] if data.get("success") else []
                for item in rows:
                    content = item.get("text") or item.get("raw_content") or item.get("content") or item.get("markdown")
                    if isinstance(content, str) and content.strip():
                        title = item.get("title") or item.get("metadata", {}).get("title", "")
                        return {"url": url, "title": str(title)[:500], "content": content[:PAGE_CHARS], "provider": name}
            except Exception:
                continue
        return {"url": url, "error": "Page extraction failed; use another source or the available search results", "content": ""}

    async def extract(self, urls, **kwargs):
        # One page at a time: parallel SDK calls and full-page response copies
        # can exceed the free instance's RAM before Hermes truncates tool output.
        results = []
        for index, url in enumerate(dict.fromkeys(urls)):
            if index >= MAX_URLS:
                results.append({"url": url, "error": "Extract up to four pages per call", "content": ""})
            else:
                results.append(await asyncio.to_thread(self.extract_one, url))
        return results


def register(ctx):
    ctx.register_web_search_provider(Research())
