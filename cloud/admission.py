"""Bounded, cancellation-aware admission without increasing provider concurrency."""
import threading
import time


class Admission:
    def __init__(self, capacity=1, maximum=16, timeout=120, clock=time.monotonic):
        self.capacity, self.maximum, self.timeout, self.clock = capacity, maximum, timeout, clock
        self.active, self.pending, self.last_owner = set(), [], None
        self.condition = threading.Condition()

    def acquire(self, run):
        began = self.clock()
        with self.condition:
            if run in self.active: return True
            if len(self.pending) >= self.maximum:
                return False
            self.pending.append(run)
            if len(self.active) >= self.capacity or len(self.pending) > 1:
                run.event('jarvis.queued', {'message': 'Queued — waiting for a free reply slot.', 'position': len(self.pending)})
            try:
                while not run.stopped and self.clock() - began < self.timeout:
                    # Alternate accounts when possible while keeping each account FIFO.
                    next_run = next((item for item in self.pending if item.owner != self.last_owner), self.pending[0])
                    if len(self.active) < self.capacity and next_run is run:
                        self.active.add(run)
                        self.last_owner = run.owner
                        elapsed = round((self.clock() - began) * 1000)
                        run.trace.spans['queue'] = run.trace.spans.get('queue', 0) + elapsed
                        run.event('jarvis.status', {'message': 'Vaelo is working…'})
                        return True
                    self.condition.wait(.25)
                return False
            finally:
                self.pending.remove(run)

    def release(self, run):
        with self.condition:
            self.active.discard(run)
            self.condition.notify_all()
