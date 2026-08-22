import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';
import { checkDatabase, claimPendingSignals } from '../src/repository.js';

const leaseToken = '11111111-1111-4111-8111-111111111111';

function batchDb(rows = []) {
  return {
    prepare(sql) {
      return { bind(...args) { return { sql, args }; } };
    },
    async batch(statements) {
      assert.equal(statements.length, 2);
      assert.match(statements[0].sql, /UPDATE signals/);
      assert.match(statements[1].sql, /lease_token = \?/);
      return [{ results:[] }, { results:rows }];
    }
  };
}

test('health comprueba el esquema signals y no solo SELECT 1', async () => {
  const healthy = { prepare:sql => ({ all:async()=>{ assert.match(sql, /FROM signals/); return { results:[] }; } }) };
  const missing = { prepare:() => ({ all:async()=>{ throw new Error('no such table: signals'); } }) };
  assert.equal(await checkDatabase(healthy), true);
  assert.equal(await checkDatabase(missing), false);
});

test('claim usa un batch transaccional y devuelve lease al consumidor', async () => {
  const rows = [{
    id:'tv_'+'a'.repeat(64), source:'TRADINGVIEW', symbol:'BTCUSD', rawSymbol:'BINANCE:BTCUSDT', exchange:'BINANCE',
    timeframe:'M15', side:'BUY', price:68000, emittedAt:'2026-08-08T12:00:00.000Z', receivedAt:'2026-08-08T12:00:01.000Z',
    strategy:null, leaseToken, leaseUntil:'2026-08-08T12:05:00.000Z', attempts:1, retryReason:null,
  }];
  const signals = await claimPendingSignals(batchDb(rows), {
    limit:10, now:'2026-08-08T12:00:00.000Z', leaseToken, leaseUntil:'2026-08-08T12:05:00.000Z'
  });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].leaseToken, leaseToken);
  assert.equal(signals[0].attempts, 1);
});

test('endpoint claim exige Bearer y retorna contrato reservado', async () => {
  const rows = [{
    id:'tv_'+'b'.repeat(64), symbol:'EURUSD', rawSymbol:'OANDA:EURUSD', exchange:'OANDA', timeframe:'H1', side:'SELL',
    price:1.16, emittedAt:'2026-08-08T12:00:00.000Z', receivedAt:'2026-08-08T12:00:01.000Z', strategy:null,
    leaseToken, leaseUntil:'2026-08-08T12:05:00.000Z', attempts:1, retryReason:null,
  }];
  const request = new Request('https://example.test/api/v1/signals/claim', {
    method:'POST', headers:{ Authorization:'Bearer consumer', 'Content-Type':'application/json' }, body:'{"limit":10}'
  });
  const response = await worker.fetch(request, { DB:batchDb(rows), SENTINEL_CONSUMER_TOKEN:'consumer' });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.signals[0].leaseToken, leaseToken);
});
