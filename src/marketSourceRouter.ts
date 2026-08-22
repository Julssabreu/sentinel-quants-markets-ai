import type { EquityContextAnalysis } from './equityContext';
import {
  classifyMarket,
  type MarketAnalysisRequest,
  type MarketClassification,
} from './marketArchitecture';
import {
  PROVIDERS,
  REQUIRED_ROLES_BY_MARKET,
  type CoverageMode,
  type MarketId,
  type ProviderDefinition,
  type ProviderId,
  type ProviderRole,
  type ProviderStatus,
} from './providerRegistry';

export const MARKET_ROUTER_VERSION = '1.0.0';

export type RouteRuntimeStatus =
  | 'VERIFIED'
  | 'READY'
  | 'CONDITIONAL'
  | 'AVAILABLE'
  | 'REQUIRES_SETUP'
  | 'STALE'
  | 'FAILED';

export type RoleCoverageStatus = 'VERIFIED' | 'PLANNED' | 'DEGRADED' | 'MISSING';
export type MarketCoverageStatus = 'COMPLETE' | 'PARTIAL' | 'INSUFFICIENT';

export interface Mt5ResolutionEvidence {
  resolved: boolean;
  exact: boolean;
  ambiguous?: boolean;
  brokerSymbol?: string | null;
  candlesAvailable?: boolean;
  tickFresh?: boolean;
  observedAt?: string | null;
  error?: string | null;
}

export interface ProviderObservation {
  providerId: ProviderId;
  roles?: readonly ProviderRole[];
  ok: boolean;
  fresh?: boolean;
  observedAt?: string | null;
  error?: string | null;
}

export interface MarketRouterRuntime {
  mt5?: Mt5ResolutionEvidence | null;
  tradingViewConfigured?: boolean;
  observations?: readonly ProviderObservation[];
  equityFundamental?: EquityContextAnalysis | null;
}

export interface RoutedProvider {
  providerId: ProviderId;
  providerName: string;
  providerStatus: ProviderStatus;
  role: ProviderRole;
  coverageMode: CoverageMode;
  runtimeStatus: RouteRuntimeStatus;
  observedAt: string | null;
  reason: string;
  autoSpend: false;
}

export interface RoleCoverage {
  role: ProviderRole;
  required: boolean;
  status: RoleCoverageStatus;
  providers: RoutedProvider[];
}

export interface MarketCoverageDecision {
  status: MarketCoverageStatus;
  requiredRoleCount: number;
  plannedRoleCount: number;
  verifiedRoleCount: number;
  missingRoles: ProviderRole[];
  degradedRoles: ProviderRole[];
}

export interface ResolvedAnalysisContext {
  resolverVersion: string;
  request: MarketAnalysisRequest;
  instrument: MarketClassification;
  roles: RoleCoverage[];
  coverage: MarketCoverageDecision;
  readyForTechnicalAnalysis: boolean;
  readyForOperationalAnalysis: boolean;
  operationalBlockers: string[];
  warnings: string[];
}

export interface MarketRouteSnapshot {
  resolverVersion: string;
  market: MarketClassification['market'];
  instrumentKind: MarketClassification['instrumentKind'];
  canonicalId: string;
  contractId: string;
  exchange: string | null;
  brokerSymbol: string | null;
  underlying: MarketClassification['underlying'];
  coverage: MarketCoverageDecision;
  readyForOperationalAnalysis: boolean;
  sources: Array<Pick<RoutedProvider, 'providerId' | 'role' | 'runtimeStatus' | 'observedAt'>>;
}

const ROLE_ORDER: readonly ProviderRole[] = [
  'PRICE_TECHNICAL',
  'DERIVATIVES',
  'MACRO',
  'FUNDAMENTAL',
  'REGULATORY',
  'NEWS',
  'CONTEXT',
  'ALERT_TRIGGER',
];

