import { describe, expect, it } from 'vitest';
import {
  classifyMarket,
  MARKET_CLASSES,
} from './marketArchitecture';

describe('multi-market instrument classification', () => {
  it.each([
    ['EUR/USD', 'FOREX', 'FOREX:EUR/USD'],
    ['BTC/USD', 'CRYPTO', 'CRYPTO:BTC/USD'],
    ['SPX', 'INDEX', 'INDEX:SPX'],
    ['SPY', 'ETF', 'ETF:NYSEARCA:SPY'],
    ['XAU/USD', 'METAL', 'METAL:XAU/USD'],
    ['CL1!', 'FUTURE', 'FUTURE:NYMEX:CL1!'],
    ['US10Y', 'BOND_RATE', 'BOND_RATE:US10Y'],
  ] as const)('classifies %s as %s', (symbol, market, canonicalId) => {
    const result = classifyMarket(symbol);
    expect(result.market).toBe(market);
    expect(result.canonicalId).toBe(canonicalId);
  });

  it('treats a bare known equity as STOCK and warns that its exchange was inferred', () => {
    const result = classifyMarket('AAPL');
    expect(result.market).toBe('STOCK');
    expect(result.canonicalId).toBe('STOCK:NASDAQ:AAPL');
    expect(result.exchange).toBe('NASDAQ');
    expect(result.warnings.some(warning => warning.includes('Falta la bolsa'))).toBe(true);
  });

  it('uses an explicit exchange for an equity without confusing it with an index or ETF', () => {
    const result = classifyMarket('NASDAQ:AAPL');
    expect(result.market).toBe('STOCK');
    expect(result.exchange).toBe('NASDAQ');
    expect(result.canonicalId).toBe('STOCK:NASDAQ:AAPL');
    expect(result.warnings.some(warning => warning.includes('Falta la bolsa'))).toBe(false);
  });

  it('does not reuse a known equity alias under a conflicting exchange', () => {
    const result = classifyMarket('NYSE:AAPL');
    expect(result.market).toBe('STOCK');
    expect(result.canonicalId).toBe('STOCK:NYSE:AAPL');
    expect(result.exchange).toBe('NYSE');
  });

  it.each([
    ['STOCK:NASDAQ:MSFT', 'STOCK', 'STOCK:NASDAQ:MSFT'],
    ['COMMODITY:BRENT', 'COMMODITY', 'COMMODITY:BRENT'],
    ['FUTURE:NYMEX:CL1!', 'FUTURE', 'FUTURE:NYMEX:CL1!'],
  ] as const)('preserves declared canonical id %s', (canonical, market, expected) => {
    const result = classifyMarket(canonical);
    expect(result.market).toBe(market);
    expect(result.canonicalId).toBe(expected);
    expect(result.confidence).toBe('DECLARED');
  });

  it('preserves provider aliases for known instruments', () => {
    const aapl = classifyMarket('NASDAQ:AAPL');
    expect(aapl.aliases).toEqual(expect.arrayContaining([
      expect.objectContaining({provider:'CANONICAL',symbol:'STOCK:NASDAQ:AAPL'}),
      expect.objectContaining({provider:'MT5',symbol:'AAPL'}),
      expect.objectContaining({provider:'TRADINGVIEW',symbol:'NASDAQ:AAPL'}),
    ]));

    const bitcoin = classifyMarket('BINANCE:BTCUSDT');
    expect(bitcoin.market).toBe('CRYPTO');
    expect(bitcoin.aliases).toEqual(expect.arrayContaining([
      expect.objectContaining({provider:'BINANCE_SPOT',symbol:'BTCUSDT'}),
      expect.objectContaining({provider:'MT5',symbol:'BTCUSD'}),
    ]));
  });

  it('recognizes an OPRA/OSI option contract as OPTION', () => {
    const result = classifyMarket('OPRA:AAPL260116C00200000');
    expect(result.market).toBe('OPTION');
    expect(result.exchange).toBe('OPRA');
    expect(result.canonicalId).toBe('OPTION:OPRA:AAPL260116C00200000');
  });

  it('treats CFD as a broker wrapper and preserves the resolved underlying market', () => {
    const result = classifyMarket('CFD:US500.CFD');
    expect(result.instrumentKind).toBe('CFD');
    expect(result.market).toBe('INDEX');
    expect(result.canonicalId).toBe('INDEX:SPX');
    expect(result.contractId).toBe('CFD:CFD_US500.CFD');
    expect(result.underlying).toEqual(expect.objectContaining({market:'INDEX',canonicalId:'INDEX:SPX'}));
  });

  it('keeps a stock CFD analytically classified as STOCK when broker metadata proves the wrapper', () => {
    const result = classifyMarket({
      symbol:'AAPL',
      exchange:'NASDAQ',
      brokerMetadata:{symbol:'AAPL.CFD',description:'Apple Inc CFD',exchange:'NASDAQ'},
    });
    expect(result.market).toBe('STOCK');
    expect(result.instrumentKind).toBe('CFD');
    expect(result.canonicalId).toBe('STOCK:NASDAQ:AAPL');
    expect(result.brokerSymbol).toBe('AAPL.CFD');
  });

  it('does not guess an unknown ticker', () => {
    const result = classifyMarket('MISTERIO-123');
    expect(result.market).toBe('UNKNOWN');
    expect(result.confidence).toBe('UNKNOWN');
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('No se pudo clasificar'),
    ]));
  });

  it('supports every explicit market class without collapsing STOCK into INDEX, ETF or CFD', () => {
    expect(MARKET_CLASSES).toEqual([
      'FOREX','CRYPTO','STOCK','INDEX','ETF','METAL','COMMODITY','FUTURE','CFD','BOND_RATE','OPTION','UNKNOWN',
    ]);
    expect(new Set(MARKET_CLASSES).size).toBe(MARKET_CLASSES.length);
  });

  describe('sufijos de plaza del bróker', () => {
    it('clasifica una acción aunque llegue con el sufijo del bróker', () => {
      // Antes AAPL.US daba UNKNOWN mientras AAPL daba STOCK, aunque son el mismo activo.
      expect(classifyMarket('AAPL.US')).toMatchObject({ market:'STOCK', symbol:'AAPL' });
      // Para cualquier símbolo, el sufijo de plaza no debe cambiar la clasificación:
      // un ticker desconocido sigue siendo desconocido, pero por la misma razón.
      for (const ticker of ['AAPL', 'MSFT', 'TSLA', 'BRK']) {
        for (const suffix of ['US', 'NAS', 'NYSE']) {
          expect(classifyMarket(`${ticker}.${suffix}`).market).toBe(classifyMarket(ticker).market);
          expect(classifyMarket(`${ticker}.${suffix}`).symbol).toBe(classifyMarket(ticker).symbol);
        }
      }
    });

    it('deja constancia de la interpretación en las advertencias', () => {
      expect(classifyMarket('AAPL.US').warnings.join(' ')).toContain('sufijo de plaza');
      expect(classifyMarket('AAPL').warnings.join(' ')).not.toContain('sufijo de plaza');
    });

    it('no confunde una clase de acción con un sufijo de plaza', () => {
      // BRK.B no debe convertirse en BRK: son cotizaciones distintas.
      expect(classifyMarket('BRK.B').symbol).toBe('BRK.B');
    });

    it('no altera los símbolos sin punto', () => {
      expect(classifyMarket('EUR/USD')).toMatchObject({ market:'FOREX', symbol:'EUR/USD' });
      expect(classifyMarket('NASDAQ:AAPL')).toMatchObject({ market:'STOCK', symbol:'AAPL' });
    });
  });
});
