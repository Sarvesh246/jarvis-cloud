"""Read-only public data lookups used by the existing cloud web-search tool.

Only fixed providers and parameters are accepted. No SDKs, arbitrary URLs, account
access, model planning calls or API keys from tool arguments.
"""
from collections import OrderedDict, deque
from datetime import datetime, timezone
from http.client import HTTPSConnection
import ipaddress
import gzip
import io
import json
import math
import os
import re
import threading
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener


MAX_BYTES = 512 * 1024
TIMEOUT = 8
USER_AGENT = "Vaelo/1.0 (https://vaelo.app; public-data research)"

# source: description, accepted parameter names, documentation, usage qualification
CATALOG = {
    "currency": ("Daily reference exchange rates", "base quote date", "https://frankfurter.dev/", "Reference rates, not bank or trading quotes."),
    "country": ("Country geography and demographics", "name", "https://restcountries.com/docs/countries", "Requires REST_COUNTRIES_API_KEY; population figures may lag; not visa advice."),
    "holidays": ("Public holidays", "country year", "https://date.nager.at/Api", "Country ISO code required; regional applicability is in counties/global."),
    "dictionary": ("English definitions and pronunciation", "word", "https://dictionaryapi.dev/", "English entries only."),
    "books": ("Open Library books and authors", "query", "https://openlibrary.org/dev/docs/api/search", "Catalog metadata, not full book text."),
    "papers": ("Crossref scholarly works and DOI metadata", "query", "https://www.crossref.org/documentation/retrieve-metadata/rest-api/", "Metadata is not evidence that a paper's conclusion is true."),
    "github": ("Public repositories", "query", "https://docs.github.com/en/rest/search/search", "Public data only; unauthenticated quota applies."),
    "npm": ("npm package metadata", "package", "https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md", "No package installation or code execution."),
    "pypi": ("Python package metadata", "package", "https://docs.pypi.org/api/json/", "No package installation or code execution."),
    "stackoverflow": ("Stack Overflow question search", "query", "https://api.stackexchange.com/docs/advanced-search", "Answers are community content; check versions and dates."),
    "wikipedia": ("Encyclopedia page discovery", "query", "https://www.mediawiki.org/wiki/API:Search", "Secondary source; snippets are not full articles."),
    "wikidata": ("Entity identification", "query", "https://www.wikidata.org/w/api.php?action=help&modules=wbsearchentities", "Entity matches are not verification of every fact."),
    "food": ("Open Food Facts barcode nutrition and allergens", "barcode", "https://openfoodfacts.github.io/openfoodfacts-server/api/", "Crowdsourced; verify the actual label for allergies."),
    "earthquakes": ("USGS earthquake events", "start end magnitude", "https://earthquake.usgs.gov/fdsnws/event/1/", "Catalog events, not predictions; default is the latest 5 events."),
    "vin": ("NHTSA vehicle VIN decoding", "vin", "https://vpic.nhtsa.dot.gov/api/", "Vehicle specifications, not ownership or history."),
    "recalls": ("NHTSA US vehicle recalls", "make model year", "https://www.nhtsa.gov/nhtsa-datasets-and-apis", "US recalls by model year; not a VIN-specific recall clearance."),
    "species": ("GBIF species taxonomy", "query", "https://techdocs.gbif.org/en/openapi/v1/species", "Taxonomic matches, not identification of an unseen specimen."),
    "tv": ("TVmaze show metadata", "query", "https://www.tvmaze.com/api", "CC BY-SA attribution; not regional streaming availability."),
    "art": ("Art Institute of Chicago collection", "query", "https://api.artic.edu/docs/", "Retain public-domain and copyright fields; metadata access does not license every image."),
    "worldbank": ("World Bank economic and demographic indicators", "country indicator", "https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation", "Keep observation years, units and nulls; not live statistics."),
    "weather": ("Weather forecasts; NWS preferred for US locations", "latitude longitude location", "https://open-meteo.com/en/docs", "Noncommercial Open-Meteo enabled; US forecasts prefer NWS. State resolved location and preserve units/times."),
    "airquality": ("Open-Meteo modeled air quality", "latitude longitude location", "https://open-meteo.com/en/docs/air-quality-api", "Noncommercial use enabled; model values are not a local sensor reading. Attribute CAMS/Open-Meteo."),
    "geocode": ("Open-Meteo/GeoNames city coordinates", "location", "https://open-meteo.com/en/docs/geocoding-api", "Multiple matching places may exist; state the selected city, region and country."),
    "usweather": ("National Weather Service US forecasts", "latitude longitude", "https://www.weather.gov/documentation/services-web-api", "Free US forecasts; retain generatedAt, periods, local offsets and temperature units. Not current observations."),
    "usalerts": ("National Weather Service active US alerts", "latitude longitude", "https://www.weather.gov/documentation/services-web-api", "Free US active alerts; retain sent, effective, expires and instructions. An empty response is point-specific and time-specific."),
    "usobservation": ("National Weather Service latest station observations", "station", "https://www.weather.gov/documentation/services-web-api", "Station observations may be delayed. Preserve observation timestamp, nulls and quantitative unit codes."),
    "music": ("MusicBrainz artist discovery", "query", "https://musicbrainz.org/doc/MusicBrainz_API", "Requires MUSICBRAINZ_ENABLED=1 after reviewing commercial terms; metadata only."),
    "stocks": ("Alpha Vantage stock quotes", "symbol", "https://www.alphavantage.co/documentation/", "Requires ALPHA_VANTAGE_API_KEY; quote date may be delayed. No real-time entitlement requested."),
    "crypto": ("CoinGecko coin prices", "coin currency", "https://docs.coingecko.com/reference/simple-price", "Requires COINGECKO_API_KEY (Demo API); retain last_updated_at; attribute CoinGecko."),
    "movies": ("TMDB movie search", "query", "https://developer.themoviedb.org/reference/search-movie", "Requires TMDB_READ_TOKEN; attribute TMDB. Not regional streaming availability."),
    "space": ("NASA astronomy picture metadata", "date", "https://api.nasa.gov/", "Requires NASA_API_KEY; image copyright can differ from NASA metadata."),
    "transit": ("Swiss public transport connections", "from to", "https://transport.opendata.ch/docs.html", "Switzerland only; schedules can change; not a booking."),
    "aviation": ("NOAA aviation METAR observations", "station", "https://aviationweather.gov/data/api/", "ICAO station code; observations, not flight status or an aviation briefing."),
}


