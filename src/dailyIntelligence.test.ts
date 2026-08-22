import { describe, expect, it } from 'vitest';
import {
  DATA_NOT_AVAILABLE,
  deriveDailyIntelligence,
  type DailyIntelligenceInput,
} from './dailyIntelligence';
import { marketMatchesTab } from './marketNavigation';

const emptyInput = (): DailyIntelligenceInput => ({
  market:null,
  macro:null,
  news:null,
  factors:null,
  vix:null,
  scan:null,
  history:null,
});

const frame: Mt5ScanFrame = {
  close:100,
  ema20:99,
  ema50:98,
  atr:2,
  slopePct:0.5,
  relativeVolume:1.4,
  direction:1,
  bars:150,
};

const metadata = (path: string, exchange = ''): Mt5InstrumentMetadata => ({
  symbol:'TEST',
  description:'Instrumento verificado',
  path,
  category:'',
  exchange,
  isin:'',
  sector:null,
  industry:null,
  currencyBase:'',
  currencyProfit:'USD',
  currencyMargin:'USD',
  tradeCalcMode:0,
});

const candidate = (
  symbol: string,
  path: string,
  direction: Mt5ScanCandidate['direction'],
  score: number,
): Mt5ScanCandidate => ({
  symbol,
  canonical:symbol,
  description:`${symbol} real`,
  path,
  instrument:metadata(path, path.includes('Stocks') ? 'NASDAQ' : ''),
  direction,
  score,
  spreadPoints:2,
  tickAgeMinutes:1,
  marketStatus:'ACTIVO',
  h1:frame,
  h4:frame,
  observedAt:'2026-08-10T14:00:00.000Z',
  source:'MetaTrader 5 local terminal',
});

describe('daily market navigation', () => {
  it('keeps Todos global and filters dedicated markets exactly', () => {
    expect(marketMatchesTab('CRYPTO', 'ALL')).toBe(true);
    expect(marketMatchesTab('STOCK', 'STOCK')).toBe(true);
    expect(marketMatchesTab('ETF', 'STOCK')).toBe(false);
  });
});

