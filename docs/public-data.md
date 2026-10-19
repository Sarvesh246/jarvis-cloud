# Public data in Vaelo

Vaelo's cloud research backend exposes 227 bounded, read-only operations through
the existing web-search tool. It keeps Exa/Tavily/Firecrawl for broad research,
recommendations, current news and gaps in structured data. No new model provider, model
classification request, browser dependency or vendor SDK is added.

The pasted public API directory is a discovery list, not a single free service or
a verified entitlement. Its HTTPS/authentication labels are not authoritative.
This integration selects useful data capabilities rather than adding duplicate
gateways, random test data, placeholder images or services that repeat the model's
writing/translation functions. Personal-account actions, bookings, payments,
messages, uploads and paid media generation are outside these read-only adapters.
The full shortlist is tracked in [the coverage ledger](api-coverage.md). It contains
517 shortlisted entries plus Hacker News, Product Hunt and NewsAPI. GNews was
already shortlisted, giving 520 distinct directory entries. Read adapters cover
220 directory entries plus PyPI; several operations share one provider.
**This is not 517 or 522 active API integrations.** Pending contracts and per-user
account connections remain unfinished and are explicitly labeled.

## Coverage and validation

On October 19, 2026, an explicit live pass returned usable final tool records from
136 declarative operations. Failed and unconfigured sources remain visible in the
coverage ledger. The original 27 public operations were checked earlier. Hacker
News, GNews and Product Hunt each returned five records using the supplied keys.
Credentialed operations have offline schema/gate tests; most keys were not supplied. This is local
HTTP evidence, not proof of a Render deployment or a completed model chat.

The core operations are below. Another 191 fixed-host read operations are defined
in `cloud/api_operations.json` and executed by `cloud/extended_sources.py`; four
news adapters are in `cloud/news_sources.py`. The coverage ledger lists every
provider and remaining requirement. This table is not the full operation catalog.

| Tool source | Provider / useful data | State |
| --- | --- | --- |
| currency | Frankfurter daily/historical reference exchange rates | Live checked |
| holidays | Nager.Date public holidays, including regional applicability | Live checked |
| dictionary | Free Dictionary English definitions/pronunciation | Live checked |
| books | Open Library book/author/publication metadata | Live checked |
| papers | Crossref scholarly metadata and DOI links | Live checked |
| github | GitHub public repository discovery | Live checked |
| npm | npm latest package version, requirements and license metadata | Live checked |
| pypi | PyPI package version, Python requirements and project links | Live checked |
| stackoverflow | Stack Exchange relevant question discovery | Live checked |
| wikipedia | MediaWiki encyclopedia page discovery | Live checked |
| wikidata | Wikidata entity disambiguation | Live checked |
| food | Open Food Facts barcode nutrition, ingredients and allergens | Live checked |
| earthquakes | USGS earthquake events, magnitude, location and timestamps | Live checked |
| vin | NHTSA VIN vehicle specifications and decode errors | Live checked |
| recalls | NHTSA US recalls by make/model/year | Live checked |
| species | GBIF species taxonomy | Live checked |
| tv | TVmaze show metadata and schedules | Live checked |
| art | Art Institute of Chicago collection and rights metadata | Live checked |
| worldbank | World Bank dated economic/demographic indicators | Live checked |
| weather | NWS for covered US coordinates; Open-Meteo fallback/global forecast | Live checked |
| airquality | Open-Meteo/CAMS modeled AQI and pollutants with units | Live checked |
| geocode | Open-Meteo/GeoNames city coordinates, region and country | Live checked |
| usweather | NWS seven-day forecast periods, units and issuance times | Live checked |
| usalerts | NWS active alerts, expiration times and instructions | Live checked |
| usobservation | NWS latest station observations and units | Live checked |
| transit | Swiss public transport connections | Live checked |
| aviation | NOAA aviation METAR observations | Live checked |
| country | REST Countries v5 geography/demographics | Needs REST_COUNTRIES_API_KEY |
| crypto | CoinGecko price and last-update timestamp | Needs COINGECKO_API_KEY (Demo API) |
| movies | TMDB movie metadata | Needs TMDB_READ_TOKEN |
| space | NASA APOD metadata, date and copyright | Needs NASA_API_KEY |
| music | MusicBrainz artist discovery | Needs MUSICBRAINZ_ENABLED=1 after reviewing terms |

REST Countries' old v3.1 endpoint redirected during validation; the adapter uses
the documented authenticated v5 API instead. No shared demo credential is used.

