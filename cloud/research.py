"""Cloud research over bounded HTTP requests, without loading provider SDKs.

Search asks every configured index at once and fuses the answers, the way a person would
check two search engines: pages both rank highly come first, no single site crowds out the
rest, and each hit carries a dated, question-focused passage so most answers need no page
reads at all. Reading a page returns the passages that matter to the search that found it
rather than whatever happens to sit in the first ten thousand characters.
"""

import asyncio
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
import ipaddress
import json
import math
import os
import re
import socket
import threading
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from http.client import HTTPConnection, HTTPSConnection
from urllib.request import (
    HTTPHandler,
    HTTPRedirectHandler,
    HTTPSHandler,
    ProxyHandler,
    Request,
    build_opener,
    urlopen,
)

try:
    from agent.web_search_provider import WebSearchProvider
except ModuleNotFoundError as exc:
    # The relay reuses this bounded HTTP client outside the Hermes process.
    if exc.name not in ("agent", "agent.web_search_provider"):
        raise
    WebSearchProvider = object
try:
    from .data_sources import search as data_search, natural_query
except ImportError:
    try:
        from data_sources import search as data_search, natural_query
    except ModuleNotFoundError:
        from cloud.data_sources import search as data_search, natural_query
try:
    from .source_quality import subjects, source_scope, relevant_sources
except ImportError:
    try:
        from source_quality import subjects, source_scope, relevant_sources
    except ModuleNotFoundError:
        from cloud.source_quality import subjects, source_scope, relevant_sources
try:
    from .image_gen import FreeLLMAPIImages
except ImportError:
    try:
        from image_gen import FreeLLMAPIImages
    except ModuleNotFoundError:
        from cloud.image_gen import FreeLLMAPIImages

REQUEST_TIMEOUT = 15
# One page gets this long in all, across every provider tried and the direct read; a socket
# timeout alone only bounds each wait, and a server can trickle bytes just under it.
PAGE_SECONDS = 25
SEARCH_TIMEOUT = 12
# At most four concurrent structured lookups/web races per process, without an
# unbounded executor queue during provider outages. Sockets have their own limits.
_route_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="data-route")
_route_slots = threading.BoundedSemaphore(8)


def route_job(call):
    if not _route_slots.acquire(blocking=False):
        return None
    try:
        job = _route_pool.submit(call)
    except Exception:
        _route_slots.release()
        return None
    job.add_done_callback(lambda _: _route_slots.release())
    return job
RESPONSE_BYTES = 512 * 1024
PAGE_BYTES = 1024 * 1024
PAGE_CHARS = 10000
HEAD_CHARS = 1500
SNIPPET_CHARS = 1500
MAX_URLS = 4
SEARCH_LIMIT = 8
PER_SITE = 2
KEYS = {
    "exa": "EXA_API_KEY",
    "tavily": "TAVILY_API_KEY",
    "firecrawl": "FIRECRAWL_API_KEY",
}
BASES = {
    "exa": "https://api.exa.ai",
    "tavily": "https://api.tavily.com",
    "firecrawl": "https://api.firecrawl.dev/v2",
}
# Indexes searched side by side. Firecrawl's search costs more and is kept as the fallback.
INDEXES = ("exa", "tavily")
# Words that say the person wants what happened recently, not what is generally true.
NEWS = re.compile(
    r"\b(news|headlines?|breaking|today|tonight|yesterday|this (week|morning|evening)|latest (news|updates?))\b",
    re.I,
)
TRACKING = re.compile(r"^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$)")
STOP = frozenset(
    "the and for are but not you all any can had her was one our out has his how its may new now "
    "see two who did get got him let put say she too use what when where which while with will "
    "that this than then them they there these those from have into more most much must only "
    "over some such very your about after again also been being does doing each just like make "
    "many other should their under until upon were would could what's best vs versus between".split()
)


def read_within(response, limit, deadline):
    """Up to ``limit`` bytes of a response, giving up once ``deadline`` (monotonic) passes."""
    chunks, size = [], 0
    while size < limit:
        if time.monotonic() > deadline:
            raise TimeoutError("The page took too long to arrive")
        chunk = response.read1(min(64 * 1024, limit - size))
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
    return b"".join(chunks)


