from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import patch

from services import mt5_bridge


def symbol(name: str) -> SimpleNamespace:
    return SimpleNamespace(
        name=name,
        description=name,
        path='Test',
        category='',
        exchange='',
        isin='',
        sector=None,
        industry=None,
        currency_base='',
        currency_profit='USD',
        currency_margin='USD',
        trade_calc_mode=0,
        digits=5,
        trade_contract_size=100000.0,
        trade_tick_size=0.00001,
        trade_tick_value=1.0,
        trade_tick_value_profit=1.0,
        trade_tick_value_loss=1.0,
        volume_min=0.01,
        volume_max=100.0,
        volume_step=0.01,
    )


class ResolveSymbolTests(TestCase):
    def test_canonical_symbol_removes_explicit_broker_suffix(self):
        self.assertEqual(mt5_bridge.canonical_symbol('BTCUSD.m'), 'BTCUSD')
        self.assertEqual(mt5_bridge.canonical_symbol('EURUSD.a'), 'EURUSD')

    def resolve(self, requested: str, names: list[str]):
        with patch.object(mt5_bridge.mt5, 'symbols_get', return_value=tuple(symbol(name) for name in names)):
            return mt5_bridge.resolve_symbol(requested)

    def test_exact_broker_symbol_wins(self):
        result = self.resolve('EURUSD', ['EURUSD', 'EURUSD.a'])
        self.assertTrue(result['ok'])
        self.assertEqual(result['item'].name, 'EURUSD')
        self.assertEqual(result['method'], 'EXACT_BROKER_SYMBOL')

    def test_unique_suffix_is_allowed(self):
        result = self.resolve('EURUSD', ['EURUSD.a', 'GBPUSD.a'])
        self.assertTrue(result['ok'])
        self.assertEqual(result['item'].name, 'EURUSD.a')
        self.assertEqual(result['method'], 'UNIQUE_BROKER_SUFFIX')

    def test_equal_suffixes_are_ambiguous(self):
        result = self.resolve('EURUSD', ['EURUSD.a', 'EURUSD.b'])
        self.assertFalse(result['ok'])
        self.assertEqual(result['error'], 'SYMBOL_AMBIGUOUS')
        self.assertEqual([item['symbol'] for item in result['candidates']], ['EURUSD.a', 'EURUSD.b'])

    def test_generic_substring_is_rejected(self):
        result = self.resolve('APPLE', ['US.APPLE.CFD'])
        self.assertFalse(result['ok'])
        self.assertEqual(result['error'], 'SYMBOL_NOT_FOUND')


