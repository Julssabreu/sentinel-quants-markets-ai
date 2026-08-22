import { assessDatasetQuality } from './dataQuality';
import { assessTickFreshness } from './dataFreshness';
import { buildGuardedDecision, type DecisionResult } from './decisionEngine';
import { deriveFinalStatus, type SentinelDecision } from './decisionContract';
import { evaluateCircuitBreakers } from './circuitBreaker';
import { type ExecutionCostProfile } from './executionCostModel';
import { assessInstitutionalFactorRisk } from './institutionalFactorRisk';
import { analyzeIntermarket } from './intermarketEngine';
import { type KillSwitchState } from './killSwitch';
import { classifyMarket, type MarketClass } from './marketArchitecture';
import { normalizeMarketDataEvent } from './marketDataEvent';
import { analyzeMicrostructure } from './microstructureEngine';
import { analyzeMultiTimeframe } from './multiTimeframeAnalysis';
import { evaluateModelGovernance, type ModelGovernance } from './modelGovernance';
import { evaluateOperationalSafety } from './operationalSafetyCoordinator';
import { createPaperEvent, createPaperObservation, advancePaperObservation, blockPaperObservationForRecovery, type PaperEvent } from './paperTradingEngine';
import { reconstructPaperObservations } from './paperTradingCoordinator';
import { applyPortfolioGate } from './portfolioGate';
import { rankNews } from './newsIntelligence';
import { buildAnalysisHistoryDraft } from './analysisHistoryRecord';
import { SENTINEL_QUANT_VERSIONS } from './sentinelQuantVersions';
import { recoverActiveShadowObservations, processShadowMarketEvent, startShadowDecision, type ShadowFeedHealth } from './shadowLiveRuntime';
import { analyzeSmcStrategy, SMC_STRATEGY_ID, type SmcSetup } from './smcStrategy';
import { blockShadowObservationForRecovery, createShadowEvent, type ShadowEvent } from './shadowMode';
import type { SystemHealthSnapshot } from './systemHealth';
import type { TradePlan } from './tradePlan';
import { evaluateDecisionPosture } from './decisionPosture';
import { analyzeVixContext } from './vixContext';

export const AUTONOMOUS_TIMEFRAMES = ['D1', 'H4', 'H1', 'M15', 'M5'] as const;
export type AutonomousRuntimeState = 'READY' | 'DEGRADED' | 'BLOCKED' | 'DISABLED' | 'ERROR';

type SentinelApi = NonNullable<Window['sentinel']>;
export type AutonomousRuntimeApi = Pick<SentinelApi,
  'getWatchlists' | 'getSignalNotifier' | 'getMt5MultiRates' | 'getMt5RatesAfter' | 'getMt5Microstructure'
  | 'getMacroSnapshot' | 'getNewsSnapshot' | 'getMt5Portfolio' | 'listAnalysisHistory'
  | 'getMt5Factors' | 'getInstitutionalFactors' | 'getTradingViewVixContext'
  | 'getTradingViewConfig' | 'getTradingViewMarketObservations'
  | 'getLatestOperationalHealth' | 'refreshOperationalHealth'
  | 'saveAnalysisHistory' | 'listPaperEvents' | 'appendPaperEvents'
  | 'listShadowEvents' | 'appendShadowEvents'
> & {
  saveAutonomousRuntimeHeartbeat?: SentinelApi['saveAutonomousRuntimeHeartbeat'];
  retryPendingSignalDeliveries?: (limit?:number) => Promise<{ok:boolean;status:string;retried:number;sent:number;pending:number;remaining?:number}>;
};

export interface AutonomousSymbolResult {
  symbol:string;
  instrumentId:string;
  brokerSymbol:string | null;
  state:'MONITORING'|'SETUP_CREATED'|'BLOCKED'|'ERROR';
  smcStage:string | null;
  smcScore:number | null;
  anchorTime:string | null;
  analysisRecordId:string | null;
  paperEventsCreated:number;
  shadowEventsCreated:number;
  reasonCodes:string[];
  error:string | null;
}

export interface AutonomousRuntimeReport {
  state:AutonomousRuntimeState;
  checkedAt:string;
  nextIntervalMinutes:number;
  symbols:AutonomousSymbolResult[];
  paperJournalEvents:number;
  shadowJournalEvents:number;
  activePaper:number;
  activeShadow:number;
  deliveryRetries:{attempted:number;sent:number;pending:number} | null;
  reasonCodes:string[];
  errors:string[];
  liveOrderSent:false;
  executionAuthorized:false;
}

