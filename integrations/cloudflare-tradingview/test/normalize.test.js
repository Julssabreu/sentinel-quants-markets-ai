import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeAckPayload,
  normalizeTimeframe,
  normalizeTradingViewPayload,
  TRADINGVIEW_TO_SENTINEL
} from '../src/normalize.js';

test('convierte las 21 temporalidades de TradingView a Sentinel', () => {
  const expected = [
    'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M10', 'M12', 'M15', 'M20', 'M30',
    'H1', 'H2', 'H3', 'H4', 'H6', 'H8', 'H12', 'D1', 'W1', 'MN1'
  ];

  assert.equal(Object.keys(TRADINGVIEW_TO_SENTINEL).length, 21);
  assert.deepEqual(Object.values(TRADINGVIEW_TO_SENTINEL), expected);
  for (const [tradingView, sentinel] of Object.entries(TRADINGVIEW_TO_SENTINEL)) {
    assert.equal(normalizeTimeframe(tradingView), sentinel);
  }
  assert.equal(normalizeTimeframe('1M'), 'MN1');
});

test('normaliza el contrato de señal y convierte USDT a USD', () => {
  const signal = normalizeTradingViewPayload({
    ticker: 'BINANCE:BTCUSDT',
    exchange: 'binance',
    interval: '15',
    action: 'long',
    close: '68425.50',
    timestamp: '2026-08-08T12:00:00Z',
    strategy_name: 'Atomic'
  }, '2026-08-08T12:00:01.000Z');

  assert.deepEqual(signal, {
    source: 'TRADINGVIEW',
    symbol: 'BTCUSD',
    rawSymbol: 'BINANCE:BTCUSDT',
    exchange: 'BINANCE',
    timeframe: 'M15',
    side: 'BUY',
    price: 68425.5,
    emittedAt: '2026-08-08T12:00:00.000Z',
    receivedAt: '2026-08-08T12:00:01.000Z',
    strategy: 'Atomic',
    alertId: null
  });
});

test('normaliza contratos perpetuos de TradingView para MT5', () => {
  const signal = normalizeTradingViewPayload({
    ticker:'BINANCE:BTCUSDT.P', interval:'15', action:'BUY', timestamp:'2026-08-08T12:00:00Z'
  }, '2026-08-08T12:00:01.000Z');
  assert.equal(signal.symbol, 'BTCUSD');
  assert.equal(signal.rawSymbol, 'BINANCE:BTCUSDT.P');
});

test('sentinel_symbol tiene prioridad y alert_id permite omitir la fecha', () => {
  const signal = normalizeTradingViewPayload({
    ticker: 'BTCUSDT',
    sentinel_symbol: 'XBTUSD',
    timeframe: '60',
    side: 'sell',
    alert_id: 'unique-alert-2'
  }, '2026-08-08T12:00:01.000Z');

  assert.equal(signal.symbol, 'XBTUSD');
  assert.equal(signal.side, 'SELL');
  assert.equal(signal.price, null);
  assert.equal(signal.emittedAt, null);
});

test('exige timestamp o alert_id para evitar colisiones de deduplicación', () => {
  assert.throws(() => normalizeTradingViewPayload({
    ticker:'BTCUSDT', timeframe:'15', side:'buy'
  }, '2026-08-08T12:00:01.000Z'), /timestamp o alert_id/);
});

test('rechaza una temporalidad fuera de las 21 de Sentinel', () => {
  assert.throws(() => normalizeTimeframe('45'), /21 temporalidades/);
});

test('impide que VIX entre en la bandeja operativa BUY/SELL', () => {
  assert.throws(() => normalizeTradingViewPayload({
    ticker:'CBOE:VIX', timeframe:'D', side:'buy', timestamp:'2026-08-08T12:00:00Z'
  }, '2026-08-08T12:00:01.000Z'), /contexto diario/);
});

test('normaliza ACK, reintentos y lease token', () => {
  assert.deepEqual(normalizeAckPayload({
    status: 'processed',
    leaseToken: '11111111-1111-4111-8111-111111111111',
    verdict: 'VALID',
    detail: 'Consumida por Sentinel'
  }), {
    status: 'PROCESSED',
    leaseToken: '11111111-1111-4111-8111-111111111111',
    retryAfterSeconds: null,
    verdict: 'VALID',
    detail: 'Consumida por Sentinel'
  });
  assert.throws(() => normalizeAckPayload({ status: 'PENDING', leaseToken:'11111111-1111-4111-8111-111111111111' }), /RETRY/);
  assert.throws(() => normalizeAckPayload({ status: 'PROCESSED' }), /leaseToken/);
  assert.deepEqual(normalizeAckPayload({
    status:'RETRY', leaseToken:'11111111-1111-4111-8111-111111111111', retryAfterSeconds:5
  }), {
    status:'RETRY', leaseToken:'11111111-1111-4111-8111-111111111111', retryAfterSeconds:10,
    verdict:null, detail:null
  });
});
