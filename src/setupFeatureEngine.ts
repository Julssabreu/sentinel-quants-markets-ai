import type { MarketClass } from './marketArchitecture';
import { normalizeMarketSnapshot, type InstrumentNormalizationMetadata } from './marketNormalization';
import { classifyQuantMarketRegime, type QuantMarketRegime } from './marketRegimeEngine';
import { getMarketSessionContext, type MarketSession } from './marketSessionContext';
import type { Candle } from './analysisEngine';
import type { SmcSetup, SmcTimeframeProfile } from './smcStrategy';
import { SENTINEL_QUANT_VERSIONS } from './sentinelQuantVersions';

export interface SmcStructuralFacts {
  direction: 'LONG' | 'SHORT';
  d1Structure: string;
  h4Structure: string;
  h1LiquiditySweep: boolean;
  h1SweepSizeATR: number | null;
  h1DisplacementATR: number | null;
  m15Fvg: boolean;
  m15FvgSizeATR: number | null;
  m15FvgMitigationPercent: number | null;
  m5Break: boolean;
  m5BreakStrengthATR: number | null;
  distanceToLiquidityATR: number | null;
  premiumDiscountPosition: number | null;
  plannedRR: number | null;
}

export interface SetupFeatureVector extends SmcStructuralFacts {
  featureVersion: string;
  instrumentId: string;
  symbol: string;
  assetClass: MarketClass;
  timestamp: string;
  atrPercent: number;
  atrPercentile: number;
  volatilityPercentile: number;
  volatilityRegime: QuantMarketRegime;
  trendStrength: number;
  directionalPersistence: number;
  session: MarketSession;
  hourOfDay: number;
  dayOfWeek: number;
  minutesFromSessionOpen: number | null;
  minutesFromSessionClose: number | null;
  spreadATR: number | null;
  spreadBps: number | null;
}

export function buildSetupFeatureVector(input: Omit<SetupFeatureVector, 'featureVersion'>): SetupFeatureVector {
  return { ...input, featureVersion:SENTINEL_QUANT_VERSIONS.featureSet };
}

export interface SetupFeatureContextInput {
  setup: SmcSetup;
  frames: Partial<Record<string, Candle[]>>;
  profile: SmcTimeframeProfile;
  instrument: InstrumentNormalizationMetadata;
  timestamp: string;
  spreadPrice: number | null;
}

export type SetupFeatureBuildResult =
  | { ok:true; features:SetupFeatureVector }
  | { ok:false; reasonCode:'FEATURE_SMC_FACTS_MISSING' | 'FEATURE_NORMALIZATION_UNAVAILABLE' };

export function createSetupFeatureVector(input: SetupFeatureContextInput): SetupFeatureBuildResult {
  if (!input.setup.facts) return { ok:false, reasonCode:'FEATURE_SMC_FACTS_MISSING' };
  const trigger = input.frames[input.profile.trigger] ?? [];
  const regimeBars = input.frames[input.profile.setup] ?? [];
  const last = trigger.at(-1);
  const quote = last && input.spreadPrice != null
    ? { bid:last.close - input.spreadPrice / 2, ask:last.close + input.spreadPrice / 2 }
    : undefined;
  const normalized = normalizeMarketSnapshot(trigger, input.instrument, quote);
  if (!normalized) return { ok:false, reasonCode:'FEATURE_NORMALIZATION_UNAVAILABLE' };
  const regime = classifyQuantMarketRegime(regimeBars);
  const session = getMarketSessionContext(input.instrument.assetClass, input.timestamp);
  return { ok:true, features:buildSetupFeatureVector({
    ...input.setup.facts,
    instrumentId:input.instrument.instrumentId, symbol:input.instrument.canonicalSymbol,
    assetClass:input.instrument.assetClass, timestamp:input.timestamp,
    atrPercent:normalized.atrPercent, atrPercentile:regime.atrPercentile,
    volatilityPercentile:regime.volatilityPercentile, volatilityRegime:regime.regime,
    trendStrength:regime.trendStrength, directionalPersistence:regime.directionalPersistence,
    session:session.session, hourOfDay:session.hourOfDay, dayOfWeek:session.dayOfWeek,
    minutesFromSessionOpen:session.minutesFromSessionOpen, minutesFromSessionClose:session.minutesFromSessionClose,
    spreadATR:normalized.spreadATR, spreadBps:normalized.spreadBps,
  }) };
}
