import { describe, expect, it } from 'vitest';
import {
  classifyScannerCandidate,
  inferMt5MarketHint,
  selectDiverseMarketCandidates,
  type ClassifiedScannerCandidate,
  type ScannerCandidateShape,
} from './scannerMarketSelection';
import type { MarketClass } from './marketArchitecture';

const metadata = (overrides: Partial<Mt5InstrumentMetadata> = {}): Mt5InstrumentMetadata => ({
  symbol:'TEST', description:'', path:'', category:'', exchange:'', isin:'', sector:null, industry:null,
  currencyBase:'', currencyProfit:'USD', currencyMargin:'USD', tradeCalcMode:0, ...overrides,
});

describe('MT5 scanner market classification', () => {
  it.each([
    ['Forex\\Majors', 'FOREX'],
    ['Crypto\\Spot', 'CRYPTO'],
    ['CFD\\Stocks\\United States', 'STOCK'],
    ['CFD\\Indices\\United States', 'INDEX'],
    ['Markets\\ETF', 'ETF'],
    ['Commodities\\Metals', 'METAL'],
    ['Commodities\\Energy', 'COMMODITY'],
    ['Exchange Futures', 'FUTURE'],
    ['Fixed Income\\Bonds', 'BOND_RATE'],
    ['Derivatives\\Options', 'OPTION'],
    ['Broker\\CFD', 'CFD'],
  ] as const)('maps broker path %s to %s', (path, expected) => {
    expect(inferMt5MarketHint(metadata({path}))).toBe(expected);
  });

  it('uses symbol plus MT5 metadata and keeps a stock CFD in the equity market', () => {
    const result = classifyScannerCandidate({
      symbol:'AAPL.US', score:91,
      instrument:metadata({symbol:'AAPL.US',path:'CFD\\Stocks\\United States',exchange:'NASDAQ'}),
    });
    expect(result.classification.market).toBe('STOCK');
    expect(result.classification.instrumentKind).toBe('CFD');
    expect(result.classification.underlying?.market).toBe('STOCK');
    expect(result.classification.exchange).toBe('NASDAQ');
    expect(result.classification.aliases).toEqual(expect.arrayContaining([
      expect.objectContaining({provider:'MT5',symbol:'AAPL.US'}),
    ]));
  });
});

interface TestCandidate extends ScannerCandidateShape { id:string }

const classified = (id:string, market:MarketClass, score:number): ClassifiedScannerCandidate<TestCandidate> => ({
  candidate:{id,symbol:id,score},
  classification:{
    market,
    instrumentKind:'CASH',
    canonicalId:`${market}:${id}`,
    contractId:`${market}:${id}`,
    brokerSymbol:id,
    underlying:null,
    symbol:id,
    exchange:null,
    confidence:'INFERRED',
    aliases:[],
    warnings:[],
  },
});

describe('diverse deep-scan selection', () => {
  it('chooses distinct markets before filling remaining slots by score', () => {
    const candidates = [
      classified('EURUSD-A','FOREX',99),
      classified('EURUSD-B','FOREX',98),
      classified('BTCUSD-A','CRYPTO',96),
      classified('BTCUSD-B','CRYPTO',94),
      classified('XAUUSD','METAL',93),
    ];
    expect(selectDiverseMarketCandidates(candidates, 5).map(item => item.candidate.id)).toEqual([
      'EURUSD-A','BTCUSD-A','XAUUSD','EURUSD-B','BTCUSD-B',
    ]);
  });

  it('preserves score and stable broker ranking inside each market', () => {
    const candidates = [
      classified('AAPL','STOCK',80),
      classified('MSFT','STOCK',95),
      classified('GOOG','STOCK',95),
      classified('SPX','INDEX',90),
    ];
    expect(selectDiverseMarketCandidates(candidates, 4).map(item => item.candidate.id)).toEqual([
      'MSFT','SPX','GOOG','AAPL',
    ]);
  });

  it('does not privilege UNKNOWN as if it were a market', () => {
    const candidates = [
      classified('MYSTERY','UNKNOWN',100),
      classified('EURUSD','FOREX',95),
      classified('BTCUSD','CRYPTO',90),
    ];
    expect(selectDiverseMarketCandidates(candidates, 2).map(item => item.candidate.id)).toEqual(['EURUSD','BTCUSD']);
  });
});
