import { describe, expect, it } from 'vitest';
import {
  analyzeEquityContext,
  type NormalizedEquityContext,
} from './equityContext';

const NOW = new Date('2026-08-10T18:00:00.000Z');

function completeAapl(): NormalizedEquityContext {
  return {
    schemaVersion: 'EQUITY_CONTEXT_V1',
    instrument: {
      instrumentType: 'STOCK',
      ticker: 'AAPL',
      exchange: 'NASDAQ',
      currency: 'USD',
      name: 'Apple Inc.',
      countryCode: 'US',
      sector: 'Technology',
      industry: 'Consumer Electronics',
    },
    marketCapitalization: {
      value: 3_400_000_000_000,
      sharesOutstanding: 14_900_000_000,
      asOf: '2026-08-10T16:00:00.000Z',
    },
    valuation: {
      asOf: '2026-08-10T16:00:00.000Z',
      priceToEarningsTtm: 34.2,
      forwardPriceToEarnings: 29.4,
      priceToBook: 51.1,
      priceToSalesTtm: 8.7,
      enterpriseValueToEbitdaTtm: 25.8,
      dividendYieldPercent: 0.44,
    },
    profitability: {
      periodEnd: '2026-06-27',
      revenueTtm: 410_000_000_000,
      operatingIncomeTtm: 130_000_000_000,
      netIncomeTtm: 105_000_000_000,
      earningsPerShareTtm: 7.05,
      operatingMarginPercent: 31.7,
      netMarginPercent: 25.6,
      returnOnEquityPercent: 152.4,
      returnOnAssetsPercent: 31.2,
    },
    balanceSheet: {
      periodEnd: '2026-06-27',
      totalAssets: 370_000_000_000,
      totalLiabilities: 300_000_000_000,
      shareholderEquity: 70_000_000_000,
      totalDebt: 100_000_000_000,
      cashAndEquivalents: 65_000_000_000,
      currentRatio: 0.95,
      debtToEquity: 1.43,
    },
    earnings: {
      fiscalPeriod: 'Q3 2026',
      lastReportDate: '2026-07-30',
      nextReportDate: '2026-10-29',
      earningsPerShareActual: 1.57,
      earningsPerShareEstimate: 1.43,
      earningsPerShareSurprisePercent: 9.79,
      revenueActual: 94_000_000_000,
      revenueEstimate: 89_500_000_000,
      revenueSurprisePercent: 5.03,
    },
    corporateActions: {
      asOf: '2026-08-10T16:00:00.000Z',
      items: [{
        type: 'DIVIDEND',
        announcedAt: '2026-07-30',
        effectiveDate: '2026-08-13',
        description: 'Regular cash dividend',
      }],
    },
    filings: {
      asOf: '2026-08-10T16:00:00.000Z',
      items: [{
        filingType: '10-Q',
        filedAt: '2026-07-31',
        periodEnd: '2026-06-27',
        accessionNumber: '0000320193-26-000001',
        url: 'https://www.sec.gov/example-aapl-filing',
      }],
    },
    provenance: [{
      sourceId: 'regulatory-and-market-public',
      sourceName: 'Public market and regulatory records',
      retrievedAt: '2026-08-10T16:05:00.000Z',
      asOf: '2026-08-10T16:00:00.000Z',
      url: 'https://www.sec.gov/',
      fields: [
        'marketCapitalization',
        'valuation',
        'profitability',
        'balanceSheet',
        'earnings',
        'corporateActions',
        'filings',
      ],
    }],
  };
}

