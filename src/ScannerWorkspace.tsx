import { useMemo, useState } from "react";
import { Activity, Database, RefreshCw, ShieldCheck } from "lucide-react";
import { ALL_TIMEFRAMES, analyzeMultiTimeframe } from "./multiTimeframeAnalysis";
import { buildGuardedDecision, type DecisionResult } from "./decisionEngine";
import { rankNews } from "./newsIntelligence";
import { applyPortfolioGate } from "./portfolioGate";
import { evaluateModelGovernance } from "./modelGovernance";
import { assessDatasetQuality } from "./dataQuality";
import { analyzeIntermarket } from "./intermarketEngine";
import { assessInstitutionalFactorRisk } from "./institutionalFactorRisk";
import { analyzeMicrostructure } from "./microstructureEngine";
import { analyzeVixContext } from "./vixContext";
import type { MarketClass } from "./marketArchitecture";
import {
  classifyScannerCandidates,
  SCANNER_MARKET_LABELS,
  selectDiverseMarketCandidates,
} from "./scannerMarketSelection";
import { resolveMarketUiContext, verifiedProviderObservation } from "./marketUiContext";
import { buildTradePlan } from "./tradePlan";
import { assessTickFreshness } from "./dataFreshness";
import { evaluateDecisionPosture, type DecisionPosture } from "./decisionPosture";
import { buildAnalysisHistoryDraft } from "./analysisHistoryRecord";
import { assessAtomic } from "./atomicConsensus";

interface DeepResult {
  symbol: string;
  market: MarketClass;
  decision: DecisionResult;
  posture: DecisionPosture;
  alignment: number;
  coverage: number;
  bias: string;
  marketCoverage: string;
}

