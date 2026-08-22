import type { MarketClass } from './marketArchitecture';

export type MarketDataSourceRole = 'PRIMARY_MARKET_FEED' | 'SECONDARY_MARKET_FEED' | 'ALERT_FEED';
export type MarketDataEventType = 'BAR' | 'TICK' | 'QUOTE' | 'ALERT' | 'CONTRACT_SPEC';
export interface MarketBarPayload { open:number; high:number; low:number; close:number; tickVolume:number|null; realVolume:number|null; closed:boolean; }
export interface ContractSpecificationPayload { tickSize:number|null; pointSize:number|null; contractSize:number|null; minimumLot:number|null; lotStep:number|null; swapLong:number|null; swapShort:number|null; currencyBase:string|null; currencyProfit:string|null; }
export interface NormalizedMarketDataEvent {
  schemaVersion:1; eventId:string; dedupeKey:string; source:string; sourceRole:MarketDataSourceRole;
  instrumentId:string; symbol:string; assetClass:MarketClass; timeframe:string|null; eventType:MarketDataEventType;
  sourceTimestamp:string; receivedTimestamp:string; processingTimestamp:string;
  providerTimestamp?:string|null; exchangeTimestamp?:string|null; brokerTimestamp?:string|null;
  price:number|null; bid:number|null; ask:number|null; bar?:MarketBarPayload|null; contract?:ContractSpecificationPayload|null;
  metadata:Record<string,unknown>;
}
const utc=(value:string,field:string)=>{const ms=Date.parse(value);if(!Number.isFinite(ms))throw new Error(`${field} inválido.`);return new Date(ms).toISOString()};
const optionalUtc=(value:string|null|undefined,field:string)=>value==null?null:utc(value,field);
const finiteOrNull=(value:number|null,field:string)=>{if(value!=null&&!Number.isFinite(value))throw new Error(`${field} inválido.`);return value};
export function normalizeMarketDataEvent(input:Omit<NormalizedMarketDataEvent,'schemaVersion'>):NormalizedMarketDataEvent{
  if(!input.eventId||!input.dedupeKey||!input.instrumentId||!input.source)throw new Error('Evento de mercado requiere identidad, fuente e instrumento.');
  const sourceTimestamp=utc(input.sourceTimestamp,'sourceTimestamp'),receivedTimestamp=utc(input.receivedTimestamp,'receivedTimestamp'),processingTimestamp=utc(input.processingTimestamp,'processingTimestamp');
  if(Date.parse(receivedTimestamp)<Date.parse(sourceTimestamp))throw new Error('receivedTimestamp precede al dato de origen.');
  if(Date.parse(processingTimestamp)<Date.parse(receivedTimestamp))throw new Error('processingTimestamp precede a receivedTimestamp.');
  const bid=finiteOrNull(input.bid,'bid'),ask=finiteOrNull(input.ask,'ask');
  if(bid!=null&&ask!=null&&bid>ask)throw new Error('Cotización inválida: bid es superior a ask.');
  if(input.eventType==='BAR'&&!input.bar)throw new Error('Un evento BAR requiere payload OHLC.');
  if(input.bar){const{open,high,low,close,tickVolume,realVolume}=input.bar;if(![open,high,low,close].every(value=>Number.isFinite(value)&&value>0)||high<Math.max(open,close,low)||low>Math.min(open,close,high))throw new Error('Payload OHLC inválido.');if([tickVolume,realVolume].some(value=>value!=null&&(!Number.isFinite(value)||value<0)))throw new Error('Volumen inválido.');}
  return{...input,schemaVersion:1,sourceTimestamp,receivedTimestamp,processingTimestamp,providerTimestamp:optionalUtc(input.providerTimestamp,'providerTimestamp'),exchangeTimestamp:optionalUtc(input.exchangeTimestamp,'exchangeTimestamp'),brokerTimestamp:optionalUtc(input.brokerTimestamp,'brokerTimestamp'),price:finiteOrNull(input.price,'price'),bid,ask};
}
export function marketEventLatency(event:NormalizedMarketDataEvent){return{sourceToReceiveMs:Date.parse(event.receivedTimestamp)-Date.parse(event.sourceTimestamp),receiveToProcessMs:Date.parse(event.processingTimestamp)-Date.parse(event.receivedTimestamp),totalMs:Date.parse(event.processingTimestamp)-Date.parse(event.sourceTimestamp)}}
export function relativeSpread(event:NormalizedMarketDataEvent):number|null{if(event.bid==null||event.ask==null)return null;const mid=(event.bid+event.ask)/2;return mid>0?(event.ask-event.bid)/mid:null}
