export type ProviderTier = 'FREE' | 'FREEMIUM' | 'PAID' | 'LICENSED';

/**
 * ACTIVE means that Sentinel already contains a callable, read-only connector.
 * AVAILABLE is deliberately not active: code or a service may be prepared, but
 * the user still has to deploy/configure it.
 */
export type ProviderStatus =
  | 'ACTIVE'
  | 'AVAILABLE'
  | 'REQUIRES_KEY'
  | 'REQUIRES_LICENSE'
  | 'MANUAL_ONLY';

export type MarketId = Exclude<MarketClass, 'UNKNOWN'>;

export type ProviderRole =
  | 'PRICE_TECHNICAL'
  | 'DERIVATIVES'
  | 'MACRO'
  | 'FUNDAMENTAL'
  | 'REGULATORY'
  | 'NEWS'
  | 'CONTEXT'
  | 'ALERT_TRIGGER';

export type CoverageMode =
  | 'DIRECT'
  | 'REFERENCE'
  | 'BROKER_DEPENDENT'
  | 'TRIGGER_ONLY';

export type ProviderId =
  | 'mt5'
  | 'binance'
  | 'fed'
  | 'nyfed'
  | 'ecb'
  | 'bls'
  | 'treasury'
  | 'cftc'
  | 'forexfactory'
  | 'gdelt'
  | 'tradingview'
  | 'sec'
  | 'x'
  | 'reuters'
  | 'alphasense'
  | 'investing';

export interface ProviderCoverage {
  markets: readonly MarketId[];
  roles: readonly ProviderRole[];
  mode: CoverageMode;
}

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  tier: ProviderTier;
  status: ProviderStatus;
  /** Aggregates the typed roles declared in coverage. */
  roles: readonly ProviderRole[];
  /** Aggregates the markets declared in coverage. */
  markets: readonly MarketId[];
  coverage: readonly ProviderCoverage[];
  autoSpend: false;
  notes: string;
}

export interface ProviderQueryOptions {
  /** Defaults to false so staged, manual and premium sources never look active. */
  includeInactive?: boolean;
}

export interface RequiredCoverageGap {
  market: MarketId;
  role: ProviderRole;
  /** Non-active providers that could cover the role after explicit setup. */
  inactiveCandidates: readonly ProviderId[];
}

export const ALL_MARKETS: readonly MarketId[] = [
  'FOREX',
  'CRYPTO',
  'STOCK',
  'INDEX',
  'ETF',
  'METAL',
  'COMMODITY',
  'FUTURE',
  'CFD',
  'BOND_RATE',
  'OPTION'
];

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

type ProviderSeed = Omit<ProviderDefinition, 'roles' | 'markets'>;

function defineProvider(seed: ProviderSeed): ProviderDefinition {
  return {
    ...seed,
    roles: unique(seed.coverage.flatMap(item => item.roles)),
    markets: unique(seed.coverage.flatMap(item => item.markets))
  };
}

