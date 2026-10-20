"""Explicit live smoke check: python tests/live_data_sources.py (no model calls)."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cloud.data_sources import lookup
from cloud.extended_sources import SPECS

CASES = {
    "currency": {"base": "USD", "quote": "INR"},
    "holidays": {"country": "US", "year": "2026"},
    "dictionary": {"word": "serendipity"},
    "books": {"query": "Dune Frank Herbert"},
    "papers": {"query": "Attention is all you need"},
    "github": {"query": "repo:python/cpython"},
    "npm": {"package": "react"},
    "pypi": {"package": "requests"},
    "stackoverflow": {"query": "python dictionary merge"},
    "wikipedia": {"query": "Lake Michigan"},
    "wikidata": {"query": "Lake Michigan"},
    "food": {"barcode": "3017620422003"},
    "earthquakes": {},
    "vin": {"vin": "1HGCM82633A004352"},
    "recalls": {"make": "Honda", "model": "Accord", "year": "2003"},
    "species": {"query": "Panthera leo"},
    "tv": {"query": "Severance"},
    "art": {"query": "Monet"},
    "worldbank": {"country": "US", "indicator": "SP.POP.TOTL"},
    "weather": {"latitude": 41.88, "longitude": -87.63},
    "airquality": {"latitude": 41.88, "longitude": -87.63},
    "transit": {"from": "Bern", "to": "Zurich"},
    "aviation": {"station": "KORD"},
    "geocode": {"location": "Chicago, Illinois"},
    "usweather": {"latitude": 41.88, "longitude": -87.63},
    "usalerts": {"latitude": 41.88, "longitude": -87.63},
    "usobservation": {"station": "KORD"},
}


def check(pair):
    name, args = pair
    result = lookup(name, args)
    rows = result.get("data", {}).get("web", [])
    return {"source": name, "success": result["success"], "records": len(rows),
            "first": rows[0]["title"] if rows else "", "error": result.get("error", "")}


if __name__ == "__main__":
    # Deliberate HTTP checks, never part of the offline unit suite. Secrets are
    # read from the environment; provider bodies and key values are not printed.
    if "--extended" in sys.argv:
        CASES.update({name: spec["sample"] for name, spec in SPECS.items() if not spec.get("credential")})
        CASES["hackernews"] = {"feed": "top"}
    if "--configured-news" in sys.argv:
        CASES.update({"gnews": {"query": "NASA"}, "producthunt": {}})
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(check, CASES.items()))
    print(json.dumps(results, indent=2))
    sys.exit(0 if all(r["success"] for r in results) else 1)
