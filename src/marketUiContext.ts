import type { MarketAnalysisRequest, MarketClass } from './marketArchitecture';
import {
  marketRouteSnapshot,
  resolveMarketAnalysisContext,
  type MarketRouterRuntime,
  type ProviderObservation,
  type ResolvedAnalysisContext,
} from './marketSourceRouter';
import type { ProviderRole } from './providerRegistry';
import type { JulssbotMarketContext } from './julssbotAnalysis';
import type { MarketRuntimeEvidence } from './MarketCoveragePanel';

interface RuntimeInstrumentMetadata {
  symbol?: string | null;
  description?: string | null;
  path?: string | null;
  category?: string | null;
  exchange?: string | null;
  isin?: string | null;
  sector?: string | number | null;
  industry?: string | number | null;
  currencyBase?: string | null;
  currencyProfit?: string | null;
  currencyMargin?: string | null;
  tradeCalcMode?: number | null;
}

export interface MarketRatesEvidence {
  ok?: boolean;
  requested?: string;
  symbol?: string;
  source?: string;
  error?: string;
  resolution?: {
    method:'EXACT_BROKER_SYMBOL'|'EXACT_CANONICAL'|'UNIQUE_BROKER_SUFFIX';
    score:[number, number];
    ambiguous:false;
  };
  candles?: unknown[];
  tick?: {time?: string | null} | null;
  instrument?: RuntimeInstrumentMetadata;
}

export interface MarketUiResolution {
  route: ResolvedAnalysisContext;
  routeSnapshot: ReturnType<typeof marketRouteSnapshot>;
  classification: ResolvedAnalysisContext['instrument'];
  context: JulssbotMarketContext;
  runtime: MarketRuntimeEvidence | null;
}

const MARKET_LABELS: Record<MarketClass, string> = {
  FOREX:'Divisas',
  CRYPTO:'Criptoactivo',
  STOCK:'Acción',
  INDEX:'Índice',
  ETF:'ETF',
  METAL:'Metal',
  COMMODITY:'Materia prima',
  FUTURE:'Futuro',
  CFD:'CFD',
  BOND_RATE:'Bono o tasa',
  OPTION:'Opción',
  UNKNOWN:'Mercado no clasificado',
};

const ROLE_LABELS: Record<ProviderRole, string> = {
  PRICE_TECHNICAL:'Precio y análisis técnico',
  DERIVATIVES:'Datos específicos de derivados',
  MACRO:'Contexto macroeconómico',
  FUNDAMENTAL:'Fundamentales corporativos',
  REGULATORY:'Documentos o posicionamiento regulatorio',
  NEWS:'Noticias verificables',
  CONTEXT:'Contexto de mercado',
  ALERT_TRIGGER:'Disparador de alertas',
};

const unique = (values: string[]) => [...new Set(values)];

function requestWithRuntime(symbol: string, timeframe: string, rates?: MarketRatesEvidence | null): MarketAnalysisRequest {
  const broker = rates?.instrument;
  return {
    symbol,
    timeframe,
    providerSymbols:rates?.symbol ? {MT5:rates.symbol} : undefined,
    brokerMetadata:rates ? {
      symbol:rates.symbol ?? broker?.symbol ?? null,
      description:broker?.description ?? null,
      path:broker?.path ?? null,
      category:broker?.category ?? null,
      exchange:broker?.exchange ?? null,
      isin:broker?.isin ?? null,
      sector:broker?.sector == null ? null : String(broker.sector),
      industry:broker?.industry == null ? null : String(broker.industry),
      currencyBase:broker?.currencyBase ?? null,
      currencyProfit:broker?.currencyProfit ?? null,
      currencyMargin:broker?.currencyMargin ?? null,
      tradeCalcMode:broker?.tradeCalcMode ?? null,
    } : undefined,
  };
}

function exactMt5Resolution(rates?: MarketRatesEvidence | null): boolean {
  if (!rates?.ok || !rates.symbol || !rates.resolution || rates.resolution.ambiguous) return false;
  return [
    'EXACT_BROKER_SYMBOL',
    'EXACT_CANONICAL',
    'UNIQUE_BROKER_SUFFIX',
  ].includes(rates.resolution.method);
}

function tickFresh(time: string | null | undefined, now = new Date()): boolean {
  const timestamp = time ? Date.parse(time) : Number.NaN;
  return Number.isFinite(timestamp) && Math.max(0, now.getTime() - timestamp) <= 30 * 60_000;
}

