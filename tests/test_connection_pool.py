import unittest
from unittest.mock import Mock
from cloud.connection_pool import ConnectionPool


class ConnectionPoolTests(unittest.TestCase):
    def test_only_fully_read_responses_reuse_connections_and_old_leases_detach(self):
        connection = Mock()
        connection.getresponse.return_value = Mock(isclosed=lambda: True, will_close=False, length=0, chunked=False)
        factory = Mock(return_value=connection)
        pool = ConnectionPool(factory=factory)
        first = pool.acquire("example.test")
        first.getresponse()
        first.close()
        self.assertIsNone(first.sock)
        second = pool.acquire("example.test")
        self.assertIs(second.connection, connection)
        factory.assert_called_once()
        second.discard()
        second.close()
        connection.close.assert_called_once()
        pool.acquire("example.test")
        self.assertEqual(factory.call_count, 2)

    def test_expired_connections_are_closed_and_pool_is_bounded(self):
        at = [0]
        factory = Mock(side_effect=lambda *args, **kwargs: Mock())
        pool = ConnectionPool(factory=factory, limit=1, clock=lambda: at[0])
        a = Mock(); b = Mock()
        pool.release(("a",443), a)
        pool.release(("b",443), b)
        a.close.assert_called_once()
        at[0] = 31
        pool.acquire("b")
        b.close.assert_called_once()

    def test_partially_consumed_stream_is_never_reused(self):
        connection = Mock()
        connection.getresponse.return_value = Mock(isclosed=lambda: False, will_close=False, length=100, chunked=False)
        pool = ConnectionPool(factory=Mock(return_value=connection))
        lease = pool.acquire("example.test")
        lease.getresponse(); lease.close()
        self.assertEqual(pool.idle, [])
        connection.close.assert_called_once()
