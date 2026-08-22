// @ts-nocheck -- This opt-in E2E runs in Vitest's Node environment.
import { afterAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import operationalStoreModule from '../shared/sentinelOperationalStore.cjs';
import { AutonomousRuntimeEngine } from './autonomousRuntime';
import { initialKillSwitchState } from './killSwitch';
import { reconstructPaperObservations } from './paperTradingCoordinator';
import { reconstructShadowObservations } from './shadowCoordinator';

const enabled=process.env.SENTINEL_MT5_E2E==='1',run=enabled?describe:describe.skip;
const roots:string[]=[],execute=promisify(execFile);

async function bridge(command:string,args:string[]=[]){
  const python=process.env.SENTINEL_PYTHON||'python',script=path.resolve('services/mt5_bridge.py');
  const{stdout}=await execute(python,[script,command,...args],{cwd:path.resolve('.'),windowsHide:true,timeout:120_000,maxBuffer:64*1024*1024});
  return JSON.parse(stdout.trim());
}

async function createApi(root:string){
  const store=operationalStoreModule.createSentinelOperationalStore(path.join(root,'sentinel-operational'));
  const historyPath=path.join(root,'analysis-history.json');
  const readHistory=async()=>{try{return JSON.parse(await fs.readFile(historyPath,'utf8'));}catch(error){if(error.code==='ENOENT')return[];throw error;}};
  const writeHistory=async records=>{await fs.mkdir(root,{recursive:true});await fs.writeFile(historyPath,JSON.stringify(records,null,2),'utf8');};
  const list=async kind=>(await store.list(kind)).map(entry=>entry.payload);
  const append=async(kind,events)=>{const outcomes=[];for(const event of events)outcomes.push(await store.append(kind,event));return outcomes;};
  const health=async()=>{const status=await bridge('status'),checkedAt=new Date().toISOString(),healthy=status.ok&&status.connected!==false;return{schemaVersion:1,operationalEventId:`E2E_HEALTH:${checkedAt}`,timestamp:checkedAt,overall:healthy?'HEALTHY':'ERROR',blockNewOpportunities:!healthy,reasonCodes:healthy?[]:['MT5_OFFLINE'],liveEnabled:false,liveOrderSent:false,executionAuthorized:false,components:[{id:'MT5',status:healthy?'HEALTHY':'OFFLINE',lastMessage:status.checkedAt??null,lastHeartbeat:checkedAt,latencyMs:null,critical:true,reasonCodes:healthy?[]:['MT5_OFFLINE'],configured:true,checkedAt,source:'LIVE_PROBE'}]};};
  return{
    getWatchlists:async()=>({ok:true,config:{schemaVersion:1,activeListId:'E2E',intervalMinutes:2,lists:[{id:'E2E',name:'BTC MT5 E2E',enabled:true,symbols:['BTCUSD']}]}}),
    getSignalNotifier:async()=>({ok:true,config:{schemaVersion:3,enabled:false,channel:'whatsapp',target:'+10000000000',timeframes:['M5'],intervalMinutes:2,minConfidence:45,riskPercent:.5,maxSymbols:2,keepInTray:true,startWithWindows:false}}),
    getMt5MultiRates:(_symbol,timeframes,count)=>bridge('multi_rates',['--symbol','BTCUSD','--timeframes',timeframes.join(','),'--count',String(count)]),
    getMt5RatesAfter:(_symbol,timeframe,after,count,until)=>bridge('rates_after',['--symbol','BTCUSD','--timeframe',timeframe,'--after',after,'--until',until,'--count',String(count)]),
    getMt5Microstructure:()=>bridge('microstructure',['--symbol','BTCUSD']),
    getMacroSnapshot:async()=>({checkedAt:new Date().toISOString(),indicators:[],events:[],yieldCurve:null,errors:[]}),
    getNewsSnapshot:async()=>({checkedAt:new Date().toISOString(),articles:[],errors:[],sources:[]}),
    getMt5Portfolio:()=>bridge('portfolio'),
    listAnalysisHistory:async()=>({ok:true,records:await readHistory()}),
    getMt5Factors:async()=>({ok:false,factors:[],errors:['E2E_NOT_REQUIRED'],checkedAt:new Date().toISOString(),permissions:'READ_ONLY'}),
    getInstitutionalFactors:async()=>({checkedAt:new Date().toISOString(),realYields:null,cot:[],cryptoDerivatives:null,errors:['E2E_NOT_REQUIRED'],permissions:'READ_ONLY'}),
    getTradingViewVixContext:async()=>({ok:false,status:'DISABLED',contextType:'MARKET_CONTEXT',symbol:'VIX',operationalSignal:false,snapshot:null,history:[],checkedAt:new Date().toISOString(),fetchedAt:null,error:null}),
    getTradingViewConfig:async()=>({ok:true,config:{schemaVersion:1,enabled:false,endpoint:'',pollSeconds:10,maxAgeMinutes:30,hasToken:false}}),
    getTradingViewMarketObservations:async(symbol,timeframe)=>({ok:false,status:'DISABLED',contextType:'MARKET_OBSERVATION',operationalSignal:false,symbol,timeframe,observations:[],checkedAt:new Date().toISOString(),error:null}),
    getLatestOperationalHealth:async()=>({ok:true,snapshot:await health()}),
    refreshOperationalHealth:async()=>({ok:true,snapshot:await health()}),
    saveAnalysisHistory:async draft=>{const records=await readHistory(),identity=draft.analysisFingerprint,existing=records.find(item=>item.analysisFingerprint===identity);if(existing)return{ok:true,duplicate:true,record:existing};const record={...draft,id:`E2E_ANALYSIS:${Buffer.from(identity).toString('base64url').slice(0,48)}`,createdAt:new Date().toISOString(),schemaVersion:3};records.push(record);await writeHistory(records);return{ok:true,record};},
    listPaperEvents:async()=>({ok:true,events:await list('paper')}),
    appendPaperEvents:async events=>{const saved=await append('paper',events),journal=await list('paper'),active=reconstructPaperObservations(journal).filter(item=>['PENDING_ENTRY','OPEN'].includes(item.status));return{ok:true,created:saved.filter(item=>item.created).length,duplicates:saved.filter(item=>item.duplicate).length,activePaperIds:active.map(item=>item.paperId)};},
    listShadowEvents:async()=>({ok:true,events:await list('shadow')}),
    appendShadowEvents:async events=>{const saved=await append('shadow',events),journal=await list('shadow'),active=reconstructShadowObservations(journal).filter(item=>['PENDING_ENTRY','OPEN'].includes(item.status));return{ok:true,created:saved.filter(item=>item.created).length,duplicates:saved.filter(item=>item.duplicate).length,activeShadowIds:active.map(item=>item.shadowId)};},
    retryPendingSignalDeliveries:async()=>({ok:false,status:'DISABLED',retried:0,sent:0,pending:0}),
    __store:store,
    __readHistory:readHistory,
  };
}

afterAll(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});

