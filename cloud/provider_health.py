"""Small process-local circuit breaker; never stores credentials or prompt text."""
import threading
import time


class RouteHealth:
    def __init__(self, clock=time.monotonic, cooldown=30):
        self.clock, self.cooldown = clock, cooldown
        self.states, self.lock = {}, threading.Lock()

    def allow(self, route):
        with self.lock:
            state = self.states.get(route)
            if not state or state['failures'] < 2:
                return True
            if self.clock() < state['until'] or state['probe']:
                return False
            state['probe'] = True
            return True

    def success(self, route):
        with self.lock:
            self.states.pop(route, None)

    def failure(self, route):
        with self.lock:
            old = self.states.get(route, {'failures': 0})
            self.states[route] = {'failures': min(2, old['failures'] + 1),
                                  'until': self.clock() + self.cooldown, 'probe': False}