interface RuntimeContext {
  notifier:SignalNotifierConfig;
  macro:MacroSnapshot | null;
  news:NewsSnapshot | null;
  portfolio:Mt5PortfolioResponse | null;
  history:AnalysisHistoryRecord[];
  factors:Mt5FactorResponse | null;
  institutional:InstitutionalFactorSnapshot | null;
  vix:ReturnType<typeof analyzeVixContext>;
  tradingViewConfigured:boolean;
  health:SystemHealthSnapshot | null;
}

const nowIso = (now:Date) => now.toISOString();
const activePaper = (events:PaperEvent[]) => reconstructPaperObservations(events).filter(item => item.status === 'PENDING_ENTRY' || item.status === 'OPEN');
const unique = (values:string[]) => [...new Set(values.filter(Boolean))];
const timestamp = (value:string | null | undefined) => Date.parse(value ?? '');
const M5_MS=5*60_000,RECOVERY_PAGE_SIZE=5000,RECOVERY_MAX_PAGES=24;

function forexWeekendGap(previous:number,current:number){
  const start=new Date(previous),end=new Date(current),gap=current-previous;
  if(gap>80*60*60_000||start.getUTCDay()!==5||start.getUTCHours()<19)return false;
  const endDay=end.getUTCDay();
  return endDay===6||endDay===0||(endDay===1&&end.getUTCHours()<3);
}

function forexWeekendStillClosed(previous:number,current:number){
  const start=new Date(previous),end=new Date(current),gap=current-previous;
  return gap>0&&gap<=80*60*60_000&&start.getUTCDay()===5&&start.getUTCHours()>=19
    &&(end.getUTCDay()===6||(end.getUTCDay()===0&&end.getUTCHours()<20));
}

export function recoveryGapPermitted(previous:number,current:number,market:MarketClass){
  const gap=current-previous;
  if(!Number.isFinite(gap)||gap<=0)return false;
  if(gap===M5_MS)return true;
  if(market==='FOREX')return forexWeekendGap(previous,current);
  return false;
}

function noBarWaitPermitted(cursor:number,now:number,market:MarketClass){
  // `cursor` is the open time of the latest closed M5 candle. The next candle
  // is not expected to be closed until two M5 intervals after that cursor.
  if(now<cursor+2*M5_MS)return true;
  return market==='FOREX'&&forexWeekendStillClosed(cursor,now);
}

function validRecoveryCandle(bar:Mt5Candle){
  const prices=[bar.open,bar.high,bar.low,bar.close];
  return prices.every(Number.isFinite)&&bar.low<=Math.min(bar.open,bar.close)&&bar.high>=Math.max(bar.open,bar.close)
    &&bar.low<=bar.high&&Number.isSafeInteger(bar.tickVolume)&&bar.tickVolume>=0
    &&Number.isSafeInteger(bar.spread)&&bar.spread>=0&&Number.isSafeInteger(bar.realVolume)&&bar.realVolume>=0;
}

