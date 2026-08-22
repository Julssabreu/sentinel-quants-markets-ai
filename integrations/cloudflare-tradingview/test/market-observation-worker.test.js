import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';

function request(payload) {
  return new Request('https://example.test/webhooks/tradingview/market', {
    method:'POST',
    headers:{ 'CF-Connecting-IP':'52.89.214.238', 'Content-Type':'application/json' },
    body:JSON.stringify(payload)
  });
}

const common = {
  secret:'tv-secret', event_type:'MARKET_OBSERVATION', exchange:'NASDAQ',
  ticker:'NASDAQ:AAPL', market_type:'stock', timeframe:'60',
  open:220, high:223, low:219.5, close:222.5, volume:1000,
  observed_at:'2026-08-10T01:00:00Z'
};

function db(expectedTable) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return { async run() {
            assert.match(sql, new RegExp(`INSERT INTO ${expectedTable}`));
            assert.ok(args.length > 10);
            return { meta:{ changes:1 } };
          }};
        }
      };
    }
  };
}

test('endpoint universal guarda una observacion no operativa', async () => {
  const response = await worker.fetch(request(common), {
    DB:db('market_observations'), TRADINGVIEW_WEBHOOK_SECRET:'tv-secret'
  });
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.contextType, 'MARKET_OBSERVATION');
  assert.equal(body.operationalSignal, false);
  assert.equal(body.routedAs, 'MARKET_OBSERVATION');
});

test('endpoint universal enruta CBOE VIX diario a vix_daily', async () => {
  const response = await worker.fetch(request({
    ...common, ticker:'CBOE:VIX', exchange:'CBOE', market_type:'index', timeframe:'1D',
    open:20, high:22, low:19, close:21, volume:null
  }), { DB:db('vix_daily'), TRADINGVIEW_WEBHOOK_SECRET:'tv-secret' });
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.routedAs, 'VIX_DAILY');
  assert.equal(body.contextType, 'MARKET_CONTEXT');
  assert.equal(body.operationalSignal, false);
});

test('Sentinel consulta observaciones autenticadas sin convertirlas en senales', async () => {
  const DB = {
    prepare(sql) {
      assert.match(sql, /FROM market_observations/);
      return { bind(...args) { return { async all() {
        assert.deepEqual(args, ['%EURUSD', 'H1', 3]);
        return { results:[{
          id:'obs_1', source:'TRADINGVIEW', raw_symbol:'OANDA:EURUSD', exchange:'OANDA',
          market_type:'FOREX', timeframe:'H1', observed_at:'2026-08-10T02:00:00.000Z',
          open:1.15, high:1.16, low:1.14, close:1.155, volume:100,
          currency:'USD', base_currency:'EUR', received_at:'2026-08-10T02:00:02.000Z',
          metadata:null, updated_at:'2026-08-10T02:00:02.000Z'
        }] };
      } }; } };
    }
  };
  const response = await worker.fetch(new Request(
    'https://example.test/api/v1/market-observations?symbol=EUR%2FUSD&timeframe=H1&limit=3',
    { headers:{ Authorization:'Bearer consumer-token' } }
  ), { DB, SENTINEL_CONSUMER_TOKEN:'consumer-token' });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.operationalSignal, false);
  assert.equal(body.observations[0].rawSymbol, 'OANDA:EURUSD');
});
