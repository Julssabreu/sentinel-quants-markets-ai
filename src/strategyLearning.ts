import type { PerformanceStats } from './performanceStats';
export type StrategyVerdict='INSUFFICIENT_SAMPLE'|'PROBATION'|'ELIGIBLE'|'REJECTED';
export interface StrategyEvaluation { verdict:StrategyVerdict; proposedWeight:number; currentWeight:number; reasons:string[]; requiresApproval:true }
export function evaluateStrategy(stats:PerformanceStats,currentWeight:number):StrategyEvaluation {
 const reasons:string[]=[];let verdict:StrategyVerdict='PROBATION',proposedWeight=currentWeight;
 if(stats.resolved<30){verdict='INSUFFICIENT_SAMPLE';reasons.push(`Solo ${stats.resolved}/30 resultados resueltos.`);proposedWeight=Math.min(currentWeight,.25)}
 else if(stats.averageR<=0||stats.netR<=0||(stats.profitFactor??0)<1){verdict='REJECTED';reasons.push('Expectativa o profit factor no superan el umbral mínimo.');proposedWeight=0}
 else if((stats.profitFactor??0)>=1.25&&stats.averageR>=.15&&stats.maxDrawdownR<=10){verdict='ELIGIBLE';reasons.push('Supera muestra, expectativa, profit factor y drawdown requeridos.');proposedWeight=Math.min(.5,currentWeight+.1)}
 else{verdict='PROBATION';reasons.push('Resultado positivo, pero todavía sin estabilidad suficiente.');proposedWeight=Math.max(.1,currentWeight-.05)}
 if(stats.ambiguous>stats.resolved*.1)reasons.push('Proporción elevada de resultados ambiguos.');
 return{verdict,proposedWeight:Number(proposedWeight.toFixed(2)),currentWeight,reasons,requiresApproval:true};
}
export const STRATEGY_CATALOG=[
 {id:'BREAKOUT_STRUCTURE_ATR',name:'Ruptura estructural + ATR',status:'ACTIVE_RESEARCH',weight:.3},
 {id:'TREND_MOMENTUM',name:'Tendencia y momentum',status:'PLANNED',weight:0},
 {id:'MEAN_REVERSION',name:'Reversión a la media',status:'PLANNED',weight:0},
 {id:'VOLATILITY_EXPANSION',name:'Expansión de volatilidad',status:'PLANNED',weight:0},
 {id:'SUPPLY_DEMAND_FIB_VOLUME',name:'Supply & Demand + Fibonacci + volumen',status:'ACTIVE_RESEARCH',weight:0},
 {id:'MACRO_INTERMARKET',name:'Macro e intermercado',status:'PLANNED',weight:0}
] as const;
