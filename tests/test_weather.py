import json
import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch
from cloud.weather import validate, weather_reply, weather_tool, shared_location_label, us_city, keep, read_forecast, REFERENCE
import tempfile
import os


def messages(*texts):
    return [{"role": "user", "content": text} for text in texts]


class WeatherTests(unittest.TestCase):
    def test_model_arguments_are_validated_without_reading_user_phrases(self):
        for args in ({'days': 7}, {'day_offset': 4, 'days': 2}, {'start_date': '2026-10-23', 'unit': 'celsius'}):
            validate(args)
        for args in ({'days': True}, {'days': 17}, {'days': 0}, {'day_offset': -1}, {'latitude': float('nan'), 'longitude': 0}, {'latitude': 30}, {'location': ''}, {'start_date':'2026-02-30'}, {'url':'http://localhost'}, {'unit':'hot'}, {'output':'code'}):
            with self.subTest(args=args), self.assertRaises((ValueError, TypeError)):
                validate(args)

    def test_tool_result_is_immutable_bounded_and_shared_between_processes(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'HERMES_HOME': directory}):
            reply = '```weather\n{"verified":true}\n```\n\nWeather for College Station'
            with patch('cloud.weather.weather_reply', return_value=reply):
                result = json.loads(weather_tool({'days':7,'latitude':30.6,'longitude':-96.3}))
                token = REFERENCE.fullmatch(result['reference'])[1]
                self.assertEqual(read_forecast(token), reply)
                self.assertEqual(read_forecast(token, not_before=10**12), '')
                text = json.loads(weather_tool({'days':7,'output':'text'}))
                self.assertEqual(read_forecast(REFERENCE.fullmatch(text['reference'])[1]), 'Weather for College Station')
            self.assertEqual(read_forecast('../../secret'), '')
            with self.assertRaises(ValueError):
                keep('x'*60001)
            self.assertFalse(json.loads(weather_tool({'days':100}))['success'])

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
        chain = {"days": 7}
        place = {"lat": 30.60, "lon": -96.30}
        with patch('cloud.weather.get', return_value=data) as get, patch('cloud.weather.shared_location_label', return_value="College Station, TX"), patch('cloud.weather.meteo_config', return_value=''):
            payload = json.loads(weather_reply(chain, place, now).split('\n')[1])
            self.assertEqual(payload['view'], 'week')
            self.assertEqual([p['label'] for p in payload['periods']], days[:7])
            self.assertEqual(payload['title'], 'College Station, TX')
            self.assertEqual(get.call_args.args[1]['latitude'], place['lat'])
            self.assertEqual(get.call_args.args[1]['longitude'], place['lon'])
            next_week = json.loads(weather_reply({'day_offset': 7, 'days': 7}, place, now).split('\n')[1])
            self.assertEqual([p['label'] for p in next_week['periods']], days[7:14])
            data['daily']['time'] = days[:1]
            self.assertIsNone(weather_reply(chain, place, now))

    def test_data_units_nulls_dates_and_no_model_needed(self):
        data = {"utc_offset_seconds": -18000, "timezone": "America/Chicago", "current": {"time": "2026-10-20T10:00", "temperature_2m": 68, "weather_code": 0, "is_day": 1}, "daily_units": {"temperature_2m_max": "°F"}, "hourly_units": {"wind_speed_10m": "mp/h"}, "daily": {"time": ["2026-10-20", "2026-10-21"], "temperature_2m_max": [80, 82], "temperature_2m_min": [None, 55], "weather_code": [0, 2]}, "hourly": {"time": ["2026-10-20T11:00", "2026-10-21T11:00"], "temperature_2m": [73, 75], "weather_code": [0, 2], "is_day": [1,1]}}
        now = datetime(2026,10,20,15,0,tzinfo=timezone.utc)
        with patch('cloud.weather.get', return_value=data), patch('cloud.weather.meteo_config', return_value=''):
            reply = weather_reply({}, {"lat":30.62,"lon":-96.35}, now)
            payload = json.loads(reply.split('\n')[1])
            self.assertEqual(payload['current']['temperature'],68)
            self.assertIsNone(payload['periods'][0]['low'])
            self.assertEqual(len(payload['periods'][0]['hours']),1)
            self.assertEqual(payload['unit'],'°F')
            tomorrow = json.loads(weather_reply({'day_offset':1}, {"lat":30.62,"lon":-96.35}, now).split('\n')[1])
            self.assertIsNone(tomorrow['current'])
            self.assertEqual(tomorrow['periods'][0]['label'],'2026-10-21')
            self.assertIsNone(weather_reply({'start_date':'2027-01-01'}, {"lat":30.62,"lon":-96.35}, now))
            data['current']['time'] = '2026-10-19T01:00'
            stale = json.loads(weather_reply({}, {"lat":30.62,"lon":-96.35}, now).split('\n')[1])
            self.assertIsNone(stale['current'])

    def test_missing_location_and_provider_failure(self):
        self.assertIsNone(weather_reply({}))
        with patch('cloud.weather.get', side_effect=TimeoutError):
            self.assertIsNone(weather_reply({}, {"lat":30,"lon":-96}))


if __name__ == '__main__':
    unittest.main()


class DayConditionTests(unittest.TestCase):
    def test_one_drizzly_hour_does_not_make_a_dry_day_rainy(self):
        from cloud.weather import day_condition
        hours = [{"condition": "Clear sky", "isDay": True, "rain": 2} for _ in range(9)]
        hours[4] = {"condition": "Drizzle", "isDay": True, "rain": 8}
        self.assertEqual(day_condition(hours, 61, 8), "Clear sky")

    def test_a_wet_day_is_still_wet(self):
        from cloud.weather import day_condition
        hours = [{"condition": "Rain", "isDay": True, "rain": 80} for _ in range(6)]
        self.assertEqual(day_condition(hours, 63, 85), "Rain")