class Invalid(ValueError):
    pass


class Unavailable(ValueError):
    pass


def credential(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise Unavailable(f"This source requires {name} in the server environment")
    return value


def meteo_config():
    key = os.environ.get("OPEN_METEO_API_KEY", "").strip()
    if not key and os.environ.get("OPEN_METEO_NONCOMMERCIAL", "1") != "1":
        raise Unavailable("Open-Meteo requires a commercial API key or noncommercial configuration")
    return key


def geocode(location):
    key = meteo_config()
    params = {"name": location, "count": 3, "language": "en", "format": "json"}
    if key:
        params["apikey"] = key
    host = "customer-geocoding-api" if key else "geocoding-api"
    return get(f"https://{host}.open-meteo.com/v1/search", params).get("results", [])


def text(args, name, pattern=None, default=None):
    value = args.get(name, default)
    if not isinstance(value, str) or not value.strip() or len(value) > 240:
        raise Invalid(f"Provide {name} as a nonempty string of at most 240 characters")
    value = value.strip()
    if any(ord(c) < 32 for c in value) or (pattern and not re.fullmatch(pattern, value)):
        raise Invalid(f"Invalid {name}")
    return value


def date(args, name):
    value = text(args, name, r"\d{4}-\d{2}-\d{2}")
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise Invalid(f"Invalid {name}") from None
    return value


def number(args, name, lo, hi):
    value = args.get(name)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lo <= value <= hi:
        raise Invalid(f"{name} must be between {lo} and {hi}")
    return value


def select(row, fields):
    return {key: row[key] for key in fields.split() if key in row}


def item(title, url, data):
    return {"title": str(title)[:300], "url": url, "data": data}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Unavailable("Provider redirected the request")


class PublicConnection(HTTPSConnection):
    def connect(self):
        super().connect()
        address = ipaddress.ip_address(self.sock.getpeername()[0])
        embedded = getattr(address, "ipv4_mapped", None)
        if not (embedded or address).is_global:
            self.close()
            raise Unavailable("Non-public provider connection")


class PublicHTTPS(HTTPSHandler):
    def https_open(self, req):
        return self.do_open(PublicConnection, req, context=self._context)


def fetch(url, headers=None):
    # URLs are constructed only inside adapters. Never accept one from a query.
    if (urlsplit(url).hostname or "").endswith(".open-meteo.com"):
        meteo_budget()
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json", "Accept-Encoding": "identity", **(headers or {})})
    deadline = time.monotonic() + TIMEOUT
    opener = build_opener(ProxyHandler({}), PublicHTTPS(), NoRedirect())
    with opener.open(req, timeout=TIMEOUT) as response:
        chunks, size = [], 0
        while size <= MAX_BYTES:
            if time.monotonic() >= deadline:
                raise TimeoutError()
            chunk = response.read1(min(65536, MAX_BYTES + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
        if size > MAX_BYTES:
            raise Unavailable("Provider response exceeded size limit")
        encoding = response.headers.get("Content-Encoding", "").lower()
    payload = b"".join(chunks)
    if encoding == "gzip" or payload.startswith(b"\x1f\x8b"):
        with gzip.GzipFile(fileobj=io.BytesIO(payload)) as compressed:
            payload = compressed.read(MAX_BYTES + 1)
        if len(payload) > MAX_BYTES:
            raise Unavailable("Decompressed provider response exceeded size limit")
    return json.loads(payload)


def get(base, params=None, headers=None):
    return fetch(base + ("?" + urlencode(params) if params else ""), headers)


def adapter(source, a):
    """Return up to five citation-bearing records, preserving provider units/dates."""
    if source == "currency":
        base, target = (text(a, k, r"[A-Za-z]{3}").upper() for k in ("base", "quote"))
        url = f"https://api.frankfurter.dev/v2/rate/{base}/{target}"
        data = get(url, {"date": date(a, "date")} if "date" in a else None)
        return [item(f"{base}/{target} reference rate", url, data)]
    if source == "country":
        key = credential("REST_COUNTRIES_API_KEY")
        url = "https://api.restcountries.com/countries/v5"
        params = {"q": text(a, "name"), "limit": 5, "response_fields": "names.common,codes,capitals,region,subregion,population,area,currencies,languages,timezones"}
        data = get(url, params, {"Authorization": "Bearer " + key})
        return [item(r["names"]["common"], url + "?" + urlencode(params), r) for r in data["data"]["objects"][:5]]
    if source == "holidays":
        country = text(a, "country", r"[A-Za-z]{2}").upper()
        year = text(a, "year", r"20\d{2}")
        url = f"https://date.nager.at/api/v3/PublicHolidays/{year}/{country}"
        rows = get(url)
        return [item(f"{country} public holidays {year}", url, {"holidays": rows[:40], "total": len(rows), "limit": 40})]
    if source == "dictionary":
        word = text(a, "word", r"[A-Za-z][A-Za-z'-]{0,79}")
        url = "https://api.dictionaryapi.dev/api/v2/entries/en/" + quote(word, safe="")
        return [item(word, url, r) for r in get(url)[:3]]
    if source == "books":
        data = get("https://openlibrary.org/search.json", {"q": text(a, "query"), "limit": 5,
            "fields": "key,title,author_name,first_publish_year,isbn"})
        return [item(r.get("title", "Book"), "https://openlibrary.org" + r["key"], r) for r in data["docs"][:5]]
    if source == "papers":
        data = get("https://api.crossref.org/works", {"query.bibliographic": text(a, "query"), "rows": 5,
            "select": "DOI,title,author,published,URL,type,is-referenced-by-count"})
        return [item("; ".join(r.get("title", [])), "https://doi.org/" + quote(r["DOI"], safe="/"), r) for r in data["message"]["items"][:5]]
    if source == "github":
        data = get("https://api.github.com/search/repositories", {"q": text(a, "query"), "per_page": 5})
        return [item(r["full_name"], r["html_url"], select(r, "full_name description language stargazers_count updated_at archived license")) for r in data["items"][:5]]
    if source in ("npm", "pypi"):
        package = text(a, "package", r"(?:@[a-zA-Z0-9_.-]+/)?[a-zA-Z0-9_.-]+")
        if source == "npm":
            # Abbreviated version endpoint avoids downloading a package's entire version history.
            data = get("https://registry.npmjs.org/" + quote(package, safe="") + "/latest")
            return [item(package, "https://www.npmjs.com/package/" + quote(package, safe="/@"), select(data, "name version description license homepage engines repository"))]
        data = get("https://pypi.org/pypi/" + quote(package, safe="") + "/json")
        return [item(package, "https://pypi.org/project/" + quote(package, safe="") + "/", select(data["info"], "name version summary requires_python license project_urls"))]
    if source == "stackoverflow":
        data = get("https://api.stackexchange.com/2.3/search/advanced", {"q": text(a, "query"), "site": "stackoverflow", "pagesize": 5, "sort": "relevance"})
        # A provider backoff applies even when the request itself succeeds.
        if data.get("backoff"):
            with _lock:
                _next[source] = time.monotonic() + max(1, min(int(data["backoff"]), 3600))
        return [item(r["title"], r["link"], select(r, "title tags score is_answered creation_date last_activity_date question_id")) for r in data["items"][:5]]
    if source in ("wikipedia", "wikidata"):
        q = text(a, "query")
        if source == "wikipedia":
            data = get("https://en.wikipedia.org/w/api.php", {"action": "query", "list": "search", "srsearch": q, "srlimit": 5, "format": "json"})
            return [item(r["title"], "https://en.wikipedia.org/?curid=" + str(r["pageid"]), select(r, "title snippet timestamp")) for r in data["query"]["search"][:5]]
        data = get("https://www.wikidata.org/w/api.php", {"action": "wbsearchentities", "search": q, "language": "en", "limit": 5, "format": "json"})
        return [item(r.get("label", r["id"]), "https://www.wikidata.org/wiki/" + r["id"], select(r, "id label description")) for r in data["search"][:5]]
    if source == "food":
        barcode = text(a, "barcode", r"\d{8,14}")
        data = get("https://world.openfoodfacts.org/api/v2/product/" + barcode, {"fields": "product_name,brands,nutriments,allergens_tags,ingredients_text,nutrition_grades,serving_size,quantity,last_modified_t"})
        return [item(data["product"].get("product_name", barcode), "https://world.openfoodfacts.org/product/" + barcode, data["product"])] if data.get("status") == 1 else []
    if source == "earthquakes":
        params = {"format": "geojson", "limit": 5, "orderby": "time", "minmagnitude": number(a, "magnitude", 0, 10) if "magnitude" in a else 4.5}
        for key in ("start", "end"):
            if key in a:
                params[key + "time"] = date(a, key)
        if "starttime" in params and "endtime" in params and params["starttime"] > params["endtime"]:
            raise Invalid("start must not follow end")
        data = get("https://earthquake.usgs.gov/fdsnws/event/1/query", params)
        return [item(r["properties"]["title"], r["properties"]["url"], {**select(r["properties"], "mag place time updated tsunami status"), "geometry": r["geometry"]}) for r in data["features"][:5]]
    if source == "vin":
        vin = text(a, "vin", r"[A-HJ-NPR-Za-hj-npr-z0-9]{17}").upper()
        url = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/" + vin
        return [item("VIN " + vin, url + "?format=json", select(r, "VIN ErrorCode ErrorText Make Model ModelYear Manufacturer VehicleType BodyClass FuelTypePrimary FuelTypeSecondary EngineCylinders DisplacementL ElectrificationLevel DriveType PlantCountry")) for r in get(url, {"format": "json"})["Results"][:1]]
    if source == "recalls":
        params = {k: text(a, k) for k in ("make", "model")}
        params["modelYear"] = text(a, "year", r"(?:19|20)\d{2}")
        url = "https://api.nhtsa.gov/recalls/recallsByVehicle"
        data = get(url, params)
        return [item("NHTSA vehicle recalls", url + "?" + urlencode(params), {"count": data["Count"], "results": data["results"][:5], "results_limit": 5})]
    if source == "species":
        data = get("https://api.gbif.org/v1/species/search", {"q": text(a, "query"), "limit": 5})
        return [item(r.get("scientificName", "Species"), "https://www.gbif.org/species/" + str(r["key"]), select(r, "key scientificName canonicalName rank kingdom phylum class order family genus taxonomicStatus")) for r in data["results"][:5]]
    if source == "tv":
        data = get("https://api.tvmaze.com/search/shows", {"q": text(a, "query")})
        return [item(r["show"]["name"], r["show"]["url"], select(r["show"], "name genres status premiered ended schedule rating summary network webChannel")) for r in data[:5]]
    if source == "art":
        data = get("https://api.artic.edu/api/v1/artworks/search", {"q": text(a, "query"), "limit": 5,
            "fields": "id,title,artist_display,date_display,medium_display,is_public_domain,copyright_notice"})
        return [item(r["title"], "https://www.artic.edu/artworks/" + str(r["id"]), r) for r in data["data"][:5]]
    if source == "worldbank":
        country = text(a, "country", r"[A-Za-z]{2,3}")
        indicator = text(a, "indicator", r"[A-Z0-9_.]{3,80}")
        url = f"https://api.worldbank.org/v2/country/{country}/indicator/{indicator}"
        data = get(url, {"format": "json", "per_page": 5, "mrv": 5})
        return [item(f"World Bank {country}: {indicator}", url + "?format=json", {"observations": data[1]})] if isinstance(data, list) and len(data) > 1 and data[1] else []
    if source == "geocode":
        return [item(", ".join(str(r[k]) for k in ("name", "admin1", "country") if r.get(k)), "https://www.geonames.org/" + str(r["id"]), select(r, "name latitude longitude timezone country country_code admin1 population")) for r in geocode(text(a, "location"))]
    if source == "usobservation":
        station = text(a, "station", r"[A-Za-z0-9]{3,8}").upper()
        url = f"https://api.weather.gov/stations/{station}/observations/latest"
        data = get(url, headers={"Accept": "application/geo+json"})
        return [item("NWS observation " + station, url, select(data["properties"], "station timestamp rawMessage textDescription temperature dewpoint windDirection windSpeed windGust barometricPressure seaLevelPressure visibility precipitationLastHour relativeHumidity windChill heatIndex"))]
    if source in ("usweather", "usalerts"):
        lat, lon = number(a, "latitude", -90, 90), number(a, "longitude", -180, 180)
        headers = {"Accept": "application/geo+json"}
        if source == "usalerts":
            params = {"active": "true", "point": f"{lat},{lon}", "limit": 5}
            url = "https://api.weather.gov/alerts"
            data = get(url, params, headers)
            alerts = [select(r["properties"], "id areaDesc sent effective onset expires ends status messageType severity certainty urgency event headline description instruction response") for r in data["features"][:5]]
            return [item("NWS active alerts", url + "?" + urlencode(params), {"alerts": alerts, "limit": 5, "more_available": bool(data.get("pagination", {}).get("next")), "updated": data.get("updated")})]
        point = get(f"https://api.weather.gov/points/{lat:.4f},{lon:.4f}", headers=headers)["properties"]
        # Construct from validated grid identifiers, never follow upstream URLs.
        office = text(point, "gridId", r"[A-Z]{3,4}")
        x, y = number(point, "gridX", 0, 1000), number(point, "gridY", 0, 1000)
        if int(x) != x or int(y) != y:
            raise Unavailable("Invalid NWS grid coordinates")
        url = f"https://api.weather.gov/gridpoints/{office}/{int(x)},{int(y)}/forecast"
        forecast = get(url, headers=headers)["properties"]
        return [item("National Weather Service forecast", url, {**select(forecast, "updated generatedAt updateTime validTimes units elevation"), "periods": forecast["periods"][:14], "timeZone": point.get("timeZone"), "relativeLocation": point.get("relativeLocation", {}).get("properties")})]
    if source in ("weather", "airquality"):
        resolved = None
        if "location" in a:
            if "latitude" in a or "longitude" in a:
                raise Invalid("Use location or coordinates, not both")
            matches = geocode(text(a, "location"))
            if not matches:
                return []
            resolved = select(matches[0], "name admin1 country country_code latitude longitude")
            lat, lon = resolved["latitude"], resolved["longitude"]
        else:
            lat, lon = number(a, "latitude", -90, 90), number(a, "longitude", -180, 180)
        if source == "weather" and ((resolved and resolved.get("country_code") == "US") or (resolved is None and 18 <= lat <= 72 and -180 <= lon <= -65)):
            try:
                rows = adapter("usweather", {"latitude": lat, "longitude": lon})
                rows[0]["data"]["resolved_location"] = resolved
                rows[0]["data"]["provider"] = "National Weather Service"
                return rows
            except Exception:
                pass  # NWS outages/coverage gaps retain the global forecast fallback.
        key = meteo_config()
        host = "air-quality-api" if source == "airquality" else "api"
        if key:
            host = "customer-air-quality-api" if source == "airquality" else "customer-api"
        params = {"latitude": lat, "longitude": lon, "timezone": "auto", "forecast_days": 7 if source == "weather" else 3}
        if source == "weather":
            params.update(current="temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m", daily="temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset")
        else:
            params.update(current="european_aqi,us_aqi,pm10,pm2_5,ozone,nitrogen_dioxide")
        if key:
            params["apikey"] = key
        path = "/v1/" + ("air-quality" if source == "airquality" else "forecast")
        data = get(f"https://{host}.open-meteo.com" + path, params)
        data["resolved_location"] = resolved
        data["provider"] = "Open-Meteo / CAMS" if source == "airquality" else "Open-Meteo"
        public_host = "air-quality-api" if source == "airquality" else "api"
        citation = f"https://{public_host}.open-meteo.com" + path + "?" + urlencode({k: v for k, v in params.items() if k != "apikey"})
        return [item(f"{source} at {lat}, {lon}", citation, data)]
    if source == "music":
        if os.environ.get("MUSICBRAINZ_ENABLED") != "1":
            raise Unavailable("MusicBrainz requires explicit configuration after reviewing its usage terms")
        data = get("https://musicbrainz.org/ws/2/artist/", {"query": text(a, "query"), "fmt": "json", "limit": 5})
        return [item(r["name"], "https://musicbrainz.org/artist/" + r["id"], select(r, "id name type country disambiguation life-span")) for r in data["artists"][:5]]
    if source == "stocks":
        symbol = text(a, "symbol", r"[A-Za-z0-9.^:-]{1,24}")
        data = get("https://www.alphavantage.co/query", {"function": "GLOBAL_QUOTE", "symbol": symbol, "apikey": credential("ALPHA_VANTAGE_API_KEY")})
        if not data.get("Global Quote"):
            raise Unavailable("Stock quote not available under the configured quota or entitlement")
        return [item(symbol + " stock quote", "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=" + quote(symbol), data["Global Quote"])]
    if source == "crypto":
        coin = text(a, "coin", r"[a-z0-9-]{1,80}")
        currency = text(a, "currency", r"[a-z]{3,5}", default="usd")
        data = get("https://api.coingecko.com/api/v3/simple/price", {"ids": coin, "vs_currencies": currency, "include_last_updated_at": "true"}, {"x-cg-demo-api-key": credential("COINGECKO_API_KEY")})
        return [item(coin + " price", "https://www.coingecko.com/en/coins/" + coin, data[coin])] if data.get(coin) else []
    if source == "movies":
        data = get("https://api.themoviedb.org/3/search/movie", {"query": text(a, "query"), "include_adult": "false", "page": 1}, {"Authorization": "Bearer " + credential("TMDB_READ_TOKEN")})
        return [item(r["title"], "https://www.themoviedb.org/movie/" + str(r["id"]), select(r, "id title original_title original_language release_date overview vote_average vote_count")) for r in data["results"][:5]]
    if source == "space":
        params = {"api_key": credential("NASA_API_KEY")}
        if "date" in a:
            params["date"] = date(a, "date")
        data = get("https://api.nasa.gov/planetary/apod", params)
        return [item(data["title"], "https://apod.nasa.gov/apod/ap" + datetime.strptime(data["date"], "%Y-%m-%d").strftime("%y%m%d") + ".html", select(data, "date title explanation copyright media_type url hdurl"))]
    if source == "transit":
        params = {"from": text(a, "from"), "to": text(a, "to"), "limit": 3}
        url = "https://transport.opendata.ch/v1/connections"
        data = get(url, params)
        return [item("Swiss public transport connections", url + "?" + urlencode(params), {"connections": [select(r, "from to duration transfers products service") for r in data["connections"][:3]]})] if data.get("connections") else []
    if source == "aviation":
        station = text(a, "station", r"[A-Za-z]{4}").upper()
        data = get("https://aviationweather.gov/api/data/metar", {"ids": station, "format": "json"})
        return [item(station + " METAR", "https://aviationweather.gov/data/metar/?id=" + station, r) for r in data[:5]]
    raise Invalid("Unknown data source")


_lock = threading.Lock()
_cache = OrderedDict()
_next = {}
_meteo_minute = deque()
_meteo_usage = {"day": "", "month": "", "daily": 0, "monthly": 0}


def meteo_budget():
    """Conservative process-local budgets for the cloud relay + Hermes processes.

    Together these remain below the free service's limits. On horizontal scale,
    move counters/cache to shared storage before increasing deployment replicas.
    """
    now = time.monotonic()
    stamp = datetime.now(timezone.utc)
    day, month = stamp.strftime("%Y-%m-%d"), stamp.strftime("%Y-%m")
    with _lock:
        while _meteo_minute and now - _meteo_minute[0] >= 60:
            _meteo_minute.popleft()
        if _meteo_usage["day"] != day:
            _meteo_usage.update(day=day, daily=0)
        if _meteo_usage["month"] != month:
            _meteo_usage.update(month=month, monthly=0)
        if len(_meteo_minute) >= 100 or _meteo_usage["daily"] >= 3000 or _meteo_usage["monthly"] >= 90000:
            raise Unavailable("Weather provider request budget exhausted; use another source")
        _meteo_minute.append(now)
        _meteo_usage["daily"] += 1
        _meteo_usage["monthly"] += 1


def bounded(value, depth=0):
    """Project bounded JSON rather than slicing serialized JSON mid-record."""
    if depth > 7:
        return "[nested data omitted]"
    if isinstance(value, dict):
        return {str(k)[:100]: bounded(v, depth + 1) for k, v in list(value.items())[:50]}
    if isinstance(value, list):
        return [bounded(v, depth + 1) for v in value[:40]]
    return value[:1200] if isinstance(value, str) else value


def lookup(source, args):
    if source not in CATALOG or not isinstance(args, dict):
        return {"success": False, "error": "Unknown source or invalid parameter object"}
    if set(args) - set(CATALOG[source][1].split()):
        return {"success": False, "error": "Unsupported parameters; use api:catalog {} for accepted parameters"}
    try:
        identity = json.dumps([source, args], sort_keys=True, allow_nan=False)
    except (ValueError, TypeError):
        return {"success": False, "error": "Invalid parameters"}
    if len(identity) > 1000:
        return {"success": False, "error": "Parameters exceed size limit"}
    now = time.monotonic()
    with _lock:
        if identity in _cache and now - _cache[identity][0] < (60 if source in ("usalerts", "usobservation") else 300):
            return json.loads(_cache[identity][1])
        if _next.get(source, 0) > now:
            return {"success": False, "error": "Provider is cooling down; use web search or retry later"}
        _next[source] = now + 1.1
    try:
        rows = adapter(source, args)
        # Only actual returned HTTP(S) links can become citations.
        rows = [{**bounded(r), "truncated": bounded(r) != r} for r in rows[:5] if isinstance(r, dict) and isinstance(r.get("url"), str) and r["url"].startswith("https://")]
        stamp = datetime.now(timezone.utc).isoformat()
        hits = [{"title": r["title"], "url": r["url"], "description": json.dumps({"data": r["data"], "qualification": CATALOG[source][3], "truncated": r["truncated"]}, ensure_ascii=False), "retrieved_at": stamp, "source": source} for r in rows]
        # Keep total evidence bounded even for very verbose records.
        hits = [r for r in hits if len(r["description"]) <= 16000]
        result = {"success": bool(hits), "provider": source, "data": {"web": hits}, "error": "" if hits else "No matching records; this does not establish nonexistence"}
        if hits:
            encoded = json.dumps(result)
            with _lock:
                _cache[identity] = (now, encoded)
                _cache.move_to_end(identity)
                while len(_cache) > 128:
                    _cache.popitem(last=False)
        return result
    except Invalid as exc:
        return {"success": False, "error": str(exc)}
    except Unavailable as exc:
        return {"success": False, "error": str(exc)}
    except Exception as exc:
        # Never return provider bodies, URLs containing keys, or exception messages.
        delay = 60
        if isinstance(exc, HTTPError) and exc.code in (429, 503):
            try:
                delay = max(60, min(int(exc.headers.get("Retry-After", "60")), 3600))
            except (ValueError, TypeError):
                pass
        with _lock:
            _next[source] = time.monotonic() + delay
        return {"success": False, "error": "Data provider unavailable; use another source or mark the fact unverified"}


def natural_query(query):
    """Conservative exact intents only. Other lookups use explicit tool parameters."""
    q = str(query).strip()
    # Never turn transformation requests or quoted examples into network lookups.
    if re.search(r"\b(?:don't|dont|do not|without|no)\s+(?:web\s+)?(?:search|browse|internet|lookup)|\b(?:translate|rewrite|proofread|summarize|summarise)\b", q, re.I):
        return None
    m = re.fullmatch(r"(?:please\s+)?(?:convert\s+)?(?:\d+(?:[.,]\d+)*\s+)?([A-Za-z]{3})\s+(?:to|into|in)\s+([A-Za-z]{3})[?.!]?", q, re.I)
    if m:
        return "currency", {"base": m[1], "quote": m[2]}
    m = re.fullmatch(r"(?:(?:what(?:'s| is)|how is)\s+(?:the\s+)?)?(weather|forecast|temperature|air quality|aqi)(?:\s+(?:today|tomorrow|this week))?\s+(?:in|for|at)\s+([\w\s,.'-]{2,100}?)(?:\s+(?:today|tomorrow|this week))?[?.!]?", q, re.I)
    if m:
        return ("airquality" if m[1].lower() in ("air quality", "aqi") else "weather"), {"location": m[2].strip()}
    for pattern, source, key in (
        (r"(?:define|definition of|meaning of)\s+([A-Za-z'-]+)[?.!]?", "dictionary", "word"),
        (r"(?:find|search|look up)\s+(?:books?|book metadata)\s+(?:about|on|for|called|titled)\s+(.+?)[?.!]?", "books", "query"),
        (r"(?:find|search)\s+(?:research papers|scholarly papers|journal articles)\s+(?:about|on)\s+(.+?)[?.!]?", "papers", "query"),
        (r"(?:npm package|pypi package)\s+([@\w./-]+)[?.!]?", "package", "package"),
        (r"(?:decode\s+)?VIN\s+([A-HJ-NPR-Za-hj-npr-z0-9]{17})[?.!]?", "vin", "vin"),
        (r"(?:look up\s+)?(?:food\s+)?barcode\s+(\d{8,14})[?.!]?", "food", "barcode"),
    ):
        m = re.fullmatch(pattern, q, re.I)
        if m:
            return ("npm" if q.lower().startswith("npm") else "pypi") if source == "package" else source, {key: m[1]}
    return None


def search(query):
    """None means normal web research should handle this query."""
    if not isinstance(query, str):
        return None
    if query.startswith("api:"):
        match = re.fullmatch(r"api:([a-z]+)\s+(\{.*\})", query.strip(), re.S)
        if not match or len(query) > 1200:
            return {"success": False, "error": "Use api:source followed by a JSON parameter object"}
        source = match[1]
        try:
            args = json.loads(match[2])
        except ValueError:
            return {"success": False, "error": "Invalid JSON parameters"}
        if source == "catalog":
            sources = {k: {"description": v[0], "parameters": v[1], "documentation": v[2], "qualification": v[3]} for k, v in CATALOG.items()}
            return {"success": True, "sources": sources, "data": {"web": [{"title": "Vaelo public-data tool catalog", "url": "https://vaelo.app", "description": json.dumps(sources)}]}}
        return lookup(source, args)
    intent = natural_query(query)
    return lookup(*intent) if intent else None
