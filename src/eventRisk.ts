export type EventAction='NORMAL'|'VIGILAR'|'REDUCIR_CONFIANZA'|'BLOQUEAR_ENTRADAS';
export interface EventRiskAssessment { action:EventAction; score:number; minutesToEvent:number; affectedAssets:string[]; reason:string }
const ASSETS:Record<string,string[]>={
 USD:['DXY','EUR/USD','GBP/USD','USD/JPY','XAU/USD','NASDAQ','S&P 500','BTC/USD'],
 EUR:['EUR/USD','EUR/GBP','EUR/JPY','DAX','Euro Stoxx 50'], GBP:['GBP/USD','EUR/GBP','FTSE 100'],
 JPY:['USD/JPY','EUR/JPY','Nikkei 225'], AUD:['AUD/USD','AUD/JPY'], CAD:['USD/CAD','WTI'],
 CHF:['USD/CHF','EUR/CHF'], NZD:['NZD/USD'], CNY:['USD/CNH','AUD/USD','Metales','Hang Seng']
};
const WINDOW:Record<string,{before:number;after:number;score:number}>={High:{before:45,after:20,score:90},Medium:{before:20,after:10,score:60},Low:{before:8,after:3,score:30},Holiday:{before:0,after:0,score:15}};

export function assessEventRisk(event:MacroEvent,now=new Date()):EventRiskAssessment {
 const scheduled=new Date(event.scheduledAt).getTime();
 const minutes=(scheduled-now.getTime())/60000;
 const policy=WINDOW[event.impact]??WINDOW.Low;
 const within=minutes<=policy.before&&minutes>=-policy.after;
 const action:EventAction=!within?'NORMAL':event.impact==='High'?'BLOQUEAR_ENTRADAS':event.impact==='Medium'?'REDUCIR_CONFIANZA':'VIGILAR';
 return {action,score:within?policy.score:Math.max(0,Math.round(policy.score-Math.abs(minutes))),minutesToEvent:Math.round(minutes),affectedAssets:ASSETS[event.currency]??[event.currency],reason:within?`${event.impact}: ventana de riesgo desde ${policy.before} min antes hasta ${policy.after} min después.`:'Fuera de la ventana operativa de riesgo.'};
}

export function portfolioEventRisk(events:MacroEvent[],now=new Date()) {
 const assessments=events.map(event=>({event,risk:assessEventRisk(event,now)})).filter(x=>x.risk.action!=='NORMAL');
 const rank:Record<EventAction,number>={NORMAL:0,VIGILAR:1,REDUCIR_CONFIANZA:2,BLOQUEAR_ENTRADAS:3};
 return assessments.sort((a,b)=>rank[b.risk.action]-rank[a.risk.action]||Math.abs(a.risk.minutesToEvent)-Math.abs(b.risk.minutesToEvent));
}
