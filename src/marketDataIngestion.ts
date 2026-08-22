import type{MarketDataSourceRole,NormalizedMarketDataEvent}from'./marketDataEvent';
export type IngestionStatus='ACCEPTED_CANONICAL'|'ACCEPTED_AUXILIARY'|'DUPLICATE'|'STALE'|'SOURCE_REJECTED';
export interface SourcePolicy{instrumentId:string;primarySource:string;secondarySources:string[];alertSources:string[];maxAgeMs:number;discrepancyBps:number;}
export interface PriceDiscrepancy{instrumentId:string;canonicalEventId:string;comparedEventId:string;differenceBps:number;detectedAt:string;}
export interface IngestionResult{status:IngestionStatus;canonical:boolean;event:NormalizedMarketDataEvent;reasonCodes:string[];discrepancy:PriceDiscrepancy|null;}
const roleSources=(policy:SourcePolicy,role:MarketDataSourceRole)=>role==='PRIMARY_MARKET_FEED'?[policy.primarySource]:role==='SECONDARY_MARKET_FEED'?policy.secondarySources:policy.alertSources;
const comparablePrice=(event:NormalizedMarketDataEvent)=>event.price??(event.bid!=null&&event.ask!=null?(event.bid+event.ask)/2:event.bar?.close??null);
export class MarketDataIngestion{
  private readonly dedupeKeys=new Set<string>();private readonly latestCanonical=new Map<string,NormalizedMarketDataEvent>();private readonly events:NormalizedMarketDataEvent[]=[];
  constructor(private readonly policies:readonly SourcePolicy[]){}
  ingest(event:NormalizedMarketDataEvent,now:string):IngestionResult{
    const policy=this.policies.find(item=>item.instrumentId===event.instrumentId);
    if(!policy||!roleSources(policy,event.sourceRole).includes(event.source))return{status:'SOURCE_REJECTED',canonical:false,event,reasonCodes:['SOURCE_NOT_ALLOWED'],discrepancy:null};
    if(this.dedupeKeys.has(event.dedupeKey))return{status:'DUPLICATE',canonical:false,event,reasonCodes:['EVENT_DUPLICATE'],discrepancy:null};
    this.dedupeKeys.add(event.dedupeKey);this.events.push(event);
    if(Date.parse(now)-Date.parse(event.sourceTimestamp)>policy.maxAgeMs)return{status:'STALE',canonical:false,event,reasonCodes:['MARKET_DATA_STALE'],discrepancy:null};
    const canonical=event.sourceRole==='PRIMARY_MARKET_FEED'&&event.source===policy.primarySource,current=this.latestCanonical.get(event.instrumentId);let discrepancy:PriceDiscrepancy|null=null;
    if(!canonical&&current){const base=comparablePrice(current),comparison=comparablePrice(event);if(base!=null&&comparison!=null&&base>0){const differenceBps=Math.abs(comparison-base)/base*10_000;if(differenceBps>=policy.discrepancyBps)discrepancy={instrumentId:event.instrumentId,canonicalEventId:current.eventId,comparedEventId:event.eventId,differenceBps,detectedAt:now};}}
    if(canonical){if(!current||Date.parse(event.sourceTimestamp)>=Date.parse(current.sourceTimestamp))this.latestCanonical.set(event.instrumentId,event);return{status:'ACCEPTED_CANONICAL',canonical:true,event,reasonCodes:[],discrepancy};}
    return{status:'ACCEPTED_AUXILIARY',canonical:false,event,reasonCodes:discrepancy?['PRICE_SOURCE_DIVERGENCE']:[],discrepancy};
  }
  canonicalFor(instrumentId:string){return this.latestCanonical.get(instrumentId)??null}history(){return[...this.events]}
}
