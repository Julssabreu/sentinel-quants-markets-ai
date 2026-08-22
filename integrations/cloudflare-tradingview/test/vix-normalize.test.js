import assert from 'node:assert/strict';
import test from 'node:test';

import { createVixDailyId, normalizeVixDailyPayload } from '../src/vix.js';

const receivedAt = '2026-08-09T21:05:00.000Z';

test('normaliza VIX diario como contexto sin BUY/SELL', async () => {
  const observation = normalizeVixDailyPayload({
    ticker: 'CBOE:VIX',
    exchange: 'cboe',
    interval: '1D',
    value: '20.25',
    open: '19.4',
    high: '21.1',
    low: '18.9',
    close: '20.25',
    observed_at: '2026-08-09T00:00:00Z',
    metadata: { purpose: 'sentinel-volatility-context' }
  }, receivedAt);

  assert.deepEqual(observation, {
    source: 'TRADINGVIEW',
    symbol: 'VIX',
    rawSymbol: 'CBOE:VIX',
    exchange: 'CBOE',
    timeframe: 'D1',
    observationDate: '2026-08-09',
    value: 20.25,
    open: 19.4,
    high: 21.1,
    low: 18.9,
    close: 20.25,
    observedAt: '2026-08-09T00:00:00.000Z',
    receivedAt,
    metadataJson: '{"purpose":"sentinel-volatility-context"}'
  });

  const id = await createVixDailyId(observation);
  const replayId = await createVixDailyId({ ...observation, value: 20.3 });
  assert.match(id, /^vix_[a-f0-9]{64}$/);
  assert.equal(id, replayId, 'la clave idempotente depende del dia, no de una correccion del valor');
});

test('acepta value sin OHLC y deriva la fecha UTC observada', () => {
  const observation = normalizeVixDailyPayload({
    ticker: 'VIX',
    timeframe: 'D',
    value: 17.5,
    timestamp: 1786233600
  }, receivedAt);

  assert.equal(observation.observationDate, '2026-08-09');
  assert.equal(observation.close, null);
  assert.equal(observation.exchange, null);
});

test('rechaza campos operativos, otros simbolos y velas no diarias', () => {
  assert.throws(() => normalizeVixDailyPayload({
    ticker: 'CBOE:VIX', interval: '1D', value: 20, observed_at: '2026-08-09', side: 'BUY'
  }, receivedAt), /no acepta senales BUY\/SELL/);

  assert.throws(() => normalizeVixDailyPayload({
    ticker: 'CBOE:VIX3M', interval: '1D', value: 20, observed_at: '2026-08-09'
  }, receivedAt), /unicamente el indice VIX/);

  assert.throws(() => normalizeVixDailyPayload({
    ticker: 'CBOE:VIX', interval: '60', value: 20, observed_at: '2026-08-09'
  }, receivedAt), /vela diaria/);
});

test('valida fecha, cierre, rango OHLC y metadata', () => {
  assert.throws(() => normalizeVixDailyPayload({
    ticker: 'CBOE:VIX', interval: '1D', value: 20, observed_at: '2026-08-09',
    observation_date: '2026-08-08'
  }, receivedAt), /debe coincidir/);

  assert.throws(() => normalizeVixDailyPayload({
    ticker: 'CBOE:VIX', interval: '1D', value: 20, close: 21, observed_at: '2026-08-09'
  }, receivedAt), /mismo cierre diario/);

  assert.throws(() => normalizeVixDailyPayload({
    ticker: 'CBOE:VIX', interval: '1D', value: 20, high: 19, low: 18,
    observed_at: '2026-08-09'
  }, receivedAt), /high debe cubrir/);

  assert.throws(() => normalizeVixDailyPayload({
    ticker: 'CBOE:VIX', interval: '1D', value: 20, observed_at: '2026-08-09', metadata: []
  }, receivedAt), /objeto JSON/);

  assert.throws(() => normalizeVixDailyPayload({
    ticker: 'CBOE:VIX', interval: '1D', value: 20, observed_at: '2026-08-09T21:11:00Z'
  }, receivedAt), /cinco minutos en el futuro/);
});
