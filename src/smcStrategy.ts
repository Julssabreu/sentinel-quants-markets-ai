import { atr, type Candle } from './analysisEngine';
import type { SmcStructuralFacts } from './setupFeatureEngine';
import { SENTINEL_QUANT_VERSIONS } from './sentinelQuantVersions';

export const SMC_STRATEGY_ID = 'SMC_D1_H4_H1_M15_M5_V1' as const;
export type SmcDirection = 'BUY' | 'SELL' | null;
export type SmcStage = 'D1_BIAS' | 'H4_ZONE' | 'H1_SETUP' | 'M15_REFINEMENT' | 'M5_TRIGGER' | 'READY';

export interface SmcStep {
  timeframe: string;
  role: string;
  confirmed: boolean;
  summary: string;
}

export interface SmcSetup {
  strategyId: typeof SMC_STRATEGY_ID;
  direction: SmcDirection;
  stage: SmcStage;
  score: number;
  steps: SmcStep[];
  entry: number | null;
  stop: number | null;
  target: number | null;
  riskReward: number | null;
  reasons: string[];
  warnings: string[];
  facts: SmcStructuralFacts | null;
  strategyVersion: string;
  profileId: string;
  /** Umbral exigido, para que el ejecutor lo revalide en el precio real de entrada. */
  minimumRR: number;
}

export interface SmcTimeframeProfile {
  id: string;
  bias: string;
  levels: string;
  setup: string;
  refinement: string;
  trigger: string;
}
export const DEFAULT_SMC_TIMEFRAME_PROFILE: SmcTimeframeProfile = Object.freeze({
  id: 'SMC_DEFAULT_D1_H4_H1_M15_M5_V1', bias:'D1', levels:'H4', setup:'H1', refinement:'M15', trigger:'M5',
});
export interface SmcResearchOptions {
  enabledComponents?: Partial<Record<'FVG' | 'M5_CONFIRMATION', boolean>>;
  parameters?: Partial<{ h4ZoneATR:number; m5DisplacementATR:number; minimumRR:number }>;
}
const DEFAULT_SMC_PARAMETERS = Object.freeze({ h4ZoneATR:1.5, m5DisplacementATR:.55, minimumRR:1.5 });

type SmcFrames = Partial<Record<string, Candle[]>>;
type Pivot = { index: number; price: number };

const valid = (candles: Candle[] | undefined) => (candles ?? []).filter(c =>
  [c.open, c.high, c.low, c.close].every(Number.isFinite),
);

function pivots(candles: Candle[], side: 'HIGH' | 'LOW', radius = 2): Pivot[] {
  const output: Pivot[] = [];
  for (let i = radius; i < candles.length - radius; i++) {
    const value = side === 'HIGH' ? candles[i].high : candles[i].low;
    const neighborhood = candles.slice(i - radius, i + radius + 1);
    const extreme = side === 'HIGH'
      ? Math.max(...neighborhood.map(c => c.high))
      : Math.min(...neighborhood.map(c => c.low));
    if (value === extreme) output.push({ index: i, price: value });
  }
  return output;
}

function d1Bias(candles: Candle[]): { direction: SmcDirection; summary: string } {
  const highs = pivots(candles, 'HIGH').slice(-2), lows = pivots(candles, 'LOW').slice(-2);
  if (highs.length < 2 || lows.length < 2) return { direction: null, summary: 'D1 no tiene suficientes swings confirmados.' };
  const higherHigh = highs[1].price > highs[0].price, higherLow = lows[1].price > lows[0].price;
  const lowerHigh = highs[1].price < highs[0].price, lowerLow = lows[1].price < lows[0].price;
  if (higherHigh && higherLow) return { direction: 'BUY', summary: 'D1 alcista: máximo y mínimo estructural crecientes.' };
  if (lowerHigh && lowerLow) return { direction: 'SELL', summary: 'D1 bajista: máximo y mínimo estructural decrecientes.' };
  return { direction: null, summary: 'D1 está en transición: la estructura no confirma una dirección.' };
}

function structureLabel(candles: Candle[]): string {
  const highs = pivots(candles, 'HIGH').slice(-2), lows = pivots(candles, 'LOW').slice(-2);
  if (highs.length < 2 || lows.length < 2) return 'UNKNOWN';
  const high = highs[1].price > highs[0].price ? 'HH' : highs[1].price < highs[0].price ? 'LH' : 'EH';
  const low = lows[1].price > lows[0].price ? 'HL' : lows[1].price < lows[0].price ? 'LL' : 'EL';
  return `${high}_${low}`;
}