export const PROVIDERS: readonly ProviderDefinition[] = [
  defineProvider({
    id: 'mt5',
    name: 'MetaTrader 5',
    tier: 'FREE',
    status: 'ACTIVE',
    coverage: [{ markets: ALL_MARKETS, roles: ['PRICE_TECHNICAL'], mode: 'BROKER_DEPENDENT' }],
    autoSpend: false,
    notes: 'Conector local de solo lectura. La cobertura real depende del catálogo ofrecido por el bróker conectado.'
  }),
  defineProvider({
    id: 'binance',
    name: 'Binance Public Market Data',
    tier: 'FREE',
    status: 'ACTIVE',
    coverage: [{ markets: ['CRYPTO'], roles: ['PRICE_TECHNICAL', 'CONTEXT'], mode: 'DIRECT' }],
    autoSpend: false,
    notes: 'Endpoints y WebSocket públicos de solo lectura para spot, derivados, flujo y liquidaciones cripto.'
  }),
  defineProvider({
    id: 'fed',
    name: 'Federal Reserve',
    tier: 'FREE',
    status: 'ACTIVE',
    coverage: [{ markets: ALL_MARKETS, roles: ['MACRO', 'NEWS', 'CONTEXT'], mode: 'REFERENCE' }],
    autoSpend: false,
    notes: 'Comunicados monetarios oficiales mediante RSS; no entrega precios operativos.'
  }),
  defineProvider({
    id: 'nyfed',
    name: 'Federal Reserve Bank of New York',
    tier: 'FREE',
    status: 'ACTIVE',
    coverage: [{ markets: ALL_MARKETS, roles: ['MACRO', 'CONTEXT'], mode: 'REFERENCE' }],
    autoSpend: false,
    notes: 'Fuente institucional para SOFR y contexto de financiación en dólares.'
  }),
  defineProvider({
    id: 'ecb',
    name: 'Banco Central Europeo vía Frankfurter',
    tier: 'FREE',
    status: 'ACTIVE',
    coverage: [{ markets: ALL_MARKETS, roles: ['MACRO', 'NEWS', 'CONTEXT'], mode: 'REFERENCE' }],
    autoSpend: false,
    notes: 'Referencia diaria de divisas del BCE y comunicados oficiales; no es una cotización intradía.'
  }),
  defineProvider({
    id: 'bls',
    name: 'U.S. Bureau of Labor Statistics',
    tier: 'FREE',
    status: 'ACTIVE',
    coverage: [{ markets: ALL_MARKETS, roles: ['MACRO', 'CONTEXT'], mode: 'REFERENCE' }],
    autoSpend: false,
    notes: 'Series oficiales de inflación y empleo de Estados Unidos.'
  }),
  defineProvider({
    id: 'treasury',
    name: 'U.S. Department of the Treasury',
    tier: 'FREE',
    status: 'ACTIVE',
    coverage: [
      { markets: ALL_MARKETS, roles: ['MACRO', 'CONTEXT'], mode: 'REFERENCE' },
      { markets: ['BOND_RATE'], roles: ['PRICE_TECHNICAL'], mode: 'REFERENCE' }
    ],
    autoSpend: false,
    notes: 'Curvas nominal y real oficiales; son referencias de tasas, no precios de ejecución.'
  }),
  defineProvider({
    id: 'cftc',
    name: 'U.S. Commodity Futures Trading Commission',
    tier: 'FREE',
    status: 'ACTIVE',
    coverage: [{
      markets: ['FOREX', 'CRYPTO', 'INDEX', 'METAL', 'COMMODITY', 'FUTURE'],
      roles: ['REGULATORY', 'CONTEXT'],
      mode: 'REFERENCE'
    }],
    autoSpend: false,
    notes: 'COT oficial semanal para los contratos seleccionados que Sentinel ya filtra; no cubre cada instrumento.'
  }),
  defineProvider({
    id: 'sec',
    name: 'U.S. Securities and Exchange Commission (EDGAR)',
    tier: 'FREE',
    status: 'ACTIVE',
    coverage: [{
      markets: ['STOCK', 'ETF'],
      roles: ['REGULATORY', 'FUNDAMENTAL', 'NEWS', 'CONTEXT'],
      mode: 'DIRECT'
    }],
    autoSpend: false,
    notes: 'Fuente primaria: 8-K, 10-Q y 10-K llegan antes que cualquier agencia que los reporte. Conector verificado en vivo el 2026-08-21 contra AAPL: resolución de CIK, 150 presentaciones y 503 conceptos us-gaap. Exige User-Agent con contacto y respeta 10 solicitudes por segundo.'
  }),
  defineProvider({
    id: 'forexfactory',
    name: 'Forex Factory',
    tier: 'FREE',
    status: 'ACTIVE',
    coverage: [{ markets: ALL_MARKETS, roles: ['MACRO', 'CONTEXT'], mode: 'REFERENCE' }],
    autoSpend: false,
    notes: 'Calendario económico secundario; los eventos críticos deben confirmarse con la fuente oficial.'
  }),
  defineProvider({
    id: 'gdelt',
    name: 'GDELT',
    tier: 'FREE',
    status: 'ACTIVE',
    coverage: [{ markets: ALL_MARKETS, roles: ['NEWS', 'CONTEXT'], mode: 'REFERENCE' }],
    autoSpend: false,
    notes: 'Agregador abierto de noticias. Sentinel conserva la fuente original y aplica controles de calidad.'
  }),
  defineProvider({
    id: 'tradingview',
    name: 'TradingView',
    tier: 'FREEMIUM',
    status: 'AVAILABLE',
    coverage: [
      { markets: ALL_MARKETS, roles: ['PRICE_TECHNICAL', 'ALERT_TRIGGER'], mode: 'TRIGGER_ONLY' },
      { markets: ALL_MARKETS, roles: ['CONTEXT'], mode: 'REFERENCE' }
    ],
    autoSpend: false,
    notes: 'Puente Worker + D1 preparado localmente, pero todavía no desplegado ni configurado. Las alertas solo disparan análisis.'
  }),
  defineProvider({
    id: 'x',
    name: 'X API',
    tier: 'PAID',
    status: 'REQUIRES_KEY',
    coverage: [{ markets: ALL_MARKETS, roles: ['NEWS', 'CONTEXT'], mode: 'REFERENCE' }],
    autoSpend: false,
    notes: 'Pago por uso desactivado; requiere clave, presupuesto y autorización explícita.'
  }),
  defineProvider({
    id: 'reuters',
    name: 'Reuters Connect',
    tier: 'LICENSED',
    status: 'REQUIRES_LICENSE',
    coverage: [{ markets: ALL_MARKETS, roles: ['NEWS', 'CONTEXT'], mode: 'REFERENCE' }],
    autoSpend: false,
    notes: 'Conector no activo. API y contenido sujetos a licencia comercial.'
  }),
  defineProvider({
    id: 'alphasense',
    name: 'AlphaSense',
    tier: 'LICENSED',
    status: 'REQUIRES_LICENSE',
    coverage: [{
      markets: ['STOCK', 'ETF'],
      roles: ['FUNDAMENTAL', 'NEWS', 'CONTEXT'],
      mode: 'REFERENCE'
    }],
    autoSpend: false,
    notes: 'Conector no activo previsto para fundamentales, documentos y resultados; requiere licencia.'
  }),
  defineProvider({
    id: 'investing',
    name: 'Investing.com',
    tier: 'LICENSED',
    status: 'MANUAL_ONLY',
    coverage: [{
      markets: ALL_MARKETS,
      roles: ['PRICE_TECHNICAL', 'MACRO', 'NEWS', 'CONTEXT'],
      mode: 'REFERENCE'
    }],
    autoSpend: false,
    notes: 'Solo consulta visual manual; automatización desactivada sin permiso escrito o API autorizada.'
  })
];