def post(provider, path, payload, timeout=REQUEST_TIMEOUT):
    key = os.environ.get(KEYS[provider], "").strip()
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    headers["x-api-key" if provider == "exa" else "Authorization"] = (
        key if provider == "exa" else "Bearer " + key
    )
    req = Request(
        BASES[provider] + path,
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )
    deadline = time.monotonic() + timeout
    with urlopen(req, timeout=timeout) as response:
        # Bound the download, in size and time, before decoding or parsing it.
        data = read_within(response, RESPONSE_BYTES + 1, deadline)
    if len(data) > RESPONSE_BYTES:
        raise ValueError("Research response exceeded its size limit")
    return json.loads(data)


def configured(name):
    return bool(os.environ.get(KEYS[name], "").strip())


def snippet(row):
    highlights = row.get("highlights")
    if isinstance(highlights, list) and highlights:
        return " … ".join(" ".join(str(part).split()) for part in highlights if part)
    return " ".join(
        str(
            row.get("description") or row.get("content") or row.get("text") or ""
        ).split()
    )


def day(value):
    """'2026-10-14T09:00:00.000Z' or 'Tue, 14 Oct 2026 09:00:00 GMT' -> '2026-10-14';
    anything unreadable is dropped."""
    text = str(value or "").strip()
    match = re.match(r"\d{4}-\d{2}-\d{2}", text)
    if match:
        return match.group(0)
    try:
        return parsedate_to_datetime(text).date().isoformat()
    except (TypeError, ValueError, IndexError):
        return ""


def page_key(url):
    """One page, however it was linked: no scheme, www, fragment, trailing slash or tracking."""
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return url
    host = (parts.hostname or "").lower().removeprefix("www.")
    query = urlencode(
        [(k, v) for k, v in parse_qsl(parts.query) if not TRACKING.match(k.lower())]
    )
    return host + (parts.path.rstrip("/") or "") + ("?" + query if query else "")


