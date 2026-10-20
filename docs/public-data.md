# Public data in Vaelo

Vaelo's cloud research backend exposes 33 focused, read-only data adapters through
the existing web-search tool. It keeps Exa/Tavily/Firecrawl for broad research,
news, recommendations and gaps in structured data. No new model provider, model
classification request, browser dependency or vendor SDK is added.

The pasted public API directory is a discovery list, not a single free service or
a verified entitlement. Its HTTPS/authentication labels are not authoritative.
This integration selects useful data capabilities rather than adding duplicate
gateways, random test data, placeholder images or services that repeat the model's
writing/translation functions. Personal-account actions, bookings, payments,
messages, uploads and paid media generation are outside these read-only adapters.
Other entries in the directory have not all received individual integrations or
live validation; this is not a claim that all 1,824 entries were implemented.

## Coverage and validation

On October 19, 2026, the explicit smoke check retrieved records from all 27
enabled adapters. Six optional adapters have schema/credential-gate tests but
have not been verified live with the deployment's credentials. This is local
HTTP evidence, not proof of a Render deployment or a completed model chat.

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
| stocks | Alpha Vantage dated stock quote | Needs ALPHA_VANTAGE_API_KEY |
| crypto | CoinGecko price and last-update timestamp | Needs COINGECKO_API_KEY (Demo API) |
| movies | TMDB movie metadata | Needs TMDB_READ_TOKEN |
| space | NASA APOD metadata, date and copyright | Needs NASA_API_KEY |
| music | MusicBrainz artist discovery | Needs MUSICBRAINZ_ENABLED=1 after reviewing terms |

REST Countries' old v3.1 endpoint redirected during validation; the adapter uses
the documented authenticated v5 API instead. No shared demo credential is used.

Provider documentation and qualifications are maintained in
`cloud/data_sources.py` and returned by the tool's catalog operation.

## How it reaches answers

The cloud SOUL tells the full agent how to use the actual web-search tool:

```text
api:catalog {}
api:currency {"base":"USD","quote":"INR"}
api:books {"query":"Dune Frank Herbert"}
api:papers {"query":"battery recycling"}
api:weather {"location":"Chicago, Illinois"}
api:airquality {"location":"London, UK"}
api:usalerts {"latitude":41.88,"longitude":-87.63}
api:usobservation {"station":"KORD"}
api:worldbank {"country":"US","indicator":"SP.POP.TOTL"}
```

These strings are internal tool arguments; people ask ordinary questions in chat.
Exact currency pairs, definitions, book/paper searches, package names, VINs,
barcodes and simple city weather/AQI requests also route deterministically before
generation. More complex requests use the agent's existing tool-selection turn.
This adds no separate classifier/model request. It does not guarantee that a
tool-using conversation has the same total number of model calls as a direct
answer without tools.

Structured evidence retains JSON boundaries, dates, units, source links and
retrieval timestamps. It bypasses product-name relevance heuristics that could
otherwise reject package identifiers. Existing web relevance checks remain in
place for general search. Explicit API failures never forward their structured
arguments to general search; failed ordinary lookups can fall back to web search.
Offline instructions, supplied conversion rates and text transformations retain
their existing behavior.

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
