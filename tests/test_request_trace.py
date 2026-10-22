import importlib.util
from pathlib import Path
import unittest
import http.client
import threading
from http.server import ThreadingHTTPServer
from unittest import mock

spec = importlib.util.spec_from_file_location('trace_relay', Path(__file__).resolve().parents[1] / 'cloud/relay.py')
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)


class TraceTests(unittest.TestCase):
    def test_completed_trace_duration_does_not_grow_when_read_later(self):
        now=[1.0]
        trace=relay.RunTrace(lambda:now[0])
        now[0]=2.0;trace.ended=now[0]
        now[0]=10.0
        self.assertEqual(trace.record('run','complete','router',1)['total_ms'],1000)
    def test_release_capabilities_are_authenticated_and_do_not_echo_untrusted_revision(self):
        key='k'*40
        server=ThreadingHTTPServer(('127.0.0.1',0),relay.make_handler(relay.Relay(0,key)))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            connection=http.client.HTTPConnection('127.0.0.1',server.server_port)
            connection.request('GET','/vaelo/capabilities')
            response=connection.getresponse();self.assertEqual(response.status,401);response.read()
            connection.close()
            with mock.patch.dict('os.environ',{'RENDER_GIT_COMMIT':'private unexpected data'}):
                connection=http.client.HTTPConnection('127.0.0.1',server.server_port)
                connection.request('GET','/vaelo/capabilities',headers={'Authorization':'Bearer '+key,'X-Hermes-Session-Key':'web:test'})
                response=connection.getresponse()
                import json
                result=json.loads(response.read())
                self.assertIsNone(result['revision'])
                self.assertEqual(result['fast_connect_deadline_seconds'],18)
                self.assertIn('python_verify',result['tools'])
                connection.close()
        finally:
            server.shutdown();server.server_close()
    def test_overlapping_tools_are_a_union_and_open_tools_are_explicit(self):
        now = [0.0]
        trace = relay.RunTrace(lambda: now[0])
        trace.tool({'toolCallId': 'one'})
        now[0] = 1
        trace.tool({'toolCallId': 'two'})
        trace.tool({'toolCallId': 'two'})
        now[0] = 2
        trace.tool({'toolCallId': 'one', 'status': 'completed'})
        now[0] = 3
        trace.tool({'toolCallId': 'two', 'status': 'completed'})
        trace.tool({'toolCallId': 'unfinished'})
        row = trace.record('run', 'error', 'hermes', 2)
        self.assertEqual(row['spans_ms']['observed_tools'], 3000)
        self.assertEqual(row['counts']['tool_starts'], 3)
        self.assertEqual(row['counts']['unfinished_tools'], 1)
        self.assertNotIn('unfinished', str(row['spans_ms']))

    def test_failed_spans_and_first_mark_survive_without_content(self):
        now = [0.0]
        trace = relay.RunTrace(lambda: now[0])
        with self.assertRaises(ValueError):
            with trace.span('lookup'):
                now[0] = .25
                raise ValueError('private source body')
        trace.mark('first')
        now[0] = .5
        trace.mark('first')
        row = trace.record('run', 'error', 'hermes', 1)
        self.assertEqual(row['spans_ms']['lookup'], 250)
        self.assertEqual(row['marks_ms']['first'], 250)
        self.assertNotIn('private', str(row))

    def test_tool_tracking_is_bounded(self):
        trace = relay.RunTrace()
        for i in range(1000):
            trace.tool({'toolCallId': str(i), 'arguments': 'secret'})
        self.assertEqual(len(trace.active_tools), 64)
        self.assertNotIn('secret', str(trace.record('r', 'error', None, 0)))