def site(url):
    # One malformed link in a result list must not sink the whole search.
    try:
        return (urlsplit(url).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def terms(text):
    return {
        word
        for word in re.findall(r"[a-z0-9][a-z0-9.+#-]{1,}", str(text).lower())
        if word not in STOP and (len(word) > 2 or word.isdigit())
    }


def search_index(name, query, limit):
    """One index's hits as plain rows; raises on any failure so the caller can move on."""
    if name == "exa":
        # Highlights are the passages of each page that answer the query: three short
        # excerpts per hit, enough to answer from without opening the page.
        data = post(
            name,
            "/search",
            {
                "query": query,
                "numResults": limit,
                "contents": {"highlights": {"numSentences": 3, "highlightsPerUrl": 3}},
            },
            timeout=SEARCH_TIMEOUT,
        )
        rows = data.get("results", [])
    elif name == "tavily":
        payload = {"query": query, "max_results": limit, "include_raw_content": False}
        if NEWS.search(query):
            payload.update(topic="news", time_range="week")
        rows = post(name, "/search", payload, timeout=SEARCH_TIMEOUT).get("results", [])
    else:
        data = post(
            name, "/search", {"query": query, "limit": limit}, timeout=SEARCH_TIMEOUT
        ).get("data", {})
        rows = data.get("web", []) if isinstance(data, dict) else data
    hits = []
    for row in rows[:limit]:
        if not isinstance(row, dict) or not str(row.get("url", "")).startswith(
            ("http://", "https://")
        ):
            continue
        hit = {
            "url": row["url"],
            "title": " ".join(str(row.get("title") or "").split())[:300],
            "description": snippet(row)[:SNIPPET_CHARS],
        }
        published = day(
            row.get("publishedDate") or row.get("published_date") or row.get("date")
        )
        if published:
            hit["published"] = published
        hits.append(hit)
    if not hits:
        raise LookupError("no results")
    return hits


def fuse(rankings, limit):
    """Reciprocal-rank fusion: a page ranked well by both indexes beats one ranked first by
    one of them. The richest passage and any date are kept, and each site is held to two
    hits until the list would otherwise come up short."""
    merged = OrderedDict()
    for hits in rankings:
        for rank, hit in enumerate(hits):
            key = page_key(hit["url"])
            entry = merged.setdefault(key, {"hit": dict(hit), "score": 0.0})
            entry["score"] += 1.0 / (60 + rank)
            best = entry["hit"]
            if len(hit.get("description", "")) > len(best.get("description", "")):
                best["description"] = hit["description"]
            if not best.get("title") and hit.get("title"):
                best["title"] = hit["title"]
            if not best.get("published") and hit.get("published"):
                best["published"] = hit["published"]
    ranked = [
        entry["hit"]
        for entry in sorted(merged.values(), key=lambda entry: -entry["score"])
    ]
    picked, spare, per_site = [], [], {}
    for hit in ranked:
        host = site(hit["url"])
        if per_site.get(host, 0) < PER_SITE:
            per_site[host] = per_site.get(host, 0) + 1
            picked.append(hit)
        else:
            spare.append(hit)
    results = (picked + spare)[:limit]
    for position, hit in enumerate(results, 1):
        hit["position"] = position
    return results


def focus(text, query, limit=PAGE_CHARS):
    """Fit a long page into ``limit`` characters around what was asked.

    The opening stays (it names the page and usually defines the subject); the rest of the
    room goes to the paragraphs that share the most words with the query, then to what follows
    each of them (the steps under a matching heading, the table after a matching sentence,
    which rarely repeat the query's words), kept in page order with a marker wherever text was
    skipped. Without a query it keeps the opening and the end, where conclusions and dates
    tend to sit."""
    if len(text) <= limit:
        return text
    blocks = []
    for part in re.split(r"\n\s*\n", text):
        part = part.strip()
        while len(part) > 1200:  # very long paragraphs become several candidates
            cut = part.rfind(". ", 0, 1200) + 1  # end of a sentence, else of a word
            cut = cut if cut > 400 else (part.rfind(" ", 400, 1200) if part.rfind(" ", 400, 1200) > 0 else 1200)
            blocks.append(part[:cut].strip())
            part = part[cut:].strip()
        if part:
            blocks.append(part)
    wanted = terms(query)
    head, used = [], 0
    while len(head) < len(blocks) and used + len(blocks[len(head)]) <= HEAD_CHARS:
        used += len(blocks[len(head)]) + 2
        head.append(len(head))
    if not head:
        head, used = [0], len(blocks[0][:HEAD_CHARS]) + 2
        blocks[0] = blocks[0][:HEAD_CHARS]
    budget = limit - used - 200

    def score(index):
        block = blocks[index].lower()
        found = [term for term in wanted if term in block]
        if not found:
            return 0.0
        hits = sum(min(block.count(term), 4) for term in found)
        number = 0.5 if re.search(r"\d", block) else 0.0
        return (len(found) * 3 + hits + number) / math.sqrt(max(len(block), 200) / 200)

    rest = [index for index in range(len(blocks)) if index not in head]
    scored = sorted(((score(index), index) for index in rest), reverse=True)
    if wanted and scored and scored[0][0] > 0:
        chosen = []
        for value, index in scored:
            if value <= 0:
                break
            if len(blocks[index]) + 2 <= budget:
                chosen.append(index)
                budget -= len(blocks[index]) + 2
        # Room left over goes to what follows each match, the best matches first, one
        # block further on each round, until the room or the page runs out.
        taken = set(head) | set(chosen)
        reach = {index: index for index in chosen}
        growing = True
        while growing and budget > 0:
            growing = False
            for index in chosen:
                after = reach[index] + 1
                if after >= len(blocks) or after in taken:
                    continue
                if len(blocks[after]) + 2 > budget:
                    reach[index] = len(blocks)  # no gaps inside a passage: this one ends here
                    continue
                reach[index] = after
                taken.add(after)
                budget -= len(blocks[after]) + 2
                growing = True
        keep = sorted(taken)
        note = "[Long page: showing its opening and the passages most relevant to the search.]"
    else:
        keep = list(head)
        for index in reversed(rest):
            if len(blocks[index]) + 2 > budget:
                break
            keep.append(index)
            budget -= len(blocks[index]) + 2
        keep.sort()
        note = "[Long page: showing its opening and its end.]"
    out, previous = [note], -1
    for index in keep:
        if index != previous + 1:
            out.append("[…]")
        out.append(blocks[index])
        previous = index
    if previous != len(blocks) - 1:
        out.append("[…]")
    return "\n\n".join(out)[:limit]


NAT64 = (ipaddress.ip_network("64:ff9b::/96"), ipaddress.ip_network("64:ff9b:1::/48"))
TEREDO = ipaddress.ip_network("2001::/32")


def public_ip(text):
    """True for a public address. IPv6 forms that carry an IPv4 address (mapped, NAT64,
    6to4) are judged by the address they carry, since a NAT64 gateway turns
    64:ff9b::7f00:1 into 127.0.0.1 even though ipaddress calls it global."""
    try:
        ip = ipaddress.ip_address(str(text).split("%")[0])
    except ValueError:
        return False
    if ip.version == 6:
        if ip in TEREDO:
            return False
        embedded = ip.ipv4_mapped or ip.sixtofour
        # Deprecated IPv4-compatible (::a.b.c.d) and IPv4-translated (::ffff:0:a.b.c.d)
        # forms carry an IPv4 address too.
        if embedded is None and (int(ip) >> 32) in (0, 0xFFFF0000):
            embedded = ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
        if embedded is None and any(ip in net for net in NAT64):
            embedded = ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
        if embedded is not None:
            return embedded.is_global
    return ip.is_global


def public_host(url):
    """True only when every address the host resolves to is on the public internet."""
    try:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            return False
        infos = socket.getaddrinfo(
            parts.hostname, parts.port or (443 if parts.scheme == "https" else 80)
        )
        return bool(infos) and all(public_ip(info[4][0]) for info in infos)
    except (OSError, ValueError):
        return False


def check_peer(sock):
    """public_host resolved the name once; the connection resolves it again, so a
    rebinding DNS server could answer differently the second time. Judge the address
    actually connected to instead of trusting the earlier lookup."""
    if not public_ip(sock.getpeername()[0]):
        sock.close()
        raise ValueError("Connected to a non-public address")


class PublicHTTPConnection(HTTPConnection):
    def connect(self):
        super().connect()
        check_peer(self.sock)


class PublicHTTPSConnection(HTTPSConnection):
    def connect(self):
        super().connect()
        check_peer(self.sock)


class PublicHTTP(HTTPHandler):
    def http_open(self, req):
        return self.do_open(PublicHTTPConnection, req)


class PublicHTTPS(HTTPSHandler):
    def https_open(self, req):
        return self.do_open(
            PublicHTTPSConnection, req, context=self._context
        )


class PublicRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not public_host(newurl):
            raise ValueError("Redirect left the public internet")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class PageText(HTMLParser):
    """Readable text from HTML: headings, paragraphs and list items, without scripts,
    navigation, footers or other page furniture."""

    SKIP = {
        "script",
        "style",
        "noscript",
        "svg",
        "nav",
        "footer",
        "header",
        "aside",
        "button",
        "iframe",
        "template",
    }
    BLOCK = {
        "p",
        "div",
        "section",
        "article",
        "main",
        "li",
        "br",
        "tr",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "blockquote",
        "pre",
        "table",
        "ul",
        "ol",
        "dd",
        "dt",
    }

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.title, self.skipping, self.in_title = [], "", 0, False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skipping += 1
        elif self.skipping:
            return  # inside navigation or a script: none of its structure is kept either
        elif tag == "title" and not self.title:
            self.in_title = True
        elif tag in self.BLOCK:
            self.parts.append(
                "\n\n"
                + (
                    "#" * int(tag[1]) + " "
                    if tag in ("h1", "h2", "h3")
                    else "- "
                    if tag == "li"
                    else ""
                )
            )

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skipping:
            self.skipping -= 1
        elif self.skipping:
            return
        elif tag == "title":
            self.in_title = False
        elif tag in self.BLOCK:
            self.parts.append("\n\n")

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        elif not self.skipping:
            self.parts.append(data)

    def text(self):
        joined = re.sub(r"[ \t\r\f\v]+", " ", "".join(self.parts))
        return re.sub(
            r"\n\s*\n(\s*\n)+", "\n\n", re.sub(r" *\n *", "\n", joined)
        ).strip()


def fetch_page(url, timeout=REQUEST_TIMEOUT):
    """The last resort when every provider fails: read the page directly, public hosts only."""
    if not public_host(url):
        raise ValueError("Not a public address")
    # No proxies: a proxy would be the peer we check, not the page's host.
    opener = build_opener(
        ProxyHandler({}), PublicHTTP(), PublicHTTPS(), PublicRedirects()
    )
    req = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; VaeloResearch/2.0)",
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.8",
        },
    )
    deadline = time.monotonic() + timeout
    with opener.open(req, timeout=timeout) as response:
        kind = response.headers.get_content_type()
        charset = response.headers.get_content_charset() or "utf-8"
        raw = read_within(response, PAGE_BYTES, deadline)
    if kind not in ("text/html", "application/xhtml+xml", "text/plain"):
        raise ValueError("Not a readable page")
    body = raw.decode(charset, errors="replace")
    if kind == "text/plain":
        return {"title": "", "content": body}
    parser = PageText()
    parser.feed(body)
    parser.close()
    content = parser.text()
    if not re.search(r"\w", content):
        raise LookupError("empty page")  # only furniture: let the caller say it couldn't read it
    return {"title": " ".join(parser.title.split()), "content": content}