export interface RuntimeRecoveryBars {ok:boolean;bars:Mt5Candle[];pages:number;reasonCode:string|null;}
export async function loadRuntimeRecoveryBars(
  api:Pick<AutonomousRuntimeApi,'getMt5RatesAfter'>,
  input:{symbol:string;cursor:string;market:MarketClass;now:string},
):Promise<RuntimeRecoveryBars>{
  const initialCursor=timestamp(input.cursor),now=timestamp(input.now);
  if(!Number.isFinite(initialCursor)||!Number.isFinite(now)||initialCursor>=now)return{ok:false,bars:[],pages:0,reasonCode:'RECOVERY_CURSOR_INVALID'};
  let cursor=initialCursor,after=new Date(initialCursor).toISOString();
  const bars:Mt5Candle[]=[];
  for(let page=1;page<=RECOVERY_MAX_PAGES;page++){
    let response:Mt5RatesAfterResponse;
    try{response=await api.getMt5RatesAfter(input.symbol,'M5',after,RECOVERY_PAGE_SIZE,input.now)}
    catch{return{ok:false,bars:[],pages:page,reasonCode:'RECOVERY_BACKFILL_UNAVAILABLE'}}
    const responseAfter=timestamp(response?.after),queryUntil=timestamp(response?.queryUntil),clockMeasuredAt=timestamp(response?.clock?.measuredAt);
    const safeContract=response?.ok===true&&Array.isArray(response.candles)&&clockVerified(response.clock)
      &&response.timeframe==='M5'&&String(response.symbol||'').toUpperCase()===input.symbol.toUpperCase()
      &&response.permissions==='read-only'&&typeof response.hasMore==='boolean'
      &&Number.isFinite(responseAfter)&&responseAfter===cursor&&Number.isFinite(queryUntil)&&queryUntil>=cursor
      &&Number.isFinite(clockMeasuredAt)&&Math.abs(now-clockMeasuredAt)<=10*60_000
      &&Number.isInteger(response.pageLimit)&&Number(response.pageLimit)>0
      &&response.liveOrderSent===false&&response.executionAuthorized===false;
    if(!safeContract)return{ok:false,bars:[],pages:page,reasonCode:'RECOVERY_BACKFILL_UNVERIFIED'};
    const pageBars=response.candles??[];
    if(pageBars.length>Math.min(RECOVERY_PAGE_SIZE,Number(response.pageLimit)))return{ok:false,bars:[],pages:page,reasonCode:'RECOVERY_BACKFILL_UNVERIFIED'};
    for(const bar of pageBars){
      const current=timestamp(bar.time);
      if(!validRecoveryCandle(bar)||!Number.isFinite(current)||current<=cursor||current+M5_MS>now||current>queryUntil||!recoveryGapPermitted(cursor,current,input.market))return{ok:false,bars:[],pages:page,reasonCode:'RECOVERY_GAP'};
      bars.push(bar);cursor=current;
    }
    if(response.hasMore!==true){
      if(queryUntil<now||!noBarWaitPermitted(cursor,now,input.market))return{ok:false,bars:[],pages:page,reasonCode:'RECOVERY_GAP'};
      return{ok:true,bars,pages:page,reasonCode:null};
    }
    if(!pageBars.length)return{ok:false,bars:[],pages:page,reasonCode:'RECOVERY_EMPTY_PAGE'};
    after=new Date(cursor).toISOString();
  }
  return{ok:false,bars:[],pages:RECOVERY_MAX_PAGES,reasonCode:'RECOVERY_PAGE_LIMIT'};
}

export function configuredWatchlistSymbols(config:WatchlistConfig):string[] {
  return unique(config.lists.filter(list => list.enabled).flatMap(list => list.symbols.map(symbol => symbol.trim().toUpperCase())));
}

export function runtimeExecutionProfile(market:MarketClass):ExecutionCostProfile {
  if (market === 'FOREX') return {id:'RUNTIME_FOREX_CONSERVATIVE_V1',spreadPrice:.00012,slippagePrice:.00003,commissionRoundTripPrice:0,latencyMs:250,conservativeSameBar:true};
  if (market === 'CRYPTO') return {id:'RUNTIME_BTC_CONSERVATIVE_V1',spreadPrice:10,slippagePrice:2.5,commissionRoundTripPrice:0,latencyMs:500,conservativeSameBar:true};
  if (market === 'METAL') return {id:'RUNTIME_METAL_CONSERVATIVE_V1',spreadPrice:.3,slippagePrice:.05,commissionRoundTripPrice:0,latencyMs:350,conservativeSameBar:true};
  return {id:'RUNTIME_GENERIC_CONSERVATIVE_V1',spreadPrice:.01,slippagePrice:.005,commissionRoundTripPrice:0,latencyMs:500,conservativeSameBar:true};
}

function quantStatus(governance:ModelGovernance):SentinelDecision['quantStatus'] {
  if (governance.status === 'ACTIVE') return 'ELIGIBLE';
  if (governance.status === 'PROBATION') return 'PROBATION';
  if (governance.status === 'SUSPENDED') return 'BLOCKED';
  return 'RESEARCH';
}

function smcTradePlan(setup:SmcSetup):TradePlan {
  const active=setup.stage==='READY'&&setup.direction!=null&&setup.entry!=null&&setup.stop!=null&&setup.target!=null;
  if(!active)return{active:false,direction:null,trigger:null,maxEntry:null,stop:null,tp1:null,tp2:null,riskReward1:null,riskReward2:null,atr:null,expiresAfterBars:0,cancellation:[setup.steps.find(step=>!step.confirmed)?.summary??'SMC incompleto.']};
  const entry=setup.entry!,stop=setup.stop!,target=setup.target!,direction=setup.direction!,risk=Math.abs(entry-stop),sign=direction==='BUY'?1:-1;
  return{active:true,direction,trigger:entry,maxEntry:entry+sign*risk*.15,stop,tp1:entry+sign*risk*1.5,tp2:target,riskReward1:1.5,riskReward2:setup.riskReward,atr:null,expiresAfterBars:3,cancellation:['Cancelar si la estructura SMC queda invalidada antes de la entrada.']};
}

