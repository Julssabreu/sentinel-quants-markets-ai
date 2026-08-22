import { describe, expect, it } from 'vitest';
import { resolveMarketAnalysisContext, marketRouteSnapshot } from './marketSourceRouter';

const verifiedMt5 = {
  resolved: true,
  exact: true,
  ambiguous: false,
  brokerSymbol: 'EURUSD',
  candlesAvailable: true,
  tickFresh: true,
  observedAt: '2026-08-09T12:00:00.000Z',
} as const;

describe('market source router', () => {
  it('requires runtime MT5 evidence before declaring technical or operational readiness', () => {
    const planned = resolveMarketAnalysisContext('EUR/USD');
    expect(planned.coverage.status).toBe('COMPLETE');
    expect(planned.readyForTechnicalAnalysis).toBe(false);
    expect(planned.readyForOperationalAnalysis).toBe(false);
    expect(planned.operationalBlockers).toEqual(expect.arrayContaining([
      expect.stringContaining('MT5 no ha demostrado'),
    ]));

    const verified = resolveMarketAnalysisContext('EUR/USD', { mt5: verifiedMt5 });
    expect(verified.readyForTechnicalAnalysis).toBe(true);
    expect(verified.readyForOperationalAnalysis).toBe(true);
  });

  it('keeps global stocks first-class and reports the real fundamental/regulatory gaps', () => {
    const context = resolveMarketAnalysisContext(
      {symbol:'NASDAQ:AAPL',brokerMetadata:{symbol:'AAPL',exchange:'NASDAQ',currencyProfit:'USD'}},
      {mt5:{...verifiedMt5,brokerSymbol:'AAPL'}},
    );
    // El conector EDGAR verificado cierra FUNDAMENTAL y REGULATORY, que eran las dos
    // únicas brechas de acciones. La cobertura pasa de PARTIAL a COMPLETE.
    expect(context.instrument.market).toBe('STOCK');
    expect(context.coverage.status).toBe('COMPLETE');
    expect(context.coverage.missingRoles).toEqual([]);
    expect(context.readyForTechnicalAnalysis).toBe(true);
    expect(context.readyForOperationalAnalysis).toBe(true);
    expect(context.warnings).not.toEqual(expect.arrayContaining([
      expect.stringContaining('no hay todavía un conector fundamental activo'),
    ]));
  });

  it('does not confuse a configured connector with observed evidence', () => {
    const context = resolveMarketAnalysisContext('BTC/USD', {tradingViewConfigured:false});
    const trigger = context.roles.find(role => role.role === 'ALERT_TRIGGER');
    expect(trigger?.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({providerId:'tradingview',runtimeStatus:'AVAILABLE'}),
    ]));
    expect(context.readyForTechnicalAnalysis).toBe(false);
  });

  it('routes a resolved stock CFD through the stock context and its broker contract separately', () => {
    const context = resolveMarketAnalysisContext({
      symbol:'AAPL.CFD',
      marketHint:'CFD',
      underlying:{symbol:'NASDAQ:AAPL'},
      brokerMetadata:{symbol:'AAPL.CFD',description:'Apple CFD',exchange:'NASDAQ',currencyProfit:'USD'},
    }, {mt5:{...verifiedMt5,brokerSymbol:'AAPL.CFD'}});
    expect(context.instrument.market).toBe('STOCK');
    expect(context.instrument.instrumentKind).toBe('CFD');
    expect(context.instrument.canonicalId).toBe('STOCK:NASDAQ:AAPL');
    expect(context.instrument.contractId).toContain('CFD:');
    expect(context.instrument.underlying?.market).toBe('STOCK');
  });

  it('blocks an unresolved CFD and an unknown symbol', () => {
    const cfd = resolveMarketAnalysisContext('CFD:MYSTERY.CFD', {mt5:verifiedMt5});
    expect(cfd.coverage.status).toBe('INSUFFICIENT');
    expect(cfd.readyForOperationalAnalysis).toBe(false);
    expect(cfd.operationalBlockers).toContain('CFD sin subyacente inequívoco.');

    const unknown = resolveMarketAnalysisContext('MISTERIO-123', {mt5:verifiedMt5});
    expect(unknown.coverage.status).toBe('INSUFFICIENT');
  });

  it('leaves options staged until option-specific derivatives data exists', () => {
    const context = resolveMarketAnalysisContext('OPRA:AAPL260116C00200000', {mt5:verifiedMt5});
    expect(context.instrument.market).toBe('OPTION');
    expect(context.coverage.missingRoles).toContain('DERIVATIVES');
    expect(context.readyForOperationalAnalysis).toBe(false);
  });

  it('creates an auditable snapshot without claiming inactive sources as verified', () => {
    const snapshot = marketRouteSnapshot(resolveMarketAnalysisContext('EUR/USD', {mt5:verifiedMt5}));
    expect(snapshot.resolverVersion).toBe('1.0.0');
    expect(snapshot.canonicalId).toBe('FOREX:EUR/USD');
    expect(snapshot.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({providerId:'mt5',role:'PRICE_TECHNICAL',runtimeStatus:'VERIFIED'}),
    ]));
    expect(snapshot.sources.some(source => source.providerId === 'tradingview')).toBe(false);
  });
});
