import { assessEventRisk } from './eventRisk';
import { classifyMarket, type MarketClass } from './marketArchitecture';
import { rankNews } from './newsIntelligence';
import { classifyScannerCandidates } from './scannerMarketSelection';
import { analyzeVixContext } from './vixContext';
import { selectCompatibleSimulations } from './modelGovernance';
import { marketMatchesTab, type DailyMarketTab } from './marketNavigation';
/** Declara si el VWAP usa volumen negociado real o un proxy de conteo de ticks. */
export type VolumeBasis = 'REAL_VOLUME' | 'TICK_VOLUME';

export const DATA_NOT_AVAILABLE = 'Dato no disponible';

export type IntelligenceSourceStatus = 'READY' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_RUN';

/** Presentaciones y fundamentales tomados de SEC EDGAR para el activo en foco. */
export interface EdgarSnapshot {
  ticker: string;
  companyName: string | null;
  filings: { form: string; filingDate: string; documentUrl: string }[];
  latestRevenue: { value: number; periodEnd: string } | null;
  retrievedAt: string | null;
  error: string | null;
}

/** VWAP y opening range ya calculados; `null` significa no calculable, no cero. */
export interface SessionMetricsSnapshot {
  vwap: { value: number; basis: VolumeBasis; anchorTime: string } | null;
  openingRange: { high: number; low: number; breakout: 'ABOVE' | 'BELOW' | null } | null;
  unavailableReason: string | null;
}

export interface DailyIntelligenceInput {
  market: MarketSnapshot | null;
  macro: MacroSnapshot | null;
  news: NewsSnapshot | null;
  factors: Mt5FactorResponse | null;
  vix: TradingViewVixContextResponse | null;
  scan: Mt5ScanResponse | null;
  history: AnalysisHistoryRecord[] | null;
  /** Opcionales: ausentes mientras el activo en foco no sea una acción con datos. */
  edgar?: EdgarSnapshot | null;
  sessionMetrics?: SessionMetricsSnapshot | null;
}

export interface IntelligenceBenchmark {
  id: string;
  label: string;
  value: number | null;
  change24h: number | null;
  source: string | null;
  observedAt: string | null;
  freshness: string;
}

export interface IntelligenceContextItem {
  id: string;
  label: string;
  value: string;
  detail: string;
  source: string;
  observedAt: string | null;
}

export interface IntelligenceChange {
  id: string;
  title: string;
  value: string;
  detail: string;
  source: string;
  observedAt: string;
}

export interface IntelligenceCandidate {
  symbol: string;
  description: string;
  market: MarketClass;
  direction: Mt5ScanCandidate['direction'];
  score: number;
  marketStatus: Mt5ScanCandidate['marketStatus'];
  spreadPoints: number;
  tickAgeMinutes: number;
  source: string;
  observedAt: string;
  caveat: string;
}

export interface IntelligenceEvent {
  id: string;
  title: string;
  currency: string;
  impact: string;
  scheduledAt: string;
  action: string;
  forecast: string | null;
  previous: string | null;
  source: string;
  sourceUrl: string;
  quality: string;
}

export interface IntelligenceNewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  credibility: number;
  impact: string;
  topic: string;
  assets: string[];
}

export interface IntelligenceHistoryItem {
  id: string;
  symbol: string;
  timeframe: string;
  decision: string;
  confidence: number;
  maturity: string;
  outcome: string;
  createdAt: string;
}

export interface IntelligenceSource {
  id: string;
  label: string;
  status: IntelligenceSourceStatus;
  checkedAt: string | null;
  errors: string[];
}

export interface IntelligenceCapability {
  id: string;
  label: string;
  available: boolean;
  detail: string;
}

export interface DailyIntelligenceModel {
  market: DailyMarketTab;
  generatedAt: string;
  benchmarks: IntelligenceBenchmark[];
  context: IntelligenceContextItem[];
  changes: IntelligenceChange[];
  candidates: IntelligenceCandidate[];
  avoidCandidates: IntelligenceCandidate[];
  events: IntelligenceEvent[];
  news: IntelligenceNewsItem[];
  history: IntelligenceHistoryItem[];
  sources: IntelligenceSource[];
  capabilities: IntelligenceCapability[];
  scanStatus: IntelligenceSourceStatus;
  scanMethod: string | null;
}

