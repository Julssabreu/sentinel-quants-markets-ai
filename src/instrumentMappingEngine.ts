import type{NormalizedNewsEvent}from'./newsEventEngine';
export interface InstrumentMappingRule{id:string;tokens:string[];instrumentIds:string[];matchType:'CURRENCY'|'COMPANY'|'SECTOR'|'COMMODITY'|'COUNTRY'|'SUBJECT';weight:number;}
export interface InstrumentMappingResult{instrumentId:string;matchedRuleIds:string[];score:number;}
export function mapEventToInstruments(event:NormalizedNewsEvent,rules:readonly InstrumentMappingRule[]):InstrumentMappingResult[]{
  const fields=[event.headline,...event.subjects,...event.companies,...event.currencies,...event.countries,...event.commodities].join(' ').toUpperCase(),matches=new Map<string,{rules:string[];score:number}>();
  for(const rule of rules){if(!rule.tokens.some(token=>fields.includes(token.toUpperCase())))continue;for(const instrumentId of rule.instrumentIds){const current=matches.get(instrumentId)??{rules:[],score:0};current.rules.push(rule.id);current.score+=Math.max(0,rule.weight);matches.set(instrumentId,current);}}
  return[...matches.entries()].map(([instrumentId,value])=>({instrumentId,matchedRuleIds:[...new Set(value.rules)],score:Math.min(100,value.score)})).sort((a,b)=>b.score-a.score||a.instrumentId.localeCompare(b.instrumentId));
}
