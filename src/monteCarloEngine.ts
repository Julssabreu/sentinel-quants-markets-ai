import { calculateQuantStatistics } from './quantStatistics';

export interface MonteCarloResult { randomSeed:number; paths:number; pathLength:number; terminalR:{ p05:number; p50:number; p95:number }; maxDrawdownR:{ p50:number; p95:number; worst:number }; ruinProbability:number; }
function randomGenerator(seed:number) { let value=seed>>>0; return()=>{value+=0x6D2B79F5;let t=value;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}; }
function percentile(values:number[], p:number) { if (!values.length) return 0; const sorted=[...values].sort((a,b)=>a-b), index=Math.min(sorted.length-1,Math.max(0,Math.floor((sorted.length-1)*p)));return sorted[index]; }
export function runMonteCarloBootstrap(returns:readonly number[], config:{ paths:number; pathLength?:number; randomSeed:number; ruinThresholdR:number }):MonteCarloResult {
  const clean=returns.filter(Number.isFinite); if(!clean.length)throw new Error('Monte Carlo requiere retornos.');
  if(!Number.isInteger(config.paths)||config.paths<1||!Number.isInteger(config.randomSeed))throw new Error('Configuración Monte Carlo inválida.');
  const random=randomGenerator(config.randomSeed), length=config.pathLength??clean.length, terminals:number[]=[], drawdowns:number[]=[];let ruined=0;
  for(let path=0;path<config.paths;path++){const sampled=Array.from({length},()=>clean[Math.floor(random()*clean.length)]),stats=calculateQuantStatistics(sampled);let equity=0,min=0;sampled.forEach(value=>{equity+=value;min=Math.min(min,equity)});if(min<=-Math.abs(config.ruinThresholdR))ruined++;terminals.push(sampled.reduce((sum,value)=>sum+value,0));drawdowns.push(stats.maxDrawdownR)}
  return{randomSeed:config.randomSeed,paths:config.paths,pathLength:length,terminalR:{p05:percentile(terminals,.05),p50:percentile(terminals,.5),p95:percentile(terminals,.95)},maxDrawdownR:{p50:percentile(drawdowns,.5),p95:percentile(drawdowns,.95),worst:Math.max(...drawdowns)},ruinProbability:ruined/config.paths};
}