function smcDecisionResult(setup:SmcSetup, guarded:DecisionResult):DecisionResult {
  if (guarded.decision === 'NO_OPERAR_EVENTO' || setup.stage !== 'READY' || setup.direction == null) return guarded;
  return {
    ...guarded,
    decision:setup.direction === 'BUY' ? 'BUY_CONDICIONADO' : 'SELL_CONDICIONADO',
    confidence:Math.max(guarded.confidence, setup.score),
    technicalConfidence:Math.max(guarded.technicalConfidence, setup.score),
    reasons:unique([...setup.reasons, ...guarded.reasons]),
  };
}

function buildRuntimeDecision(input:{
  setup:SmcSetup; instrumentId:string; anchorTime:string; governance:ModelGovernance;
  riskAcceptable:boolean; reasonCodes:string[];
}):SentinelDecision {
  const smcStatus:SentinelDecision['smcStatus']=input.setup.stage==='READY'?'SMC_VALID':input.setup.direction?'SMC_CANDIDATE':'NO_SETUP';
  const decision:SentinelDecision={
    schemaVersion:1,
    setupId:`${SMC_STRATEGY_ID}:${input.instrumentId}:${input.anchorTime}`,
    instrumentId:input.instrumentId,
    timestamp:input.anchorTime,
    smcStatus,
    quantStatus:quantStatus(input.governance),
    riskStatus:input.riskAcceptable?'ACCEPTABLE':'BLOCKED',
    executionStatus:'ANALYSIS_ONLY',
    direction:input.setup.direction==='BUY'?'LONG':input.setup.direction==='SELL'?'SHORT':null,
    entry:input.setup.entry,
    stop:input.setup.stop,
    target:input.setup.target,
    plannedRR:input.setup.riskReward,
    quantMetrics:{sample:input.governance.sample,averageR:input.governance.recentAverageR,brierScore:input.governance.brierScore},
    reasonCodes:unique([...input.setup.warnings,...input.reasonCodes,`QUANT_${quantStatus(input.governance)}`,'EXECUTION_LIVE_DISABLED']),
    versions:SENTINEL_QUANT_VERSIONS,
    finalStatus:'NO_SETUP',
  };
  decision.finalStatus=deriveFinalStatus(decision);
  return decision;
}

function clockVerified(clock:Mt5ClockInfo | null | undefined) {
  return Boolean(clock && ['UTC_CONFIRMED','BROKER_CLOCK_CORRECTED'].includes(clock.status) && clock.sampleCount > 0);
}

function relativeSpreadBps(frame:Mt5RatesResponse):number | null {
  const bid=frame.tick?.bid,ask=frame.tick?.ask;
  if(!Number.isFinite(bid)||!Number.isFinite(ask)||Number(bid)<=0||Number(ask)<Number(bid))return null;
  return (Number(ask)-Number(bid))/((Number(ask)+Number(bid))/2)*10_000;
}

function tradingViewDivergenceBps(frame:Mt5RatesResponse, response:TradingViewMarketObservationResponse | null, now:Date):number | null {
  const observation=response?.ok?[...response.observations].sort((a,b)=>timestamp(a.observedAt)-timestamp(b.observedAt)).at(-1):null,mt5=frame.candles?.at(-1)?.close;
  if(!observation||!Number.isFinite(mt5)||Number(mt5)<=0||now.getTime()-timestamp(observation.observedAt)>30*60_000)return null;
  return Math.abs(observation.close-Number(mt5))/Number(mt5)*10_000;
}

export class AutonomousRuntimeEngine {
  private paperEvents:PaperEvent[]=[];
  private shadowEvents:ShadowEvent[]=[];
  private recovered=false;
  private busy=false;

  constructor(
    private readonly api:AutonomousRuntimeApi,
    private readonly controls:()=>KillSwitchState,
    private readonly clock:()=>Date=()=>new Date(),
  ) {}

  async recover() {
    if(this.recovered)return;
    const [paper,shadow]=await Promise.all([this.api.listPaperEvents(),this.api.listShadowEvents()]);
    this.paperEvents=paper.events??[];
    this.shadowEvents=shadow.events??[];
    reconstructPaperObservations(this.paperEvents);
    recoverActiveShadowObservations(this.shadowEvents);
    this.recovered=true;
  }

