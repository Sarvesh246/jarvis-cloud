"""Bounded keep-alive leases for direct provider calls, never agent tool runs."""
import http.client
import threading
import time


class ConnectionPool:
    def __init__(self, factory=http.client.HTTPSConnection, limit=4, idle_seconds=30, clock=time.monotonic):
        self.factory, self.limit, self.idle_seconds, self.clock = factory, limit, idle_seconds, clock
        self.idle, self.lock = [], threading.Lock()

    def acquire(self, host, port=443, timeout=4):
        with self.lock:
            connection = None
            kept = []
            for address, at, item in self.idle:
                if self.clock() - at > self.idle_seconds:
                    item.close()
                elif connection is None and address == (host, port):
                    connection = item
                else:
                    kept.append((address, at, item))
            self.idle = kept
        return Lease(self, (host, port), connection or self.factory(host, port, timeout=timeout), timeout)

    def release(self, address, connection):
        with self.lock:
            if len(self.idle) >= self.limit:
                self.idle.pop(0)[2].close()
            self.idle.append((address, self.clock(), connection))


class Lease:
    def __init__(self, pool, address, connection, timeout):
        self.pool, self.address, self.connection = pool, address, connection
        self.response, self.reusable = None, True
        self.timeout = timeout

    @property
    def sock(self):
        return self.connection.sock if self.connection else None

    @property
    def timeout(self):
        return self.connection.timeout if self.connection else None

    @timeout.setter
    def timeout(self, value):
        self.connection.timeout = value
        if self.connection.sock is not None:
            self.connection.sock.settimeout(value)

    def request(self, *args, **kwargs):
        return self.connection.request(*args, **kwargs)

    def getresponse(self):
        self.response = self.connection.getresponse()
        return self.response

    def discard(self):
        self.reusable = False

    def close(self):
        connection, self.connection = self.connection, None
        if connection is None:
            return
        response = self.response
        if (self.reusable and response is not None and response.isclosed() and
                not response.will_close and connection.sock is not None and
                (response.length == 0 or response.chunked and response.chunk_left is None)):
            self.pool.release(self.address, connection)
        else:
            connection.close()