function h4Zone(candles: Candle[], direction: Exclude<SmcDirection, null>, zoneATR:number = DEFAULT_SMC_PARAMETERS.h4ZoneATR) {
  const volatility = atr(candles, 14), last = candles.at(-1)!;
  const points = pivots(candles, direction === 'BUY' ? 'LOW' : 'HIGH');
  const targets = pivots(candles, direction === 'BUY' ? 'HIGH' : 'LOW');
  const anchor = points.at(-1)?.price, target = targets.at(-1)?.price;
  if (!Number.isFinite(volatility) || volatility <= 0 || anchor == null || target == null)
    return { confirmed: false, target: null, summary: 'H4 no permite construir una zona y objetivo verificables.' };
  const distance = Math.abs(last.close - anchor), near = distance <= volatility * zoneATR;
  return {
    confirmed: near,
    target,
    summary: near
      ? `H4 está dentro de 1.5 ATR de la zona estructural ${anchor.toFixed(5)}.`
      : `H4 todavía no alcanza la zona estructural ${anchor.toFixed(5)}.`,
  };
}

function h1Setup(candles: Candle[], direction: Exclude<SmcDirection, null>) {
  if (candles.length < 45) return { confirmed: false, sweepSizeATR:null, displacementATR:null, summary: 'H1 requiere al menos 45 velas.' };
  const recentStart = candles.length - 10, reference = candles.slice(-40, -10);
  const referenceExtreme = direction === 'BUY'
    ? Math.min(...reference.map(c => c.low))
    : Math.max(...reference.map(c => c.high));
  const recent = candles.slice(recentStart);
  const sweepOffset = recent.findIndex(c => direction === 'BUY'
    ? c.low < referenceExtreme && c.close > referenceExtreme
    : c.high > referenceExtreme && c.close < referenceExtreme);
  if (sweepOffset < 0) return { confirmed: false, sweepSizeATR:null, displacementATR:null, summary: 'H1 aún no confirma un barrido de liquidez con cierre de rechazo.' };
  const sweepIndex = recentStart + sweepOffset;
  const volatility = atr(candles.slice(0, sweepIndex + 1), 14);
  const sweepBar = candles[sweepIndex];
  const sweepDistance = direction === 'BUY' ? referenceExtreme - sweepBar.low : sweepBar.high - referenceExtreme;
  const sweepSizeATR = Number.isFinite(volatility) && volatility > 0 ? sweepDistance / volatility : null;
  const before = candles.slice(Math.max(0, sweepIndex - 12), sweepIndex);
  const breakLevel = direction === 'BUY'
    ? Math.max(...before.map(c => c.high))
    : Math.min(...before.map(c => c.low));
  const displacementBars = candles.slice(sweepIndex + 1);
  const displacementBar = displacementBars.find(c => direction === 'BUY' ? c.close > breakLevel : c.close < breakLevel);
  const displaced = Boolean(displacementBar);
  const displacementATR = displacementBar && Number.isFinite(volatility) && volatility > 0
    ? Math.abs(displacementBar.close - sweepBar.close) / volatility
    : null;
  return {
    confirmed: displaced,
    sweepSizeATR,
    displacementATR,
    summary: displaced
      ? `H1 confirma barrido y desplazamiento con ruptura de ${breakLevel.toFixed(5)}.`
      : `H1 registró barrido, pero falta ruptura de ${breakLevel.toFixed(5)}.`,
  };
}

