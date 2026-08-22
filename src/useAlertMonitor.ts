import { useCallback, useEffect, useRef, useState } from 'react';
import { assessInstitutionalFactorRisk } from './institutionalFactorRisk';
import { analyzeMicrostructure } from './microstructureEngine';
import { analyzeCryptoFlow } from './cryptoFlowEngine';
import { buildSentinelAlerts } from './alertEngine';

export function useAlertMonitor(_selectedSymbol:string) {
  const [activeCount,setActiveCount]=useState(0);
  const [criticalCount,setCriticalCount]=useState(0);
  const [lastCheckedAt,setLastCheckedAt]=useState<string|null>(null);
  const [lastError,setLastError]=useState<string|null>(null);
  const [intervalMinutes,setIntervalMinutes]=useState(2);
  const running=useRef(false),knownCritical=useRef(new Set<string>()),cryptoSymbols=useRef(new Set<string>());

  const syncCounts=useCallback(async()=>{
    const response=await window.sentinel?.listAlerts?.(),now=Date.now();
    const active=(response?.records??[]).filter(item=>item.status==='ACTIVE'&&(!item.expiresAt||Date.parse(item.expiresAt)>now));
    setActiveCount(active.length);setCriticalCount(active.filter(item=>item.severity==='CRITICA').length);
    const activeFingerprints=new Set(active.map(item=>item.fingerprint));
    knownCritical.current=new Set([...knownCritical.current].filter(fingerprint=>activeFingerprints.has(fingerprint)));
    return active;
  },[]);

  const monitor=useCallback(async()=>{
    if(!window.sentinel||running.current)return;
    running.current=true;
    try{
      const saved=await window.sentinel.getWatchlists(),enabled=saved.config.lists.filter(list=>list.enabled);
      const symbols=[...new Set(enabled.flatMap(list=>list.symbols).map(symbol=>symbol.trim().toUpperCase()).filter(Boolean))];
      setIntervalMinutes(saved.config.intervalMinutes);
      const desiredCrypto=new Set(symbols.filter(symbol=>/^(BTC|ETH|SOL|BNB|XRP|DOGE|ADA|AVAX|LINK)/.test(symbol.replace(/[^A-Z0-9]/g,''))));
      for(const prior of cryptoSymbols.current)if(!desiredCrypto.has(prior)){await window.sentinel.stopCryptoFlow(prior).catch(()=>null);cryptoSymbols.current.delete(prior);}
      if(!symbols.length){setLastError(null);setLastCheckedAt(new Date().toISOString());await syncCounts();return;}
      const [macro,institutionalRaw]=await Promise.all([window.sentinel.getMacroSnapshot(),window.sentinel.getInstitutionalFactors()]);
      const candidates:SentinelAlertCandidate[]=[];
      for(const symbol of symbols){
        const compact=symbol.replace(/[^A-Z0-9]/g,''),isCrypto=/^(BTC|ETH|SOL|BNB|XRP|DOGE|ADA|AVAX|LINK)/.test(compact);
        let flowRaw:CryptoFlowSnapshot|null=null;
        if(isCrypto){await window.sentinel.startCryptoFlow(symbol);cryptoSymbols.current.add(symbol);flowRaw=await window.sentinel.getCryptoFlowSnapshot(symbol);}
        const microRaw=await window.sentinel.getMt5Microstructure(symbol).catch(()=>null);
        candidates.push(...buildSentinelAlerts({symbol,events:macro.events,institutional:assessInstitutionalFactorRisk(symbol,institutionalRaw),micro:analyzeMicrostructure(microRaw),flow:isCrypto?analyzeCryptoFlow(flowRaw):null}));
      }
      await window.sentinel.upsertAlerts(candidates);
      const active=await syncCounts(),newCritical=active.filter(item=>item.severity==='CRITICA'&&!knownCritical.current.has(item.fingerprint));
      for(const item of newCritical){knownCritical.current.add(item.fingerprint);if('Notification'in window&&Notification.permission==='granted')new Notification(`Sentinel · ${item.title}`,{body:`${item.symbol??'GLOBAL'} · ${item.details.slice(0,180)}`});}
      setLastError(null);setLastCheckedAt(new Date().toISOString());
    }catch(error){setLastError(error instanceof Error?error.message:'Falló el monitor contextual de alertas.');await syncCounts().catch(()=>{});}
    finally{running.current=false;}
  },[syncCounts]);

  useEffect(()=>{
    void syncCounts();
    if('Notification'in window&&Notification.permission==='default')void Notification.requestPermission();
    void monitor();
    const timer=window.setInterval(()=>void monitor(),intervalMinutes*60_000);
    return()=>{window.clearInterval(timer);for(const symbol of cryptoSymbols.current)void window.sentinel?.stopCryptoFlow(symbol);cryptoSymbols.current.clear();};
  },[monitor,syncCounts,intervalMinutes]);

  return{activeCount,criticalCount,lastCheckedAt,lastError,refreshAlerts:monitor};
}
