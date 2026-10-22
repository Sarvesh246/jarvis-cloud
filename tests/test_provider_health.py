import unittest
from cloud.provider_health import RouteHealth


class HealthTests(unittest.TestCase):
    def test_circuit_skips_repeated_failures_and_allows_one_recovery_probe(self):
        now=[0]
        health=RouteHealth(clock=lambda:now[0])
        health.failure('router')
        self.assertTrue(health.allow('router'))
        health.failure('router')
        self.assertFalse(health.allow('router'))
        self.assertTrue(health.allow('openrouter'))
        now[0]=31
        self.assertTrue(health.allow('router'))
        self.assertFalse(health.allow('router'))
        health.success('router')
        self.assertTrue(health.allow('router'))
