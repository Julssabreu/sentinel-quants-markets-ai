import type { SmcSetup } from './smcStrategy';

export type QuantGateStatus = 'RESEARCH' | 'PROBATION' | 'PRELIMINARY' | 'ELIGIBLE' | 'BLOCKED';
export interface QuantEvidence {
  resolvedTrades: number;
  averageR: number;
  profitFactor: number | null;
  maxDrawdownR: number;
  outOfSampleAverageR?: number | null;
  outOfSampleProfitFactor?: number | null;
  walkForwardStable?: boolean;
  paperTradingStable?: boolean;
  sampleQuality?: number | null;
}
export interface QuantGateConfig {
  researchMaxExclusive:number;
  probationMaxExclusive:number;
  preliminaryMaxExclusive:number;
  minimumExpectancyR:number;
  minimumProfitFactor:number;
  maximumDrawdownR:number;
  minimumOosExpectancyR:number;
  minimumOosProfitFactor:number;
  minimumSampleQuality:number;
  requireWalkForward:boolean;
  requirePaper:boolean;
  minimumPlannedRR:number;
}
export const DEFAULT_QUANT_GATE_CONFIG:QuantGateConfig=Object.freeze({researchMaxExclusive:30,probationMaxExclusive:100,preliminaryMaxExclusive:250,minimumExpectancyR:0,minimumProfitFactor:1.2,maximumDrawdownR:12,minimumOosExpectancyR:0,minimumOosProfitFactor:1.1,minimumSampleQuality:60,requireWalkForward:true,requirePaper:true,minimumPlannedRR:1.5});

export interface QuantSmcVerdict { status:QuantGateStatus; authorized:boolean; setupScore:number; reasons:string[]; reasonCodes:string[]; }

export function evaluateSmcQuantGate(setup:SmcSetup,evidence?:QuantEvidence,config:QuantGateConfig=DEFAULT_QUANT_GATE_CONFIG):QuantSmcVerdict{
  const reasons:string[]=[],reasonCodes:string[]=[];
  if(setup.stage!=='READY'){reasonCodes.push('SMC_INCOMPLETE');reasons.push(`Cadena SMC incompleta: Sentinel espera ${setup.stage}.`)}
  if((setup.riskReward??0)<config.minimumPlannedRR){reasonCodes.push('SMC_RR_INSUFFICIENT');reasons.push(`La configuración no alcanza ${config.minimumPlannedRR}R.`)}
  const sample=evidence?.resolvedTrades??0;
  if(!evidence||sample<config.researchMaxExclusive){reasonCodes.push('QUANT_INSUFFICIENT_SAMPLE');reasons.push(`Evidencia insuficiente: ${sample}/${config.researchMaxExclusive} observaciones.`);return{status:'RESEARCH',authorized:false,setupScore:setup.score,reasons,reasonCodes}}
  const negativeEdge=evidence.averageR<=config.minimumExpectancyR||(evidence.profitFactor??0)<1||evidence.maxDrawdownR>config.maximumDrawdownR;
  if(negativeEdge){reasonCodes.push(evidence.averageR<=config.minimumExpectancyR?'QUANT_NEGATIVE_EXPECTANCY':evidence.maxDrawdownR>config.maximumDrawdownR?'QUANT_DRAWDOWN_FAILED':'QUANT_PROFIT_FACTOR_FAILED');reasons.push('La evidencia neta no supera los límites mínimos de edge y drawdown.');return{status:'BLOCKED',authorized:false,setupScore:setup.score,reasons,reasonCodes}}
  if(sample<config.probationMaxExclusive){reasonCodes.push('QUANT_PROBATION_SAMPLE');reasons.push('Evidencia positiva preliminar; permanece en probation.');return{status:'PROBATION',authorized:false,setupScore:setup.score,reasons,reasonCodes}}
  const eligibilityFailures:string[]=[];
  if(sample<config.preliminaryMaxExclusive)eligibilityFailures.push('QUANT_PRELIMINARY_SAMPLE');
  if(evidence.averageR<=config.minimumExpectancyR)eligibilityFailures.push('QUANT_NEGATIVE_EXPECTANCY');
  if((evidence.profitFactor??0)<config.minimumProfitFactor)eligibilityFailures.push('QUANT_PROFIT_FACTOR_FAILED');
  if((evidence.outOfSampleAverageR??Number.NEGATIVE_INFINITY)<=config.minimumOosExpectancyR)eligibilityFailures.push('QUANT_OOS_FAILED');
  if((evidence.outOfSampleProfitFactor??0)<config.minimumOosProfitFactor)eligibilityFailures.push('QUANT_OOS_PF_FAILED');
  if(config.requireWalkForward&&evidence.walkForwardStable!==true)eligibilityFailures.push('QUANT_WALK_FORWARD_FAILED');
  if(config.requirePaper&&evidence.paperTradingStable!==true)eligibilityFailures.push('QUANT_PAPER_FAILED');
  if((evidence.sampleQuality??0)<config.minimumSampleQuality)eligibilityFailures.push('QUANT_SAMPLE_QUALITY_LOW');
  if(eligibilityFailures.length){reasonCodes.push(...eligibilityFailures);reasons.push('Existe evidencia preliminar, pero faltan criterios simultáneos de elegibilidad.');return{status:'PRELIMINARY',authorized:false,setupScore:setup.score,reasons,reasonCodes}}
  const authorized=setup.stage==='READY'&&(setup.riskReward??0)>=config.minimumPlannedRR;
  reasonCodes.push('QUANT_ELIGIBLE');reasons.push(authorized?'Setup completo con edge validado; puede pasar a Risk.':'Quant es elegible, pero el setup actual no puede pasar a Risk.');
  return{status:'ELIGIBLE',authorized,setupScore:setup.score,reasons,reasonCodes};
}