Provider documentation and qualifications are maintained in
`cloud/data_sources.py`, `cloud/api_operations.json` and `cloud/news_sources.py`.
The paginated catalog returns implemented operations; the separate directory
includes unfinished entries with their exact statuses. A directory listing is
coverage metadata, not evidence for factual answers.

## How it reaches answers

The cloud SOUL tells the full agent how to use the actual web-search tool:

```text
api:catalog {"query":"weather"}
api:currency {"base":"USD","quote":"INR"}
api:books {"query":"Dune Frank Herbert"}
api:papers {"query":"battery recycling"}
api:weather {"location":"Chicago, Illinois"}
api:airquality {"location":"London, UK"}
api:usalerts {"latitude":41.88,"longitude":-87.63}
api:usobservation {"station":"KORD"}
api:worldbank {"country":"US","indicator":"SP.POP.TOTL"}
```

Additional examples:

```text
api:directory {"query":"transport"}
api:directory {"id":81}
api:catalog {"query":"manga"}
api:mangadex {"query":"One Piece"}
api:hackernews {"feed":"top"}
api:producthunt {"days":1}
api:gnews {"query":"space exploration","language":"en"}
```

Directory pages contain five entries; catalog pages contain 12 and accept an
offset. Missing keys, pending contracts and user connections are unavailable.
Only listed callable operations have read adapters. The bootstrap installs all
modules and JSON contracts in the Hermes plugin.

These strings are internal tool arguments; people ask ordinary questions in chat.
Exact currency pairs, definitions, book/paper searches, package names, VINs,
barcodes and simple city weather/AQI requests also route deterministically before
generation. More complex requests use the agent's existing tool-selection turn.
Hacker News, Product Hunt, Pokemon and explicit searches on named supported
providers also route deterministically. Short Hacker News and Product Hunt feed requests also use the existing fast
summary route after retrieval, respecting research and thorough modes. This adds
no separate classifier/model request. It does not guarantee that a
tool-using conversation has the same total number of model calls as a direct
answer without tools.

Structured evidence retains JSON boundaries, dates, units, source links and
retrieval timestamps. It bypasses product-name relevance heuristics that could
otherwise reject package identifiers. Existing web relevance checks remain in
place for general search. Explicit API failures never forward their structured
arguments to general search; failed ordinary lookups can fall back to web search.
Automatically recognized API and web retrieval start concurrently. First usable
evidence wins within a bounded research deadline; there is no serial API-timeout
penalty before web fallback begins. The worker pool and queue are bounded.
**Network retrieval still adds latency.** Original download timestamps survive
cache hits. Automatic current evidence checks actual observation/publication
ages, including modeled weather UTC offsets. Stale or undated observations use
web research; historical records remain dated. A dataset catalog edit time is
not a measurement date. Dataset discovery metadata is not a statistical answer.

Offline instructions, supplied conversion rates and text transformations retain
their existing behavior.

## News configuration and limits

Hacker News uses its official public API. Product Hunt uses only fixed public
GraphQL read queries and requires `PRODUCTHUNT_TOKEN`. Its API secret is not
needed. Product Hunt and GNews are gated to noncommercial use. GNews requires
`GNEWS_API_KEY`; its free feed delays articles by 12 hours. Automatic current-news
requests use web research instead of spending quota on known-delayed articles.
Explicit reads preserve original publisher links and publication dates.

NewsAPI Developer is local-development only, including for nonprofit apps. It
requires `NEWSAPI_LOCAL_DEVELOPMENT=1`; a Render/Vercel/cloud environment blocks
the Developer route regardless of that switch. No paid entitlement is assumed
from a key alone and no production subscription is purchased.

Configure production secrets in Render environment variables. `render.yaml`
declares GNews and Product Hunt as unsynced secrets; a Git push does not upload
ignored local keys. Local HTTP tests do not prove production configuration.
GNews and NewsAPI are conservatively capped at 45 requests/day per process,
allowing for the existing relay/Hermes pair; Guardian is capped at 200. Counters
are ephemeral and provider quotas remain authoritative.

## Weather configuration and attribution

Vaelo is currently noncommercial. `OPEN_METEO_NONCOMMERCIAL=1` is set in the
Render blueprint and is the runtime default. Free weather/air quality works
without a paid key. This is based on the stated current use, not solely on whether
users pay. If the app becomes commercial, set this to `0` and configure
`OPEN_METEO_API_KEY`; customer hosts are selected automatically. NWS remains free.

