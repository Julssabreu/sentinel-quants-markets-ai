import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMarketObservationId,
  isVixDailyObservation,
  normalizeMarketObservation
} from '../src/market-observation.js';

const receivedAt = '2026-08-10T01:00:05.000Z';
const payload = {
  ticker: 'NASDAQ:AAPL',
  exchange: 'NASDAQ',
  market_type: 'stock',
  timeframe: '60',
  open: 220,
  high: 223,
  low: 219.5,
  close: 222.5,
  volume: 125000,
  currency: 'USD',
  observed_at: 1786323600000,
  metadata: { purpose: 'sentinel-market-observation' }
};

test('normaliza una vela universal sin convertirla en senal', async () => {
  const observation = normalizeMarketObservation(payload, receivedAt);
  assert.equal(observation.rawSymbol, 'NASDAQ:AAPL');
  assert.equal(observation.marketType, 'STOCK');
  assert.equal(observation.timeframe, 'H1');
  assert.equal(observation.close, 222.5);
  assert.equal('side' in observation, false);
  assert.match(await createMarketObservationId(observation), /^obs_[a-f0-9]{64}$/);
});

test('rechaza BUY SELL y velas OHLC imposibles', () => {
  assert.throws(() => normalizeMarketObservation({ ...payload, action:'BUY' }, receivedAt), /no acepta BUY\/SELL/);
  assert.throws(() => normalizeMarketObservation({ ...payload, high:218 }, receivedAt), /vela valida/);
});

test('solo enruta VIX diario a su contrato especializado', () => {
  assert.equal(isVixDailyObservation({ ticker:'CBOE:VIX', timeframe:'1D' }), true);
  assert.equal(isVixDailyObservation({ ticker:'CBOE:VIX', timeframe:'60' }), false);
  assert.equal(isVixDailyObservation({ ticker:'NASDAQ:AAPL', timeframe:'1D' }), false);
});