  private async context(notifier:SignalNotifierConfig):Promise<RuntimeContext> {
    const [macro,news,portfolio,history,factors,institutional,vixResponse,tradingView,latestHealth]=await Promise.all([
      this.api.getMacroSnapshot().catch(()=>null),
      this.api.getNewsSnapshot().catch(()=>null),
      this.api.getMt5Portfolio().catch(()=>null),
      this.api.listAnalysisHistory().catch(()=>({ok:false,records:[]})),
      this.api.getMt5Factors().catch(()=>null),
      this.api.getInstitutionalFactors().catch(()=>null),
      this.api.getTradingViewVixContext?.(false).catch(()=>null)??Promise.resolve(null),
      this.api.getTradingViewConfig().catch(()=>null),
      this.api.getLatestOperationalHealth().catch(()=>({ok:false,snapshot:null})),
    ]);
    let health=latestHealth?.snapshot??null;
    const healthAge=this.clock().getTime()-Date.parse(health?.timestamp??'');
    if(!health||!Number.isFinite(healthAge)||healthAge>5*60_000)health=(await this.api.refreshOperationalHealth().catch(()=>({ok:false,snapshot:null as never}))).snapshot??null;
    return{notifier,macro,news,portfolio,history:history.records??[],factors,institutional,vix:analyzeVixContext(vixResponse?.history??[]),tradingViewConfigured:Boolean(tradingView?.config.enabled),health};
  }

  private feedHealth(context:RuntimeContext, tradingViewReady:boolean, at:string):Record<string,ShadowFeedHealth> {
    const mt5=context.health?.components.find(component=>component.id==='MT5');
    return{
      MT5:{status:mt5?.status==='HEALTHY'?'HEALTHY':mt5?.status==='DEGRADED'?'DEGRADED':'OFFLINE',observedAt:at},
      TRADINGVIEW:{status:tradingViewReady?'ONLINE':context.tradingViewConfigured?'DEGRADED':'OFFLINE',observedAt:at},
    };
  }

  private async processExisting(
    brokerSymbol:string,
    instrumentId:string,
    market:MarketClass,
    context:RuntimeContext,
    tradingViewReady:boolean,
    processedAt:string,
  ) {
    const profile=runtimeExecutionProfile(market),feedHealth=this.feedHealth(context,tradingViewReady,processedAt);
    let paperCreated=0,shadowCreated=0;
    let observations=activePaper(this.paperEvents).filter(item=>item.decision.instrumentId===instrumentId);
    const shadowObservations=recoverActiveShadowObservations(this.shadowEvents).filter(item=>item.decision.instrumentId===instrumentId);
    const cursors=[...observations.map(item=>item.lastProcessedBarTime??item.decision.timestamp),...shadowObservations.map(item=>item.lastProcessedBarTime??item.decision.timestamp)].map(timestamp).filter(Number.isFinite);
    if(!cursors.length)return{paperCreated,shadowCreated,recoveryReason:null as string|null};
    const earliestCursor=Math.min(...cursors);
    const recovery=await loadRuntimeRecoveryBars(this.api,{symbol:brokerSymbol,cursor:new Date(earliestCursor).toISOString(),market,now:processedAt});
    if(!recovery.ok){
      const paperBlocked=observations.map(item=>createPaperEvent('RECOVERY_BLOCKED',blockPaperObservationForRecovery(item),processedAt));
      const shadowBlocked=shadowObservations.map(item=>createShadowEvent('RECOVERY_BLOCKED',blockShadowObservationForRecovery(item),processedAt));
      if(paperBlocked.length){const saved=await this.api.appendPaperEvents(paperBlocked);paperCreated+=saved.created;this.paperEvents.push(...paperBlocked)}
      if(shadowBlocked.length){const saved=await this.api.appendShadowEvents(shadowBlocked);shadowCreated+=saved.created;this.shadowEvents.push(...shadowBlocked)}
      return{paperCreated,shadowCreated,recoveryReason:recovery.reasonCode??'RECOVERY_GAP'};
    }
    for(const bar of recovery.bars){
      const matching=observations.filter(item=>timestamp(bar.time)>timestamp(item.lastProcessedBarTime??item.decision.timestamp));
      const emitted:PaperEvent[]=[];
      for(const observation of matching){
        const next=advancePaperObservation(observation,bar,profile);
        if(next.lastProcessedBarTime!==observation.lastProcessedBarTime)emitted.push(createPaperEvent('BAR_PROCESSED',next,processedAt));
      }
      if(emitted.length){const saved=await this.api.appendPaperEvents(emitted);paperCreated+=saved.created;this.paperEvents.push(...emitted);observations=activePaper(this.paperEvents).filter(item=>item.decision.instrumentId===instrumentId);}

      const classification=classifyMarket(instrumentId),event=normalizeMarketDataEvent({
        eventId:`MT5:${instrumentId}:M5:${bar.time}`,
        dedupeKey:`MT5:${instrumentId}:M5:${bar.time}`,
        source:'MT5',sourceRole:'PRIMARY_MARKET_FEED',instrumentId,symbol:classification.symbol,
        assetClass:market,timeframe:'M5',eventType:'BAR',sourceTimestamp:bar.time,
        receivedTimestamp:processedAt,processingTimestamp:processedAt,providerTimestamp:null,exchangeTimestamp:null,brokerTimestamp:bar.time,
        price:bar.close,bid:null,ask:null,
        bar:{open:bar.open,high:bar.high,low:bar.low,close:bar.close,tickVolume:bar.tickVolume,realVolume:bar.realVolume,closed:true},
        contract:null,metadata:{permissions:'READ_ONLY',liveOrderSent:false,barClosedAt:new Date(Date.parse(bar.time)+300_000).toISOString()},
      });
      const shadow=processShadowMarketEvent(this.shadowEvents,event,profile,feedHealth);
      if(shadow.events.length){const saved=await this.api.appendShadowEvents(shadow.events);shadowCreated+=saved.created;this.shadowEvents.push(...shadow.events);}
    }
    return{paperCreated,shadowCreated,recoveryReason:null as string|null};
  }