export default function ScannerWorkspace({ onAnalyze }:{ onAnalyze:(symbol:string)=>void }) {
  const [result,setResult]=useState<Mt5ScanResponse|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [deep,setDeep]=useState<DeepResult[]>([]);
  const [deepLoading,setDeepLoading]=useState(false);
  const classifiedCandidates=useMemo(
    ()=>classifyScannerCandidates(result?.candidates??[]),
    [result],
  );

  const scan=async()=>{
    if(!window.sentinel?.scanMt5Market){setError("El escáner requiere la aplicación de escritorio.");return;}
    setLoading(true);setError("");
    try{
      const next=await window.sentinel.scanMt5Market(300,true);
      if(!next.ok)throw new Error(next.error||"Escaneo incompleto");
      setResult(next);setDeep([]);
    }
    catch(e){setError(e instanceof Error?e.message:"No fue posible escanear MT5.");}
    finally{setLoading(false);}
  };

  const runDeep=async()=>{
    if(!result||!window.sentinel?.getMt5MultiRates||!window.sentinel?.getMacroSnapshot)return;
    const eligible=classifiedCandidates.filter(({candidate})=>candidate.marketStatus==='ACTIVO'&&candidate.direction!=='ESPERAR');
    const selected=selectDiverseMarketCandidates(eligible,5);
    if(!selected.length){setError("No hay candidatos con cotización activa. Sentinel no profundizará datos atrasados.");return;}
    setDeepLoading(true);setError("");
    try{
      const [macro,news,portfolio,history,atomic,factors,institutional,vixResponse]=await Promise.all([
        window.sentinel.getMacroSnapshot(),
        window.sentinel.getNewsSnapshot?.().catch(()=>null),
        window.sentinel.getMt5Portfolio?.().catch(()=>null),
        window.sentinel.listAnalysisHistory(),
        window.sentinel.getAtomicMt5().catch(()=>null),
        window.sentinel.getMt5Factors?.().catch(()=>null),
        window.sentinel.getInstitutionalFactors?.().catch(()=>null),
        window.sentinel.getTradingViewVixContext?.(false).catch(()=>null)??Promise.resolve(null),
      ]);
      const completed:DeepResult[]=[];
      const governance=evaluateModelGovernance(history.records);
      const vixContext=analyzeVixContext(vixResponse?.history??[]);
      for(const {candidate} of selected){
        const rates=await window.sentinel.getMt5MultiRates(candidate.symbol,[...ALL_TIMEFRAMES],350);
        if(!rates.ok)continue;
        const quality=assessDatasetQuality(rates.results);
        if(!quality.valid)continue;
        const technical=analyzeMultiTimeframe(rates.results);
        const visual=rates.results.H1??Object.values(rates.results).find(item=>item.ok);
        if(!visual?.candles)continue;
        const marketResolution=resolveMarketUiContext(
          candidate.symbol,
          visual.timeframe??'H1',
          visual,
          {
            tradingViewConfigured:['READY','CACHED'].includes(vixResponse?.status??''),
            observations:vixContext.usableAsContext
              ? [verifiedProviderObservation('tradingview',['CONTEXT'],vixContext.currentObservedAt)]
              : [],
          },
        );
        const intermarket=factors?.ok?analyzeIntermarket(candidate.symbol,factors):undefined;
        const institutionalRisk=assessInstitutionalFactorRisk(candidate.symbol,institutional);
        const micro=analyzeMicrostructure(await window.sentinel.getMt5Microstructure?.(candidate.symbol).catch(()=>null)??null);
        const guarded=buildGuardedDecision(candidate.symbol,technical,macro.events,new Date(),news?rankNews(news):[],intermarket,institutionalRisk,micro,vixContext);
        const atomicAssessment=assessAtomic(atomic,candidate.symbol,visual.timeframe??'H1',guarded);
        const portfolioGate=applyPortfolioGate(guarded,portfolio,candidate.symbol,.5);
        const freshness=assessTickFreshness(visual.tick?.time);
        const plan=buildTradePlan(visual.candles,guarded);
        const posture=evaluateDecisionPosture({
          decision:guarded,
          governance,
          plan,
          dataQualityValid:quality.valid,
          tickFresh:freshness.fresh,
          technicalReady:marketResolution.context.readyForTechnicalAnalysis,
          operationalMarketReady:marketResolution.route.readyForOperationalAnalysis,
          additionalBlockers:[
            ...(atomicAssessment.advisoryDecision==='ESPERAR'?[atomicAssessment.reason]:[]),
            ...(portfolioGate.action==='BLOQUEAR'?portfolioGate.reasons:[]),
          ],
        });
        if(window.sentinel.saveAnalysisHistory)await window.sentinel.saveAnalysisHistory(buildAnalysisHistoryDraft({
          symbol:candidate.symbol,
          brokerSymbol:visual.symbol??candidate.symbol,
          timeframe:visual.timeframe??'H1',
          anchorTime:visual.candles.at(-1)?.time??null,
          decision:guarded,
          posture,
          technical,
          plan,
          quality,
          marketRoute:marketResolution.routeSnapshot,
          sources:[
            visual.source??'MT5',
            ...(macro.indicators?.map(item=>item.source)??[]),
            ...(macro.events?.map(item=>item.source)??[]),
            ...(news?.articles?.map(item=>item.source)??[]),
            ...(atomic?.ok?['Atomic Analyst MT5']:[]),
            ...(vixContext.usableAsContext?['TradingView / Cboe VIX']:[]),
          ],
        })).catch(()=>null);
        completed.push({
          symbol:candidate.symbol,
          market:marketResolution.classification.market,
          decision:guarded,
          posture,
          alignment:technical.alignment,
          coverage:technical.available,
          bias:technical.bias,
          marketCoverage:marketResolution.route.coverage.status,
        });
      }
      setDeep(completed.sort((a,b)=>b.decision.confidence-a.decision.confidence));
    }catch(e){setError(e instanceof Error?e.message:"Falló el análisis profundo.");}
    finally{setDeepLoading(false);}
  };

  return <div className="scanner-page">
    <div className="analysis-page-head"><div><p className="eyebrow">PREFILTRO MULTI-ACTIVO</p><h1>Escáner global</h1><p>Clasifica el catálogo de tu bróker por mercado en H1/H4 y reserva las 21 temporalidades para el análisis profundo.</p></div><span className="readonly-badge"><ShieldCheck size={15}/> SOLO LECTURA</span></div>
    <div className="card scanner-control"><div><Database size={18}/><span>{result?`${result.scanned} instrumentos revisados · ${result.qualified} con datos suficientes`:"Listo para consultar el catálogo real de MT5"}</span></div><div className="scanner-actions">{result?<button className="text-btn" onClick={runDeep} disabled={deepLoading}>{deepLoading?"Analizando 21 marcos...":"Profundizar mejores 5 multimercado"}</button>:null}<button className="primary" onClick={scan} disabled={loading}><RefreshCw size={16}/>{loading?" Escaneando...":" Iniciar escaneo"}</button></div></div>
    {error?<div className="connector-message error">{error}</div>:null}
    {result?<div className="card scanner-results"><div className="scanner-head"><span>ACTIVO / MERCADO</span><span>SESGO</span><span>PUNTUACIÓN</span><span>H1 / H4</span><span>ESTADO</span><span></span></div>{classifiedCandidates.map(({candidate:item,classification})=><div className="scanner-row" key={item.symbol}><div><b>{item.symbol}</b><small title={classification.warnings.join(' ')}>{SCANNER_MARKET_LABELS[classification.market]} · {item.description||item.path}</small></div><span className={`decision ${item.direction==='BUY'?'buy':item.direction==='SELL'?'sell':'wait'}`}>{item.direction}</span><b>{item.score}/100</b><span>{item.h1.slopePct.toFixed(2)}% / {item.h4.slopePct.toFixed(2)}%</span><span title={`Último tick hace ${item.tickAgeMinutes} min`}>{item.marketStatus}</span><button className="text-btn" onClick={()=>onAnalyze(item.symbol)}><Activity size={15}/> Profundizar</button></div>)}</div>:null}
    {result?<p className="scanner-note">Este resultado es un prefiltro, no una entrada. La selección profunda prioriza mercados distintos; cada candidato todavía debe superar análisis multi-temporal, macro, noticias, Atomic y riesgo.</p>:null}
    {deep.length?<div className="card deep-results"><h2>Análisis profundo · sesgo separado de autorización</h2>{deep.map(item=><div className="deep-row" key={item.symbol}><div><b>{item.symbol}</b><small>{SCANNER_MARKET_LABELS[item.market]} · cobertura {item.marketCoverage} · {item.bias} · {item.coverage}/21 marcos</small></div><span className={`decision ${item.decision.decision.startsWith('BUY')?'buy':item.decision.decision.startsWith('SELL')?'sell':'wait'}`}>{item.decision.decision.replaceAll('_',' ')}</span><span title={item.posture.reasons.join(' ')}>{item.posture.recommendationStatus.replaceAll('_',' ')}</span><b>{item.decision.confidence}/100</b><button className="text-btn" onClick={()=>onAnalyze(item.symbol)}>Ver análisis</button></div>)}</div>:null}
  </div>;
}