interface BenchmarkDefinition {
  id: string;
  label: string;
  aliases: readonly string[];
}

const BENCHMARKS: Record<DailyMarketTab, readonly BenchmarkDefinition[]> = {
  ALL: [
    { id:'US500', label:'S&P 500', aliases:['US500','SPX'] },
    { id:'US100', label:'Nasdaq 100', aliases:['US100','NAS100','NDX'] },
    { id:'VIX', label:'VIX', aliases:['VIX'] },
    { id:'US10Y', label:'Treasury 10 años', aliases:['US10Y'] },
    { id:'WTI', label:'Petróleo WTI', aliases:['WTI'] },
    { id:'DXY', label:'Dólar DXY', aliases:['DXY'] },
  ],
  STOCK: [
    { id:'SPY', label:'SPY', aliases:['SPY'] },
    { id:'QQQ', label:'QQQ', aliases:['QQQ'] },
    { id:'DIA', label:'DIA', aliases:['DIA'] },
    { id:'IWM', label:'IWM', aliases:['IWM'] },
  ],
  FOREX: [
    { id:'EURUSD', label:'EUR/USD', aliases:['EURUSD'] },
    { id:'GBPUSD', label:'GBP/USD', aliases:['GBPUSD'] },
    { id:'USDJPY', label:'USD/JPY', aliases:['USDJPY'] },
    { id:'USDCHF', label:'USD/CHF', aliases:['USDCHF'] },
  ],
  CRYPTO: [
    { id:'BTCUSD', label:'BTC/USD', aliases:['BTCUSD','BTCUSDT'] },
    { id:'ETHUSD', label:'ETH/USD', aliases:['ETHUSD','ETHUSDT'] },
  ],
  INDEX: [
    { id:'US500', label:'S&P 500', aliases:['US500','SPX'] },
    { id:'US100', label:'Nasdaq 100', aliases:['US100','NAS100','NDX'] },
    { id:'US30', label:'Dow Jones', aliases:['US30','DJI'] },
    { id:'US2000', label:'Russell 2000', aliases:['US2000','RUT'] },
  ],
  FUTURE: [
    { id:'ES1', label:'E-mini S&P 500', aliases:['ES1','ES1!'] },
    { id:'NQ1', label:'E-mini Nasdaq', aliases:['NQ1','NQ1!'] },
    { id:'CL1', label:'Crudo WTI', aliases:['CL1','CL1!'] },
  ],
  METAL: [
    { id:'XAUUSD', label:'Oro', aliases:['XAUUSD'] },
    { id:'XAGUSD', label:'Plata', aliases:['XAGUSD'] },
  ],
  COMMODITY: [
    { id:'WTI', label:'WTI', aliases:['WTI'] },
    { id:'BRENT', label:'Brent', aliases:['BRENT'] },
    { id:'NATGAS', label:'Gas natural', aliases:['NATGAS'] },
  ],
  ETF: [
    { id:'SPY', label:'SPY', aliases:['SPY'] },
    { id:'QQQ', label:'QQQ', aliases:['QQQ'] },
    { id:'IWM', label:'IWM', aliases:['IWM'] },
    { id:'DIA', label:'DIA', aliases:['DIA'] },
  ],
  BOND_RATE: [
    { id:'US02Y', label:'Treasury 2 años', aliases:['US02Y','US2Y'] },
    { id:'US10Y', label:'Treasury 10 años', aliases:['US10Y'] },
  ],
  OPTION: [
    { id:'VIX', label:'VIX', aliases:['VIX'] },
  ],
};

const MARKET_NEWS_TERMS: Record<Exclude<DailyMarketTab, 'ALL'>, readonly string[]> = {
  STOCK:['stock','share','equity','earnings','company','nasdaq','nyse'],
  FOREX:['currency','forex','dollar','euro','yen','central bank','interest rate'],
  CRYPTO:['crypto','bitcoin','ethereum','stablecoin'],
  INDEX:['index','indices','s&p','nasdaq','dow','russell'],
  FUTURE:['futures','contract','cme','nymex'],
  METAL:['gold','silver','metal','xau','xag'],
  COMMODITY:['oil','crude','gas','commodity','opec','energy'],
  ETF:['etf','fund'],
  BOND_RATE:['bond','yield','treasury','interest rate','fixed income'],
  OPTION:['option','volatility','vix'],
};