  private async analyzeSymbol(symbol:string,context:RuntimeContext,now:Date):Promise<AutonomousSymbolResult> {
    const result:AutonomousSymbolResult={symbol,instrumentId:classifyMarket(symbol).canonicalId,brokerSymbol:null,state:'MONITORING',smcStage:null,smcScore:null,anchorTime:null,analysisRecordId:null,paperEventsCreated:0,shadowEventsCreated:0,reasonCodes:[],error:null};
    try{
      const [rates,micro,tv]=await Promise.all([
        this.api.getMt5MultiRates(symbol,[...AUTONOMOUS_TIMEFRAMES],350),
        this.api.getMt5Microstructure(symbol).catch(()=>null),
        context.tradingViewConfigured?this.api.getTradingViewMarketObservations(symbol,'M5',5).catch(()=>null):Promise.resolve(null),
      ]);
      if(!rates.ok)throw new Error(`${symbol}: MT5 no entregó la serie multitemporal requerida.`);
      const m5=rates.results.M5;
      if(!m5?.ok||!m5.candles?.length)throw new Error(`${symbol}: MT5 no entregó velas M5 cerradas.`);
      const metadata=m5.instrument?{...m5.instrument,sector:m5.instrument.sector==null?null:String(m5.instrument.sector),industry:m5.instrument.industry==null?null:String(m5.instrument.industry)}:undefined;
      const classification=classifyMarket({symbol:m5.canonical??symbol,brokerMetadata:metadata});
      result.instrumentId=classification.canonicalId;result.brokerSymbol=m5.symbol??null;
      const frames=Object.fromEntries(AUTONOMOUS_TIMEFRAMES.map(tf=>[tf,rates.results[tf]?.candles??[]]));
      const setup=analyzeSmcStrategy(frames),anchor=m5.candles.at(-1)!.time;
      result.smcStage=setup.stage;result.smcScore=setup.score;result.anchorTime=anchor;
      const tradingViewReady=Boolean(tv?.ok&&tv.observations.length),processedAt=nowIso(now);
      const progressed=await this.processExisting(m5.symbol??symbol,result.instrumentId,classification.market,context,tradingViewReady,processedAt);
      result.paperEventsCreated+=progressed.paperCreated;result.shadowEventsCreated+=progressed.shadowCreated;

      const quality=assessDatasetQuality(rates.results),technical=analyzeMultiTimeframe(rates.results);
      const factorAnalysis=context.factors?.ok?analyzeIntermarket(symbol,context.factors):undefined;
      const institutional=assessInstitutionalFactorRisk(symbol,context.institutional);
      const microAnalysis=analyzeMicrostructure(micro);
      const guarded=buildGuardedDecision(symbol,technical,context.macro?.events??[],now,context.news?rankNews(context.news):[],factorAnalysis,institutional,microAnalysis,context.vix);
      const analytical=smcDecisionResult(setup,guarded),plan=smcTradePlan(setup),governance=evaluateModelGovernance(context.history);
      const freshness=assessTickFreshness(m5.tick?.time,now,classification.market==='CRYPTO'?10:30);
      const spreadBps=relativeSpreadBps(m5),tvDivergence=tradingViewDivergenceBps(m5,tv,now);
      const marketDataInconsistent=!quality.valid||(tvDivergence!=null&&tvDivergence>(classification.market==='CRYPTO'?200:50));
      const spreadExtreme=spreadBps!=null&&spreadBps>(classification.market==='CRYPTO'?50:20);
      const verifiedClock=clockVerified(rates.clock),clockDriftMs=verifiedClock?0:Math.max(2_001,Math.abs(rates.clock?.offsetSeconds??0)*1000);
      const circuit=evaluateCircuitBreakers({timestamp:processedAt,marketDataStale:!freshness.fresh,spreadExtreme,marketDataInconsistent,quantHealthy:true,riskHealthy:context.portfolio?.ok===true,executionHealthy:true,clockDriftMs,maxClockDriftMs:2_000});
      const safety=evaluateOperationalSafety({systemHealth:context.health,circuitBreaker:circuit,killSwitch:this.controls()});
      const portfolio=applyPortfolioGate(analytical,context.portfolio,symbol,context.notifier.riskPercent);
      const riskAcceptable=setup.stage==='READY'&&guarded.decision!=='NO_OPERAR_EVENTO'&&portfolio.action!=='BLOQUEAR'&&!safety.blockNewOpportunities&&progressed.recoveryReason==null;
      const reasonCodes=unique([
        ...(progressed.recoveryReason?['RECOVERY_GAP',progressed.recoveryReason,'RECOVERY_GAP_NO_PERFORMANCE']:[]),
        ...circuit.reasonCodes,
        ...safety.reasonCodes,
        ...(!verifiedClock?['BROKER_CLOCK_UNVERIFIED']:[]),
        ...(tvDivergence!=null&&marketDataInconsistent?['TRADINGVIEW_MT5_PRICE_DIVERGENCE']:[]),
        ...(portfolio.action==='BLOQUEAR'?['PORTFOLIO_RISK_BLOCKED']:[]),
      ]);
      result.reasonCodes=reasonCodes;
      const posture=evaluateDecisionPosture({decision:analytical,governance,plan,dataQualityValid:quality.valid,tickFresh:freshness.fresh,technicalReady:setup.stage==='READY',operationalMarketReady:classification.market!=='UNKNOWN',additionalBlockers:riskAcceptable?[]:reasonCodes.length?reasonCodes:['RUNTIME_RISK_BLOCKED']});
      const saved=await this.api.saveAnalysisHistory(buildAnalysisHistoryDraft({symbol,brokerSymbol:m5.symbol??symbol,timeframe:'M5',anchorTime:anchor,decision:analytical,posture,technical,plan,quality,strategy:SMC_STRATEGY_ID,checkedAt:processedAt,sources:unique([m5.source??'MT5',tradingViewReady?'TradingView / Cloudflare':'',...(context.macro?.indicators.map(item=>item.source)??[]),...(context.news?.articles.map(item=>item.source)??[])])}));
      result.analysisRecordId=saved.record.id;

      const decision=buildRuntimeDecision({setup,instrumentId:result.instrumentId,anchorTime:anchor,governance,riskAcceptable,reasonCodes});
      const existingPaper=new Set(this.paperEvents.map(event=>event.paperId)),existingShadow=new Set(this.shadowEvents.map(event=>event.shadowId));
      const profile=runtimeExecutionProfile(classification.market),paper=createPaperObservation(decision,profile,processedAt),shadow=startShadowDecision(decision,processedAt,this.feedHealth(context,tradingViewReady,processedAt));
      if(!existingPaper.has(paper.paperId)){const event=createPaperEvent('CREATED',paper,processedAt),stored=await this.api.appendPaperEvents([event]);result.paperEventsCreated+=stored.created;this.paperEvents.push(event);}
      if(!existingShadow.has(shadow.shadowId)){const stored=await this.api.appendShadowEvents([shadow]);result.shadowEventsCreated+=stored.created;this.shadowEvents.push(shadow);}
      result.state=setup.stage!=='READY'?'MONITORING':riskAcceptable?'SETUP_CREATED':'BLOCKED';
      return result;
    }catch(error){result.state='ERROR';result.error=error instanceof Error?error.message:`${symbol}: error operativo desconocido.`;return result;}
  }

