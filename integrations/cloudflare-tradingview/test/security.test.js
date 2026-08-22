import assert from 'node:assert/strict';
import test from 'node:test';

import {
  constantTimeEqual,
  extractBearerToken,
  hasValidBearer,
  hasValidBodySecret,
  hasValidTradingViewIp,
  TRADINGVIEW_WEBHOOK_IPS
} from '../src/auth.js';
import { MAX_JSON_BODY_BYTES, readJsonObject } from '../src/body.js';
import { createSignalId } from '../src/signal-id.js';

test('valida secreto de cuerpo y Bearer sin aceptar formatos ambiguos', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('abc', 'abcx'), false);
  assert.equal(hasValidBodySecret({ secret: 'tv-secret' }, 'tv-secret'), true);
  assert.equal(extractBearerToken('Bearer sentinel-token'), 'sentinel-token');
  assert.equal(extractBearerToken('Basic sentinel-token'), null);

  const request = new Request('https://example.test/api/v1/signals', {
    headers: { Authorization: 'Bearer sentinel-token' }
  });
  assert.equal(hasValidBearer(request, 'sentinel-token'), true);
  assert.equal(hasValidBearer(request, 'otro-token'), false);
});

test('solo acepta las cuatro IP oficiales de webhooks de TradingView', () => {
  assert.equal(TRADINGVIEW_WEBHOOK_IPS.size, 4);
  for (const ip of TRADINGVIEW_WEBHOOK_IPS) {
    const request = new Request('https://example.test/webhooks/tradingview', {
      headers: { 'CF-Connecting-IP': ip }
    });
    assert.equal(hasValidTradingViewIp(request), true);
  }

  const unknown = new Request('https://example.test/webhooks/tradingview', {
    headers: { 'CF-Connecting-IP': '203.0.113.10' }
  });
  assert.equal(hasValidTradingViewIp(unknown), false);
  assert.equal(hasValidTradingViewIp(unknown, true), true);
});

test('limita el JSON a 16 KB y exige un objeto', async () => {
  const valid = new Request('https://example.test/webhooks/tradingview', {
    method: 'POST',
    body: JSON.stringify({ action: 'BUY' })
  });
  assert.deepEqual(await readJsonObject(valid), { action: 'BUY' });

  const oversized = new Request('https://example.test/webhooks/tradingview', {
    method: 'POST',
    body: JSON.stringify({ value: 'x'.repeat(MAX_JSON_BODY_BYTES) })
  });
  await assert.rejects(() => readJsonObject(oversized), (error) => error.status === 413);

  const arrayBody = new Request('https://example.test/webhooks/tradingview', {
    method: 'POST',
    body: '[]'
  });
  await assert.rejects(() => readJsonObject(arrayBody), (error) => error.status === 400);
});

test('el ID es estable para reintentos y cambia con la señal', async () => {
  const base = {
    source: 'TRADINGVIEW',
    symbol: 'BTCUSD',
    rawSymbol: 'BTCUSDT',
    exchange: 'BINANCE',
    timeframe: 'M15',
    side: 'BUY',
    price: 68000,
    emittedAt: '2026-08-08T12:00:00.000Z',
    strategy: 'Atomic',
    alertId: 'alert-1'
  };
  const first = await createSignalId(base);
  const replay = await createSignalId({ ...base });
  const different = await createSignalId({ ...base, side: 'SELL' });

  assert.match(first, /^tv_[a-f0-9]{64}$/);
  assert.equal(first, replay);
  assert.notEqual(first, different);
});