class Research(WebSearchProvider):
    name = "jarvis-cloud-research"
    display_name = "Exa + Tavily (fused) / Firecrawl"

    def __init__(self):
        super().__init__()
        # Which search found each page, so reading it later can focus on what was asked.
        self.found_by = OrderedDict()

    def is_available(self):
        # Public API operations remain useful without a paid search-index key.
        return True

    def supports_extract(self):
        return True

    def remember(self, query, hits):
        for hit in hits:
            self.found_by[page_key(hit["url"])] = query
            self.found_by.move_to_end(page_key(hit["url"]))
        while len(self.found_by) > 400:
            self.found_by.popitem(last=False)

    def search(self, query, limit=5):
        limit = max(1, min(int(limit), SEARCH_LIMIT))
        if str(query).startswith("api:"):
            structured = data_search(query)
            # Explicit API arguments must never be forwarded to a search index.
            if structured and structured.get("success") and "data" in structured:
                structured["data"]["web"] = structured["data"]["web"][:limit]
            return structured or {"success": False, "error": "Invalid API query"}
        if not natural_query(query):
            return self.web_search(query, limit)
        # Start the fallback concurrently so an eight-second API timeout never
        # precedes a second, full web-search wait. First usable evidence wins.
        jobs = [job for job in (route_job(lambda: data_search(query)),
                                route_job(lambda: self.web_search(query, limit))) if job is not None]
        deadline = time.monotonic() + SEARCH_TIMEOUT + 3
        pending = set(jobs)
        while pending:
            done, pending = wait(pending, timeout=max(0, deadline - time.monotonic()), return_when=FIRST_COMPLETED)
            if not done:
                break
            for job in done:
                try:
                    result = job.result()
                    if result and result.get("success"):
                        result["data"]["web"] = result["data"]["web"][:limit]
                        return result
                except Exception:
                    pass
        return {"success": False, "error": "No current source available within the research deadline"}

    def web_search(self, query, limit=5):
        names = [name for name in INDEXES if configured(name)]
        rankings, answered = [], []
        if names:
            pool = ThreadPoolExecutor(max_workers=len(names))
            # Each index is asked for a full page of hits whatever the caller wants, so fusion and
            # the per-site cap have spares to choose from; neither index charges more for them.
            jobs = {
                pool.submit(search_index, name, query, SEARCH_LIMIT): name for name in names
            }
            done, _ = wait(jobs, timeout=SEARCH_TIMEOUT + 3)
            pool.shutdown(wait=False, cancel_futures=True)
            for name in names:  # keep a stable order, so ties favour Exa's ranking
                job = next(job for job, owner in jobs.items() if owner == name)
                if job in done and not job.exception():
                    rankings.append(job.result())
                    answered.append(name)
        if not rankings and configured("firecrawl"):
            try:
                rankings.append(search_index("firecrawl", query, SEARCH_LIMIT))
                answered.append("firecrawl")
            except Exception:
                pass
        if not rankings:
            return {
                "success": False,
                "error": "No configured research provider returned results",
            }
        results = relevant_sources(query, fuse(rankings, SEARCH_LIMIT))[:limit]
        if not results:
            return {"success": False, "error": "Search results did not identify the exact requested models. Try separate official specifications queries; do not infer nonexistence."}
        for position, hit in enumerate(results, 1):
            hit["position"] = position
        self.remember(query, results)
        return {
            "success": True,
            "data": {"web": results},
            "provider": "+".join(answered),
        }

    def read(self, name, url, timeout=REQUEST_TIMEOUT):
        if name == "exa":
            # A live crawl only when Exa has no cached copy, so fresh pages still come back.
            data = post(
                name,
                "/contents",
                {
                    "urls": [url],
                    "text": {"maxCharacters": PAGE_CHARS * 3},
                    "livecrawl": "fallback",
                },
                timeout,
            )
            rows = data.get("results", [])
        elif name == "tavily":
            rows = post(
                name,
                "/extract",
                {"urls": [url], "extract_depth": "basic", "format": "text"},
                timeout,
            ).get("results", [])
        elif name == "firecrawl":
            data = post(
                name,
                "/scrape",
                {
                    "url": url,
                    "formats": ["markdown"],
                    "onlyMainContent": True,
                    "timeout": int(max(1, timeout - 1) * 1000),
                },
                timeout,
            )
            rows = [data.get("data", {})] if data.get("success") else []
        else:
            rows = [fetch_page(url, timeout)]
        if not isinstance(rows, list):
            raise LookupError("invalid page results")
        for item in rows:
            if not isinstance(item, dict):
                continue
            # One damaged field/row must not hide another usable page passage.
            content = next((item.get(key) for key in ("text", "raw_content", "content", "markdown")
                            if isinstance(item.get(key), str) and item[key].strip()), None)
            if content is not None:
                metadata = item.get("metadata")
                metadata = metadata if isinstance(metadata, dict) else {}
                title = item.get("title") or metadata.get("title", "")
                published = day(
                    item.get("publishedDate")
                    or metadata.get("publishedTime")
                )
                return str(title), content, published
        raise LookupError("empty page")

    def extract_one(self, url):
        query = self.found_by.get(page_key(url), "")
        deadline = time.monotonic() + PAGE_SECONDS
        for name in [name for name in KEYS if configured(name)] + ["direct"]:
            left = deadline - time.monotonic()
            if left < 2:
                break  # out of time for this page: say so rather than keep the reply waiting
            try:
                title, content, published = self.read(name, url, min(REQUEST_TIMEOUT, left))
            except Exception:
                continue
            scoped = source_scope({"url": url, "title": title, "content": content}, subjects(query))
            if scoped is None:
                return {"url": url, "error": "This page does not identify the exact requested models or compares different models. Use the correct official specifications instead.", "content": ""}
            page = {
                "url": url,
                "title": title[:500],
                "content": focus(content.strip(), query),
                "provider": name,
            }
            if published:
                page["published"] = published
            if "subjects" in scoped:
                page["subjects"] = scoped["subjects"]
                page["evidence_scope"] = scoped["evidence_scope"]
            return page
        return {
            "url": url,
            "error": "Page extraction failed; use another source or the available search results",
            "content": "",
        }

    async def extract(self, urls, **kwargs):
        # Pages are read side by side: each download is capped before it is decoded and each
        # page is cut to PAGE_CHARS before it is kept, so four at once stays a few megabytes,
        # and the wait is the slowest page instead of the sum of all of them.
        unique = list(dict.fromkeys(urls))
        pages = await asyncio.gather(
            *(asyncio.to_thread(self.extract_one, url) for url in unique[:MAX_URLS])
        )
        return list(pages) + [
            {"url": url, "error": "Extract up to four pages per call", "content": ""}
            for url in unique[MAX_URLS:]
        ]