- [Open-Meteo terms](https://open-meteo.com/en/terms)
- [Open-Meteo weather documentation](https://open-meteo.com/en/docs)
- [Open-Meteo/CAMS air-quality attribution](https://open-meteo.com/en/docs/air-quality-api)
- [Open-Meteo/GeoNames geocoding](https://open-meteo.com/en/docs/geocoding-api)
- [National Weather Service API](https://www.weather.gov/documentation/services-web-api)

US weather resolves the current NWS office/grid from `/points` and constructs the
forecast path from validated identifiers. It never follows an arbitrary URL from
the provider response. NWS alerts use the nonredirecting `/alerts?active=true`
endpoint. Point-specific empty alerts are valid evidence only for that location
and retrieval time. Fetch alerts separately when warnings are relevant; forecasts
are not current observations. Use station observations/METAR for current readings.
NWS observations can be delayed; preserve their actual timestamp and null values.

City weather selects the first geocoding match and returns its city/region/country
explicitly; Vaelo must state the assumed location and clarify ambiguity when it
matters. Coordinates supplied by the person take precedence. Coordinates outside
NWS coverage and NWS failures fall back to Open-Meteo. An explicit `usweather`
operation reports its own failure instead of pretending another provider is NWS.

Answers retain provider attribution. In particular: Open-Meteo and CAMS for modeled
air quality, GeoNames for geocoding, Open Food Facts (ODbL), TVmaze (CC BY-SA),
CoinGecko and TMDB. Collection/image rights are returned as data, not inferred
from API availability. Paper metadata is not a verified scientific conclusion;
food data is crowdsourced and cannot establish allergy safety from a missing field.

## Resource and privacy limits

Requests use fixed HTTPS providers and allowlisted parameters. Query values are
encoded; path identifiers and coordinates are validated. Connections reject
nonpublic peers, redirects are disabled, proxy environment variables are ignored,
downloads and gzip expansion are bounded to 512 KiB, and each HTTP request has an
eight-second timeout/deadline. Large provider responses fail safely rather than
being parsed without bounds. Multi-request weather lookups can take longer than
one HTTP timeout.

Successful records are cached in a bounded 128-entry process-local cache for five
minutes; NWS alerts/observations use one minute. Results retain their original
retrieval time. Provider calls have a per-source cooldown, Stack Exchange backoff
is honored, and HTTP 429/503 responses honor bounded Retry-After seconds. Failures
never expose raw provider bodies, exception strings or credential-bearing URLs.

Open-Meteo additionally has conservative process-local budgets of 100 calls/minute,
3,000/day and 90,000/month. These allow for the existing relay/Hermes pair. Counters
are ephemeral, so restarts reset them; they are not a durable quota ledger. Before
horizontal scaling, share the cache/budgets across replicas. The provider can
still enforce stricter limits. No account creation, paid subscription or billing
change is part of this integration.

Only public lookup terms requested by the person belong in tool parameters.
Attachments, Workroom documents, credentials and private chat history must not be
sent to these APIs. Existing request extraction keeps attachments out of automatic
retrieval. Public responses are untrusted evidence and cannot authorize actions.

## Verification and prompts

```powershell
python -m unittest discover -s tests -q
python tests/live_data_sources.py
# Deliberate broader checks (some sources require keys or are unavailable):
python tests/live_data_sources.py --extended
python tests/live_data_sources.py --configured-news
cd web
node --test --test-concurrency=1 tests/*.test.js
npm run build
```

The live smoke script is explicit and makes public data HTTP requests without
model generation. Ordinary unit tests never require API keys or live APIs.
Credentialed adapters have mocked schema/credential tests; enable and live-check
them only with the appropriate configured keys and usage rights.

In a signed-in chat, try:

- “What's the weather in Chicago today?” — resolved city and NWS forecast.
- “Air quality in London, UK” — timestamp, AQI scale, pollutant units, attribution.
- “Are there active NWS alerts at 41.88, -87.63?” — point-specific warnings/expiry.
- “What are current conditions at KORD?” — actual observation time, not forecast.
- “100 USD to INR” — dated reference rate and calculated conversion.
- “Find research papers on battery recycling” — DOI links and publication metadata.
- “Find books about astronomy” — retrieved book and author metadata.
- “npm package react” — retrieved package version and requirements.
- “Food barcode 3017620422003” — retrieved label data with crowdsource qualification.
- “Find Swiss train connections from Bern to Zurich” — public schedules, no booking.
- “Don't browse; convert 100 USD to INR using a rate of 83” — no data lookup.

Full-agent source choice and final prose still need post-deployment chat checks.
Guest direct answers can consume automatic evidence but do not gain Hermes tools.
