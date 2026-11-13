import unittest
from unittest.mock import Mock
from cloud.relay import Relay, Run


class JournalRecoveryTests(unittest.TestCase):
    def test_restart_replays_numbered_frames_without_starting_generation(self):
        relay = Relay(1, "synthetic")
        relay.journal = Mock()
        relay.journal.load.return_value = {"frames": [b'id: 0\ndata: first\n\n'], "created": 1, "done": False, "outcome": "running"}
        run = relay.find("recovered", "web:owner")
        self.assertTrue(run.done)
        self.assertTrue(run.model_started)
        self.assertEqual(run.frames[0], b'id: 0\ndata: first\n\n')
        self.assertIn(b'run_interrupted', run.frames[1])
        relay.execute = Mock()
        self.assertIs(relay.start("recovered", "web:owner", {}), run)
        relay.execute.assert_not_called()
        self.assertIsNone(relay.find("recovered", "web:other"))

    def test_complete_reply_keeps_original_event_numbers_and_outcome(self):
        relay = Relay(1, "synthetic")
        relay.journal = Mock()
        relay.journal.load.return_value = {"frames": [b'id: 0\nevent: jarvis.complete\ndata: {}\n\n'], "created": 1, "done": True, "outcome": "complete"}
        run = relay.find("finished", "web:owner")
        self.assertEqual(run.outcome, "complete")
        self.assertEqual(len(run.frames), 1)

    def test_temporary_and_guest_runs_never_enter_shared_storage(self):
        for owner, body in [("web:owner", {"temporary": True}), ("web:guest:anonymous", {})]:
            relay = Relay(1, "synthetic")
            relay.journal = Mock()
            relay.execute = Mock()
            run = relay.start("private", owner, body)
            self.assertIsNone(run.journal)
            relay.journal.create.assert_not_called()
            relay.journal.load.assert_not_called()

    def test_frames_and_completion_are_submitted_in_order(self):
        journal = Mock()
        run = Run("id", "web:owner", journal)
        run.emit("data: hello")
        journal.append.assert_called_once_with(run, 0, run.frames[0])
        run.finish("complete")
        journal.finish.assert_called_once_with(run)