run('autonomous runtime with real MT5 bridge',()=>{
  it('persiste análisis BTCUSD + Paper/Shadow y los recupera tras reinicio sin duplicar',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'sentinel-mt5-runtime-e2e-'));roots.push(root);
    const api=await createApi(root),firstEngine=new AutonomousRuntimeEngine(api,initialKillSwitchState);
    const first=await firstEngine.runConfiguredCycle();
    expect(first.state).not.toBe('ERROR');
    expect(first.symbols).toHaveLength(1);
    expect(first.symbols[0]).toMatchObject({symbol:'BTCUSD',analysisRecordId:expect.any(String),paperEventsCreated:1,shadowEventsCreated:1,error:null});
    expect((await api.__readHistory())).toHaveLength(1);
    const persisted=await api.__store.recover();
    expect(persisted.eventCounts).toMatchObject({paper:1,shadow:1});
    expect(persisted.lastEvents.paper.observation.liveOrderSent).toBe(false);
    expect(persisted.lastEvents.shadow.observation.liveOrderSent).toBe(false);

    const restarted=new AutonomousRuntimeEngine(api,initialKillSwitchState),second=await restarted.runConfiguredCycle();
    expect(second.state).not.toBe('ERROR');
    expect((await api.__readHistory())).toHaveLength(1);
    const recovered=await api.__store.recover();
    expect(recovered.eventCounts).toMatchObject({paper:1,shadow:1});
    expect(second.paperJournalEvents).toBe(1);
    expect(second.shadowJournalEvents).toBe(1);
  },180_000);
});