  private async executeConfiguredCycle():Promise<AutonomousRuntimeReport> {
    const checkedAt=nowIso(this.clock());
    try{
      await this.recover();
      const [watchlists,notifier]=await Promise.all([this.api.getWatchlists(),this.api.getSignalNotifier()]);
      const symbols=configuredWatchlistSymbols(watchlists.config),nextIntervalMinutes=Math.max(1,watchlists.config.intervalMinutes);
      if(!symbols.length)return{state:'DISABLED',checkedAt,nextIntervalMinutes,symbols:[],paperJournalEvents:this.paperEvents.length,shadowJournalEvents:this.shadowEvents.length,activePaper:activePaper(this.paperEvents).length,activeShadow:recoverActiveShadowObservations(this.shadowEvents).length,deliveryRetries:null,reasonCodes:['WATCHLIST_EMPTY'],errors:[],liveOrderSent:false,executionAuthorized:false};
      const context=await this.context(notifier.config),deliveryRetries=await this.api.retryPendingSignalDeliveries?.(10).catch(()=>null)??null;
      const results:AutonomousSymbolResult[]=[];
      // Journal state is shared and append-only. Serial processing prevents two
      // aliases of the same instrument from racing and inflating heartbeat counts.
      for(const symbol of symbols)results.push(await this.analyzeSymbol(symbol,context,this.clock()));
      const errors=results.flatMap(item=>item.error?[item.error]:[]),blocked=results.filter(item=>item.state==='BLOCKED').length;
      const state:AutonomousRuntimeState=errors.length?'DEGRADED':blocked===results.length?'BLOCKED':'READY';
      return{state,checkedAt:nowIso(this.clock()),nextIntervalMinutes,symbols:results,paperJournalEvents:this.paperEvents.length,shadowJournalEvents:this.shadowEvents.length,activePaper:activePaper(this.paperEvents).length,activeShadow:recoverActiveShadowObservations(this.shadowEvents).length,deliveryRetries:deliveryRetries?{attempted:deliveryRetries.retried,sent:deliveryRetries.sent,pending:deliveryRetries.pending}:null,reasonCodes:unique(results.flatMap(item=>item.reasonCodes)),errors,liveOrderSent:false,executionAuthorized:false};
    }catch(error){const message=error instanceof Error?error.message:'Falló el runtime autónomo.';return{state:'ERROR',checkedAt:nowIso(this.clock()),nextIntervalMinutes:2,symbols:[],paperJournalEvents:this.paperEvents.length,shadowJournalEvents:this.shadowEvents.length,activePaper:activePaper(this.paperEvents).length,activeShadow:recoverActiveShadowObservations(this.shadowEvents).length,deliveryRetries:null,reasonCodes:['AUTONOMOUS_RUNTIME_ERROR'],errors:[message],liveOrderSent:false,executionAuthorized:false};}
  }

