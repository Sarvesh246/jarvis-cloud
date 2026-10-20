"""Bounded weather lookups rendered from provider data, without a model turn."""

from datetime import date, datetime, timedelta, timezone
import json
import math
import re

try:
    from data_sources import get, geocode, meteo_config
except ModuleNotFoundError:
    from cloud.data_sources import get, geocode, meteo_config

DAY = r"(?:today|tonight|tomorrow(?: night)?|yesterday|this week|next week|(?:next |this )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?) \d{1,2}(?:st|nd|rd|th)?(?:,? \d{4})?)"
UNSAFE = re.compile(r"\b(?:plain text|text only|no widgets|json|csv|table|code|explain|why|how does|write|rewrite|translate|summari[sz]e|research|compare|climate|historical|safe|hurricane|tornado|alerts?|warning|travel|pack|wear|should|advice|and also|without|don't|do not|no search)\b", re.I)


def user_text(message):
    value = message.get("content", "")
    return value.split("\n\n[Vaelo request:", 1)[0].strip().replace("’", "'") if isinstance(value, str) else ""


def intent(messages):
    users = [user_text(m) for m in messages if m.get("role") == "user"]
    if not users:
        return None
    query = users[-1]
    if len(query) > 200 or UNSAFE.search(query):
        return None
    if not re.search(r"\b(?:weather|forecast|temperature)\b", query, re.I):
        if not re.fullmatch(r"(?:what|how) about (?:the )?" + DAY + r"[?.!]?", query, re.I):
            return None
        # Only a directly preceding weather request supplies follow-up context.
        if len(users) < 2 or not re.search(r"\b(?:weather|forecast|temperature)\b", users[-2], re.I) or UNSAFE.search(users[-2]):
            return None
        previous = users[-2]
    else:
        previous = ""
    # Avoid hijacking explanations, quoted examples, or compound requests.
    residue = re.sub(DAY, " ", query, flags=re.I)
    residue = re.split(r"\b(?:in|at|for)\s+(?!the\b)", residue, flags=re.I)[0]
    residue = re.sub(r"\b(?:what|whats|what's|is|are|was|will|be|how|about|the|weather|forecast|temperature|like|on|for|please|show|me|give|s|today's|right|now|celsius|fahrenheit)\b|[?.!,']", " ", residue, flags=re.I)
    if residue.strip():
        return None
    def location(text):
        text = re.sub(DAY, " ", text, flags=re.I)
        text = re.sub(r"\b(?:in celsius|in fahrenheit)\b", "", text, flags=re.I)
        match = re.search(r"\b(?:in|at|for)\s+([\w .,'-]+)", text, re.I)
        return match[1].strip(" .?!,") if match else None
    return {"query": query, "location": location(query) or location(previous)}


def target_dates(query, today):
    match = re.search(DAY, query, re.I)
    value = match[0].lower() if match else "today"
    count = 7 if value in ("this week", "next week") else 1
    if value == "next week":
        start = today + timedelta(days=7)
    elif value in ("today", "tonight", "this week"):
        start = today
    elif value.startswith("tomorrow"):
        start = today + timedelta(days=1)
    elif value == "yesterday":
        start = today - timedelta(days=1)
    elif re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        start = date.fromisoformat(value)
    elif re.search(r"\d", value):
        value = re.sub(r"(\d)(?:st|nd|rd|th)", r"\1", value).replace(",", "")
        parts = value.split()
        month = datetime.strptime(parts[0][:3], "%b").month
        start = date(int(parts[2]) if len(parts) > 2 else today.year, month, int(parts[1]))
        if len(parts) == 2 and start < today:
            start = start.replace(year=today.year + 1)
    else:
        name = value.split()[-1]
        weekday = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].index(name)
        offset = (weekday - today.weekday()) % 7
        if value.startswith("next ") and offset == 0:
            offset = 7
        start = today + timedelta(days=offset)
    return start, start + timedelta(days=count - 1)


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


def weather_reply(messages, place=None, now=None):
    """None leaves complex/unsupported requests on the normal research path."""
    ask = intent(messages)
    if ask is None:
        return None
    try:
        if ask["location"]:
            rows = geocode(ask["location"])
            if not rows:
                return None
            point = rows[0]
            lat, lon = point["latitude"], point["longitude"]
            label = ", ".join(dict.fromkeys(str(point[k]) for k in ("name", "admin1", "country") if point.get(k)))
        elif isinstance(place, dict) and number(place.get("lat")) is not None and number(place.get("lon")) is not None and -90 <= place["lat"] <= 90 and -180 <= place["lon"] <= 180:
            lat, lon = place["lat"], place["lon"]
            label = ", ".join(str(place[k])[:80] for k in ("city", "region") if place.get(k)) or f"{lat:.2f}, {lon:.2f}"
        else:
            return "Which city would you like the weather for? You can also share your approximate location in Settings."
        key = meteo_config()
        unit = "celsius" if re.search(r"\bcelsius\b|°\s*C\b", ask["query"], re.I) else "fahrenheit" if re.search(r"\bfahrenheit\b|°\s*F\b", ask["query"], re.I) or (18 <= lat <= 72 and -180 <= lon <= -65) else "celsius"
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
        start, end = target_dates(ask["query"], local.date())
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
        if not periods or not any(p["high"] is not None or p["low"] is not None for p in periods): return None
        # Current conditions are model estimates. Reject stale or undated data.
        try:
            observed = datetime.fromisoformat(current.get("time", ""))
            fresh = -300 <= (local - observed).total_seconds() <= 7200
        except (TypeError, ValueError):
            fresh = False
        snapshot = {"time": current["time"], "temperature": number(current.get("temperature_2m")), "feels": number(current.get("apparent_temperature")), "humidity": number(current.get("relative_humidity_2m")), "wind": number(current.get("wind_speed_10m")), "condition": condition(current.get("weather_code")), "isDay": current.get("is_day") == 1} if fresh and start == local.date() else None
        payload = {"version": 1, "title": label, "timezone": data["timezone"], "unit": temp_unit, "windUnit": wind_unit, "localTime": local.isoformat(timespec="minutes"), "retrieved": instant.isoformat(), "current": snapshot, "periods": periods}
        fallback = f"Weather for {label}\n\n| Day | Conditions | High ({temp_unit}) | Low ({temp_unit}) |\n|---|---|---|---|\n"
        fallback += "\n".join(f"| {p['label']} | {p['condition']} | {p['high'] if p['high'] is not None else '—'} | {p['low'] if p['low'] is not None else '—'} |" for p in periods)
        return "```weather\n" + json.dumps(payload, ensure_ascii=False) + "\n```\n\n" + fallback + "\n\n[Open-Meteo](https://open-meteo.com/) · Model forecast; times are local to " + data["timezone"] + "."
    except Exception:
        return None  # Provider failures use the existing source/recovery path.
