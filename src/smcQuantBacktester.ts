import type { Candle } from './analysisEngine';
import type { DataQualityStatus } from './dataQualityEngine';
import { closeAtEndOfData, evaluateExitOnBar, prepareExecutedTrade, type ExecutedTradePlan, type ExecutionCostProfile, type ExitReason } from './executionCostModel';
import { timeframeDurationMs } from './multiTimeframeSynchronizer';
import { SimulationClock } from './simulationClock';
import { analyzeSmcStrategy, DEFAULT_SMC_TIMEFRAME_PROFILE, type SmcSetup, type SmcTimeframeProfile } from './smcStrategy';
import { SENTINEL_QUANT_VERSIONS } from './sentinelQuantVersions';
import { createSetupFeatureVector, type SetupFeatureBuildResult, type SetupFeatureVector } from './setupFeatureEngine';
import type { InstrumentNormalizationMetadata } from './marketNormalization';

export interface SmcBacktestInput {
  experimentId: string;
  datasetIds: Record<string, string>;
  dataQuality: Record<string, DataQualityStatus>;
  frames: Readonly<Record<string, readonly Candle[]>>;
  execution: ExecutionCostProfile;
  executionForBar?: (bar:Candle, index:number) => ExecutionCostProfile;
  riskPercent?: number;
  maxLookbackBars?: number;
  profile?: SmcTimeframeProfile;
  analyze?: (frames: Partial<Record<string, Candle[]>>, profile: SmcTimeframeProfile) => SmcSetup;
  instrument?: InstrumentNormalizationMetadata;
  buildFeatures?: (setup:SmcSetup, frames:Partial<Record<string, Candle[]>>, timestamp:string) => SetupFeatureBuildResult;
}

export interface SmcBacktestCandidate {
  setupId: string;
  signalTimestamp: string;
  direction: 'LONG' | 'SHORT';
  plannedEntry: number;
  plannedStop: number;
  plannedTarget: number;
  plannedRR: number | null;
  profileId: string;
  features: SetupFeatureVector;
  signalSpreadPrice?: number;
  signalSlippagePrice?: number;
}

export interface SmcBacktestTrade {
  setupId: string;
  signalTimestamp: string;
  entryTimestamp: string;
  exitTimestamp: string;
  direction: 'LONG' | 'SHORT';
  requestedEntry: number;
  entryFill: number;
  stop: number;
  target: number;
  exitFill: number;
  exitReason: ExitReason;
  /** La vela tocó stop y objetivo; el resultado depende del supuesto conservador. */
  ambiguousExit: boolean;
  grossResultR: number;
  netResultR: number;
  maeR: number;
  mfeR: number;
  strategyVersion: string;
  executionModelVersion: string;
  riskPercent?: number;
  grossResultPercent?: number;
  netResultPercent?: number;
  entrySpreadPrice?: number;
  entrySlippagePrice?: number;
  exitSpreadPrice?: number;
  exitSlippagePrice?: number;
}

export interface SmcBacktestResult {
  experimentId: string;
  datasetIds: Record<string, string>;
  trades: SmcBacktestTrade[];
  candidates: SmcBacktestCandidate[];
  featureFailures: number;
  skippedInvalidPlans: number;
  /**
   * Operaciones cuya vela de salida tocó stop y objetivo. Sin este número no se puede
   * saber qué parte de la curva descansa sobre el supuesto conservador.
   */
  ambiguousExits: number;
  grossR: number;
  netR: number;
  grossReturnPercent?: number;
  netReturnPercent?: number;
  riskPercent?: number;
  riskModel?: 'FIXED_FRACTION_NON_COMPOUNDED';
}

type Pending = { setupId:string; signalTimestamp:string; setup:SmcSetup; candidate:SmcBacktestCandidate };
type OpenTrade = { pending:Pending; plan:ExecutedTradePlan; entryTimestamp:string; maeR:number; mfeR:number; entryExecution:ExecutionCostProfile };

function sortedUnique(candles: readonly Candle[], timeframe:string) {
  const sorted=[...candles].filter(bar=>Number.isFinite(Date.parse(bar.time))).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  for(let index=1;index<sorted.length;index++)if(Date.parse(sorted[index].time)===Date.parse(sorted[index-1].time))throw new Error(`Temporalidad ${timeframe} contiene timestamps duplicados.`);
  return sorted;
}

