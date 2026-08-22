import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';

const officialTradingViewIp = '52.89.214.238';

function vixRequest(payload, connectingIp = officialTradingViewIp) {
  return new Request('https://example.test/webhooks/tradingview/vix', {
    method: 'POST',
    headers: {
      'CF-Connecting-IP': connectingIp,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

function writeDb(changes = 1) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              assert.match(sql, /INSERT INTO vix_daily/);
              assert.equal(args[2], 'VIX');
              return { meta: { changes } };
            }
          };
        }
      };
    }
  };
}

const validPayload = {
  secret: 'tv-secret',
  ticker: 'CBOE:VIX',
  exchange: 'CBOE',
  interval: '1D',
  value: '20.25',
  close: '20.25',
  observed_at: '2026-08-09T00:00:00Z'
};

test('webhook VIX escribe contexto diario separado de signals', async () => {
  const response = await worker.fetch(vixRequest(validPayload), {
    DB: writeDb(),
    TRADINGVIEW_WEBHOOK_SECRET: 'tv-secret'
  });
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.contextType, 'MARKET_CONTEXT');
  assert.equal(body.operationalSignal, false);
  assert.equal(body.observationDate, '2026-08-09');
  assert.equal(body.accepted, true);
  assert.match(body.id, /^vix_[a-f0-9]{64}$/);
});

test('webhook VIX conserva allowlist y secreto aun con bypass local', async () => {
  const foreignIp = await worker.fetch(vixRequest(validPayload, '203.0.113.10'), {
    DB: writeDb(),
    TRADINGVIEW_WEBHOOK_SECRET: 'tv-secret'
  });
  assert.equal(foreignIp.status, 403);

  const badSecret = await worker.fetch(vixRequest({ ...validPayload, secret: 'incorrecto' }, '203.0.113.10'), {
    DB: writeDb(),
    TRADINGVIEW_WEBHOOK_SECRET: 'tv-secret',
    ALLOW_NON_TRADINGVIEW_IPS: 'true'
  });
  assert.equal(badSecret.status, 401);
});

function contextDb(rows) {
  return {
    prepare(sql) {
      return {
        bind(limit) {
          assert.match(sql, /FROM vix_daily/);
          assert.equal(limit, 60);
          return { all: async () => ({ results: rows }) };
        }
      };
    }
  };
}

test('API VIX exige Bearer y entrega snapshot mas historico', async () => {
  const url = 'https://example.test/api/v1/context/vix?limit=60';
  const unauthorized = await worker.fetch(new Request(url), {
    DB: contextDb([]),
    SENTINEL_CONSUMER_TOKEN: 'consumer'
  });
  assert.equal(unauthorized.status, 401);

  const row = {
    id: 'vix_' + 'b'.repeat(64),
    rawSymbol: 'CBOE:VIX',
    exchange: 'CBOE',
    observationDate: '2026-08-09',
    value: 20.25,
    open: 19.4,
    high: 21.1,
    low: 18.9,
    close: 20.25,
    observedAt: '2026-08-09T00:00:00.000Z',
    receivedAt: '2026-08-09T21:05:00.000Z',
    metadata: null,
    updatedAt: '2026-08-09T21:05:00.000Z'
  };
  const authorized = await worker.fetch(new Request(url, {
    headers: { Authorization: 'Bearer consumer' }
  }), {
    DB: contextDb([row]),
    SENTINEL_CONSUMER_TOKEN: 'consumer'
  });
  const body = await authorized.json();

  assert.equal(authorized.status, 200);
  assert.equal(body.contextType, 'MARKET_CONTEXT');
  assert.equal(body.operationalSignal, false);
  assert.equal(body.snapshot.value, 20.25);
  assert.equal(body.history.length, 1);
  assert.equal('side' in body.snapshot, false);
});

test('API VIX valida limite, parametros y metodo', async () => {
  const env = { DB: contextDb([]), SENTINEL_CONSUMER_TOKEN: 'consumer' };
  const headers = { Authorization: 'Bearer consumer' };

  const invalidLimit = await worker.fetch(new Request(
    'https://example.test/api/v1/context/vix?limit=366', { headers }
  ), env);
  assert.equal(invalidLimit.status, 400);

  const unknownParameter = await worker.fetch(new Request(
    'https://example.test/api/v1/context/vix?foo=bar', { headers }
  ), env);
  assert.equal(unknownParameter.status, 400);

  const wrongMethod = await worker.fetch(new Request(
    'https://example.test/api/v1/context/vix', { method: 'POST', headers }
  ), env);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET');
});
