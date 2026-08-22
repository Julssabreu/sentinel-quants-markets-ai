export const TRADESTATION_SIM_BASE_URL='https://sim-api.tradestation.com/v3';
export const TRADESTATION_LIVE_BASE_URL='https://api.tradestation.com/v3';

export type TradeStationSessionTemplate='Default'|'USEQPre'|'USEQPost'|'USEQPreAndPost'|'USEQ24Hour';
export type TradeStationBarUnit='Minute'|'Daily'|'Weekly'|'Monthly';

export interface TradeStationRequestDescriptor {
  method:'GET';
  url:string;
  capability:'QUOTES'|'BARS'|'SYMBOLS';
  readOnly:true;
}

const safeSymbols=(symbols:string[],maximum:number)=>{
  const normalized=[...new Set(symbols.map((symbol)=>symbol.trim().toUpperCase()).filter((symbol)=>/^[A-Z0-9 .!_-]{1,40}$/.test(symbol)))];
  if(!normalized.length||normalized.length>maximum)throw new Error(`Se requieren entre 1 y ${maximum} símbolos válidos.`);
  return normalized;
};

export function tradeStationRequestedScopes(readAccount=false){
  return ['openid','offline_access','MarketData',...(readAccount?['ReadAccount']:[])];
}

export function assertTradeStationReadOnlyPath(pathname:string,method='GET'){
  if(method.toUpperCase()!=='GET')throw new Error('Sentinel bloquea cualquier método TradeStation distinto de GET.');
  if(!/^\/marketdata\//.test(pathname))throw new Error('Sentinel solo permite endpoints /marketdata de TradeStation.');
  if(/order|brokerage|trade/i.test(pathname))throw new Error('Endpoint de ejecución bloqueado por política.');
}

function request(pathname:string,query:Record<string,string|number|undefined>,capability:TradeStationRequestDescriptor['capability']):TradeStationRequestDescriptor{
  assertTradeStationReadOnlyPath(pathname);
  const url=new URL(`${TRADESTATION_SIM_BASE_URL}${pathname}`);
  for(const[key,value]of Object.entries(query))if(value!==undefined)url.searchParams.set(key,String(value));
  return{method:'GET',url:url.toString(),capability,readOnly:true};
}

export function tradeStationQuoteRequest(symbols:string[]){
  return request(`/marketdata/quotes/${encodeURIComponent(safeSymbols(symbols,100).join(','))}`,{},'QUOTES');
}

export function tradeStationSymbolRequest(symbols:string[]){
  return request(`/marketdata/symbols/${encodeURIComponent(safeSymbols(symbols,50).join(','))}`,{},'SYMBOLS');
}

export function tradeStationBarsRequest(symbol:string,options:{
  interval?:number;
  unit?:TradeStationBarUnit;
  barsback?:number;
  sessionTemplate?:TradeStationSessionTemplate;
}={}){
  const normalized=safeSymbols([symbol],1)[0];
  const interval=Math.max(1,Math.min(1440,Math.trunc(options.interval??1)));
  const barsback=Math.max(1,Math.min(57_600,Math.trunc(options.barsback??300)));
  return request(`/marketdata/barcharts/${encodeURIComponent(normalized)}`,{
    interval,
    unit:options.unit??'Minute',
    barsback,
    sessiontemplate:options.sessionTemplate??'USEQPreAndPost',
  },'BARS');
}