export const REQUIRED_ROLES_BY_MARKET: Readonly<Record<MarketId, readonly ProviderRole[]>> = {
  FOREX: ['PRICE_TECHNICAL', 'MACRO', 'NEWS', 'CONTEXT'],
  CRYPTO: ['PRICE_TECHNICAL', 'MACRO', 'REGULATORY', 'NEWS', 'CONTEXT'],
  STOCK: ['PRICE_TECHNICAL', 'MACRO', 'FUNDAMENTAL', 'REGULATORY', 'NEWS', 'CONTEXT'],
  INDEX: ['PRICE_TECHNICAL', 'MACRO', 'NEWS', 'CONTEXT'],
  ETF: ['PRICE_TECHNICAL', 'MACRO', 'FUNDAMENTAL', 'REGULATORY', 'NEWS', 'CONTEXT'],
  METAL: ['PRICE_TECHNICAL', 'MACRO', 'REGULATORY', 'NEWS', 'CONTEXT'],
  COMMODITY: ['PRICE_TECHNICAL', 'MACRO', 'REGULATORY', 'NEWS', 'CONTEXT'],
  FUTURE: ['PRICE_TECHNICAL', 'MACRO', 'REGULATORY', 'NEWS', 'CONTEXT'],
  CFD: ['PRICE_TECHNICAL', 'MACRO', 'NEWS', 'CONTEXT'],
  BOND_RATE: ['PRICE_TECHNICAL', 'MACRO', 'NEWS', 'CONTEXT'],
  OPTION: ['PRICE_TECHNICAL', 'DERIVATIVES', 'MACRO', 'NEWS', 'CONTEXT']
};

function isSelectable(provider: ProviderDefinition, options?: ProviderQueryOptions): boolean {
  return options?.includeInactive === true || provider.status === 'ACTIVE';
}

function covers(provider: ProviderDefinition, market: MarketId, role?: ProviderRole): boolean {
  return provider.coverage.some(item =>
    item.markets.includes(market) && (role === undefined || item.roles.includes(role))
  );
}

/** Returns only active connectors unless includeInactive is explicitly requested. */
export function providersForMarket(
  market: MarketId,
  options?: ProviderQueryOptions
): ProviderDefinition[] {
  return PROVIDERS.filter(provider => isSelectable(provider, options) && covers(provider, market));
}

/** Returns only active connectors unless includeInactive is explicitly requested. */
export function providersForRole(
  role: ProviderRole,
  options?: ProviderQueryOptions
): ProviderDefinition[] {
  return PROVIDERS.filter(provider => isSelectable(provider, options) && provider.roles.includes(role));
}

/** Returns providers whose same coverage declaration matches both market and role. */
export function providersForMarketRole(
  market: MarketId,
  role: ProviderRole,
  options?: ProviderQueryOptions
): ProviderDefinition[] {
  return PROVIDERS.filter(provider => isSelectable(provider, options) && covers(provider, market, role));
}

export function detectRequiredCoverageGaps(market: MarketId): RequiredCoverageGap[] {
  return REQUIRED_ROLES_BY_MARKET[market].flatMap(role => {
    if (providersForMarketRole(market, role).length > 0) return [];
    const inactiveCandidates = providersForMarketRole(market, role, { includeInactive: true })
      .filter(provider => provider.status !== 'ACTIVE')
      .map(provider => provider.id);
    return [{ market, role, inactiveCandidates }];
  });
}

export const activeProviders = (): ProviderDefinition[] =>
  PROVIDERS.filter(provider => provider.status === 'ACTIVE');

export const premiumRoadmap = (): ProviderDefinition[] =>
  PROVIDERS.filter(provider => provider.tier === 'PAID' || provider.tier === 'LICENSED');
import type { MarketClass } from './marketArchitecture';