const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'NYSEARCA', 'OPRA', 'CME', 'CBOT', 'NYMEX', 'COMEX']);
const USD_REFERENCE_PROVIDERS = new Set<ProviderId>(['fed', 'nyfed', 'bls', 'treasury']);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function observationFor(
  runtime: MarketRouterRuntime,
  providerId: ProviderId,
  role: ProviderRole,
): ProviderObservation | undefined {
  return runtime.observations?.find(item => (
    item.providerId === providerId && (!item.roles || item.roles.includes(role))
  ));
}

function instrumentTokens(instrument: MarketClassification, request: MarketAnalysisRequest): string {
  const metadata = request.brokerMetadata;
  return [
    instrument.canonicalId,
    instrument.symbol,
    instrument.exchange,
    metadata?.currencyBase,
    metadata?.currencyProfit,
    metadata?.currencyMargin,
    metadata?.path,
    metadata?.description,
  ].filter(Boolean).join(' ').toUpperCase();
}

function applicability(
  providerId: ProviderId,
  instrument: MarketClassification,
  request: MarketAnalysisRequest,
): { applicable: boolean; reason: string } {
  const tokens = instrumentTokens(instrument, request);
  const exchange = instrument.exchange?.toUpperCase() ?? '';
  if (USD_REFERENCE_PROVIDERS.has(providerId)) {
    const relevant = tokens.includes('USD') || tokens.includes('US10Y') || US_EXCHANGES.has(exchange)
      || ['SPX', 'NDX', 'DJI', 'VIX', 'US500', 'NAS100'].some(value => tokens.includes(value));
    return relevant
      ? { applicable: true, reason: 'Referencia de Estados Unidos pertinente por moneda, bolsa o subyacente.' }
      : { applicable: false, reason: 'Solo se activa si moneda, bolsa o exposición confirman relevancia de Estados Unidos.' };
  }
  if (providerId === 'ecb') {
    return tokens.includes('EUR')
      ? { applicable: true, reason: 'Referencia europea pertinente por exposición al euro.' }
      : { applicable: false, reason: 'Solo se activa cuando la exposición al euro está identificada.' };
  }
  if (providerId === 'cftc') {
    return {
      applicable: false,
      reason: 'Requiere correspondencia explícita con un contrato incluido en el reporte COT; no cubre todo instrumento.',
    };
  }
  return { applicable: true, reason: 'La fuente declara cobertura para este mercado y función.' };
}

function statusForProvider(
  provider: ProviderDefinition,
  role: ProviderRole,
  mode: CoverageMode,
  instrument: MarketClassification,
  request: MarketAnalysisRequest,
  runtime: MarketRouterRuntime,
): Pick<RoutedProvider, 'runtimeStatus' | 'observedAt' | 'reason'> {
  const observation = observationFor(runtime, provider.id, role);
  if (observation) {
    if (!observation.ok) {
      return {
        runtimeStatus: 'FAILED',
        observedAt: observation.observedAt ?? null,
        reason: observation.error || 'La consulta falló y no se usó como evidencia.',
      };
    }
    if (observation.fresh === false) {
      return {
        runtimeStatus: 'STALE',
        observedAt: observation.observedAt ?? null,
        reason: 'La observación existe, pero está fuera de su ventana de frescura.',
      };
    }
    return {
      runtimeStatus: 'VERIFIED',
      observedAt: observation.observedAt ?? null,
      reason: 'Observación obtenida y utilizable en esta ejecución.',
    };
  }

  if (provider.id === 'mt5' && mode === 'BROKER_DEPENDENT') {
    const evidence = runtime.mt5;
    if (evidence?.ambiguous || evidence?.error) {
      return {
        runtimeStatus: 'FAILED',
        observedAt: evidence.observedAt ?? null,
        reason: evidence.error || 'La resolución MT5 es ambigua.',
      };
    }
    if (evidence?.resolved && evidence.exact && evidence.candlesAvailable && evidence.tickFresh) {
      return {
        runtimeStatus: 'VERIFIED',
        observedAt: evidence.observedAt ?? null,
        reason: `Contrato MT5 resuelto sin ambigüedad${evidence.brokerSymbol ? ` como ${evidence.brokerSymbol}` : ''}, con velas y tick vigentes.`,
      };
    }
    return {
      runtimeStatus: 'CONDITIONAL',
      observedAt: evidence?.observedAt ?? null,
      reason: 'El conector existe, pero falta confirmar alias exacto, contrato, velas y tick vigente en el bróker.',
    };
  }

  if (provider.id === 'tradingview') {
    return runtime.tradingViewConfigured
      ? { runtimeStatus: 'READY', observedAt: null, reason: 'Puente configurado; una alerta sigue siendo un disparador, no precio operativo.' }
      : { runtimeStatus: 'AVAILABLE', observedAt: null, reason: 'El puente está preparado localmente, pero aún no está desplegado y configurado.' };
  }

  if (provider.status !== 'ACTIVE') {
    return {
      runtimeStatus: provider.status === 'AVAILABLE' ? 'AVAILABLE' : 'REQUIRES_SETUP',
      observedAt: null,
      reason: provider.notes,
    };
  }

  const match = applicability(provider.id, instrument, request);
  return {
    runtimeStatus: match.applicable ? 'READY' : 'CONDITIONAL',
    observedAt: null,
    reason: match.reason,
  };
}

