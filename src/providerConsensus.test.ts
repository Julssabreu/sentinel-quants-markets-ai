import { describe, expect, it } from 'vitest';
import { analyzeProviderConsensus } from './providerConsensus';

describe('analyzeProviderConsensus', () => {
  it('calcula una referencia robusta y detecta un feed atípico', () => {
    const result = analyzeProviderConsensus('EUR/USD', [
      { provider: 'OANDA', bid: 1.1000, ask: 1.1002, observedAt: '', source: 'TradingView' },
      { provider: 'FXCM', bid: 1.1001, ask: 1.1003, observedAt: '', source: 'TradingView' },
      { provider: 'Pepperstone', bid: 1.0999, ask: 1.1001, observedAt: '', source: 'TradingView' },
      { provider: 'Feed retrasado', bid: 1.1020, ask: 1.1022, observedAt: '', source: 'OTRO' }
    ]);
    expect(result.referenceMid).toBeCloseTo(1.10015, 5);
    expect(result.outliers).toContain('Feed retrasado');
    expect(result.providersUsed).toBe(4);
  });

  it('no inventa consenso cuando no existen datos válidos', () => {
    const result = analyzeProviderConsensus('USD/JPY', []);
    expect(result.confidence).toBe(0);
    expect(result.providersUsed).toBe(0);
  });
});