function m15Refinement(candles: Candle[], direction: Exclude<SmcDirection, null>) {
  const start = Math.max(2, candles.length - 20);
  for (let i = candles.length - 1; i >= start; i--) {
    const bullishGap = candles[i].low > candles[i - 2].high;
    const bearishGap = candles[i].high < candles[i - 2].low;
    if (direction === 'BUY' && bullishGap) {
      const low = candles[i - 2].high, high = candles[i].low, volatility = atr(candles.slice(0, i + 1), 14);
      const futureKnown = candles.slice(i + 1), deepest = futureKnown.length ? Math.min(...futureKnown.map(c => c.low)) : high;
      const mitigationPercent = Math.max(0, Math.min(100, (high - deepest) / (high - low) * 100));
      return { confirmed: true, sizeATR:Number.isFinite(volatility) && volatility > 0 ? (high - low) / volatility : null, mitigationPercent, summary: `M15 identifica FVG alcista ${low.toFixed(5)}–${high.toFixed(5)}.` };
    }
    if (direction === 'SELL' && bearishGap) {
      const low = candles[i].high, high = candles[i - 2].low, volatility = atr(candles.slice(0, i + 1), 14);
      const futureKnown = candles.slice(i + 1), highest = futureKnown.length ? Math.max(...futureKnown.map(c => c.high)) : low;
      const mitigationPercent = Math.max(0, Math.min(100, (highest - low) / (high - low) * 100));
      return { confirmed: true, sizeATR:Number.isFinite(volatility) && volatility > 0 ? (high - low) / volatility : null, mitigationPercent, summary: `M15 identifica FVG bajista ${low.toFixed(5)}–${high.toFixed(5)}.` };
    }
  }
  return { confirmed: false, sizeATR:null, mitigationPercent:null, summary: 'M15 no presenta un FVG válido en la dirección del sesgo.' };
}

function m5Trigger(candles: Candle[], direction: Exclude<SmcDirection, null>, target: number | null, options:{displacementATR:number;minimumRR:number;requireConfirmation:boolean} = { displacementATR:DEFAULT_SMC_PARAMETERS.m5DisplacementATR, minimumRR:DEFAULT_SMC_PARAMETERS.minimumRR, requireConfirmation:true }) {
  if (candles.length < 20) return { confirmed: false, breakDetected:false, entry: null, stop: null, target: null, rr: null, breakStrengthATR:null, summary: 'M5 requiere al menos 20 velas.' };
  const bar = candles.at(-1)!, previous = candles.slice(-7, -1), volatility = atr(candles, 14);
  const level = direction === 'BUY' ? Math.max(...previous.map(c => c.high)) : Math.min(...previous.map(c => c.low));
  const body = Math.abs(bar.close - bar.open);
  const breakConfirmed = direction === 'BUY' ? bar.close > level : bar.close < level;
  const displaced = Number.isFinite(volatility) && body >= volatility * options.displacementATR;
  const breakStrengthATR = Number.isFinite(volatility) && volatility > 0 ? body / volatility : null;
  if (options.requireConfirmation && (!breakConfirmed || !displaced))
    return { confirmed: false, breakDetected:breakConfirmed, entry: null, stop: null, target, rr: null, breakStrengthATR, summary: 'M5 espera cierre de ruptura con desplazamiento mínimo de 0.55 ATR.' };
  const entry = bar.close;
  const stop = direction === 'BUY' ? Math.min(...previous.map(c => c.low)) : Math.max(...previous.map(c => c.high));
  const risk = Math.abs(entry - stop), reward = target == null ? 0 : direction === 'BUY' ? target - entry : entry - target;
  const rr = risk > 0 && reward > 0 ? reward / risk : null;
  return { confirmed: rr != null && rr >= options.minimumRR, breakDetected:breakConfirmed, entry, stop, target, rr, breakStrengthATR, summary: rr != null && rr >= options.minimumRR
    ? `M5 confirma disparador; relación riesgo/beneficio ${rr.toFixed(2)}.`
    : 'M5 rompió estructura, pero el objetivo H4 no ofrece al menos 1.5R.' };
}

