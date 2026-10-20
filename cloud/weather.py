"""Model-interpreted weather requests; provider-owned forecast values and dates."""

from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
import json
import math
import re
import os
import secrets
import time
from pathlib import Path

try:
    from .data_sources import get, geocode, meteo_config
except ImportError:
    from data_sources import get, geocode, meteo_config

SCHEMA = {
    "name": "weather_forecast",
    "description": "Fetch verified current weather and daily/hourly forecasts. Interpret the user's natural language in ANY language and resolve omitted location, units and changed dates from the conversation. Never require fixed phrases. For example a follow-up can change just the period or destination. Prefer this tool over general search for forecasts. Use shared approximate coordinates when no destination is specified; never invent a location. Relative offsets use the forecast location's local date. Use start_date for explicit dates; day_offset for relative dates. Supply the entire requested range, e.g. days=7 for a week. Set output=text when the user wants plain text or a table; otherwise widget. Do not call for offline requests, translations, quoted examples, or explanations of weather as a concept.",
    "parameters": {"type": "object", "properties": {
        "location": {"type": "string", "description": "Explicit city, region and country, or destination retained from prior weather turns. Omit when using shared coordinates."},
        "latitude": {"type": "number", "minimum": -90, "maximum": 90},
        "longitude": {"type": "number", "minimum": -180, "maximum": 180},
        "day_offset": {"type": "integer", "minimum": 0, "maximum": 15, "description": "Start relative to location-local today: 0 today, 1 tomorrow, etc."},
        "start_date": {"type": "string", "description": "YYYY-MM-DD for a specific calendar date. Overrides day_offset."},
        "days": {"type": "integer", "minimum": 1, "maximum": 16, "description": "Number of consecutive forecast dates requested, not the number of prior messages."},
        "unit": {"type": "string", "enum": ["celsius", "fahrenheit"], "description": "Preserve the prior forecast's units unless the user explicitly changes them. Do not switch units merely because the user changes language. Omit for the location's default on the first request."},
        "output": {"type": "string", "enum": ["widget", "text", "data"], "default": "widget", "description": "Use widget by default, including all ordinary natural-language questions. Use text ONLY for an explicit request for plain text or a Markdown table. Use data for a specific format such as JSON/CSV that the model must compose from returned values."},
    }, "additionalProperties": False},
}
# Models sometimes drop or add a bracket when they copy the reference back, so
# accept any bracketing of the exact 24-hex token. The token is the credential.
REFERENCE = re.compile(r"\[{0,2}vaelo-weather:([0-9a-f]{24})\]{0,2}")


def widget_reference(arguments, result):
    """The reference a widget forecast stored for this very call, or None.
    The relay executes the tool itself, so it knows which forecast belongs to
    the run even when the model fails to repeat the reference."""
    if (arguments or {}).get("output", "widget") != "widget":
        return None
    try:
        found = REFERENCE.search(str(json.loads(result).get("reference") or ""))
    except (TypeError, ValueError, AttributeError):
        return None
    return found.group(1) if found else None