function routerRuntime(
  request: MarketAnalysisRequest,
  rates?: MarketRatesEvidence | null,
  supplemental: Omit<MarketRouterRuntime, 'mt5'> = {},
): MarketRouterRuntime {
  return {
    ...supplemental,
    mt5:rates ? {
      resolved:Boolean(rates.ok && rates.symbol),
      exact:exactMt5Resolution(rates),
      ambiguous:rates.error === 'SYMBOL_AMBIGUOUS',
      brokerSymbol:rates.symbol ?? null,
      candlesAvailable:Boolean(rates.candles?.length),
      tickFresh:tickFresh(rates.tick?.time),
      observedAt:rates.tick?.time ?? null,
      error:rates.error ?? null,
    } : null,
  };
}

function sourceLists(route: ResolvedAnalysisContext) {
  const all = route.roles.flatMap(role => role.providers);
  const active = all.filter(provider => provider.providerStatus === 'ACTIVE')
    .filter(provider => !['FAILED', 'STALE'].includes(provider.runtimeStatus))
    .map(provider => `${provider.providerName} · ${provider.runtimeStatus}`);
  const pending = all.filter(provider => provider.providerStatus !== 'ACTIVE')
    .map(provider => `${provider.providerName} · ${provider.runtimeStatus}`);
  return {active:unique(active), pending:unique(pending)};
}

/** UI adapter for the single, authoritative multi-market router. It performs no I/O. */
export function resolveMarketUiContext(
  symbol: string,
  timeframe: string,
  rates?: MarketRatesEvidence | null,
  supplementalRuntime: Omit<MarketRouterRuntime, 'mt5'> = {},
): MarketUiResolution {
  const request = requestWithRuntime(symbol, timeframe, rates);
  const route = resolveMarketAnalysisContext(request, routerRuntime(request, rates, supplementalRuntime));
  const sources = sourceLists(route);
  const missingOrDegraded = unique([
    ...route.coverage.missingRoles,
    ...route.coverage.degradedRoles,
  ].map(role => ROLE_LABELS[role]));
  if (route.instrument.market === 'UNKNOWN') {
    missingOrDegraded.push('Clasificación inequívoca del mercado');
  }
  const mt5 = route.roles.flatMap(role => role.providers).find(provider => (
    provider.providerId === 'mt5' && provider.role === 'PRICE_TECHNICAL'
  ));

  return {
    route,
    routeSnapshot:marketRouteSnapshot(route),
    classification:route.instrument,
    context: {
      market:route.instrument.market,
      marketLabel:MARKET_LABELS[route.instrument.market],
      canonicalId:route.instrument.canonicalId,
      contractId:route.instrument.contractId,
      instrumentKind:route.instrument.instrumentKind,
      classificationConfidence:route.instrument.confidence,
      coverage:route.coverage.status,
      requiredRoleCount:route.coverage.requiredRoleCount,
      plannedRoleCount:route.coverage.plannedRoleCount,
      verifiedRoleCount:route.coverage.verifiedRoleCount,
      readyForTechnicalAnalysis:route.readyForTechnicalAnalysis,
      readyForOperationalAnalysis:route.readyForOperationalAnalysis,
      operationalPriceVerified:mt5?.runtimeStatus === 'VERIFIED',
      activeSources:sources.active,
      pendingSources:sources.pending,
      gaps:missingOrDegraded,
      warnings:unique([...route.warnings, ...route.operationalBlockers]),
    },
    runtime:runtimeEvidence(rates),
  };
}

export function verifiedProviderObservation(
  providerId: ProviderObservation['providerId'],
  roles: readonly ProviderRole[],
  observedAt: string | null,
): ProviderObservation {
  return {providerId, roles, ok:true, fresh:true, observedAt};
}

function runtimeEvidence(rates?: MarketRatesEvidence | null): MarketRuntimeEvidence | null {
  if (!rates) return null;
  const instrument = rates.instrument;
  return {
    brokerSymbol:rates.symbol ?? instrument?.symbol ?? null,
    source:rates.source ?? null,
    description:instrument?.description ?? null,
    exchange:instrument?.exchange ?? null,
    sector:instrument?.sector == null ? null : String(instrument.sector),
    industry:instrument?.industry == null ? null : String(instrument.industry),
    isin:instrument?.isin ?? null,
  };
}
