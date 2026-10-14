"""Research routing uses Hermes providers and their normal credential handling."""
import asyncio
import inspect
from agent.web_search_provider import WebSearchProvider


class Research(WebSearchProvider):
    name = "jarvis-cloud-research"
    display_name = "Exa / Tavily / Firecrawl"

    def providers(self):
        from agent.web_search_registry import get_provider
        return [(name, get_provider(name)) for name in ("exa", "tavily", "firecrawl")]

    def is_available(self):
        return any(provider and provider.is_available() for _, provider in self.providers())

    def supports_extract(self):
        return True

    def search(self, query, limit=5):
        for name, provider in self.providers():
            if not provider or not provider.is_available():
                continue
            try:
                result = provider.search(query, limit=limit)
                if result.get("success") and result.get("data", {}).get("web"):
                    result["provider"] = name
                    return result
                if "interrupt" in str(result.get("error", "")).lower():
                    return result
            except Exception:
                continue
        return {"success": False, "error": "No configured research provider returned results"}

    async def extract(self, urls, **kwargs):
        from agent.web_search_registry import get_provider
        remaining = list(dict.fromkeys(urls))
        found = {}
        for name in ("firecrawl", "exa", "tavily"):
            provider = get_provider(name)
            if not remaining or not provider or not provider.is_available() or not provider.supports_extract():
                continue
            try:
                if inspect.iscoroutinefunction(provider.extract):
                    result = await provider.extract(remaining, **kwargs)
                else:
                    result = await asyncio.to_thread(provider.extract, remaining, **kwargs)
                if isinstance(result, dict):
                    result = result.get("data", result.get("results", []))
                for item in result or []:
                    url = item.get("url")
                    if url in remaining and (item.get("content") or item.get("raw_content")) and not item.get("error"):
                        found[url] = {**item, "provider": name}
                remaining = [url for url in remaining if url not in found]
            except Exception:
                continue
        return [found.get(url, {"url": url, "error": "Page extraction failed", "content": ""}) for url in urls]


def register(ctx):
    ctx.register_web_search_provider(Research())