function routeProvider(
  provider: ProviderDefinition,
  market: MarketId,
  role: ProviderRole,
  instrument: MarketClassification,
  request: MarketAnalysisRequest,
  runtime: MarketRouterRuntime,
): RoutedProvider | null {
  const coverage = provider.coverage.find(item => item.markets.includes(market) && item.roles.includes(role));
  if (!coverage) return null;
  return {
    providerId: provider.id,
    providerName: provider.name,
    providerStatus: provider.status,
    role,
    coverageMode: coverage.mode,
    ...statusForProvider(provider, role, coverage.mode, instrument, request, runtime),
    autoSpend: false,
  };
}

function roleStatus(providers: RoutedProvider[]): RoleCoverageStatus {
  if (providers.some(provider => provider.runtimeStatus === 'VERIFIED')) return 'VERIFIED';
  if (providers.some(provider => provider.runtimeStatus === 'READY' || provider.runtimeStatus === 'CONDITIONAL')) return 'PLANNED';
  if (providers.some(provider => provider.runtimeStatus === 'FAILED' || provider.runtimeStatus === 'STALE')) return 'DEGRADED';
  return 'MISSING';
}

export function resolveMarketAnalysisContext(
  request: MarketAnalysisRequest | string,
  runtime: MarketRouterRuntime = {},
): ResolvedAnalysisContext {
  const normalizedRequest: MarketAnalysisRequest = typeof request === 'string' ? { symbol: request } : request;
  const instrument = classifyMarket(normalizedRequest);
  const market = instrument.market === 'UNKNOWN' ? null : instrument.market;
  const requiredRoles = market ? REQUIRED_ROLES_BY_MARKET[market] : [];
  const roles = ROLE_ORDER.map(role => {
    const providers = market
      ? PROVIDERS.map(provider => routeProvider(provider, market, role, instrument, normalizedRequest, runtime)).filter((item): item is RoutedProvider => Boolean(item))
      : [];
    return {
      role,
      required: requiredRoles.includes(role),
      status: roleStatus(providers),
      providers,
    } satisfies RoleCoverage;
  });

  if (market === 'STOCK' && runtime.equityFundamental?.usableForFundamentalDecision) {
    const fundamental = roles.find(role => role.role === 'FUNDAMENTAL');
    if (fundamental) fundamental.status = 'VERIFIED';
  }

  const required = roles.filter(role => role.required);
  const missingRoles = required.filter(role => role.status === 'MISSING').map(role => role.role);
  const degradedRoles = required.filter(role => role.status === 'DEGRADED').map(role => role.role);
  const unresolvedCfd = instrument.instrumentKind === 'CFD' && !instrument.underlying;
  const coverageStatus: MarketCoverageStatus = instrument.market === 'UNKNOWN' || unresolvedCfd
    ? 'INSUFFICIENT'
    : missingRoles.length > 0 || degradedRoles.length > 0
      ? 'PARTIAL'
      : 'COMPLETE';
  const coverage: MarketCoverageDecision = {
    status: coverageStatus,
    requiredRoleCount: required.length,
    plannedRoleCount: required.filter(role => role.status !== 'MISSING' && role.status !== 'DEGRADED').length,
    verifiedRoleCount: required.filter(role => role.status === 'VERIFIED').length,
    missingRoles,
    degradedRoles,
  };

  const mt5Verified = roles.find(role => role.role === 'PRICE_TECHNICAL')?.providers
    .some(provider => provider.providerId === 'mt5' && provider.runtimeStatus === 'VERIFIED') ?? false;
  const readyForTechnicalAnalysis = instrument.market !== 'UNKNOWN' && !unresolvedCfd && mt5Verified;
  const readyForOperationalAnalysis = readyForTechnicalAnalysis && coverage.status === 'COMPLETE';
  const blockers: string[] = [];
  if (instrument.market === 'UNKNOWN') blockers.push('Identidad de mercado no resuelta.');
  if (unresolvedCfd) blockers.push('CFD sin subyacente inequívoco.');
  if (!mt5Verified) blockers.push('MT5 no ha demostrado resolución exacta, velas disponibles y tick vigente.');
  if (missingRoles.length > 0) blockers.push(`Cobertura requerida ausente: ${missingRoles.join(', ')}.`);
  if (degradedRoles.length > 0) blockers.push(`Cobertura degradada: ${degradedRoles.join(', ')}.`);

  const warnings = [...instrument.warnings];
  if (instrument.market === 'STOCK' && missingRoles.includes('FUNDAMENTAL')) {
    warnings.push('Acciones: no hay todavía un conector fundamental activo; Sentinel no inventará valoración, resultados ni balances.');
  }
  if (instrument.market === 'STOCK' && missingRoles.includes('REGULATORY')) {
    warnings.push('Acciones: falta una fuente regulatoria oficial aplicable a cada bolsa o jurisdicción.');
  }
  warnings.push('El VIX puede aportar contexto diario de volatilidad cuando sea pertinente; nunca se convierte en BUY/SELL ni en condición universal.');

  return {
    resolverVersion: MARKET_ROUTER_VERSION,
    request: normalizedRequest,
    instrument,
    roles,
    coverage,
    readyForTechnicalAnalysis,
    readyForOperationalAnalysis,
    operationalBlockers: unique(blockers),
    warnings: unique(warnings),
  };
}

export function marketRouteSnapshot(context: ResolvedAnalysisContext): MarketRouteSnapshot {
  return {
    resolverVersion: context.resolverVersion,
    market: context.instrument.market,
    instrumentKind: context.instrument.instrumentKind,
    canonicalId: context.instrument.canonicalId,
    contractId: context.instrument.contractId,
    exchange: context.instrument.exchange,
    brokerSymbol: context.instrument.brokerSymbol,
    underlying: context.instrument.underlying,
    coverage: context.coverage,
    readyForOperationalAnalysis: context.readyForOperationalAnalysis,
    sources: context.roles.flatMap(role => role.providers
      .filter(provider => ['VERIFIED', 'READY', 'CONDITIONAL', 'STALE', 'FAILED'].includes(provider.runtimeStatus))
      .map(provider => ({
        providerId: provider.providerId,
        role: provider.role,
        runtimeStatus: provider.runtimeStatus,
        observedAt: provider.observedAt,
      }))),
  };
}
