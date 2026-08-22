import { filterQuantSeriesByDate, runPreparedSmcBacktest, validateQuantDatasetConfig, type StoredQuantDataset } from './quantBacktestRunner';
import { validateQuantLaboratoryConfig, type QuantLaboratoryConfig } from './quantLaboratoryModel';
import { timeframeDurationMs } from './multiTimeframeSynchronizer';
import { createDevelopmentWalkForward, createPurgedChronologicalValidation } from './quantValidationRunner';
import { runOosCostRobustness, runOosMonteCarlo, runOosSameRrBenchmark } from './quantEvidenceRunner';
import { createGovernedAblationPlan } from './ablationGovernance';
import { runExecutableSmcAblations } from './challengerAblationRunner';
import { validateAblationChallengers } from './challengerValidationRunner';
import { runSmcParameterStability } from './parameterStabilityRunner';
import { calculateSampleQuality } from './sampleQualityEngine';
import { evaluateLaboratoryQuantGate } from './quantLaboratoryGate';
import { summarizePaperJournal } from './paperTradingCoordinator';
import { summarizeShadowJournal } from './shadowCoordinator';
import { calculateQuantStatistics } from './quantStatistics';

export interface TrustedQuantBacktestInput {
  experimentId:string;
  datasetId:string;
  dataset:StoredQuantDataset;
  config:QuantLaboratoryConfig;
  now:string;
}

export interface TrustedQuantBacktestEnvelope {
  schemaVersion:1;
  authority:'SENTINEL_BACKEND_V1';
  computation:'SMC_CAUSAL_BACKTEST';
  experimentId:string;
  datasetId:string;
  datasetChecksum:string;
  computedAt:string;
  executionAuthorized:false;
  output:ReturnType<typeof developmentBacktest>;
}

export type TrustedQuantStage='OUT_OF_SAMPLE'|'WALK_FORWARD'|'MONTE_CARLO'|'BENCHMARK'|'ROBUSTNESS'|'ABLATION_PLAN'|'ABLATION_RUN'|'ABLATION_VALIDATION'|'QUANT_GATE';
export interface TrustedQuantStageInput extends TrustedQuantBacktestInput{
  stage:TrustedQuantStage;
  datasetReuseCount?:number;
  operationalEvidence?:{paperEvents:unknown[];shadowEvents:unknown[]};
}

function baseResearch(input:TrustedQuantBacktestInput){
  validateTrustedQuantPreparation({dataset:input.dataset,config:input.config});
  const base=runPreparedSmcBacktest(input),purgeMs=timeframeDurationMs(input.config.timeframes.trigger)*2;
  const oos=createPurgedChronologicalValidation(base.records,{trainingRatio:.6,validationRatio:.2,purgeMs,range:base.observedDateRange});
  return{base,oos,purgeMs};
}

function developmentBacktest(base:ReturnType<typeof runPreparedSmcBacktest>,oos:ReturnType<typeof createPurgedChronologicalValidation>,purgeMs:number){
  const oosStart=oos.boundaries.oosStart?Date.parse(oos.boundaries.oosStart):Number.NaN;
  if(!Number.isFinite(oosStart))throw new Error('BACKTEST_REQUIRES_FROZEN_OOS_BOUNDARY');
  const developmentCutoff=oosStart-purgeMs,records=base.records.filter(record=>Date.parse(record.sourceTimestamp)<developmentCutoff&&Date.parse(record.exitTimestamp??record.sourceTimestamp)<developmentCutoff);
  const allowed=new Set(records.map(record=>record.setupId)),trades=base.result.trades.filter(trade=>allowed.has(trade.setupId)),candidates=base.result.candidates.filter(candidate=>Date.parse(candidate.signalTimestamp)<developmentCutoff);
  const grossR=trades.reduce((sum,trade)=>sum+trade.grossResultR,0),netR=trades.reduce((sum,trade)=>sum+trade.netResultR,0),riskPercent=base.result.riskPercent??base.appliedRisk.riskPercent;
  return{...base,records,statistics:calculateQuantStatistics(trades.map(trade=>trade.netResultR)),result:{...base.result,trades,candidates,grossR,netR,grossReturnPercent:grossR*riskPercent,netReturnPercent:netR*riskPercent},partition:{scope:'DEVELOPMENT_ONLY' as const,oosSealed:true as const,oosStart:oos.boundaries.oosStart,developmentCutoff:new Date(developmentCutoff).toISOString(),purgeMs}};
}

