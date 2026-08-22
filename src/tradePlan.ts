import { atr, type Candle } from './analysisEngine';
import type { DecisionResult } from './decisionEngine';
export interface TradePlan { active:boolean; direction:'BUY'|'SELL'|null; trigger:number|null; maxEntry:number|null; stop:number|null; tp1:number|null; tp2:number|null; riskReward1:number|null; riskReward2:number|null; atr:number|null; expiresAfterBars:number; cancellation:string[] }

export function buildTradePlan(candles:Candle[],decision:DecisionResult):TradePlan {
 const inactive=(reason:string):TradePlan=>({active:false,direction:null,trigger:null,maxEntry:null,stop:null,tp1:null,tp2:null,riskReward1:null,riskReward2:null,atr:null,expiresAfterBars:0,cancellation:[reason]});
 if(!['BUY_CONDICIONADO','SELL_CONDICIONADO'].includes(decision.decision)) return inactive(decision.decision==='NO_OPERAR_EVENTO'?'Bloqueado por evento macroeconómico.':'No existe ventaja suficiente para calcular una entrada.');
 const valid=candles.filter(c=>[c.open,c.high,c.low,c.close].every(Number.isFinite));if(valid.length<30)return inactive('Se requieren al menos 30 velas válidas.');
 const volatility=atr(valid,14);if(!Number.isFinite(volatility)||volatility<=0)return inactive('ATR inválido.');
 const recent=valid.slice(-20),direction=decision.decision==='BUY_CONDICIONADO'?'BUY':'SELL';
 const resistance=Math.max(...recent.slice(0,-1).map(c=>c.high)),support=Math.min(...recent.slice(0,-1).map(c=>c.low));
 const buffer=volatility*.1;let trigger:number,stop:number;
 if(direction==='BUY'){trigger=resistance+buffer;stop=Math.min(support,trigger-volatility*1.35)}else{trigger=support-buffer;stop=Math.max(resistance,trigger+volatility*1.35)}
 const risk=Math.abs(trigger-stop);if(!Number.isFinite(risk)||risk<=0)return inactive('La estructura no permite definir riesgo.');
 const sign=direction==='BUY'?1:-1,tp1=trigger+sign*risk*1.5,tp2=trigger+sign*risk*2.5,maxEntry=trigger+sign*risk*.15;
 return{active:true,direction,trigger,maxEntry,stop,tp1,tp2,riskReward1:1.5,riskReward2:2.5,atr:volatility,expiresAfterBars:3,cancellation:['Cancelar si ocurre un evento de alto impacto relevante.','Cancelar si la vela cierra más allá de la invalidación antes de activar la entrada.','Recalcular después de tres velas sin activación.']};
}
