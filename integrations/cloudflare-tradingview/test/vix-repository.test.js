import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkVixDatabase,
  getVixHistory,
  purgeVixHistory,
  upsertVixDaily
} from '../src/vix-repository.js';

function statementDb({ changes = 1, rows = [] } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return {
            run: async () => ({ meta: { changes } }),
            all: async () => ({ results: rows })
          };
        },
        all: async () => ({ results: rows })
      };
    }
  };
}

const observation = {
  id: 'vix_' + 'a'.repeat(64),
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
  receivedAt: '2026-08-09T21:05:00.000Z',
  metadataJson: '{"purpose":"test"}'
};

test('upsert diario usa una clave unica y distingue replay exacto', async () => {
  const insertedDb = statementDb({ changes: 1 });
  assert.equal(await upsertVixDaily(insertedDb, observation), true);
  assert.match(insertedDb.calls[0].sql, /ON CONFLICT \(source, symbol, observation_date\)/);
  assert.equal(insertedDb.calls[0].args[6], '2026-08-09');

  const duplicateDb = statementDb({ changes: 0 });
  assert.equal(await upsertVixDaily(duplicateDb, observation), false);
});

test('devuelve historico reciente tipado como MARKET_CONTEXT', async () => {
  const row = {
    id: observation.id,
    rawSymbol: 'CBOE:VIX',
    exchange: 'CBOE',
    observationDate: '2026-08-09',
    value: 20.25,
    open: null,
    high: 21.1,
    low: 18.9,
    close: 20.25,
    observedAt: '2026-08-09T00:00:00.000Z',
    receivedAt: '2026-08-09T21:05:00.000Z',
    metadata: '{"purpose":"test"}',
    updatedAt: '2026-08-09T21:05:00.000Z'
  };
  const db = statementDb({ rows: [row] });
  const history = await getVixHistory(db, 60);

  assert.equal(db.calls[0].args[0], 60);
  assert.equal(history[0].contextType, 'MARKET_CONTEXT');
  assert.equal(history[0].symbol, 'VIX');
  assert.equal(history[0].value, 20.25);
  assert.deepEqual(history[0].metadata, { purpose: 'test' });
  assert.equal('side' in history[0], false);
});

test('health comprueba vix_daily y la purga usa solo la fecha de corte', async () => {
  const healthy = statementDb();
  assert.equal(await checkVixDatabase(healthy), true);

  const missing = {
    prepare: () => ({ all: async () => { throw new Error('no such table: vix_daily'); } })
  };
  assert.equal(await checkVixDatabase(missing), false);

  const purgeDb = statementDb();
  await purgeVixHistory(purgeDb, '2001-08-09');
  assert.match(purgeDb.calls[0].sql, /DELETE FROM vix_daily/);
  assert.deepEqual(purgeDb.calls[0].args, ['2001-08-09']);
});