def validate(ask):
    if not isinstance(ask, dict) or set(ask) - set(SCHEMA["parameters"]["properties"]):
        raise ValueError("Unsupported forecast arguments")
    for key, low, high in (("day_offset", 0, 15), ("days", 1, 16)):
        if key in ask and (type(ask[key]) is not int or not low <= ask[key] <= high):
            raise ValueError("Invalid forecast range")
    for key, low, high in (("latitude", -90, 90), ("longitude", -180, 180)):
        if key in ask and (number(ask[key]) is None or not low <= ask[key] <= high):
            raise ValueError("Invalid coordinates")
    if ("latitude" in ask) != ("longitude" in ask):
        raise ValueError("Both coordinates are required")
    if "location" in ask and (not isinstance(ask["location"], str) or not 1 <= len(ask["location"].strip()) <= 120):
        raise ValueError("Invalid location")
    if "start_date" in ask:
        if not isinstance(ask["start_date"], str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", ask["start_date"]):
            raise ValueError("Invalid date")
        date.fromisoformat(ask["start_date"])
    if "unit" in ask and ask["unit"] not in ("celsius", "fahrenheit"):
        raise ValueError("Invalid temperature unit")
    if "output" in ask and ask["output"] not in ("widget", "text", "data"):
        raise ValueError("Invalid output format")


def folder():
    return Path(os.environ.get("HERMES_HOME") or "/opt/data") / "cache" / "vaelo-weather"


def keep(reply):
    if len(reply.encode("utf-8")) > 60000:
        raise ValueError("Forecast exceeds presentation limit")
    where = folder()
    where.mkdir(parents=True, exist_ok=True)
    files = sorted(where.glob("*.txt"), key=lambda p: p.stat().st_mtime, reverse=True)
    for i, path in enumerate(files):
        if re.fullmatch(r"[0-9a-f]{24}\.txt", path.name) and (i >= 63 or time.time() - path.stat().st_mtime > 3600):
            path.unlink(missing_ok=True)
    token = secrets.token_hex(12)
    target = where / (token + ".txt")
    temporary = target.with_suffix(".tmp")
    temporary.write_text(reply, encoding="utf-8")
    temporary.replace(target)
    return f"[[vaelo-weather:{token}]]"


def read_forecast(token, *, not_before=0):
    if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{24}", token):
        return ""
    try:
        path = folder() / (token + ".txt")
        metadata = path.stat()
        if metadata.st_size > 60000 or metadata.st_mtime < not_before or time.time() - metadata.st_mtime > 3600:
            return ""
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return ""


def weather_tool(arguments, **kwargs):
    try:
        validate(arguments)
        place = {"lat": arguments.get("latitude"), "lon": arguments.get("longitude")}
        reply = weather_reply(arguments, place)
        if not reply:
            return json.dumps({"success": False, "error": "Forecast unavailable for those coordinates, location or dates. Ask for a city if none was provided; otherwise use live research. Never reuse an earlier forecast as new evidence."})
        fallback = reply.split("\n```\n\n", 1)[-1]
        if arguments.get("output") == "data":
            return json.dumps({"success": True, "forecast": fallback, "instruction": "Return these verified values in exactly the user's requested format. Do not include a forecast widget or reference."})
        reference = keep(fallback if arguments.get("output") == "text" else reply)
        return json.dumps({"success": True, "reference": reference,
                           "forecast": fallback,
                           "instruction": "Include reference EXACTLY once in your final answer, on its own line without backticks. Vaelo renders the verified forecast itself. Do not copy or invent a weather JSON block. Answer in the user's language. For a simple forecast, the reference is sufficient. Add grounded advice only if asked. Never copy a reference from a prior turn; use this fresh result."})
    except (ValueError, TypeError, OSError):
        return json.dumps({"success": False, "error": "Invalid or unavailable forecast request; correct the tool arguments or use live research."})

@lru_cache(maxsize=256)
def us_city(lat, lon):
    point = get(f"https://api.weather.gov/points/{lat:.4f},{lon:.4f}")
    names = point["properties"]["relativeLocation"]["properties"]
    if not names.get("city") or not names.get("state"):
        raise ValueError("No municipality in point metadata")
    return f'{names["city"]}, {names["state"]}'


def shared_location_label(place):
    """Name coordinate-only requests too; never geocode a census label back
    into a different forecast point. NWS supplies the nearest US municipality.
    A naming-service outage must not prevent the coordinate forecast."""
    lat, lon = place["lat"], place["lon"]
    if 18 <= lat <= 72 and -180 <= lon <= -65:
        try:
            return us_city(round(lat, 2), round(lon, 2))
        except Exception:
            pass
    return ", ".join(str(place[k])[:80] for k in ("city", "region") if place.get(k)) or "Your shared location"


def condition(code):
    if code == 0: return "Clear sky"
    if code in (1, 2): return "Partly cloudy"
    if code == 3: return "Overcast"
    if code in (45, 48): return "Fog"
    if code in (51, 53, 55, 56, 57): return "Drizzle"
    if code in (61, 63, 65, 66, 67, 80, 81, 82): return "Rain"
    if code in (71, 73, 75, 77, 85, 86): return "Snow"
    if code in (95, 96, 99): return "Thunderstorms"
    return ""


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def weather_reply(ask, place=None, now=None):
    """Execute validated model tool arguments, never parse the user's wording."""
    try:
        validate(ask)
        if ask.get("location"):
            rows = geocode(ask["location"])
            if not rows:
                return None
            point = rows[0]
            lat, lon = point["latitude"], point["longitude"]
            label = ", ".join(dict.fromkeys(str(point[k]) for k in ("name", "admin1", "country") if point.get(k)))
        elif isinstance(place, dict) and number(place.get("lat")) is not None and number(place.get("lon")) is not None and -90 <= place["lat"] <= 90 and -180 <= place["lon"] <= 180:
            lat, lon = place["lat"], place["lon"]
            label = shared_location_label(place)
        else:
            return None
        key = meteo_config()
        unit = ask.get("unit") or ("fahrenheit" if 18 <= lat <= 72 and -180 <= lon <= -65 else "celsius")
        params = {"latitude": lat, "longitude": lon, "timezone": "auto", "forecast_days": 16,
                  "temperature_unit": unit, "wind_speed_unit": "mph" if unit == "fahrenheit" else "kmh",
                  "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m",
                  "hourly": "temperature_2m,precipitation_probability,weather_code,is_day,relative_humidity_2m,wind_speed_10m",
                  "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunrise,sunset"}
        if key: params["apikey"] = key
        data = get("https://" + ("customer-api" if key else "api") + ".open-meteo.com/v1/forecast", params)
        current = data.get("current", {})
        instant = now or datetime.now(timezone.utc)
        local = (instant + timedelta(seconds=int(data["utc_offset_seconds"]))).replace(tzinfo=None)
        start = date.fromisoformat(ask["start_date"]) if ask.get("start_date") else local.date() + timedelta(days=ask.get("day_offset", 0))
        end = start + timedelta(days=ask.get("days", 1) - 1)
        if start < local.date() or end > local.date() + timedelta(days=15):
            return None  # Historical and longer-range requests retain live research.
        daily, hourly = data["daily"], data["hourly"]
        def at(group, field, i):
            values = group.get(field, [])
            return values[i] if isinstance(values, list) and i < len(values) else None
        periods = []
        temp_unit = data["daily_units"]["temperature_2m_max"]
        wind_unit = data["hourly_units"]["wind_speed_10m"]
        for i, day in enumerate(daily["time"]):
            if not start.isoformat() <= day <= end.isoformat(): continue
            hours = []
            for j, stamp in enumerate(hourly["time"]):
                if not stamp.startswith(day): continue
                hours.append({"time": stamp, "temperature": number(at(hourly, "temperature_2m", j)), "rain": number(at(hourly, "precipitation_probability", j)), "condition": condition(at(hourly, "weather_code", j)), "isDay": at(hourly, "is_day", j) == 1})
            periods.append({"label": day, "high": number(at(daily, "temperature_2m_max", i)), "low": number(at(daily, "temperature_2m_min", i)), "condition": condition(at(daily, "weather_code", i)), "rain": number(at(daily, "precipitation_probability_max", i)), "wind": number(at(daily, "wind_speed_10m_max", i)), "uv": number(at(daily, "uv_index_max", i)), "sunrise": at(daily, "sunrise", i), "sunset": at(daily, "sunset", i), "hours": hours})
        expected = [(start + timedelta(days=i)).isoformat() for i in range((end-start).days + 1)]
        if [p["label"] for p in periods] != expected or not all(p["high"] is not None or p["low"] is not None for p in periods): return None
        # Current conditions are model estimates. Reject stale or undated data.
        try:
            observed = datetime.fromisoformat(current.get("time", ""))
            fresh = -300 <= (local - observed).total_seconds() <= 7200
        except (TypeError, ValueError):
            fresh = False
        snapshot = {"time": current["time"], "temperature": number(current.get("temperature_2m")), "feels": number(current.get("apparent_temperature")), "humidity": number(current.get("relative_humidity_2m")), "wind": number(current.get("wind_speed_10m")), "condition": condition(current.get("weather_code")), "isDay": current.get("is_day") == 1} if fresh and start == local.date() else None
        payload = {"version": 1, "view": "day" if start == end else "week" if len(periods) == 7 else "range", "title": label, "timezone": data["timezone"], "unit": temp_unit, "windUnit": wind_unit, "localTime": local.isoformat(timespec="minutes"), "retrieved": instant.isoformat(), "current": snapshot, "periods": periods}
        fallback = f"Weather for {label}\n\n| Day | Conditions | High ({temp_unit}) | Low ({temp_unit}) |\n|---|---|---|---|\n"
        fallback += "\n".join(f"| {p['label']} | {p['condition']} | {p['high'] if p['high'] is not None else '—'} | {p['low'] if p['low'] is not None else '—'} |" for p in periods)
        return "```weather\n" + json.dumps(payload, ensure_ascii=False) + "\n```\n\n" + fallback + "\n\n[Open-Meteo](https://open-meteo.com/) · Model forecast; times are local to " + data["timezone"] + "."
    except Exception:
        return None  # A failed lookup is evidence of unavailability, never a forecast.