const normalizeSymbol = (value: string) => value.toUpperCase().replace(/[^A-Z0-9!]/g, '');
const unique = <T>(items: readonly T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

function factorFor(definition: BenchmarkDefinition, factors: Mt5FactorResponse | null) {
  return factors?.factors.find((factor) => {
    const values = [factor.id, factor.symbol].map(normalizeSymbol);
    return definition.aliases.some((alias) => values.includes(normalizeSymbol(alias)));
  }) ?? null;
}

function instrumentFor(definition: BenchmarkDefinition, market: MarketSnapshot | null) {
  return market?.instruments.find((instrument) => definition.aliases.some(
    (alias) => normalizeSymbol(instrument.symbol) === normalizeSymbol(alias),
  )) ?? null;
}

function buildBenchmarks(
  selectedMarket: DailyMarketTab,
  input: DailyIntelligenceInput,
  now: Date,
): IntelligenceBenchmark[] {
  const vixAnalysis = analyzeVixContext(input.vix?.history ?? [], { now });
  return BENCHMARKS[selectedMarket].map((definition) => {
    if (definition.id === 'VIX' && vixAnalysis.currentLevel !== null) {
      return {
        id:definition.id,
        label:definition.label,
        value:vixAnalysis.currentLevel,
        change24h:vixAnalysis.change1d?.percent ?? null,
        source:'TradingView · VIX diario',
        observedAt:vixAnalysis.currentObservedAt,
        freshness:vixAnalysis.fresh ? 'Cierre diario vigente' : 'Cierre diario desactualizado',
      };
    }
    if (definition.id === 'US10Y' && input.macro?.yieldCurve) {
      return {
        id:definition.id,
        label:definition.label,
        value:input.macro.yieldCurve.y10,
        change24h:null,
        source:input.macro.yieldCurve.source,
        observedAt:input.macro.yieldCurve.date,
        freshness:'Curva diaria oficial',
      };
    }
    if (definition.id === 'US02Y' && input.macro?.yieldCurve) {
      return {
        id:definition.id,
        label:definition.label,
        value:input.macro.yieldCurve.y2,
        change24h:null,
        source:input.macro.yieldCurve.source,
        observedAt:input.macro.yieldCurve.date,
        freshness:'Curva diaria oficial',
      };
    }
    const factor = factorFor(definition, input.factors);
    if (factor) {
      return {
        id:definition.id,
        label:definition.label,
        value:factor.price,
        change24h:factor.change24h,
        source:factor.source,
        observedAt:input.factors?.checkedAt ?? null,
        freshness:factor.fresh ? 'Tick MT5 vigente' : `Tick con ${factor.tickAgeMinutes.toFixed(0)} min`,
      };
    }
    const instrument = instrumentFor(definition, input.market);
    if (instrument) {
      return {
        id:definition.id,
        label:definition.label,
        value:instrument.price,
        change24h:instrument.change,
        source:instrument.source,
        observedAt:instrument.observedAt,
        freshness:instrument.freshness,
      };
    }
    return {
      id:definition.id,
      label:definition.label,
      value:null,
      change24h:null,
      source:null,
      observedAt:null,
      freshness:DATA_NOT_AVAILABLE,
    };
  });
}

function buildContext(input: DailyIntelligenceInput, now: Date): IntelligenceContextItem[] {
  const vix = analyzeVixContext(input.vix?.history ?? [], { now });
  const freshFactors = input.factors?.factors.filter((factor) => factor.fresh) ?? [];
  const advancing = freshFactors.filter((factor) => factor.change24h > 0).length;
  const declining = freshFactors.filter((factor) => factor.change24h < 0).length;
  const event = input.macro?.events
    .filter((item) => Date.parse(item.scheduledAt) >= now.getTime() - 60 * 60_000)
    .map((item) => ({ item, risk:assessEventRisk(item, now) }))
    .sort((left, right) => Math.abs(left.risk.minutesToEvent) - Math.abs(right.risk.minutesToEvent))[0];
  return [
    {
      id:'vix',
      label:'Volatilidad VIX',
      value:vix.currentLevel === null ? DATA_NOT_AVAILABLE : `${vix.currentLevel.toFixed(2)} · ${vix.regime}`,
      detail:vix.available ? `${vix.trend}; ${vix.fresh ? 'vigente' : 'desactualizado'}. No emite señal.` : DATA_NOT_AVAILABLE,
      source:vix.available ? 'TradingView · contexto diario' : DATA_NOT_AVAILABLE,
      observedAt:vix.currentObservedAt,
    },
    {
      id:'yield-curve',
      label:'Curva del Tesoro',
      value:input.macro?.yieldCurve?.shape ?? DATA_NOT_AVAILABLE,
      detail:input.macro?.yieldCurve
        ? `10A–2A ${input.macro.yieldCurve.spread10y2y.toFixed(2)} puntos porcentuales.`
        : DATA_NOT_AVAILABLE,
      source:input.macro?.yieldCurve?.source ?? DATA_NOT_AVAILABLE,
      observedAt:input.macro?.yieldCurve?.date ?? null,
    },
    {
      id:'breadth',
      label:'Amplitud de factores MT5',
      value:freshFactors.length ? `${advancing} suben · ${declining} bajan` : DATA_NOT_AVAILABLE,
      detail:freshFactors.length
        ? `${freshFactors.length} factores con tick vigente; lectura descriptiva, no amplitud bursátil completa.`
        : DATA_NOT_AVAILABLE,
      source:freshFactors.length ? 'MetaTrader 5 local' : DATA_NOT_AVAILABLE,
      observedAt:input.factors?.checkedAt ?? null,
    },
    {
      id:'macro-window',
      label:'Ventana macro más próxima',
      value:event ? event.risk.action.replaceAll('_', ' ') : DATA_NOT_AVAILABLE,
      detail:event ? `${event.item.currency} · ${event.item.title} · ${event.risk.minutesToEvent} min.` : DATA_NOT_AVAILABLE,
      source:event?.item.source ?? DATA_NOT_AVAILABLE,
      observedAt:event?.item.scheduledAt ?? null,
    },
  ];
}

function buildChanges(selectedMarket: DailyMarketTab, input: DailyIntelligenceInput): IntelligenceChange[] {
  const factorChanges: IntelligenceChange[] = (input.factors?.factors ?? [])
    .filter((factor) => marketMatchesTab(classifyMarket(factor.id || factor.symbol).market, selectedMarket))
    .filter((factor) => Number.isFinite(factor.change24h))
    .map((factor) => ({
      id:`factor-${factor.id}`,
      title:factor.description || factor.symbol,
      value:`${factor.change24h >= 0 ? '+' : ''}${factor.change24h.toFixed(2)}%`,
      detail:`Cambio observado en 24 horas; 5 días ${factor.change5d >= 0 ? '+' : ''}${factor.change5d.toFixed(2)}%. ${factor.fresh ? 'Tick vigente.' : `Tick con ${factor.tickAgeMinutes.toFixed(0)} min.`}`,
      source:factor.source,
      observedAt:input.factors?.checkedAt ?? '',
    }))
    .sort((left, right) => Math.abs(Number.parseFloat(right.value)) - Math.abs(Number.parseFloat(left.value)));
  const marketChanges: IntelligenceChange[] = (input.market?.instruments ?? [])
    .filter((instrument) => marketMatchesTab(classifyMarket(instrument.symbol).market, selectedMarket))
    .filter((instrument) => instrument.change !== null && Number.isFinite(instrument.change))
    .map((instrument) => ({
      id:`market-${instrument.symbol}`,
      title:instrument.symbol,
      value:`${(instrument.change ?? 0) >= 0 ? '+' : ''}${(instrument.change ?? 0).toFixed(2)}%`,
      detail:instrument.freshness,
      source:instrument.source,
      observedAt:instrument.observedAt,
    }));
  return unique([...factorChanges, ...marketChanges], (item) => normalizeSymbol(item.title)).slice(0, 6);
}

function buildCandidates(
  selectedMarket: DailyMarketTab,
  scan: Mt5ScanResponse | null,
): IntelligenceCandidate[] {
  return classifyScannerCandidates(scan?.candidates ?? [])
    .filter((item) => marketMatchesTab(item.classification.market, selectedMarket))
    .sort((left, right) => right.candidate.score - left.candidate.score)
    .map(({ candidate, classification }) => ({
      symbol:candidate.symbol,
      description:candidate.description || classification.symbol,
      market:classification.market,
      direction:candidate.direction,
      score:candidate.score,
      marketStatus:candidate.marketStatus,
      spreadPoints:candidate.spreadPoints,
      tickAgeMinutes:candidate.tickAgeMinutes,
      source:candidate.source,
      observedAt:candidate.observedAt,
      caveat:'Prefiltro H1/H4. Requiere análisis profundo y no autoriza ejecución.',
    }));
}

function relevantEvents(
  selectedMarket: DailyMarketTab,
  macro: MacroSnapshot | null,
  now: Date,
): IntelligenceEvent[] {
  const currencies: Partial<Record<DailyMarketTab, readonly string[]>> = {
    STOCK:['USD'], CRYPTO:['USD'], INDEX:['USD','EUR','JPY','GBP'], ETF:['USD'],
    BOND_RATE:['USD','EUR','JPY','GBP'], OPTION:['USD'], METAL:['USD'],
    COMMODITY:['USD','CAD'], FUTURE:['USD'],
  };
  return (macro?.events ?? [])
    .filter((event) => Date.parse(event.scheduledAt) >= now.getTime() - 60 * 60_000)
    .filter((event) => selectedMarket === 'ALL' || selectedMarket === 'FOREX'
      || (currencies[selectedMarket]?.includes(event.currency) ?? false))
    .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt))
    .slice(0, 12)
    .map((event) => ({
      id:event.id,
      title:event.title,
      currency:event.currency,
      impact:event.impact,
      scheduledAt:event.scheduledAt,
      action:assessEventRisk(event, now).action,
      forecast:event.forecast,
      previous:event.previous,
      source:event.source,
      sourceUrl:event.sourceUrl,
      quality:event.quality,
    }));
}