def register(ctx):
    ctx.register_web_search_provider(Research())
    from .calculation import SCHEMA as CALC_SCHEMA, DATE_SCHEMA, calculate, date_difference
    ctx.register_tool(name='calculate',toolset='web',schema=CALC_SCHEMA,handler=calculate,
                      description='Bounded deterministic decimal arithmetic')
    ctx.register_tool(name='date_difference',toolset='web',schema=DATE_SCHEMA,handler=date_difference,
                      description='Timezone-aware calendar and elapsed-time differences')
    from .verification import SCHEMA as VERIFY_SCHEMA, JS_SCHEMA, verification_tool, javascript_tool
    ctx.register_tool(name='javascript_verify',toolset='web',schema=JS_SCHEMA,handler=javascript_tool,
                      description='Isolated JavaScript implementation and assertion tests')
    ctx.register_tool(name="python_verify", toolset="web", schema=VERIFY_SCHEMA,
                      handler=verification_tool, description="Isolated Python code and assertion tests")
    from .weather import SCHEMA, weather_tool
    ctx.register_tool(name="weather_forecast", toolset="web", schema=SCHEMA,
                      handler=weather_tool, description="Verified local weather and forecast dates")
    # Older Hermes builds have no image backends; research must still load there.
    if hasattr(ctx, "register_image_gen_provider"):
        ctx.register_image_gen_provider(FreeLLMAPIImages())