function updateExcursions(open: OpenTrade, bar: Candle) {
  const long = open.plan.direction === 'LONG';
  const adverse = long ? open.plan.entryFill - bar.low : bar.high - open.plan.entryFill;
  const favorable = long ? bar.high - open.plan.entryFill : open.plan.entryFill - bar.low;
  open.maeR = Math.max(open.maeR, adverse / open.plan.riskPrice);
  open.mfeR = Math.max(open.mfeR, favorable / open.plan.riskPrice);
}

function completed(open: OpenTrade, exitTimestamp: string, exit: ReturnType<typeof closeAtEndOfData>, exitExecution:ExecutionCostProfile, riskPercent:number): SmcBacktestTrade {
  return {
    setupId:open.pending.setupId, signalTimestamp:open.pending.signalTimestamp,
    entryTimestamp:open.entryTimestamp, exitTimestamp, direction:open.plan.direction,
    requestedEntry:open.plan.requestedEntry, entryFill:open.plan.entryFill,
    stop:open.plan.stop, target:open.plan.target, exitFill:exit.exitFill, exitReason:exit.reason,
    ambiguousExit:exit.ambiguous,
    grossResultR:exit.grossResultR, netResultR:exit.netResultR, maeR:open.maeR, mfeR:open.mfeR,
    strategyVersion:SENTINEL_QUANT_VERSIONS.smcStrategy,
    executionModelVersion:SENTINEL_QUANT_VERSIONS.executionModel,
    riskPercent, grossResultPercent:exit.grossResultR*riskPercent, netResultPercent:exit.netResultR*riskPercent,
    entrySpreadPrice:open.entryExecution.spreadPrice, entrySlippagePrice:open.entryExecution.slippagePrice,
    exitSpreadPrice:exitExecution.spreadPrice, exitSlippagePrice:exitExecution.slippagePrice,
  };
}

function createBoundedCausalFrames(frames:Readonly<Record<string,readonly Candle[]>>, profile:SmcTimeframeProfile, maxLookbackBars:number){
  const required=[profile.bias,profile.levels,profile.setup,profile.refinement,profile.trigger];
  const prepared=Object.fromEntries(required.map(timeframe=>[timeframe,{bars:sortedUnique(frames[timeframe]??[],timeframe),cursor:0,duration:timeframeDurationMs(timeframe)}])) as Record<string,{bars:Candle[];cursor:number;duration:number}>;
  return (availableMs:number)=>Object.fromEntries(required.map(timeframe=>{
    const state=prepared[timeframe];
    while(state.cursor<state.bars.length&&Date.parse(state.bars[state.cursor].time)+state.duration<=availableMs)state.cursor++;
    return[timeframe,state.bars.slice(Math.max(0,state.cursor-maxLookbackBars),state.cursor)];
  })) as Partial<Record<string,Candle[]>>;
}