function relevantNews(
  selectedMarket: DailyMarketTab,
  news: NewsSnapshot | null,
  now: Date,
): IntelligenceNewsItem[] {
  if (!news) return [];
  const terms = selectedMarket === 'ALL' ? [] : MARKET_NEWS_TERMS[selectedMarket];
  return rankNews(news, now)
    .filter((article) => {
      if (!terms.length) return true;
      const text = `${article.title} ${article.summary} ${article.topic} ${article.assets.join(' ')}`.toLowerCase();
      return terms.some((term) => text.includes(term));
    })
    .slice(0, 20)
    .map((article) => ({
      id:article.id,
      title:article.title,
      url:article.url,
      source:article.source,
      publishedAt:article.publishedAt,
      credibility:article.credibility,
      impact:article.impact,
      topic:article.topic,
      assets:article.assets,
    }));
}

function historyMarket(record: AnalysisHistoryRecord): MarketClass {
  return record.marketRoute?.market ?? classifyMarket(record.symbol).market;
}

function relevantHistory(
  selectedMarket: DailyMarketTab,
  history: AnalysisHistoryRecord[] | null,
): IntelligenceHistoryItem[] {
  return selectCompatibleSimulations(history ?? [])
    .filter((record) => marketMatchesTab(historyMarket(record), selectedMarket))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 20)
    .map((record) => ({
      id:record.id,
      symbol:record.symbol,
      timeframe:record.timeframe,
      decision:record.analyticalDecision ?? record.decision,
      confidence:record.analyticalConfidence ?? record.confidence,
      maturity:`${record.maturityStatus ?? 'RESEARCH'} · ${record.maturitySample ?? 0}/30`,
      outcome:record.outcome?.status ?? 'PENDIENTE',
      createdAt:record.createdAt,
    }));
}