export function runTrustedQuantStage(input:TrustedQuantStageInput){
  const common={schemaVersion:1 as const,authority:'SENTINEL_BACKEND_V1' as const,experimentId:input.experimentId,datasetId:input.datasetId,datasetChecksum:input.dataset.provenance.checksum,computedAt:input.now,executionAuthorized:false as const,stage:input.stage};
  if(input.stage==='ABLATION_PLAN'){
    validateTrustedQuantPreparation({dataset:input.dataset,config:input.config});
    const output={status:'PLANNED_BLOCKED' as const,...createGovernedAblationPlan({familyId:`SMC_ABLATION:${input.experimentId}`,experimentId:input.experimentId,createdAt:input.now,createdBy:'SENTINEL_BACKEND',datasetReuseCount:input.datasetReuseCount??1})};
    return{...common,output};
  }
  const {base,oos,purgeMs}=baseResearch(input);
  if(input.stage==='OUT_OF_SAMPLE')return{...common,output:oos};
  if(input.stage==='WALK_FORWARD')throw new Error('WALK_FORWARD_BLOCKED: rolling performance is diagnostic only; a causal refit/train/test implementation is required before persistence.');
  if(input.stage==='MONTE_CARLO')return{...common,output:runOosMonteCarlo(base.records,oos.outOfSample.setupIds)};
  if(input.stage==='BENCHMARK'){
    const filtered=filterQuantSeriesByDate(input.dataset.raw.series,input.config.dateFrom,input.config.dateTo);
    return{...common,output:runOosSameRrBenchmark({records:base.records,oosIds:oos.outOfSample.setupIds,candles:filtered.series[input.config.timeframes.trigger]??[],execution:base.execution,randomSeed:20260816,fallbackRR:input.config.risk.minimumRR})};
  }
  if(input.stage==='ROBUSTNESS')return{...common,output:runOosCostRobustness(base.records,oos.outOfSample.setupIds,base.execution)};
  if(input.stage==='ABLATION_RUN')return{...common,output:runExecutableSmcAblations({parentExperimentId:input.experimentId,datasetId:input.datasetId,dataset:input.dataset,config:input.config,now:input.now})};
  if(input.stage==='ABLATION_VALIDATION'){
    const ablation=runExecutableSmcAblations({parentExperimentId:input.experimentId,datasetId:input.datasetId,dataset:input.dataset,config:input.config,now:input.now});
    return{...common,output:validateAblationChallengers({ablation,boundaries:oos.boundaries,purgeMs})};
  }
  if(input.stage==='QUANT_GATE'){
    if(!input.operationalEvidence)throw new Error('QUANT_GATE_REQUIRES_DURABLE_OPERATIONAL_EVIDENCE');
    const walk=createDevelopmentWalkForward(base.records,oos.outOfSample.setupIds),monte=runOosMonteCarlo(base.records,oos.outOfSample.setupIds),robustness=runOosCostRobustness(base.records,oos.outOfSample.setupIds,base.execution);
    const sampleQuality=calculateSampleQuality(base.records.map(record=>({timestamp:record.sourceTimestamp,regime:record.features.volatilityRegime,volatilityPercentile:record.features.volatilityPercentile,eventClusterId:null,marketEpisodeId:null})));
    const paper=summarizePaperJournal(input.operationalEvidence.paperEvents as never[],{minimumClosedTrades:30,minimumExpectancyR:0,minimumProfitFactor:1.2});
    const shadow=summarizeShadowJournal(input.operationalEvidence.shadowEvents as never[],{minimumClosedTrades:30,minimumExpectancyR:0,minimumProfitFactor:1.2,maximumAverageLatencyMs:5000,requiredFeeds:['MT5']});
    const output=evaluateLaboratoryQuantGate({statistics:base.statistics,oos:oos.outOfSample.statistics,walkForwardStable:walk.validation?.stable===true,monteCarlo:{completed:monte.status==='COMPLETED',ruinProbability:monte.result?.ruinProbability??null},robustness:{completed:robustness.status==='COMPLETED',collapsedScenarios:robustness.scenarios.filter(item=>item.collapsed).length},sampleQuality:sampleQuality.score,dataQuality:input.dataset.provenance.qualityStatus,paperTradingStable:paper.stable,shadowStable:shadow.stable});
    return{...common,output:{...output,status:output.status,sampleQuality,backendEvidence:{walkForwardMethodology:walk.methodology,paperStable:paper.stable,shadowStable:shadow.stable}}};
  }
  throw new Error(`Etapa Quant backend no soportada: ${input.stage}`);
}