export function runSmcQuantBacktest(input: SmcBacktestInput): SmcBacktestResult {
  const profile = input.profile ?? DEFAULT_SMC_TIMEFRAME_PROFILE;
  const analyze = input.analyze ?? analyzeSmcStrategy;
  if (!input.instrument && !input.buildFeatures) throw new Error('Backtest requiere metadatos de instrumento para construir features.');
  const required = [profile.bias, profile.levels, profile.setup, profile.refinement, profile.trigger];
  for (const timeframe of required) {
    if (!input.frames[timeframe]) throw new Error(`Falta dataset para ${timeframe}.`);
    if (!input.datasetIds[timeframe]) throw new Error(`Falta datasetId para ${timeframe}.`);
    if (input.dataQuality[timeframe] === 'DATA_INVALID') throw new Error(`Dataset ${timeframe} es DATA_INVALID.`);
  }
  const riskPercent=input.riskPercent??1;
  if(!Number.isFinite(riskPercent)||riskPercent<=0||riskPercent>100)throw new Error('riskPercent debe ser finito y positivo.');
  const maxLookbackBars=input.maxLookbackBars??512;
  if(!Number.isInteger(maxLookbackBars)||maxLookbackBars<80)throw new Error('maxLookbackBars debe ser un entero de al menos 80.');
  const triggerBars = sortedUnique(input.frames[profile.trigger],profile.trigger);
  const triggerDuration = timeframeDurationMs(profile.trigger);
  const causalFramesAt=createBoundedCausalFrames(input.frames,profile,maxLookbackBars);
  const trades: SmcBacktestTrade[] = [], candidates: SmcBacktestCandidate[] = [];
  let pending: Pending | null = null, open: OpenTrade | null = null, featureFailures = 0, skippedInvalidPlans = 0;

  for (let index = 0; index < triggerBars.length; index++) {
    const bar = triggerBars[index];
    const openMs = Date.parse(bar.time);
    if (!Number.isFinite(openMs)) continue;
    const clock = new SimulationClock(openMs + triggerDuration);

    if (pending && !open) {
      try {
        const setup = pending.setup;
        const direction = setup.direction === 'BUY' ? 'LONG' : 'SHORT';
        const entryExecution=input.executionForBar?.(bar,index)??input.execution;
        // El umbral se revalida aquí, contra la apertura real, no contra el cierre que
        // originó la señal. Un plan que ya no cumple se descarta en vez de ejecutarse.
        const plan = prepareExecutedTrade(direction, bar.open, setup.stop!, setup.target!, entryExecution, setup.minimumRR);
        open = { pending, plan, entryTimestamp:bar.time, maeR:0, mfeR:0, entryExecution };
      } catch { skippedInvalidPlans++; }
      pending = null;
    }
    if (open) {
      updateExcursions(open, bar);
      const exitExecution=input.executionForBar?.(bar,index)??input.execution;
      const exit = evaluateExitOnBar(open.plan, bar, exitExecution);
      if (exit) { trades.push(completed(open, clock.nowIso(), exit,exitExecution,riskPercent)); open = null; }
    }
    if (open || pending) continue;

    const causalFrames = causalFramesAt(clock.nowMs());
    const setup = analyze(causalFrames, profile);
    if (setup.stage !== 'READY' || !setup.direction || setup.entry == null || setup.stop == null || setup.target == null) continue;
    const signalExecution=input.executionForBar?.(bar,index)??input.execution;
    const featureResult = input.buildFeatures
      ? input.buildFeatures(setup, causalFrames, clock.nowIso())
      : createSetupFeatureVector({ setup, frames:causalFrames, profile, instrument:input.instrument!, timestamp:clock.nowIso(), spreadPrice:signalExecution.spreadPrice });
    if (!featureResult.ok) { featureFailures++; continue; }
    const setupId = `${input.experimentId}:${clock.nowIso()}`;
    const candidate: SmcBacktestCandidate = {
      setupId, signalTimestamp:clock.nowIso(), direction:setup.direction === 'BUY' ? 'LONG' : 'SHORT',
      plannedEntry:setup.entry, plannedStop:setup.stop, plannedTarget:setup.target,
      plannedRR:setup.riskReward, profileId:profile.id, features:featureResult.features,
      signalSpreadPrice:signalExecution.spreadPrice, signalSlippagePrice:signalExecution.slippagePrice,
    };
    candidates.push(candidate);
    pending = { setupId, signalTimestamp:clock.nowIso(), setup, candidate };
  }

  const last = triggerBars.at(-1);
  if (open && last) {
    const exitExecution=input.executionForBar?.(last,triggerBars.length-1)??input.execution;
    const exit = closeAtEndOfData(open.plan, last.close, exitExecution);
    trades.push(completed(open, new Date(Date.parse(last.time) + triggerDuration).toISOString(), exit,exitExecution,riskPercent));
  }
  const grossR=trades.reduce((sum, trade) => sum + trade.grossResultR, 0),netR=trades.reduce((sum, trade) => sum + trade.netResultR, 0);
  return {
    experimentId:input.experimentId, datasetIds:{ ...input.datasetIds }, trades, candidates, featureFailures, skippedInvalidPlans,
    ambiguousExits:trades.filter(trade => trade.ambiguousExit).length,
    grossR, netR, grossReturnPercent:grossR*riskPercent, netReturnPercent:netR*riskPercent, riskPercent,riskModel:'FIXED_FRACTION_NON_COMPOUNDED',
  };
}
