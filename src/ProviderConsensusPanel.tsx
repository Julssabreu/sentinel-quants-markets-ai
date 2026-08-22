import { useMemo, useState } from 'react';
import { Database, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { analyzeProviderConsensus, type ProviderQuote } from './providerConsensus';
import { independentSourceCount, scoreSource, type SourceObservation } from './sourceQuality';
import { classifyMarket } from './marketArchitecture';
const PROVIDERS=['OANDA','FXCM','FOREXCOM','PEPPERSTONE'];
const tvUrl=(symbol:string,provider:string)=>`https://www.tradingview.com/chart/?symbol=${provider}%3A${symbol.toUpperCase().replace(/[^A-Z0-9]/g,'')}`;
export default function ProviderConsensusPanel({symbol,mt5}:{symbol:string;mt5:Mt5RatesResponse}){
 const market=classifyMarket({symbol,brokerMetadata:mt5.instrument?{
  ...mt5.instrument,
  sector:mt5.instrument.sector==null?null:String(mt5.instrument.sector),
  industry:mt5.instrument.industry==null?null:String(mt5.instrument.industry),
 }:undefined});
 if(market.market!=='FOREX')return <div className="card provider-panel"><div className="provider-head"><div><Database/><span><b>Validación entre proveedores · {market.market}</b><small>MT5 conserva el precio operativo; no se aplican proveedores FX ni unidades de pips a este mercado.</small></span></div><strong className="provider-pending">RUTA ESPECÍFICA</strong></div><p className="provider-note">La cobertura disponible y sus brechas aparecen en el panel multimercado. El consenso manual se habilitará cuando existan feeds comparables y unidades normalizadas para {market.canonicalId}.</p></div>;
 return <ForexProviderConsensus symbol={symbol} mt5={mt5}/>;
}
function ForexProviderConsensus({symbol,mt5}:{symbol:string;mt5:Mt5RatesResponse}){
 const initial=useMemo<ProviderQuote[]>(()=>mt5.tick?[{provider:mt5.source||'MT5 local',bid:mt5.tick.bid,ask:mt5.tick.ask,observedAt:mt5.tick.time,source:'MT5'}]:[],[mt5]);
 const [quotes,setQuotes]=useState(initial),[provider,setProvider]=useState('OANDA'),[bid,setBid]=useState(''),[ask,setAsk]=useState('');
 const consensus=useMemo(()=>analyzeProviderConsensus(symbol,quotes),[symbol,quotes]);
 const observations=useMemo<SourceObservation[]>(()=>quotes.map(q=>({id:q.provider,kind:q.source==='MT5'?'BROKER':'SCREENER',observedAt:q.observedAt||new Date().toISOString(),receivedAt:new Date().toISOString(),direct:q.source==='MT5',authenticated:q.source==='MT5',independentGroup:q.provider})),[quotes]);
 const add=()=>{const b=Number(bid),a=Number(ask);if(!Number.isFinite(b)||!Number.isFinite(a)||a<b||b<=0)return;setQuotes(xs=>[...xs.filter(x=>x.provider!==provider),{provider,bid:b,ask:a,observedAt:new Date().toISOString(),source:'TradingView'}]);setBid('');setAsk('')};
 return <div className="card provider-panel"><div className="provider-head"><div><Database/><span><b>Consenso entre proveedores</b><small>MT5 manda para ejecución; los demás feeds confirman.</small></span></div><strong className={consensus.providersUsed>=3?'provider-ready':'provider-pending'}>{consensus.providersUsed>=3?'CONSENSO DISPONIBLE':'FALTAN FUENTES'}</strong></div>
 <div className="provider-metrics"><div><span>Referencia mediana</span><b>{Number.isFinite(consensus.referenceMid)?consensus.referenceMid.toFixed(mt5.digits??5):'—'}</b></div><div><span>Dispersión</span><b>{Number.isFinite(consensus.dispersionPips)?`${consensus.dispersionPips.toFixed(2)} pips`:'—'}</b></div><div><span>Confianza</span><b>{consensus.confidence}/100</b></div><div><span>Independientes</span><b>{independentSourceCount(observations)}</b></div></div>
 <div className="quote-table">{quotes.map(q=>{const quality=scoreSource(observations.find(x=>x.id===q.provider)!);return <div key={q.provider}><b>{q.provider}</b><span>{q.bid.toFixed(mt5.digits??5)}</span><span>{q.ask.toFixed(mt5.digits??5)}</span><em>{quality.score}/100</em>{q.source==='MT5'?<small>OPERATIVA</small>:<button onClick={()=>setQuotes(xs=>xs.filter(x=>x.provider!==q.provider))}><Trash2 size={13}/></button>}</div>})}</div>
 <div className="quote-entry"><select value={provider} onChange={e=>setProvider(e.target.value)}>{PROVIDERS.map(x=><option key={x}>{x}</option>)}</select><input value={bid} onChange={e=>setBid(e.target.value)} placeholder="Bid"/><input value={ask} onChange={e=>setAsk(e.target.value)} placeholder="Ask"/><button className="primary" onClick={add}><Plus size={15}/> Añadir</button><a href={tvUrl(symbol,provider)} target="_blank" rel="noreferrer">TradingView <ExternalLink size={13}/></a></div>
 <p className="provider-note">Las lecturas externas manuales quedan marcadas como secundarias y no sustituyen el precio del bróker.</p>{consensus.warnings.length?<div className="provider-warnings">{consensus.warnings.map(x=><span key={x}>{x}</span>)}</div>:null}</div>
}
