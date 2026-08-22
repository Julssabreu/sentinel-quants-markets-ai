import { describe, expect, it } from 'vitest';
import { resolveMarketUiContext } from './marketUiContext';

describe('market UI context', () => {
  it('keeps a global equity distinct and exposes missing fundamental/regulatory coverage', () => {
    const result = resolveMarketUiContext('NASDAQ:AAPL', 'D1', {
      ok:true,
      symbol:'AAPL',
      source:'MetaTrader 5',
      resolution:{method:'EXACT_BROKER_SYMBOL',score:[0, 0],ambiguous:false},
      candles:[{}],
      tick:{time:new Date().toISOString()},
      instrument:{symbol:'AAPL',exchange:'NASDAQ',description:'Apple Inc',sector:'Technology',isin:'US0378331005'},
    });
    expect(result.context.market).toBe('STOCK');
    expect(result.context.marketLabel).toBe('Acción');
    expect(result.context.operationalPriceVerified).toBe(true);
    // EDGAR cubre fundamentales y regulatorio para acciones, así que la interfaz ya no
    // debe mostrar esas dos carencias.
    expect(result.context.coverage).toBe('COMPLETE');
    expect(result.context.gaps).toEqual([]);
    expect(result.context.pendingSources).toEqual(expect.arrayContaining([
      expect.stringContaining('TradingView'),
    ]));
  });

  it('does not present an active connector as a verified operational price without runtime rates', () => {
    const result = resolveMarketUiContext('EUR/USD', 'H1');
    expect(result.context.market).toBe('FOREX');
    expect(result.context.operationalPriceVerified).toBe(false);
    expect(result.context.coverage).toBe('COMPLETE');
    expect(result.context.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('MT5 no ha demostrado'),
    ]));
  });

  it('keeps TradingView staged and never describes VIX as an operational signal', () => {
    const result = resolveMarketUiContext('BTC/USD', 'H1', {
      ok:true,
      symbol:'BTCUSD',
      source:'MetaTrader 5',
      resolution:{method:'EXACT_CANONICAL',score:[0, 0],ambiguous:false},
      instrument:{symbol:'BTCUSD',category:'Crypto'},
    });
    expect(result.context.market).toBe('CRYPTO');
    expect(result.context.activeSources.some(source => source.includes('Binance Public Market Data'))).toBe(true);
    expect(result.context.pendingSources).toEqual(expect.arrayContaining([
      expect.stringContaining('TradingView'),
    ]));
    expect(result.context.activeSources.some(source => source.includes('TradingView'))).toBe(false);
  });

  it('blocks coverage when the market cannot be classified safely', () => {
    const result = resolveMarketUiContext('MISTERIO-123', 'H1');
    expect(result.context.market).toBe('UNKNOWN');
    expect(result.context.coverage).toBe('INSUFFICIENT');
    expect(result.context.gaps).toContain('Clasificación inequívoca del mercado');
  });

  it('does not infer an exact MT5 resolution from equal-looking strings alone', () => {
    const result = resolveMarketUiContext('EUR/USD', 'H1', {
      ok:true,
      requested:'EUR/USD',
      symbol:'EURUSD',
      candles:[{}],
      tick:{time:new Date().toISOString()},
    });
    expect(result.context.operationalPriceVerified).toBe(false);
    expect(result.context.readyForTechnicalAnalysis).toBe(false);
  });

  it('accepts a broker suffix only when MT5 proves it is unique', () => {
    const result = resolveMarketUiContext('EUR/USD', 'H1', {
      ok:true,
      requested:'EUR/USD',
      symbol:'EURUSD.m',
      resolution:{method:'UNIQUE_BROKER_SUFFIX',score:[1, 1],ambiguous:false},
      candles:[{}],
      tick:{time:new Date().toISOString()},
    });
    expect(result.context.operationalPriceVerified).toBe(true);
    expect(result.context.readyForTechnicalAnalysis).toBe(true);
  });
});