function statusFor(
  present: boolean,
  itemCount: number,
  errors: readonly string[] = [],
): IntelligenceSourceStatus {
  if (!present || itemCount === 0) return 'UNAVAILABLE';
  return errors.length ? 'PARTIAL' : 'READY';
}

function buildSources(input: DailyIntelligenceInput): IntelligenceSource[] {
  return [
    {
      id:'market', label:'Precios externos',
      status:statusFor(Boolean(input.market), input.market?.instruments.length ?? 0, input.market?.errors),
      checkedAt:input.market?.checkedAt ?? null, errors:input.market?.errors ?? [],
    },
    {
      id:'mt5-factors', label:'Factores MT5',
      status:statusFor(Boolean(input.factors), input.factors?.factors.length ?? 0, input.factors?.errors),
      checkedAt:input.factors?.checkedAt ?? null, errors:input.factors?.errors ?? [],
    },
    {
      id:'macro', label:'Macro y calendario',
      status:statusFor(Boolean(input.macro), (input.macro?.indicators.length ?? 0) + (input.macro?.events.length ?? 0) + (input.macro?.yieldCurve ? 1 : 0), input.macro?.errors),
      checkedAt:input.macro?.checkedAt ?? null, errors:input.macro?.errors ?? [],
    },
    {
      id:'news', label:'Noticias',
      status:statusFor(Boolean(input.news), input.news?.articles.length ?? 0, input.news?.errors),
      checkedAt:input.news?.checkedAt ?? null, errors:input.news?.errors ?? [],
    },
    {
      id:'vix', label:'VIX TradingView',
      status:input.vix?.status === 'READY' || input.vix?.status === 'CACHED'
        ? input.vix.error ? 'PARTIAL' : 'READY'
        : 'UNAVAILABLE',
      checkedAt:input.vix?.checkedAt ?? null, errors:input.vix?.error ? [input.vix.error] : [],
    },
    {
      id:'scanner', label:'Escáner MT5',
      status:input.scan === null
        ? 'NOT_RUN'
        : !input.scan.ok
          ? 'UNAVAILABLE'
          : input.scan.error
            ? 'PARTIAL'
            : 'READY',
      checkedAt:input.scan?.checkedAt ?? null, errors:input.scan?.error ? [input.scan.error] : [],
    },
  ];
}

