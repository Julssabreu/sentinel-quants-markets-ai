import { analyzeCandles, type TechnicalAnalysis } from './analysisEngine';

export const ALL_TIMEFRAMES = ['M1','M2','M3','M4','M5','M6','M10','M12','M15','M20','M30','H1','H2','H3','H4','H6','H8','H12','D1','W1','MN1'] as const;
export type Timeframe = typeof ALL_TIMEFRAMES[number];
const WEIGHTS: Record<Timeframe, number> = { M1:.25,M2:.25,M3:.3,M4:.3,M5:.4,M6:.4,M10:.5,M12:.55,M15:.65,M20:.7,M30:.8,H1:1.1,H2:1.2,H3:1.3,H4:1.6,H6:1.7,H8:1.8,H12:1.9,D1:2.3,W1:2.6,MN1:2.4 };
export interface TimeframeResult { timeframe: Timeframe; weight: number; analysis: TechnicalAnalysis }
export interface MultiTimeframeAnalysis { score:number; confidence:number; alignment:number; bias:'ALCISTA'|'BAJISTA'|'NEUTRAL'; available:number; bullish:Timeframe[]; bearish:Timeframe[]; neutral:Timeframe[]; contradictions:string[]; results:TimeframeResult[] }

export function analyzeMultiTimeframe(results: Record<string, Mt5RatesResponse>): MultiTimeframeAnalysis {
  const analyzed = ALL_TIMEFRAMES.flatMap(timeframe => {
    const payload=results[timeframe];
    return payload?.ok&&payload.candles?.length ? [{timeframe,weight:WEIGHTS[timeframe],analysis:analyzeCandles(payload.candles)}] : [];
  });
  const valid=analyzed.filter(x=>x.analysis.regime!=='DATOS_INSUFICIENTES');
  const total=valid.reduce((s,x)=>s+x.weight,0);
  const score=total?valid.reduce((s,x)=>s+x.analysis.score*x.weight,0)/total:0;
  const directional=valid.filter(x=>['ALCISTA','BAJISTA'].includes(x.analysis.regime));
  const directionalTotal=directional.reduce((s,x)=>s+x.weight,0);
  const net=directional.reduce((s,x)=>s+(x.analysis.regime==='ALCISTA'?x.weight:-x.weight),0);
  const alignment=directionalTotal?Math.round(100*Math.abs(net)/directionalTotal):0;
  const bias=score>=18?'ALCISTA':score<=-18?'BAJISTA':'NEUTRAL';
  const bullish=valid.filter(x=>x.analysis.regime==='ALCISTA').map(x=>x.timeframe);
  const bearish=valid.filter(x=>x.analysis.regime==='BAJISTA').map(x=>x.timeframe);
  const neutral=valid.filter(x=>!['ALCISTA','BAJISTA'].includes(x.analysis.regime)).map(x=>x.timeframe);
  const higher=valid.filter(x=>['H4','H6','H8','H12','D1','W1','MN1'].includes(x.timeframe));
  const lower=valid.filter(x=>x.timeframe.startsWith('M'));
  const direction=(items:TimeframeResult[])=>items.reduce((s,x)=>s+Math.sign(x.analysis.score)*x.weight,0);
  const contradictions:string[]=[];
  if(direction(higher)*direction(lower)<0) contradictions.push('Las temporalidades rápidas contradicen la estructura H4–MN1.');
  if(bullish.length&&bearish.length) contradictions.push(`${bullish.length} marcos alcistas y ${bearish.length} bajistas: no existe unanimidad.`);
  if(alignment<45&&directionalTotal) contradictions.push('La alineación direccional es baja; conviene esperar confirmación.');
  const coverage=valid.length/ALL_TIMEFRAMES.length;
  const confidence=Math.min(90,Math.round((Math.abs(score)*.75+alignment*.25)*coverage));
  return {score:Math.round(score),confidence,alignment,bias,available:valid.length,bullish,bearish,neutral,contradictions,results:analyzed};
}
