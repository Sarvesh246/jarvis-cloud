import json
import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch
from cloud.weather import intent, target_dates, weather_reply, shared_location_label, us_city


def messages(*texts):
    return [{"role": "user", "content": text} for text in texts]


class WeatherTests(unittest.TestCase):
    def test_chained_followups_keep_place_and_units_but_replace_dates(self):
        chain = messages("What's the weather today in College Station, Texas in celsius?",
                         "How about this week?", "And tomorrow?")
        self.assertEqual(intent(chain), {"query": "And tomorrow?", "location": "College Station, Texas", "unit": "celsius"})
        self.assertEqual(target_dates(intent(chain[:-1])["query"], date(2026, 10, 20)),
                         (date(2026, 10, 20), date(2026, 10, 26)))
        self.assertEqual(intent(messages("weather in Paris", "weather tomorrow"))["location"], "Paris")
        self.assertEqual(intent(messages("weather in Paris", "how about tomorrow in London?"))["location"], "London")
        self.assertIsNone(intent(messages("weather in Paris", "tell me a joke", "how about this week?")))
        self.assertIsNone(intent(messages("weather as plain text", "how about this week?")))

    def test_coordinate_city_resolution_does_not_move_forecast_point(self):
        us_city.cache_clear()
        place = {"lat": 30.60, "lon": -96.30, "city": "South Brazos", "region": "Texas"}
        with patch('cloud.weather.get', return_value={"properties": {"relativeLocation": {"properties": {"city": "College Station", "state": "TX"}}}}) as get:
            self.assertEqual(shared_location_label(place), "College Station, TX")
            self.assertEqual(shared_location_label({"lat": 30.60, "lon": -96.30}), "College Station, TX")
            get.assert_called_once_with("https://api.weather.gov/points/30.6000,-96.3000")
        us_city.cache_clear()
        with patch('cloud.weather.get', side_effect=TimeoutError):
            self.assertEqual(shared_location_label({"lat": 30.60, "lon": -96.30}), "Your shared location")

    def test_weekly_reply_contains_every_requested_day_and_rejects_partial_data(self):
        from datetime import timedelta
        days = [(date(2026, 10, 20) + timedelta(days=i)).isoformat() for i in range(16)]
        data = {"utc_offset_seconds": -18000, "timezone": "America/Chicago",
                "daily_units": {"temperature_2m_max": "°F"}, "hourly_units": {"wind_speed_10m": "mp/h"},
                "daily": {"time": days, "temperature_2m_max": list(range(70,86)), "temperature_2m_min": [50]*16}, "hourly": {"time": []}}
        now = datetime(2026,10,20,15,tzinfo=timezone.utc)
        chain = messages("What's the weather today?", "What about this week?")
        place = {"lat": 30.60, "lon": -96.30}
        with patch('cloud.weather.get', return_value=data) as get, patch('cloud.weather.shared_location_label', return_value="College Station, TX"), patch('cloud.weather.meteo_config', return_value=''):
            payload = json.loads(weather_reply(chain, place, now).split('\n')[1])
            self.assertEqual(payload['view'], 'week')
            self.assertEqual([p['label'] for p in payload['periods']], days[:7])
            self.assertEqual(payload['title'], 'College Station, TX')
            self.assertEqual(get.call_args.args[1]['latitude'], place['lat'])
            self.assertEqual(get.call_args.args[1]['longitude'], place['lon'])
            next_week = json.loads(weather_reply(messages('weather next week'), place, now).split('\n')[1])
            self.assertEqual([p['label'] for p in next_week['periods']], days[7:14])
            data['daily']['time'] = days[:1]
            self.assertIsNone(weather_reply(chain, place, now))

    def test_natural_questions_and_followups(self):
        for text in ("whats the weather like today", "what about todays weather", "what's today's weather?", "weather for Friday", "weather on October 22", "weather on 2026-10-22 in Paris"):
            self.assertIsNotNone(intent(messages(text)), text)
        self.assertEqual(intent(messages("weather tomorrow in Paris", "what about Friday?"))["location"], "Paris")
        for text in ("explain how weather works", "write a weather widget", "weather today as plain text", "weather alerts in Paris", "weather and also news", "translate 'weather today'", "weather without browsing"):
            self.assertIsNone(intent(messages(text)), text)
        self.assertIsNone(intent(messages("what about Friday?")))

    def test_local_dates(self):
        today = date(2026, 10, 20)
        for query, expected in (("weather tomorrow", date(2026,10,21)), ("weather Friday", date(2026,10,23)), ("weather October 22", date(2026,10,22)), ("weather 2026-10-25",date(2026,10,25))):
            self.assertEqual(target_dates(query,today)[0], expected)

    def test_data_units_nulls_dates_and_no_model_needed(self):
        data = {"utc_offset_seconds": -18000, "timezone": "America/Chicago", "current": {"time": "2026-10-20T10:00", "temperature_2m": 68, "weather_code": 0, "is_day": 1}, "daily_units": {"temperature_2m_max": "°F"}, "hourly_units": {"wind_speed_10m": "mp/h"}, "daily": {"time": ["2026-10-20", "2026-10-21"], "temperature_2m_max": [80, 82], "temperature_2m_min": [None, 55], "weather_code": [0, 2]}, "hourly": {"time": ["2026-10-20T11:00", "2026-10-21T11:00"], "temperature_2m": [73, 75], "weather_code": [0, 2], "is_day": [1,1]}}
        now = datetime(2026,10,20,15,0,tzinfo=timezone.utc)
        with patch('cloud.weather.get', return_value=data), patch('cloud.weather.meteo_config', return_value=''):
            reply = weather_reply(messages('whats the weather today'), {"lat":30.62,"lon":-96.35}, now)
            payload = json.loads(reply.split('\n')[1])
            self.assertEqual(payload['current']['temperature'],68)
            self.assertIsNone(payload['periods'][0]['low'])
            self.assertEqual(len(payload['periods'][0]['hours']),1)
            self.assertEqual(payload['unit'],'°F')
            tomorrow = json.loads(weather_reply(messages('weather tomorrow'), {"lat":30.62,"lon":-96.35}, now).split('\n')[1])
            self.assertIsNone(tomorrow['current'])
            self.assertEqual(tomorrow['periods'][0]['label'],'2026-10-21')
            self.assertIsNone(weather_reply(messages('weather 2027-01-01'), {"lat":30.62,"lon":-96.35}, now))
            data['current']['time'] = '2026-10-19T01:00'
            stale = json.loads(weather_reply(messages('weather today'), {"lat":30.62,"lon":-96.35}, now).split('\n')[1])
            self.assertIsNone(stale['current'])

    def test_missing_location_and_provider_failure(self):
        self.assertIn('Which city',weather_reply(messages('weather today')))
        with patch('cloud.weather.get', side_effect=TimeoutError):
            self.assertIsNone(weather_reply(messages('weather today'), {"lat":30,"lon":-96}))


if __name__ == '__main__':
    unittest.main()