function buildCapabilities(selectedMarket: DailyMarketTab, input: DailyIntelligenceInput): IntelligenceCapability[] {
  const pricesAvailable = Boolean(input.market?.instruments.length || input.factors?.factors.length);
  const macroAvailable = Boolean(input.macro && (
    input.macro.indicators.length || input.macro.events.length || input.macro.yieldCurve
  ));
  const newsAvailable = Boolean(input.news?.articles.length);

  // SEC EDGAR: una capacidad solo está disponible si llegó el dato, no si el conector existe.
  const edgar = input.edgar ?? null;
  const edgarFailure = edgar?.error ? `SEC EDGAR no respondió: ${edgar.error}` : DATA_NOT_AVAILABLE;
  const reportForms = new Set(['8-K', '10-Q', '10-K']);
  const reports = edgar && !edgar.error
    ? edgar.filings.filter(filing => reportForms.has(filing.form.toUpperCase()))
    : [];
  const earningsAvailable = reports.length > 0;
  const earningsDetail = earningsAvailable
    ? `${reports.length} presentaciones de ${edgar?.companyName ?? edgar?.ticker} con enlace al documento original en la SEC.`
    : edgarFailure;
  const fundamentalsAvailable = Boolean(edgar && !edgar.error && edgar.latestRevenue);
  const fundamentalsDetail = fundamentalsAvailable
    ? `Hechos XBRL oficiales; ingresos declarados al cierre de ${edgar!.latestRevenue!.periodEnd}.`
    : edgarFailure;

  // VWAP y opening range: deterministas sobre velas MT5 cerradas, sin IA de por medio.
  const session = input.sessionMetrics ?? null;
  const sessionAvailable = Boolean(session && (session.vwap || session.openingRange));
  const sessionDetail = sessionAvailable
    ? [
        session!.vwap
          ? session!.vwap.basis === 'REAL_VOLUME'
            ? 'VWAP sobre volumen negociado.'
            : 'VWAP proxy sobre volumen de ticks: el bróker no entrega volumen real, no es el VWAP institucional.'
          : null,
        session!.openingRange
          ? `Opening range ${session!.openingRange.low}–${session!.openingRange.high}${session!.openingRange.breakout ? `, ruptura ${session!.openingRange.breakout === 'ABOVE' ? 'al alza' : 'a la baja'} confirmada por cierre` : ', sin ruptura confirmada'}.`
          : null,
      ].filter(Boolean).join(' ')
    : session?.unavailableReason ?? DATA_NOT_AVAILABLE;

  const capabilities: IntelligenceCapability[] = [
    {
      id:'verified-prices', label:'Precios y factores verificables',
      available:pricesAvailable,
      detail:pricesAvailable
        ? 'Disponibles con fuente y hora de corte.' : DATA_NOT_AVAILABLE,
    },
    {
      id:'macro-news', label:'Macro, calendario y noticias',
      available:macroAvailable && newsAvailable,
      detail:macroAvailable && newsAvailable ? 'Disponibles; cada elemento conserva procedencia.' : DATA_NOT_AVAILABLE,
    },
    {
      id:'technical-radar', label:'Radar técnico MT5',
      available:input.scan?.ok===true,
      detail:input.scan?.ok
        ? `Prefiltro H1/H4 automático (${input.scan.method}); no es recomendación operativa.`
        : input.scan
          ? `Escáner no disponible: ${input.scan.error ?? 'sin detalle del proveedor'}.`
          : 'Esperando el primer escaneo protegido de MT5.',
    },
    {
      id:'ai-routing', label:'Consejo de IA con control de costo', available:true,
      detail:'Tiempo real determinista; Opus 5 y GPT-5.6 Sol nunca se consultan automáticamente como respaldo silencioso.',
    },
  ];
  if (selectedMarket === 'STOCK' || selectedMarket === 'ALL') {
    capabilities.push(
      { id:'tradestation-adapter', label:'Adaptador TradeStation SIM', available:false, detail:'Contrato MarketData de solo lectura preparado; OAuth todavía no conectado.' },
      { id:'extended-hours', label:'Premarket y after-hours', available:false, detail:DATA_NOT_AVAILABLE },
      { id:'earnings', label:'Resultados y guías empresariales', available:earningsAvailable, detail:earningsDetail },
      { id:'fundamentals', label:'SEC y fundamentales empresariales', available:fundamentalsAvailable, detail:fundamentalsDetail },
      { id:'opening-range', label:'Opening range y VWAP intradía', available:sessionAvailable, detail:sessionDetail },
    );
  }
  return capabilities;
}

