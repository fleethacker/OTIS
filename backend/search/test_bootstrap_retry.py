"""Bounded retry behavior for interrupted offline model uploads."""
import io
import unittest
import urllib.error
from unittest.mock import patch

import deploy


class BootstrapRetryTests(unittest.TestCase):
    def rejection(self, code):
        return urllib.error.HTTPError('http://opensearch/test', code, 'rejected', {}, io.BytesIO(b'{}'))

    def test_rejected_chunk_reuses_exact_request_after_backoff(self):
        with patch.object(deploy.OPENER, 'open') as open_request, patch.object(deploy.time, 'sleep') as sleep:
            response = unittest.mock.MagicMock()
            response.__enter__.return_value.read.return_value = b'{"stored":true}'
            open_request.side_effect = [self.rejection(429), response]
            self.assertEqual(deploy.request('POST', '/model/upload_chunk/17', b'chunk'), {'stored': True})
            first, second = [call.args[0] for call in open_request.call_args_list]
            self.assertIs(first, second)
            self.assertEqual(second.data, b'chunk')
            sleep.assert_called_once_with(2)

    def test_repeated_pressure_has_a_finite_retry_budget(self):
        with patch.object(deploy.OPENER, 'open', side_effect=[self.rejection(429) for _ in range(6)]) as open_request, patch.object(deploy.time, 'sleep') as sleep:
            with self.assertRaises(urllib.error.HTTPError) as failure:
                deploy.request('POST', '/model/upload_chunk/17', b'chunk')
            self.assertEqual(open_request.call_count, 6)
            failure.exception.close()
            self.assertEqual([call.args[0] for call in sleep.call_args_list], [2, 4, 8, 16, 16])

    def test_ambiguous_failures_and_non_throttling_errors_are_not_replayed(self):
        for error in (self.rejection(503), self.rejection(400), OSError('connection interrupted')):
            with self.subTest(error=error), patch.object(deploy.OPENER, 'open', side_effect=error) as open_request, patch.object(deploy.time, 'sleep') as sleep:
                with self.assertRaises(type(error)):
                    deploy.request('POST', '/_plugins/_ml/models/_register_meta', {})
                self.assertEqual(open_request.call_count, 1)
                sleep.assert_not_called()
            if isinstance(error, urllib.error.HTTPError):
                error.close()


if __name__ == '__main__':
    unittest.main()