describe('daily intelligence derivation', () => {
  it('declares unavailable data instead of inventing a market overview', () => {
    const result = deriveDailyIntelligence(emptyInput(), 'STOCK', new Date('2026-08-10T14:00:00.000Z'));
    expect(result.benchmarks.map((item) => item.value)).toEqual([null, null, null, null]);
    expect(result.benchmarks.every((item) => item.freshness === DATA_NOT_AVAILABLE)).toBe(true);
    expect(result.scanStatus).toBe('NOT_RUN');
    expect(result.candidates).toEqual([]);
    expect(result.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id:'fundamentals', available:false, detail:DATA_NOT_AVAILABLE }),
      expect.objectContaining({ id:'extended-hours', available:false, detail:DATA_NOT_AVAILABLE }),
    ]));
  });

  it('uses real MT5 factors and preserves their source and freshness', () => {
    const input = emptyInput();
    input.factors = {
      ok:true,
      factors:[{
        id:'EURUSD', symbol:'EURUSD.a', description:'Euro frente al dólar', price:1.12345,
        change1h:0.1, change24h:0.75, change5d:1.2, volatility48h:0.2,
        tickAgeMinutes:2, fresh:true, source:'MetaTrader 5 local terminal',
      }],
      errors:[],
      checkedAt:'2026-08-10T14:00:00.000Z',
      permissions:'read-only',
    };
    const result = deriveDailyIntelligence(input, 'FOREX', new Date('2026-08-10T14:00:00.000Z'));
    expect(result.benchmarks[0]).toMatchObject({
      id:'EURUSD', value:1.12345, change24h:0.75,
      source:'MetaTrader 5 local terminal', freshness:'Tick MT5 vigente',
    });
    expect(result.changes[0].title).toBe('Euro frente al dólar');
  });

  it('filters scanner candidates by market and treats them only as a prefiltro', () => {
    const input = emptyInput();
    input.scan = {
      ok:true,
      scanned:2,
      qualified:2,
      candidates:[
        candidate('AAPL.US', 'CFD\\Stocks\\United States', 'BUY', 91),
        candidate('BTCUSD', 'Crypto\\Spot', 'SELL', 88),
      ],
      method:'H1/H4 prefilter; deep analysis required',
      permissions:'read-only',
      checkedAt:'2026-08-10T14:00:00.000Z',
    };
    const result = deriveDailyIntelligence(input, 'STOCK', new Date('2026-08-10T14:00:00.000Z'));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ symbol:'AAPL.US', market:'STOCK', direction:'BUY' });
    expect(result.candidates[0].caveat).toContain('no autoriza ejecución');
  });

  describe('capacidades de acciones', () => {
    const capability = (input: DailyIntelligenceInput, id: string) =>
      deriveDailyIntelligence(input, 'STOCK', new Date('2026-08-21T13:00:00.000Z'))
        .capabilities.find(item => item.id === id)!;

    it('mantiene resultados y fundamentales no disponibles sin datos de EDGAR', () => {
      // Tener el conector no es tener el dato: sin snapshot la capacidad sigue apagada.
      expect(capability(emptyInput(), 'earnings')).toMatchObject({ available:false, detail:DATA_NOT_AVAILABLE });
      expect(capability(emptyInput(), 'fundamentals')).toMatchObject({ available:false, detail:DATA_NOT_AVAILABLE });
    });

    it('activa resultados y fundamentales cuando EDGAR entregó presentaciones y XBRL', () => {
      const input: DailyIntelligenceInput = {
        ...emptyInput(),
        edgar:{
          ticker:'AAPL', companyName:'Apple Inc.',
          filings:[
            { form:'10-Q', filingDate:'2026-07-31', documentUrl:'https://www.sec.gov/x.htm' },
            { form:'8-K', filingDate:'2026-07-30', documentUrl:'https://www.sec.gov/y.htm' },
          ],
          latestRevenue:{ value:109417000000, periodEnd:'2026-06-27' },
          retrievedAt:'2026-08-21T13:00:00.000Z', error:null,
        },
      };
      expect(capability(input, 'earnings')).toMatchObject({ available:true });
      expect(capability(input, 'earnings').detail).toContain('Apple Inc.');
      expect(capability(input, 'fundamentals')).toMatchObject({ available:true });
      expect(capability(input, 'fundamentals').detail).toContain('2026-06-27');
    });

    it('reporta el fallo de EDGAR con su motivo en vez de decir solo no disponible', () => {
      const input: DailyIntelligenceInput = {
        ...emptyInput(),
        edgar:{
          ticker:'AAPL', companyName:null, filings:[], latestRevenue:null,
          retrievedAt:null, error:'HTTP 403',
        },
      };
      expect(capability(input, 'earnings').detail).toContain('403');
    });

    it('declara el VWAP proxy como proxy y no como VWAP institucional', () => {
      const proxy: DailyIntelligenceInput = {
        ...emptyInput(),
        sessionMetrics:{
          vwap:{ value:187.4, basis:'TICK_VOLUME', anchorTime:'2026-08-21T13:30:00.000Z' },
          openingRange:null, unavailableReason:null,
        },
      };
      const detail = capability(proxy, 'opening-range').detail;
      expect(capability(proxy, 'opening-range').available).toBe(true);
      expect(detail).toContain('proxy');
      expect(detail).toContain('no es el VWAP institucional');

      const real: DailyIntelligenceInput = {
        ...emptyInput(),
        sessionMetrics:{
          vwap:{ value:187.4, basis:'REAL_VOLUME', anchorTime:'2026-08-21T13:30:00.000Z' },
          openingRange:{ high:190, low:185, breakout:'ABOVE' }, unavailableReason:null,
        },
      };
      expect(capability(real, 'opening-range').detail).toContain('volumen negociado');
      expect(capability(real, 'opening-range').detail).toContain('ruptura al alza');
    });

    it('nunca presenta premarket como disponible: no hay fuente conectada', () => {
      expect(capability(emptyInput(), 'extended-hours')).toMatchObject({ available:false });
    });
  });
});