export function deriveDailyIntelligence(
  input: DailyIntelligenceInput,
  selectedMarket: DailyMarketTab = 'ALL',
  now: Date = new Date(),
): DailyIntelligenceModel {
  const candidates = buildCandidates(selectedMarket, input.scan);
  return {
    market:selectedMarket,
    generatedAt:now.toISOString(),
    benchmarks:buildBenchmarks(selectedMarket, input, now),
    context:buildContext(input, now),
    changes:buildChanges(selectedMarket, input),
    candidates:candidates.filter((candidate) => candidate.direction !== 'ESPERAR' && candidate.marketStatus === 'ACTIVO').slice(0, 12),
    avoidCandidates:candidates.filter((candidate) => candidate.direction === 'ESPERAR' || candidate.marketStatus !== 'ACTIVO').slice(0, 8),
    events:relevantEvents(selectedMarket, input.macro, now),
    news:relevantNews(selectedMarket, input.news, now),
    history:relevantHistory(selectedMarket, input.history),
    sources:buildSources(input),
    capabilities:buildCapabilities(selectedMarket, input),
    scanStatus:input.scan === null ? 'NOT_RUN' : input.scan.ok ? 'READY' : 'UNAVAILABLE',
    scanMethod:input.scan?.method ?? null,
  };
}
