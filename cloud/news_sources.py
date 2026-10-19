"""Fixed, read-only news operations. Tokens and GraphQL are never model supplied."""
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timedelta, timezone
import os
import re
from urllib.parse import urlencode


CATALOG = {
    "hackernews": ("Hacker News top/new/best/ask/show/job stories", "feed", "https://github.com/HackerNews/API", "Official public API; HN ranking is not verification of linked claims."),
    "producthunt": ("Product Hunt recent launches or a launch by slug", "slug days", "https://www.producthunt.com/v2/docs", "Requires PRODUCTHUNT_TOKEN; noncommercial public reads only. Attribute Product Hunt."),
    "gnews": ("GNews article search/headlines", "query country language", "https://docs.gnews.io/", "Free noncommercial tier: 100 requests/day, 12-hour publication delay. Not breaking-news evidence; attribute original publishers."),
    "newsapi": ("NewsAPI article search", "query language", "https://newsapi.org/docs/endpoints/everything", "Free Developer tier is local development only, with 24-hour delayed articles. Disabled in deployed Vaelo; use other sources."),
}


def adapter(source, a, *, get, fetch, text, credential, item, unavailable):
    if source == "hackernews":
        feed = text(a, "feed", r"top|new|best|ask|show|job", default="top")
        root = "https://hacker-news.firebaseio.com/v0/"
        ids = get(root + feed + "stories.json")
        if not isinstance(ids, list):
            raise unavailable("Unexpected Hacker News feed")
        ids = [i for i in ids[:5] if type(i) is int and 0 < i < 10**12]
        pool = ThreadPoolExecutor(max_workers=5)
        jobs = {pool.submit(get, root + f"item/{i}.json"): i for i in ids}
        done, _ = wait(jobs, timeout=8)
        pool.shutdown(wait=False, cancel_futures=True)
        rows = []
        for job, ident in jobs.items():
            if job not in done or job.exception():
                continue
            r = job.result()
            if not isinstance(r, dict) or r.get("dead") or r.get("deleted") or r.get("type") not in ("story", "job"):
                continue
            rows.append(item(r.get("title", "HN story"), f"https://news.ycombinator.com/item?id={ident}",
                             {k: r[k] for k in ("id", "title", "url", "by", "time", "score", "descendants", "type") if k in r}))
        return rows
    if source == "producthunt":
        if os.environ.get("PUBLIC_DATA_NONCOMMERCIAL", "1") != "1":
            raise unavailable("Product Hunt's free API is noncommercial only")
        token = credential("PRODUCTHUNT_TOKEN")
        fields = "id name tagline url website votesCount commentsCount createdAt featuredAt"
        if "slug" in a:
            slug = text(a, "slug", r"[a-z0-9][a-z0-9-]{0,150}")
            payload = {"query": "query($slug:String!){post(slug:$slug){" + fields + "}}", "variables": {"slug": slug}}
        else:
            days = a.get("days", 1)
            if type(days) is not int or not 1 <= days <= 30:
                raise unavailable("days must be an integer between 1 and 30")
            after = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            payload = {"query": "query($after:DateTime!){posts(first:5,order:VOTES,postedAfter:$after){nodes{" + fields + "}}}", "variables": {"after": after}}
        result = fetch("https://api.producthunt.com/v2/api/graphql", {"Authorization": "Bearer " + token, "Content-Type": "application/json"}, payload)
        if result.get("errors"):
            raise unavailable("Product Hunt rejected the read query; use web research")
        data = result.get("data") or {}
        rows = [data["post"]] if "slug" in a and data.get("post") else (data.get("posts") or {}).get("nodes", [])
        return [item(r["name"], r["url"], r) for r in rows[:5] if r.get("url")]
    language = text(a, "language", r"[a-z]{2}", default="en")
    if source == "gnews":
        if os.environ.get("PUBLIC_DATA_NONCOMMERCIAL", "1") != "1":
            raise unavailable("GNews free API is noncommercial only")
        params = {"lang": language, "max": 5}
        endpoint = "search" if "query" in a else "top-headlines"
        if "query" in a:
            params.update(q=text(a, "query"), sortby="publishedAt")
        else:
            params["category"] = "general"
        if "country" in a:
            params["country"] = text(a, "country", r"[a-z]{2}")
        url = "https://gnews.io/api/v4/" + endpoint
        result = get(url, {**params, "apikey": credential("GNEWS_API_KEY")})
    else:
        # A key does not grant production rights. Never infer development from a
        # missing NODE_ENV: Render's Python process does not set it by default.
        if os.environ.get("NEWSAPI_LOCAL_DEVELOPMENT") != "1" or any(os.environ.get(k) for k in ("RENDER", "VERCEL", "K_SERVICE")):
            raise unavailable("NewsAPI Developer is development-only; unavailable in deployed Vaelo")
        params = {"q": text(a, "query"), "language": language, "pageSize": 5, "sortBy": "publishedAt"}
        result = get("https://newsapi.org/v2/everything", params, {"X-Api-Key": credential("NEWSAPI_API_KEY")})
    if result.get("errors") or result.get("status") == "error":
        raise unavailable("News provider did not return usable articles")
    return [item(r.get("title", "News article"), r["url"],
                 {k: r[k] for k in ("title", "description", "publishedAt", "source", "author") if k in r})
            for r in result.get("articles", [])[:5] if isinstance(r, dict) and str(r.get("url", "")).startswith("https://")]


def intent(query):
    m = re.fullmatch(r"(?:(?:what(?:'s| is)|show(?: me)?|get)\s+)?(?:(top|new|best|ask|show|job)\s+)?(?:hacker\s*news|HN)(?:\s+(?:stories|headlines|today))?[?.!]?", query, re.I)
    if m:
        return "hackernews", {"feed": (m[1] or "top").lower()}
    m = re.fullmatch(r"(?:(?:show(?: me)?|get|what(?:'s| is))\s+)?(?:today'?s?\s+)?product\s*hunt(?:\s+(?:launches|products|today))?[?.!]?", query, re.I)
    if m:
        return "producthunt", {}
    m = re.fullmatch(r"(?:latest |recent |today'?s? )?(?:news|headlines)(?:\s+(?:about|on|for)\s+(.+?))?[?.!]?", query, re.I)
    if m:
        return "gnews", {"query": m[1]} if m[1] else {}
    return None
