import {
  classifyMarket,
  type MarketClass,
  type MarketClassification,
} from './marketArchitecture';

export const SCANNER_MARKET_LABELS: Record<MarketClass, string> = {
  FOREX:'Forex',
  CRYPTO:'Cripto',
  STOCK:'Acciones',
  INDEX:'Índices',
  ETF:'ETF',
  METAL:'Metales',
  COMMODITY:'Materias primas',
  FUTURE:'Futuros',
  CFD:'CFD',
  BOND_RATE:'Bonos / tasas',
  OPTION:'Opciones',
  UNKNOWN:'Sin clasificar',
};

export interface ScannerCandidateShape {
  symbol: string;
  score: number;
  description?: string;
  path?: string;
  instrument?: Mt5InstrumentMetadata;
}

export interface ClassifiedScannerCandidate<T extends ScannerCandidateShape = ScannerCandidateShape> {
  candidate: T;
  classification: MarketClassification;
}

const matches = (value: string, pattern: RegExp) => pattern.test(value);

/**
 * Broker paths are not standardized, so the hint is deliberately conservative.
 * An explicit underlying family (for example Stocks inside a CFD tree) wins over
 * the generic CFD wrapper. This keeps equities as a first-class market.
 */
export function inferMt5MarketHint(
  instrument: Mt5InstrumentMetadata | undefined,
  fallback: Pick<ScannerCandidateShape, 'description' | 'path'> = {},
): Exclude<MarketClass, 'UNKNOWN'> | undefined {
  const text = [
    instrument?.path,
    instrument?.category,
    instrument?.description,
    fallback.path,
    fallback.description,
  ].filter(Boolean).join(' ').toUpperCase();

  if (!text) return undefined;
  if (matches(text, /\b(?:OPTION|OPTIONS|OPCION|OPCIONES)\b/)) return 'OPTION';
  if (matches(text, /\b(?:ETF|ETFS|EXCHANGE[ -]?TRADED FUND)\b/)) return 'ETF';
  if (matches(text, /\b(?:STOCK|STOCKS|SHARE|SHARES|EQUIT(?:Y|IES)|ACCION|ACCIONES)\b/)) return 'STOCK';
  if (matches(text, /\b(?:INDEX|INDICES|INDICE|INDEXES)\b/)) return 'INDEX';
  if (matches(text, /\b(?:CRYPTO|CRYPTOS|CRYPTOCURRENC(?:Y|IES)|CRIPTOMONEDA|CRIPTOMONEDAS)\b/)) return 'CRYPTO';
  if (matches(text, /\b(?:FOREX|FX|CURRENC(?:Y|IES)|DIVISA|DIVISAS)\b/)) return 'FOREX';
  if (matches(text, /\b(?:METAL|METALS|METALES|GOLD|SILVER|PLATINUM|PALLADIUM)\b/)) return 'METAL';
  if (matches(text, /\b(?:FUTURE|FUTURES|FUTURO|FUTUROS)\b/)) return 'FUTURE';
  if (matches(text, /\b(?:BOND|BONDS|BONO|BONOS|RATE|RATES|YIELD|YIELDS|TASA|TASAS)\b/)) return 'BOND_RATE';
  if (matches(text, /\b(?:COMMODIT(?:Y|IES)|ENERGY|ENERGIES|AGRICULTURE|AGRICULTURAL|OIL|GAS|MATERIA PRIMA|MATERIAS PRIMAS)\b/)) return 'COMMODITY';
  if (matches(text, /\bCFDS?\b/)) return 'CFD';
  return undefined;
}

export function classifyScannerCandidate<T extends ScannerCandidateShape>(
  candidate: T,
): ClassifiedScannerCandidate<T> {
  const exchange = candidate.instrument?.exchange?.trim() || null;
  const marketHint = inferMt5MarketHint(candidate.instrument, candidate);
  const brokerMetadata = candidate.instrument ? {
    ...candidate.instrument,
    sector:candidate.instrument.sector == null ? null : String(candidate.instrument.sector),
    industry:candidate.instrument.industry == null ? null : String(candidate.instrument.industry),
  } : {
    symbol:candidate.symbol,
    description:candidate.description ?? null,
    path:candidate.path ?? null,
  };
  return {
    candidate,
    classification:classifyMarket({
      symbol:candidate.symbol,
      exchange,
      marketHint,
      brokerMetadata,
      providerSymbols:{MT5:candidate.symbol},
      intent:'WATCH',
    }),
  };
}

export function classifyScannerCandidates<T extends ScannerCandidateShape>(
  candidates: readonly T[],
): ClassifiedScannerCandidate<T>[] {
  return candidates.map(classifyScannerCandidate);
}

/**
 * Selects the highest-scored member of each known market first. If the limit
 * is not reached, it fills the remaining slots by the original global ranking.
 * Stable tie-breaking preserves broker order and score order inside each market.
 */
export function selectDiverseMarketCandidates<T extends ScannerCandidateShape>(
  candidates: readonly ClassifiedScannerCandidate<T>[],
  limit = 5,
): ClassifiedScannerCandidate<T>[] {
  if (limit <= 0) return [];

  const ranked = candidates
    .map((item, index) => ({item, index}))
    .sort((left, right) => right.item.candidate.score - left.item.candidate.score || left.index - right.index);
  const selected: typeof ranked = [];
  const selectedIndexes = new Set<number>();
  const representedMarkets = new Set<MarketClass>();

  for (const rankedItem of ranked) {
    const market = rankedItem.item.classification.market;
    if (market === 'UNKNOWN' || representedMarkets.has(market)) continue;
    representedMarkets.add(market);
    selected.push(rankedItem);
    selectedIndexes.add(rankedItem.index);
    if (selected.length === limit) return selected.map(item => item.item);
  }

  for (const rankedItem of ranked) {
    if (selectedIndexes.has(rankedItem.index)) continue;
    selected.push(rankedItem);
    if (selected.length === limit) break;
  }
  return selected.map(item => item.item);
}