describe('equity fundamental context', () => {
  it('acepta una acción AAPL completa y conserva trazabilidad sin emitir señal', () => {
    const result = analyzeEquityContext(completeAapl(), { now: NOW });

    expect(result.availability).toBe('AVAILABLE');
    expect(result.acceptedInstrument).toBe(true);
    expect(result.usableForFundamentalDecision).toBe(true);
    expect(result.coveragePercent).toBe(100);
    expect(result.qualityScore).toBe(100);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      sourceId: 'regulatory-and-market-public',
      freshness: 'FRESH',
    });
    expect(result.operationalSignal).toBe(false);
    expect(Object.keys(result)).not.toContain('side');
    expect(Object.keys(result)).not.toContain('recommendation');
  });

  it('clasifica una acción global con cobertura incompleta como parcial sin inventar campos', () => {
    const globalPartial: NormalizedEquityContext = {
      schemaVersion: 'EQUITY_CONTEXT_V1',
      instrument: {
        instrumentType: 'STOCK',
        ticker: '7203',
        exchange: 'TSE',
        currency: 'JPY',
        name: 'Toyota Motor Corporation',
        countryCode: 'JP',
        sector: 'Consumer Cyclical',
        industry: 'Auto Manufacturers',
      },
      marketCapitalization: {
        value: 48_000_000_000_000,
        asOf: '2026-08-10T06:00:00.000Z',
      },
      valuation: {
        asOf: '2026-08-10T06:00:00.000Z',
        priceToEarningsTtm: 11.8,
        priceToBook: 1.2,
      },
      profitability: {
        periodEnd: '2026-06-30',
        revenueTtm: 48_000_000_000_000,
        netIncomeTtm: 5_000_000_000_000,
        netMarginPercent: 10.4,
      },
      provenance: [{
        sourceId: 'jp-public-records',
        sourceName: 'Japan public records',
        retrievedAt: '2026-08-10T07:00:00.000Z',
        fields: ['marketCapitalization', 'valuation', 'profitability'],
      }],
    };

    const result = analyzeEquityContext(globalPartial, { now: NOW });

    expect(result.availability).toBe('PARTIAL');
    expect(result.usableForFundamentalDecision).toBe(false);
    expect(result.sources.map((source) => source.sourceId)).toEqual(['jp-public-records']);
    expect(result.domains.find((domain) => domain.domain === 'balanceSheet')?.status).toBe('MISSING');
    expect(result.domains.find((domain) => domain.domain === 'earnings')?.status).toBe('MISSING');
    expect(result.coveragePercent).toBeLessThan(100);
    expect(result.warnings.some((warning) => warning.includes('Cobertura ausente'))).toBe(true);
  });

  it('marca datos completos pero obsoletos y no los habilita para decisión fundamental', () => {
    const stale = completeAapl();
    stale.marketCapitalization!.asOf = '2025-01-01';
    stale.valuation!.asOf = '2025-01-01';
    stale.profitability!.periodEnd = '2025-01-01';
    stale.balanceSheet!.periodEnd = '2025-01-01';
    stale.earnings!.lastReportDate = '2025-01-01';
    stale.corporateActions!.asOf = '2025-01-01';
    stale.filings!.asOf = '2025-01-01';
    stale.provenance[0].retrievedAt = '2025-01-01T00:00:00.000Z';

    const result = analyzeEquityContext(stale, { now: NOW });

    expect(result.availability).toBe('PARTIAL');
    expect(result.usableForFundamentalDecision).toBe(false);
    expect(result.staleDomains).toEqual(expect.arrayContaining([
      'identity', 'marketCap', 'valuation', 'profitability', 'balanceSheet',
      'earnings', 'corporateActions', 'filings', 'provenance',
    ]));
    expect(result.sources[0].freshness).toBe('STALE');
    expect(result.warnings.some((warning) => warning.includes('Datos obsoletos'))).toBe(true);
  });

  it('rechaza un ETF aunque tenga el mismo conjunto de fundamentales', () => {
    const etf = completeAapl();
    etf.instrument = {
      ...etf.instrument,
      instrumentType: 'ETF',
      ticker: 'SPY',
      exchange: 'NYSEARCA',
      name: 'SPDR S&P 500 ETF Trust',
      sector: 'Broad Market',
      industry: 'Exchange Traded Fund',
    };

    const result = analyzeEquityContext(etf, { now: NOW });

    expect(result.instrumentType).toBe('ETF');
    expect(result.acceptedInstrument).toBe(false);
    expect(result.availability).toBe('UNAVAILABLE');
    expect(result.usableForFundamentalDecision).toBe(false);
    expect(result.warnings[0]).toContain('exige instrumentType STOCK');
    expect(result.operationalSignal).toBe(false);
  });
});
