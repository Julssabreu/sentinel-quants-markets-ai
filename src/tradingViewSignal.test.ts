import { describe, expect, it } from 'vitest';
import { isFreshTradingViewSignal, normalizeTradingViewSymbol, normalizeTradingViewTimeframe } from './tradingViewSignal';

const signal: TradingViewSignal = {
  id:'tv-1', source:'TRADINGVIEW', symbol:'BTC/USD', rawSymbol:'BINANCE:BTCUSDT', exchange:'BINANCE',
  timeframe:'H1', side:'BUY', price:68420, emittedAt:'2026-08-08T12:00:00.000Z', receivedAt:'2026-08-08T12:00:02.000Z', strategy:null,
  leaseToken:'11111111-1111-4111-8111-111111111111', leaseUntil:'2026-08-08T12:05:02.000Z', attempts:1, retryReason:null,
};

describe('TradingView signal normalization', () => {
  it('maps TradingView intervals to Sentinel timeframes', () => {
    expect(normalizeTradingViewTimeframe('60')).toBe('H1');
    expect(normalizeTradingViewTimeframe('1D')).toBe('D1');
    expect(normalizeTradingViewTimeframe('7')).toBeNull();
  });

  it('converts common TradingView tickers to MT5-friendly symbols', () => {
    expect(normalizeTradingViewSymbol('BINANCE:BTCUSDT')).toBe('BTC/USD');
    expect(normalizeTradingViewSymbol('BINANCE:BTCUSDT.P')).toBe('BTC/USD');
    expect(normalizeTradingViewSymbol('OANDA:EURUSD')).toBe('EUR/USD');
    expect(normalizeTradingViewSymbol('CBOE:VIX')).toBe('VIX');
  });

  it('rejects stale events before spending an AI consultation', () => {
    expect(isFreshTradingViewSignal(signal, 30, Date.parse('2026-08-08T12:20:00.000Z'))).toBe(true);
    expect(isFreshTradingViewSignal(signal, 30, Date.parse('2026-08-08T13:00:00.000Z'))).toBe(false);
  });
});