export function runTrustedParameterStability(input:TrustedQuantBacktestInput&{datasetReuseCount:number}){
  const {oos,purgeMs}=baseResearch(input);
  if(!oos.boundaries.trainingEnd||!oos.boundaries.oosStart)throw new Error('PARAMETER_STABILITY_REQUIRES_FROZEN_BOUNDARIES');
  const output=runSmcParameterStability({parentExperimentId:input.experimentId,datasetId:input.datasetId,dataset:input.dataset,config:input.config,boundaries:oos.boundaries,purgeMs,now:input.now,datasetReuseCount:input.datasetReuseCount});
  return{schemaVersion:1 as const,authority:'SENTINEL_BACKEND_V1' as const,stage:'PARAMETER_STABILITY' as const,experimentId:input.experimentId,datasetId:input.datasetId,datasetChecksum:input.dataset.provenance.checksum,computedAt:input.now,executionAuthorized:false as const,output};
}

export function validateTrustedQuantPreparation(input:{dataset:StoredQuantDataset;config:QuantLaboratoryConfig}){
  const reasons=validateQuantLaboratoryConfig(input.config);
  if(reasons.length)throw new Error(`Configuración Quant inválida: ${reasons.join(',')}.`);
  if(input.dataset.provenance.qualityStatus==='DATA_INVALID')throw new Error('DATA_INVALID no puede preparar un experimento.');
  const identity=validateQuantDatasetConfig(input.dataset,input.config),filtered=filterQuantSeriesByDate(input.dataset.raw.series,input.config.dateFrom,input.config.dateTo),required=Object.values(input.config.timeframes);
  for(const timeframe of required)if(!filtered.series[timeframe]?.length)throw new Error(`El dataset no contiene ${timeframe} dentro del rango configurado.`);
  return{ok:true as const,authority:'SENTINEL_BACKEND_V1' as const,identity,dateRange:filtered.dateRange,rowsByTimeframe:filtered.rowsByTimeframe,datasetChecksum:input.dataset.provenance.checksum,executionAuthorized:false as const};
}

/**
 * Trusted-process entry point. It intentionally accepts only durable inputs;
 * renderer-provided result/records/statistics fields are neither read nor copied.
 */
export function runTrustedQuantBacktest(input:TrustedQuantBacktestInput):TrustedQuantBacktestEnvelope {
  if(!input||typeof input!=='object')throw new Error('El backend Quant requiere una entrada estructurada.');
  if(!input.experimentId?.trim()||!input.datasetId?.trim())throw new Error('El backend Quant requiere experimentId y datasetId.');
  if(!Number.isFinite(Date.parse(input.now)))throw new Error('El backend Quant requiere un reloj confiable.');
  const trusted={...input,config:structuredClone(input.config)},research=baseResearch(trusted),output=developmentBacktest(research.base,research.oos,research.purgeMs);
  return{
    schemaVersion:1,authority:'SENTINEL_BACKEND_V1',computation:'SMC_CAUSAL_BACKTEST',
    experimentId:input.experimentId,datasetId:input.datasetId,datasetChecksum:input.dataset.provenance.checksum,
    computedAt:input.now,executionAuthorized:false,output,
  };
}
