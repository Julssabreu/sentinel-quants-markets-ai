import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';

function webhookRequest(payload, connectingIp = '203.0.113.10') {
  return new Request('https://example.test/webhooks/tradingview', {
    method: 'POST',
    headers: {
      'CF-Connecting-IP': connectingIp,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

test('el bypass local de IP no omite el secreto del cuerpo', async () => {
  const response = await worker.fetch(webhookRequest({ secret: 'incorrecto' }), {
    DB: {},
    TRADINGVIEW_WEBHOOK_SECRET: 'correcto',
    ALLOW_NON_TRADINGVIEW_IPS: 'true'
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('sin bypass rechaza una IP ajena antes de leer la señal', async () => {
  const response = await worker.fetch(webhookRequest({ secret: 'correcto' }), {
    DB: {},
    TRADINGVIEW_WEBHOOK_SECRET: 'correcto'
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.error.code, 'FORBIDDEN');
});

test('health identifica estrictamente el servicio y la version del contrato', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/v1/health', {
    headers: { Authorization: 'Bearer consumidor' }
  }), {
    DB: { prepare: () => ({ all: async () => ({ results: [] }) }) },
    SENTINEL_CONSUMER_TOKEN: 'consumidor'
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, 'sentinel-tradingview-bridge');
  assert.equal(body.contractVersion, 3);
  assert.ok(Number.isFinite(Date.parse(body.checkedAt)));
});
