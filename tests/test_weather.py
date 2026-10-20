import json
import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch
from cloud.weather import intent, target_dates, weather_reply


def messages(*texts):
    return [{"role": "user", "content": text} for text in texts]


class WeatherTests(unittest.TestCase):
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
