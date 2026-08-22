export interface PerformanceStats { total:number; resolved:number; wins:number; losses:number; ambiguous:number; activationRate:number; winRate:number; netR:number; averageR:number; profitFactor:number|null; maxDrawdownR:number; sampleWarning:string|null }
const outcomeR=(record:AnalysisHistoryRecord):number|null=>record.outcome?.status==='TP2'?2.5:record.outcome?.status==='STOP'?-1:null;
export function calculatePerformance(records:AnalysisHistoryRecord[]):PerformanceStats {
 const planned=records.filter(r=>r.plan?.trigger),activated=planned.filter(r=>r.outcome?.activatedAt),returns=planned.map(outcomeR).filter((x):x is number=>x!==null);
 const wins=returns.filter(x=>x>0),losses=returns.filter(x=>x<0),grossProfit=wins.reduce((s,x)=>s+x,0),grossLoss=Math.abs(losses.reduce((s,x)=>s+x,0));
 let equity=0,peak=0,maxDrawdownR=0;for(const value of [...returns].reverse()){equity+=value;peak=Math.max(peak,equity);maxDrawdownR=Math.max(maxDrawdownR,peak-equity)}
 return{total:planned.length,resolved:returns.length,wins:wins.length,losses:losses.length,ambiguous:planned.filter(r=>r.outcome?.status==='AMBIGUOUS').length,activationRate:planned.length?Math.round(100*activated.length/planned.length):0,winRate:returns.length?Math.round(100*wins.length/returns.length):0,netR:returns.reduce((s,x)=>s+x,0),averageR:returns.length?returns.reduce((s,x)=>s+x,0)/returns.length:0,profitFactor:grossLoss?grossProfit/grossLoss:null,maxDrawdownR,sampleWarning:returns.length<30?'Muestra insuficiente: se requieren al menos 30 resultados resueltos.':null};
}
export function groupPerformance(records:AnalysisHistoryRecord[],key:'symbol'|'timeframe'|'regime'|'strategy'){
 const groups=new Map<string,AnalysisHistoryRecord[]>();for(const record of records){const value=String(record[key]??'SIN_DATO');groups.set(value,[...(groups.get(value)??[]),record])}return [...groups].map(([name,items])=>({name,...calculatePerformance(items)})).sort((a,b)=>b.resolved-a.resolved);
}