class HistoricalRatesSafetyTests(TestCase):
    def test_broker_clock_detects_three_hour_server_offset(self):
        now = datetime(2026, 8, 16, 17, 0, tzinfo=timezone.utc)
        raw_tick = datetime(2026, 8, 16, 20, 0, 3, tzinfo=timezone.utc).timestamp()
        self.assertEqual(mt5_bridge._clock_candidate(int(raw_tick), now.timestamp()), 3 * 60 * 60)

    def test_broker_clock_rejects_stale_non_calibration_tick(self):
        now = datetime(2026, 8, 16, 17, 0, tzinfo=timezone.utc)
        stale = datetime(2026, 8, 15, 17, 0, tzinfo=timezone.utc).timestamp()
        self.assertIsNone(mt5_bridge._clock_candidate(int(stale), now.timestamp()))

    def test_broker_clock_ignores_large_stale_symbol_cohort(self):
        now = datetime(2026, 8, 18, 2, 46, tzinfo=timezone.utc)
        current_server_tick = int(datetime(2026, 8, 18, 5, 46, tzinfo=timezone.utc).timestamp())
        stale_tick = int(datetime(2026, 8, 17, 23, 1, tzinfo=timezone.utc).timestamp())
        symbols = tuple(SimpleNamespace(name=f'STALE{i}', visible=True) for i in range(120)) + (
            SimpleNamespace(name='BTCUSD', visible=True),
        )

        def tick_for(name: str):
            return SimpleNamespace(time=current_server_tick if name == 'BTCUSD' else stale_tick)

        with (
            patch.object(mt5_bridge.mt5, 'symbols_get', return_value=symbols),
            patch.object(mt5_bridge.mt5, 'symbol_info_tick', side_effect=tick_for),
        ):
            result = mt5_bridge._detect_broker_clock(now)

        self.assertEqual(result['status'], 'BROKER_CLOCK_CORRECTED')
        self.assertEqual(result['offsetSeconds'], 3 * 60 * 60)
        self.assertEqual(result['sampleCount'], 1)

    def test_normalized_epoch_removes_detected_offset(self):
        raw = datetime(2026, 8, 16, 20, 0, tzinfo=timezone.utc).timestamp()
        normalized = mt5_bridge._normalized_epoch(raw, {"offsetSeconds": 10800})
        self.assertEqual(
            datetime.fromtimestamp(normalized, timezone.utc),
            datetime(2026, 8, 16, 17, 0, tzinfo=timezone.utc),
        )

    def test_open_candle_is_not_closed(self):
        now = datetime(2026, 8, 10, 15, 30, tzinfo=timezone.utc).timestamp()
        opened = datetime(2026, 8, 10, 15, 0, tzinfo=timezone.utc).timestamp()
        self.assertFalse(mt5_bridge._closed_bar(int(opened), 'H1', now))
        self.assertTrue(mt5_bridge._closed_bar(int(opened), 'M30', now))

    def test_monthly_close_uses_next_calendar_month(self):
        opened = datetime(2026, 2, 1, tzinfo=timezone.utc).timestamp()
        february_end = datetime(2026, 3, 1, tzinfo=timezone.utc).timestamp()
        self.assertTrue(mt5_bridge._closed_bar(int(opened), 'MN1', february_end))

    def test_mt5_range_error_is_not_treated_as_an_empty_window(self):
        matched = symbol('EURUSD')
        with (
            patch.object(mt5_bridge, 'resolve_symbol', return_value={
                'ok': True, 'item': matched, 'method': 'EXACT_BROKER_SYMBOL',
                'requested': 'EURUSD', 'matched': 'EURUSD',
            }),
            patch.object(mt5_bridge.mt5, 'symbol_select', return_value=True),
            patch.object(mt5_bridge.mt5, 'copy_rates_range', return_value=None),
            patch.object(mt5_bridge.mt5, 'last_error', return_value=(500, 'terminal error')),
        ):
            result = mt5_bridge.rates_after(
                'EURUSD', 'H1', '2026-08-09T12:00:00+00:00', 100,
            )
        self.assertFalse(result['ok'])
        self.assertEqual(result['error'], 'RATES_UNAVAILABLE')

    def test_rates_after_returns_earliest_closed_page_with_safe_contract(self):
        matched = symbol('EURUSD')
        until = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        after = until - mt5_bridge.timedelta(minutes=20)
        rows = [
            {'time': int((until - mt5_bridge.timedelta(minutes=15)).timestamp()), 'open': 1.1, 'high': 1.11, 'low': 1.09, 'close': 1.105, 'tick_volume': 10, 'spread': 1, 'real_volume': 0},
            {'time': int((until - mt5_bridge.timedelta(minutes=10)).timestamp()), 'open': 1.105, 'high': 1.115, 'low': 1.1, 'close': 1.11, 'tick_volume': 11, 'spread': 1, 'real_volume': 0},
            {'time': int((until - mt5_bridge.timedelta(minutes=5)).timestamp()), 'open': 1.11, 'high': 1.12, 'low': 1.1, 'close': 1.115, 'tick_volume': 12, 'spread': 1, 'real_volume': 0},
        ]
        with (
            patch.object(mt5_bridge, 'resolve_symbol', return_value={
                'ok': True, 'item': matched, 'method': 'EXACT_BROKER_SYMBOL',
                'score': (0, 6), 'requested': 'EURUSD', 'matched': 'EURUSD',
            }),
            patch.object(mt5_bridge, 'broker_clock', return_value={
                'status': 'UTC_CONFIRMED', 'offsetSeconds': 0, 'sampleCount': 3,
                'measuredAt': until.isoformat(),
            }),
            patch.object(mt5_bridge.mt5, 'symbol_select', return_value=True),
            patch.object(mt5_bridge.mt5, 'symbol_info_tick', return_value=None),
            patch.object(mt5_bridge.mt5, 'copy_rates_range', return_value=rows),
        ):
            result = mt5_bridge.rates_after('EURUSD', 'M5', after.isoformat(), 2, until.isoformat())
        self.assertTrue(result['ok'])
        self.assertEqual([item['time'] for item in result['candles']], [
            (until - mt5_bridge.timedelta(minutes=15)).isoformat(),
            (until - mt5_bridge.timedelta(minutes=10)).isoformat(),
        ])
        self.assertTrue(result['hasMore'])
        self.assertEqual(result['pageLimit'], 2)
        self.assertEqual(result['after'], after.isoformat())
        self.assertEqual(result['queryUntil'], until.isoformat())
        self.assertEqual(result['permissions'], 'read-only')
        self.assertFalse(result['liveOrderSent'])
        self.assertFalse(result['executionAuthorized'])


if __name__ == '__main__':
    main()