  private async persistHeartbeat(report:AutonomousRuntimeReport):Promise<AutonomousRuntimeReport>{
    if(!this.api.saveAutonomousRuntimeHeartbeat)return report;
    try{
      const saved=await this.api.saveAutonomousRuntimeHeartbeat(report),heartbeat=saved?.heartbeat;
      if(saved?.ok!==true||heartbeat?.liveOrderSent!==false||heartbeat?.executionAuthorized!==false
        ||heartbeat.state!==report.state||timestamp(heartbeat.checkedAt)!==timestamp(report.checkedAt)
        ||heartbeat.paperJournalEvents!==report.paperJournalEvents||heartbeat.shadowJournalEvents!==report.shadowJournalEvents
        ||heartbeat.activePaper!==report.activePaper||heartbeat.activeShadow!==report.activeShadow)throw new Error('La persistencia devolvió un heartbeat inconsistente o inseguro.');
      return report;
    }catch(error){
      return{...report,state:report.state==='ERROR'?'ERROR':'DEGRADED',reasonCodes:unique([...report.reasonCodes,'AUTONOMOUS_HEARTBEAT_PERSIST_FAILED']),errors:[...report.errors,error instanceof Error?error.message:'No se pudo persistir el heartbeat autónomo.'],liveOrderSent:false,executionAuthorized:false};
    }
  }

  async runConfiguredCycle():Promise<AutonomousRuntimeReport> {
    if(this.busy)throw new Error('El ciclo autónomo anterior todavía está en ejecución.');
    this.busy=true;
    try{return await this.persistHeartbeat(await this.executeConfiguredCycle())}
    finally{this.busy=false;}
  }
}