export function analyzeSmcStrategy(frames: SmcFrames, profile: SmcTimeframeProfile = DEFAULT_SMC_TIMEFRAME_PROFILE, research:SmcResearchOptions = {}): SmcSetup {
  const d1 = valid(frames[profile.bias]), h4 = valid(frames[profile.levels]), h1 = valid(frames[profile.setup]), m15 = valid(frames[profile.refinement]), m5 = valid(frames[profile.trigger]);
  const warnings: string[] = [];
  for (const [timeframe, candles, minimum] of [[profile.bias, d1, 80], [profile.levels, h4, 80], [profile.setup, h1, 45], [profile.refinement, m15, 30], [profile.trigger, m5, 20]] as const)
    if (candles.length < minimum) warnings.push(`${timeframe}: datos insuficientes (${candles.length}/${minimum}).`);
  const bias = d1Bias(d1);
  const direction = bias.direction;
  const parameters={...DEFAULT_SMC_PARAMETERS,...research.parameters};
  const zone = direction && h4.length ? h4Zone(h4, direction, parameters.h4ZoneATR) : { confirmed: false, target: null, summary: 'H4 espera un sesgo D1 confirmado.' };
  const setup = direction && zone.confirmed ? h1Setup(h1, direction) : { confirmed: false, sweepSizeATR:null, displacementATR:null, summary: `${profile.setup} espera que ${profile.bias} y ${profile.levels} estén confirmados.` };
  const detectedRefinement = direction && setup.confirmed ? m15Refinement(m15, direction) : { confirmed: false, sizeATR:null, mitigationPercent:null, summary: `${profile.refinement} espera una configuración ${profile.setup} confirmada.` };
  const refinement = research.enabledComponents?.FVG === false && setup.confirmed ? {...detectedRefinement,confirmed:true,summary:`${profile.refinement}: FVG desactivado solo para Challenger.`}:detectedRefinement;
  const trigger = direction && refinement.confirmed ? m5Trigger(m5, direction, zone.target,{displacementATR:parameters.m5DisplacementATR,minimumRR:parameters.minimumRR,requireConfirmation:research.enabledComponents?.M5_CONFIRMATION !== false}) : { confirmed: false, breakDetected:false, entry: null, stop: null, target: zone.target, rr: null, breakStrengthATR:null, summary: `${profile.trigger} espera la validación de ${profile.refinement}.` };
  const steps: SmcStep[] = [
    { timeframe: profile.bias, role: 'Definir sesgo estructural', confirmed: direction != null, summary: bias.summary },
    { timeframe: profile.levels, role: 'Localizar zona clave', confirmed: zone.confirmed, summary: zone.summary },
    { timeframe: profile.setup, role: 'Confirmar configuración SMC', confirmed: setup.confirmed, summary: setup.summary },
    { timeframe: profile.refinement, role: 'Refinar con desequilibrio', confirmed: refinement.confirmed, summary: refinement.summary },
    { timeframe: profile.trigger, role: 'Generar disparador', confirmed: trigger.confirmed, summary: trigger.summary },
  ];
  const weights = [20, 20, 25, 15, 20];
  const score = steps.reduce((sum, step, index) => sum + (step.confirmed ? weights[index] : 0), 0);
  const firstMissing = steps.findIndex(step => !step.confirmed);
  const stages: SmcStage[] = ['D1_BIAS', 'H4_ZONE', 'H1_SETUP', 'M15_REFINEMENT', 'M5_TRIGGER'];
  const stage: SmcStage = firstMissing < 0 ? 'READY' : stages[firstMissing];
  const h4High = h4.length ? Math.max(...h4.slice(-80).map(c => c.high)) : null;
  const h4Low = h4.length ? Math.min(...h4.slice(-80).map(c => c.low)) : null;
  const premiumDiscountPosition = h4High != null && h4Low != null && h4High > h4Low ? (h4.at(-1)!.close - h4Low) / (h4High - h4Low) : null;
  const h1Atr = atr(h1, 14);
  const distanceToLiquidityATR = zone.target != null && h1.length && Number.isFinite(h1Atr) && h1Atr > 0 ? Math.abs(zone.target - h1.at(-1)!.close) / h1Atr : null;
  const facts: SmcStructuralFacts | null = direction ? {
    direction:direction === 'BUY' ? 'LONG' : 'SHORT', d1Structure:structureLabel(d1), h4Structure:structureLabel(h4),
    h1LiquiditySweep:setup.sweepSizeATR != null, h1SweepSizeATR:setup.sweepSizeATR, h1DisplacementATR:setup.displacementATR,
    m15Fvg:refinement.confirmed, m15FvgSizeATR:refinement.sizeATR, m15FvgMitigationPercent:refinement.mitigationPercent,
    m5Break:trigger.breakDetected, m5BreakStrengthATR:trigger.breakStrengthATR,
    distanceToLiquidityATR, premiumDiscountPosition, plannedRR:trigger.rr,
  } : null;
  return {
    strategyId: SMC_STRATEGY_ID, direction, stage, score, steps,
    entry: trigger.entry, stop: trigger.stop, target: trigger.target, riskReward: trigger.rr,
    reasons: steps.filter(step => step.confirmed).map(step => step.summary), warnings, facts,
    strategyVersion:SENTINEL_QUANT_VERSIONS.smcStrategy, profileId:profile.id,
    minimumRR:parameters.minimumRR,
  };
}
