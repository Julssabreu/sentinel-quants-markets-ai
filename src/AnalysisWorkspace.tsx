import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { analyzeCandles, type TechnicalAnalysis } from "./analysisEngine";
import {
  ALL_TIMEFRAMES,
  analyzeMultiTimeframe,
  type MultiTimeframeAnalysis,
} from "./multiTimeframeAnalysis";
import ProviderConsensusPanel from "./ProviderConsensusPanel";
import { buildGuardedDecision, type DecisionResult } from "./decisionEngine";
import { buildTradePlan } from "./tradePlan";
import { calculatePositionSize } from "./positionSizing";
import { assessAtomic, type AtomicAssessment } from "./atomicConsensus";
import { assessTickFreshness } from "./dataFreshness";
import { rankNews } from "./newsIntelligence";
import { applyPortfolioGate, type PortfolioGate } from "./portfolioGate";
import { evaluateModelGovernance } from "./modelGovernance";
import { buildAnalysisHistoryDraft } from "./analysisHistoryRecord";
import { evaluateDecisionPosture, type DecisionPosture } from "./decisionPosture";
import { assessDatasetQuality } from "./dataQuality";
import { analyzeIntermarket, type IntermarketAnalysis } from "./intermarketEngine";
import { assessInstitutionalFactorRisk, type InstitutionalFactorRisk } from "./institutionalFactorRisk";
import { analyzeMicrostructure, type MicrostructureAnalysis } from "./microstructureEngine";
import { analyzeCryptoFlow, type CryptoFlowAnalysis } from "./cryptoFlowEngine";
import { analyzeVixContext } from "./vixContext";
import MarketCoveragePanel from "./MarketCoveragePanel";
import {
  resolveMarketUiContext,
  verifiedProviderObservation,
  type MarketRatesEvidence,
  type MarketUiResolution,
} from "./marketUiContext";

export default function AnalysisWorkspace({
  initialSymbol,
}: {
  initialSymbol: string;
}) {
  const [symbol, setSymbol] = useState(initialSymbol),
    [timeframe, setTimeframe] = useState("H1");
  const [rates, setRates] = useState<Mt5RatesResponse | null>(null),
    [analysis, setAnalysis] = useState<TechnicalAnalysis | null>(null);
  const [multiRates, setMultiRates] = useState<Mt5MultiRatesResponse | null>(
      null,
    ),
    [multi, setMulti] = useState<MultiTimeframeAnalysis | null>(null);
  const [macro, setMacro] = useState<MacroSnapshot | null>(null),
    [decision, setDecision] = useState<DecisionResult | null>(null),
    [atomic, setAtomic] = useState<AtomicAssessment | null>(null);
  const [portfolioGate,setPortfolioGate]=useState<PortfolioGate|null>(null);
  const [dataQuality,setDataQuality]=useState<ReturnType<typeof assessDatasetQuality>|null>(null);
  const [intermarket,setIntermarket]=useState<IntermarketAnalysis|null>(null);
  const [institutionalRisk,setInstitutionalRisk]=useState<InstitutionalFactorRisk|null>(null);
  const [microstructure,setMicrostructure]=useState<MicrostructureAnalysis|null>(null);
  const [cryptoFlow,setCryptoFlow]=useState<CryptoFlowSnapshot|null>(null);
  const [cryptoFlowAnalysis,setCryptoFlowAnalysis]=useState<CryptoFlowAnalysis|null>(null);
  const [marketResolution,setMarketResolution]=useState<MarketUiResolution|null>(null);
  const [decisionPosture,setDecisionPosture]=useState<DecisionPosture|null>(null);
  const [atomicTerminals, setAtomicTerminals] = useState<AtomicTerminal[]>([]);
  const [atomicSetupMessage, setAtomicSetupMessage] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState(
    "Introduce un símbolo universal, por ejemplo EUR/USD, XAU/USD o BTC/USD.",
  );
  const [balance, setBalance] = useState(1000),
    [riskPercent, setRiskPercent] = useState(0.5);
  useEffect(()=>window.sentinel?.onCryptoFlowUpdate?.(snapshot=>{
    const requested=symbol.toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/USD$/,'USDT');
    if(snapshot.symbol===requested){setCryptoFlow(snapshot);setCryptoFlowAnalysis(analyzeCryptoFlow(snapshot))}
  }),[symbol]);
  const showTimeframe = (value: string, response = multiRates) => {
    setTimeframe(value);
    const next = response?.results[value];
    if (next?.ok && next.candles) {
      setRates(next);
      setAnalysis(analyzeCandles(next.candles));
    }
  };
  const runAnalysis = async () => {
    if (!window.sentinel?.getMt5MultiRates) {
      setState("error");
      setMessage(
        "El conector MT5 solo está disponible en la aplicación instalada.",
      );
      return;
    }
    setState("loading");
    setMessage(
      "Leyendo las 21 temporalidades y normalizando el símbolo del bróker...",
    );
    try {
      const requestedMarket=resolveMarketUiContext(symbol,timeframe);
      const isCrypto=requestedMarket.classification.market==='CRYPTO';
      const [response, macroResponse, atomicResponse, terminalResponse, newsResponse, portfolioResponse, historyResponse, factorResponse, institutionalResponse, microResponse, flowResponse, vixResponse, tradingViewResponse] = await Promise.all([
        window.sentinel.getMt5MultiRates(symbol, [...ALL_TIMEFRAMES], 350),
        window.sentinel.getMacroSnapshot?.().catch(() => null) ??
          Promise.resolve(null),
        window.sentinel.getAtomicMt5?.().catch(() => null) ??
          Promise.resolve(null),
        window.sentinel.getAtomicTerminals?.().catch(() => null) ??
          Promise.resolve(null),
        window.sentinel.getNewsSnapshot?.().catch(() => null) ??
          Promise.resolve(null),
        window.sentinel.getMt5Portfolio?.().catch(() => null) ??
          Promise.resolve(null),
        window.sentinel.listAnalysisHistory?.().catch(() => null) ??
          Promise.resolve(null),
        window.sentinel.getMt5Factors?.().catch(() => null) ??
          Promise.resolve(null),
        window.sentinel.getInstitutionalFactors?.().catch(() => null) ??
          Promise.resolve(null),
        window.sentinel.getMt5Microstructure?.(symbol).catch(() => null) ??
          Promise.resolve(null),
        isCrypto ? (window.sentinel.startCryptoFlow?.(symbol).catch(() => null) ?? Promise.resolve(null)) : Promise.resolve(null),
        window.sentinel.getTradingViewVixContext?.(false).catch(() => null) ??
          Promise.resolve(null),
        window.sentinel.getTradingViewMarketObservations?.(symbol,timeframe,20).catch(() => null) ??
          Promise.resolve(null),
      ]);
      setAtomicTerminals(terminalResponse?.terminals ?? []);
      const quality=assessDatasetQuality(response.results);
      setDataQuality(quality);
      if (!response.ok) throw new Error("No se recibieron velas desde MT5.");
      const visual =
        response.results[timeframe] ??
        Object.values(response.results).find((x) => x.ok);
      if (!visual?.candles)
        throw new Error("La temporalidad seleccionada no tiene datos.");
      setMultiRates(response);
      const technical = analyzeMultiTimeframe(response.results);
      const factorAnalysis=factorResponse?.ok?analyzeIntermarket(symbol,factorResponse):undefined;
      setIntermarket(factorAnalysis??null);
      const institutionalAnalysis=assessInstitutionalFactorRisk(symbol,institutionalResponse);
      setInstitutionalRisk(institutionalAnalysis);
      const microAnalysis=analyzeMicrostructure(microResponse);
      setMicrostructure(microAnalysis);
      setCryptoFlow(flowResponse);
      setCryptoFlowAnalysis(isCrypto?analyzeCryptoFlow(flowResponse):null);
      const vixContext=analyzeVixContext(vixResponse?.history ?? []);
      const tradingViewObservation=tradingViewResponse?.observations?.[0] ?? null;
      const mt5ReferenceClose=visual.candles[visual.candles.length-1]?.close ?? null;
      const tradingViewDeviationPct=tradingViewObservation && mt5ReferenceClose
        ? Math.abs(tradingViewObservation.close-mt5ReferenceClose)/Math.abs(mt5ReferenceClose)*100
        : null;
      const timeframeMinutes=timeframe.startsWith('M')&&timeframe!=='MN1'
        ? Number(timeframe.slice(1))
        : timeframe.startsWith('H') ? Number(timeframe.slice(1))*60
          : timeframe==='D1' ? 1440 : timeframe==='W1' ? 10080 : 43200;
      const tradingViewFresh=tradingViewObservation
        ? Date.now()-Date.parse(tradingViewObservation.observedAt) <= Math.max(10,timeframeMinutes*2+5)*60_000
        : false;
      const tradingViewTolerancePct=requestedMarket.classification.market==='FOREX' ? .25 : 1;
      const tradingViewVerified=Boolean(tradingViewObservation&&tradingViewFresh&&tradingViewDeviationPct!==null&&tradingViewDeviationPct<=tradingViewTolerancePct);
      const sourceObservations = [
        ...(tradingViewResponse?.status === 'READY' && tradingViewObservation
          ? [{
              providerId:'tradingview' as const,
              roles:['PRICE_TECHNICAL','CONTEXT'] as const,
              ok:tradingViewVerified,
              fresh:tradingViewFresh,
              observedAt:tradingViewObservation.observedAt,
              error:tradingViewVerified ? null : !tradingViewFresh
                ? 'La observación TradingView está fuera de su ventana de frescura.'
                : `El cierre TradingView difiere ${tradingViewDeviationPct?.toFixed(3) ?? 'N/D'}% de MT5.`,
            }]
          : []),
        ...(vixContext.usableAsContext
          ? [verifiedProviderObservation('tradingview', ['CONTEXT'], vixContext.currentObservedAt)]
          : []),
        ...(flowResponse?.connected && flowResponse.observedAt
          ? [verifiedProviderObservation('binance', ['PRICE_TECHNICAL', 'CONTEXT'], flowResponse.observedAt)]
          : []),
      ];
      const resolvedMarket=resolveMarketUiContext(
        symbol,
        visual.timeframe ?? timeframe,
        visual as unknown as MarketRatesEvidence,
        {
          tradingViewConfigured:['READY', 'CACHED'].includes(vixResponse?.status ?? ''),
          observations:sourceObservations,
        },
      );
      setMarketResolution(resolvedMarket);
      const guarded = buildGuardedDecision(
        symbol,
        technical,
        macroResponse?.events ?? [],
        new Date(),
        newsResponse ? rankNews(newsResponse) : [],
        factorAnalysis,
        institutionalAnalysis,
        microAnalysis,
        vixContext,
      );
      const atomicCheck = assessAtomic(
        atomicResponse,
        symbol,
        timeframe,
        guarded,
      );
      const freshness=assessTickFreshness(visual.tick?.time);
      const portfolioCheck=applyPortfolioGate(guarded,portfolioResponse,symbol,riskPercent);
      const governance=evaluateModelGovernance(historyResponse?.records??[]);
      const generatedPlan = buildTradePlan(visual.candles, guarded);
      const authorizationBlockers=[
        atomicCheck.advisoryDecision==='ESPERAR' ? atomicCheck.reason : null,
        portfolioCheck.action==='BLOQUEAR' ? portfolioCheck.reasons.join(' ') : null,
      ].filter((reason):reason is string=>Boolean(reason));
      const posture=evaluateDecisionPosture({
        decision:guarded,
        governance,
        plan:generatedPlan,
        dataQualityValid:quality.valid,
        tickFresh:freshness.fresh,
        technicalReady:resolvedMarket.context.readyForTechnicalAnalysis,
        operationalMarketReady:resolvedMarket.route.readyForOperationalAnalysis,
        additionalBlockers:authorizationBlockers,
      });
      setMulti(technical);
      setMacro(macroResponse);
      setDecision(guarded);
      setDecisionPosture(posture);
      setAtomic(atomicCheck);
      setPortfolioGate(portfolioCheck);
      setRates(visual);
      setAnalysis(analyzeCandles(visual.candles));
      setState("done");
      setMessage(
        `${visual.symbol} · ${resolvedMarket.context.marketLabel} · ${response.availableTimeframes.length}/21 temporalidades leídas desde MT5${tradingViewResponse?.observations?.[0] ? ` · TradingView ${tradingViewResponse.observations[0].timeframe} verificado` : ''}.`,
      );
      const analysisSources = [...new Set([
        visual.source ?? "MT5",
        ...(macroResponse?.indicators?.map(item => item.source) ?? []),
        ...(macroResponse?.events?.map(item => item.source) ?? []),
        ...(macroResponse?.yieldCurve ? [macroResponse.yieldCurve.source] : []),
        ...(atomicResponse?.ok ? ["Atomic Analyst MT5"] : []),
        ...(newsResponse?.articles?.flatMap(item => (
          item.id.startsWith("GDELT-") ? ["GDELT"] : [item.source]
        )) ?? []),
        ...(vixContext.usableAsContext ? ["TradingView / Cboe VIX"] : []),
        ...(tradingViewResponse?.observations?.[0] ? [`TradingView ${tradingViewResponse.observations[0].rawSymbol} ${tradingViewResponse.observations[0].timeframe}`] : []),
      ])];
      if (window.sentinel.saveAnalysisHistory)
        await window.sentinel.saveAnalysisHistory(buildAnalysisHistoryDraft({
          symbol,
          brokerSymbol: visual.symbol ?? symbol,
          timeframe,
          anchorTime:visual.candles.at(-1)?.time??null,
          decision:guarded,
          posture,
          technical,
          plan:generatedPlan,
          quality,
          marketRoute: resolvedMarket.routeSnapshot,
          sources: analysisSources,
        }));
    } catch (error) {
      setRates(null);
      setAnalysis(null);
      setDecisionPosture(null);
      setMultiRates(null);
      setMulti(null);
      setMacro(null);
      setDecision(null);
      setAtomic(null);
      setPortfolioGate(null);
      setDataQuality(null);
      setIntermarket(null);
      setInstitutionalRisk(null);
      setMicrostructure(null);
      setCryptoFlow(null);
      setCryptoFlowAnalysis(null);
      setMarketResolution(null);
      setState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "No fue posible completar el análisis.",
      );
    }
  };
  const installAtomicReader = async (terminalId: string) => {
    setAtomicSetupMessage("Instalando el enlace de solo lectura...");
    try {
      if (!window.sentinel?.installAtomicReader)
        throw new Error("Esta función requiere la aplicación de escritorio.");
      await window.sentinel.installAtomicReader(terminalId);
      setAtomicTerminals((items) =>
        items.map((item) =>
          item.id === terminalId ? { ...item, bridgeInstalled: true } : item,
        ),
      );
      setAtomicSetupMessage(
        "Lector instalado. Reinicia MT5 y coloca SentinelAtomicReader una sola vez en cualquier gráfico independiente. Buscará automáticamente Atomic Analyst en todos los gráficos abiertos, sin cargar otra instancia.",
      );
    } catch (error) {
      setAtomicSetupMessage(
        error instanceof Error ? error.message : "No fue posible instalar el lector.",
      );
    }
  };
  const testAtomicReader = async () => {
    setAtomicSetupMessage("Probando comunicación con el lector...");
    try {
      if (!window.sentinel?.testAtomicReader) throw new Error("Actualiza Sentinel para usar esta prueba.");
      const result=await window.sentinel.testAtomicReader();
      if(!result.ok) throw new Error(result.error||"El lector no respondió.");
      setAtomicSetupMessage(`Prueba correcta: comunicación completa y ${result.sources} fuente(s) Atomic detectada(s).`);
    } catch(error) {
      setAtomicSetupMessage(error instanceof Error?error.message:"Falló la prueba del lector.");
    }
  };
  const chartData =
    rates?.candles?.slice(-120).map((c) => ({
      time: new Date(c.time).toLocaleDateString("es-BO", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
      }),
      close: c.close,
    })) ?? [];
  const plan =
    analysis && rates?.candles && decision
      ? buildTradePlan(rates.candles, decision)
      : null;
  const validSimulation = Boolean(plan?.active && decisionPosture?.simulationEligible);
  const sizing =
    validSimulation && plan?.trigger && plan.stop && rates?.specification
      ? calculatePositionSize({
          balance,
          riskPercent,
          entry: plan.trigger,
          stop: plan.stop,
          specification: rates.specification,
        })
      : null;
  return (
    <div className="real-analysis">
      <div className="analysis-page-head">
        <div>
          <p className="eyebrow">ANÁLISIS REAL DE MERCADO</p>
          <h1>Analizar activo</h1>
          <p>Datos del bróker, 21 temporalidades y cálculos reproducibles.</p>
        </div>
        <span className="readonly-badge">
          <ShieldCheck size={15} /> SOLO LECTURA
        </span>
      </div>
      <div className="analysis-search card">
        <label>
          <span>Símbolo universal</span>
          <div>
            <Search size={18} />
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && void runAnalysis()}
              placeholder="EUR/USD"
            />
          </div>
        </label>
        <label>
          <span>Temporalidad visible</span>
          <select
            value={timeframe}
            onChange={(e) => showTimeframe(e.target.value)}
          >
            {ALL_TIMEFRAMES.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <button
          className="primary analyze-button"
          onClick={runAnalysis}
          disabled={state === "loading"}
        >
          {state === "loading"
            ? "Analizando 21 marcos..."
            : "Ejecutar análisis"}
        </button>
      </div>
      <div className={`connector-message ${state}`}>
        <Database size={16} />
        <span>{message}</span>
      </div>
      {analysis && rates && (
        <>
          {marketResolution ? (
            <MarketCoveragePanel
              context={marketResolution.context}
              aliases={marketResolution.classification.aliases}
              runtime={marketResolution.runtime}
            />
          ) : null}
          {decision ? (
            <div
              className={`card guarded-decision ${decision.decision.toLowerCase()}`}
            >
              <div>
                <span>DECISIÓN ANALÍTICA</span>
                <b>{decision.decision.replaceAll("_", " ")}</b>
                <small>
                  Confianza analítica {decision.confidence}/100 · Técnica{" "}
                  {decision.technicalConfidence}/100
                </small>
              </div>
              <div className="guard-reasons">
                {decision.reasons.map((reason) => (
                  <p key={reason}>{reason}</p>
                ))}
              </div>
              <em>{decision.eventAction.replaceAll("_", " ")}</em>
            </div>
          ) : null}
          {decisionPosture ? (
            <div className={`card decision-posture ${decisionPosture.recommendationStatus.toLowerCase()}`}>
              <div>
                <span>MADUREZ Y AUTORIZACIÓN</span>
                <b>{decisionPosture.recommendationStatus.replaceAll('_',' ')}</b>
                <small>Modelo {decisionPosture.maturityStatus} · {decisionPosture.maturitySample}/30 resultados compatibles</small>
              </div>
              <div className="guard-reasons">
                <p>{decisionPosture.summary}</p>
                {decisionPosture.reasons.slice(0,4).map(reason=><p key={reason}>{reason}</p>)}
              </div>
              <em>EJECUCIÓN {decisionPosture.executionStatus}</em>
            </div>
          ) : null}
          {dataQuality?<div className={`card data-quality ${dataQuality.valid?'valid':'invalid'}`}><div><span>CALIDAD DEL DATASET</span><b>{dataQuality.score}/100</b><small>{dataQuality.checked}/21 temporalidades verificadas</small></div><div>{dataQuality.warnings.slice(0,5).map(x=><p key={x}>{x}</p>)}{!dataQuality.warnings.length?<p>Sin duplicados, desorden ni OHLC inválidos.</p>:null}</div><em>{dataQuality.valid?'APROBADO':'BLOQUEADO'}</em></div>:null}
          {intermarket?<div className={`card intermarket-card ${intermarket.bias.toLowerCase()}`}><div><span>CONTEXTO INTERMERCADO</span><b>{intermarket.bias}</b><small>Puntuación {intermarket.score} · confianza {intermarket.confidence}/100</small></div><div>{intermarket.drivers.slice(0,5).map(x=><p key={x}>{x}</p>)}</div><em>{intermarket.fresh?'DATOS ACTIVOS':'SIN VOTO · DATOS ATRASADOS'}</em></div>:null}
          {institutionalRisk?<div className={`card institutional-risk ${institutionalRisk.level.toLowerCase()}`}><div><span>RIESGO INSTITUCIONAL</span><b>{institutionalRisk.level}</b><small>Puntuación {institutionalRisk.score}/100</small></div><div>{institutionalRisk.reasons.slice(0,4).map(x=><p key={x}>{x}</p>)}</div><em>{institutionalRisk.fresh?'VOTO HABILITADO':'CONTEXTO SIN VOTO'}</em></div>:null}
          {microstructure?<div className={`card microstructure-card ${microstructure.executionRisk.toLowerCase()}`}><div><span>MICROESTRUCTURA</span><b>{microstructure.bias}</b><small>{microstructure.quality} · confianza {microstructure.confidence}/100</small></div><div>{microstructure.warnings.slice(0,4).map(x=><p key={x}>{x}</p>)}{!microstructure.warnings.length?<p>Spread y flujo dentro de parámetros normales.</p>:null}</div><em>{microstructure.executionRisk}</em></div>:null}
          {cryptoFlowAnalysis&&cryptoFlow?<div className={`card microstructure-card ${cryptoFlowAnalysis.liquidationRisk.toLowerCase()}`}><div><span>FLUJO CRIPTO EN VIVO</span><b>{cryptoFlowAnalysis.bias}</b><small>{cryptoFlow.connected?'WEBSOCKET ACTIVO':'RECONECTANDO'} · {cryptoFlow.tradeCount.toLocaleString('es-BO')} operaciones</small></div><div><p>Compras taker USD {cryptoFlow.buyNotional.toLocaleString('es-BO',{maximumFractionDigits:0})} · ventas USD {cryptoFlow.sellNotional.toLocaleString('es-BO',{maximumFractionDigits:0})}</p><p>Liquidaciones long USD {cryptoFlow.longLiquidationNotional.toLocaleString('es-BO',{maximumFractionDigits:0})} · short USD {cryptoFlow.shortLiquidationNotional.toLocaleString('es-BO',{maximumFractionDigits:0})}</p>{cryptoFlowAnalysis.warnings.slice(0,3).map(x=><p key={x}>{x}</p>)}</div><em>{cryptoFlowAnalysis.liquidationRisk}</em></div>:null}
          {atomic ? (
            <div
              className={`card atomic-card ${atomic.agreement.toLowerCase()}`}
            >
              <div>
                <span>ATOMIC ANALYST MT5</span>
                <b>{atomic.agreement.replaceAll("_", " ")}</b>
                <small>{atomic.reason}</small>
              </div>
              {atomic.signal ? (
                <div className="atomic-values">
                  <span>
                    Señal <b>{atomic.signal.type}</b>
                  </span>
                  <span>
                    Activo <b>{atomic.signal.symbol}</b>
                  </span>
                  <span>
                    Marco <b>{atomic.signal.timeframe}</b>
                  </span>
                  <span>
                    Buffer{" "}
                    <b>
                      {atomic.signal.type === "BUY"
                        ? atomic.signal.buyBuffer
                        : atomic.signal.sellBuffer}
                    </b>
                  </span>
                </div>
              ) : null}
              <div className="atomic-setup">
                <button className="primary" onClick={() => void testAtomicReader()}>Probar lector Atomic</button>
                {atomicSetupMessage ? <small>{atomicSetupMessage}</small> : null}
              </div>
              {!atomic.signal && atomicTerminals.length > 0 ? (
                <div className="atomic-setup">
                  {atomicTerminals.map((terminal) => (
                    <button
                      key={terminal.id}
                      className="primary"
                      disabled={terminal.bridgeInstalled}
                      onClick={() => void installAtomicReader(terminal.id)}
                    >
                      {terminal.bridgeInstalled
                        ? "Lector instalado en este MT5"
                        : "Preparar lectura en este MT5"}
                    </button>
                  ))}
                </div>
              ) : null}
              <em>SOLO LECTURA</em>
            </div>
          ) : null}
          {portfolioGate ? <div className={`card portfolio-gate ${portfolioGate.action.toLowerCase()}`}><div><span>CONTROL DE CARTERA</span><b>{portfolioGate.action}</b><small>Riesgo proyectado conocido {portfolioGate.projectedRiskPercent.toFixed(2)}%</small></div><div>{portfolioGate.reasons.map(x=><p key={x}>{x}</p>)}</div><em>PREVIO A ENTRADA</em></div>:null}
          {plan ? (
            <div
              className={`card calculated-plan ${validSimulation ? "active" : "inactive"}`}
            >
              <div className="plan-title">
                <span>PLAN SIMULADO · {timeframe}</span>
                <b>
                  {validSimulation
                    ? `${plan.direction} CON CONFIRMACIÓN`
                    : plan.active ? "PLAN SIMULADO NO VÁLIDO" : "SIN ENTRADA"}
                </b>
                <small>
                  {validSimulation
                    ? `Caduca después de ${plan.expiresAfterBars} velas`
                    : decisionPosture?.reasons[0] ?? plan.cancellation[0]}
                </small>
              </div>
              {validSimulation ? (
                <div className="plan-levels">
                  <div>
                    <span>Activación</span>
                    <b>{plan.trigger?.toFixed(rates.digits ?? 5)}</b>
                  </div>
                  <div>
                    <span>Precio máximo</span>
                    <b>{plan.maxEntry?.toFixed(rates.digits ?? 5)}</b>
                  </div>
                  <div>
                    <span>Invalidación</span>
                    <b>{plan.stop?.toFixed(rates.digits ?? 5)}</b>
                  </div>
                  <div>
                    <span>Objetivo 1</span>
                    <b>{plan.tp1?.toFixed(rates.digits ?? 5)}</b>
                    <small>1:{plan.riskReward1}</small>
                  </div>
                  <div>
                    <span>Objetivo 2</span>
                    <b>{plan.tp2?.toFixed(rates.digits ?? 5)}</b>
                    <small>1:{plan.riskReward2}</small>
                  </div>
                  <div>
                    <span>ATR 14</span>
                    <b>{plan.atr?.toFixed(rates.digits ?? 5)}</b>
                  </div>
                </div>
              ) : null}
              {validSimulation ? (
                <div className="plan-cancel">
                  {plan.cancellation.map((x) => (
                    <p key={x}>{x}</p>
                  ))}
                </div>
              ) : plan.active ? <div className="plan-cancel"><p>Los niveles se ocultan porque la calidad, frescura o cobertura no permite una simulación válida.</p></div> : null}
            </div>
          ) : null}
          {validSimulation ? (
            <div className="card sizing-card">
              <div className="sizing-inputs">
                <label>
                  <span>Balance</span>
                  <input
                    type="number"
                    min="0"
                    value={balance}
                    onChange={(e) => setBalance(Number(e.target.value))}
                  />
                </label>
                <label>
                  <span>Riesgo máximo %</span>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={riskPercent}
                    onChange={(e) => setRiskPercent(Number(e.target.value))}
                  />
                </label>
              </div>
              <div className="sizing-results">
                <div>
                  <span>Capital en riesgo</span>
                  <b>
                    {sizing?.riskAmount.toFixed(2)}{" "}
                    {rates.specification?.currencyProfit}
                  </b>
                </div>
                <div>
                  <span>Volumen permitido</span>
                  <b>
                    {sizing?.valid ? sizing.volume.toFixed(2) : "NO DISPONIBLE"}
                  </b>
                </div>
                <div>
                  <span>Pérdida estimada al stop</span>
                  <b>
                    {sizing?.estimatedLoss.toFixed(2)}{" "}
                    {rates.specification?.currencyProfit}
                  </b>
                </div>
                <div>
                  <span>Contrato</span>
                  <b>
                    {rates.specification?.contractSize.toLocaleString("es-BO")}
                  </b>
                </div>
              </div>
              {sizing?.warning ? (
                <p className="sizing-warning">{sizing.warning}</p>
              ) : (
                <p className="sizing-ok">
                  Calculado con tick y volumen reales de {rates.symbol}.
                </p>
              )}
            </div>
          ) : null}
          {multi && (
            <div className="card mtf-summary">
              <div>
                <span>SESGO MULTI-TEMPORAL</span>
                <b className={multi.bias.toLowerCase()}>{multi.bias}</b>
              </div>
              <div>
                <span>CONFIANZA</span>
                <b>{multi.confidence}/100</b>
              </div>
              <div>
                <span>ALINEACIÓN</span>
                <b>{multi.alignment}%</b>
              </div>
              <div>
                <span>COBERTURA</span>
                <b>{multi.available}/21</b>
              </div>
              <div className="mtf-strips">
                {multi.results.map((item) => (
                  <button
                    key={item.timeframe}
                    title={`${item.timeframe}: ${item.analysis.regime} (${item.analysis.score})`}
                    onClick={() => showTimeframe(item.timeframe)}
                    className={`${item.analysis.regime.toLowerCase()} ${timeframe === item.timeframe ? "active" : ""}`}
                  >
                    <span>{item.timeframe}</span>
                    <i />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="metrics-grid">
            <div className="card metric">
              <span>Instrumento del bróker</span>
              <b>{rates.symbol}</b>
              <small>{rates.source}</small>
            </div>
            <div className="card metric">
              <span>Régimen {timeframe}</span>
              <b>{analysis.regime}</b>
              <small>Puntuación {analysis.score}</small>
            </div>
            <div className="card metric">
              <span>Confianza del marco</span>
              <b>{analysis.confidence}/100</b>
              <small>No es señal de entrada</small>
            </div>
            <div className="card metric">
              <span>Calidad de datos</span>
              <b>{analysis.dataQuality}/100</b>
              <small>{rates.candles?.length} velas</small>
            </div>
          </div>
          <div className="analysis-results-grid">
            <div className="card price-chart">
              <div className="card-heading">
                <div>
                  <Database />
                  <span>
                    <b>
                      {rates.symbol} · {rates.timeframe}
                    </b>
                    <small>Precio del terminal MT5</small>
                  </span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid stroke="#1c2c40" vertical={false} />
                  <XAxis
                    dataKey="time"
                    stroke="#65758a"
                    tick={{ fontSize: 9 }}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    stroke="#65758a"
                    tick={{ fontSize: 9 }}
                    width={64}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0a1524",
                      border: "1px solid #28465d",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="close"
                    stroke="#39d0ff"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="card indicator-panel">
              <h2>Indicadores · {timeframe}</h2>
              {analysis.indicators && (
                <div className="indicator-list">
                  <div>
                    <span>EMA 20</span>
                    <b>
                      {analysis.indicators.ema20.toFixed(rates.digits ?? 5)}
                    </b>
                  </div>
                  <div>
                    <span>EMA 50</span>
                    <b>
                      {analysis.indicators.ema50.toFixed(rates.digits ?? 5)}
                    </b>
                  </div>
                  <div>
                    <span>RSI 14</span>
                    <b>{analysis.indicators.rsi14.toFixed(2)}</b>
                  </div>
                  <div><span>Stoch RSI K (3,3,14,14)</span><b>{analysis.indicators.stochRsiK.toFixed(2)}</b></div>
                  <div><span>Stoch RSI D (3,3,14,14)</span><b>{analysis.indicators.stochRsiD.toFixed(2)}</b></div>
                  <div><span>MACD (12,26,9)</span><b>{analysis.indicators.macd.toFixed(5)}</b></div>
                  <div><span>MACD señal</span><b>{analysis.indicators.macdSignal.toFixed(5)}</b></div>
                  <div><span>MACD histograma</span><b>{analysis.indicators.macdHistogram.toFixed(5)}</b></div>
                  <div>
                    <span>ATR 14</span>
                    <b>
                      {analysis.indicators.atr14.toFixed(rates.digits ?? 5)}
                    </b>
                  </div>
                  <div>
                    <span>ATR relativo</span>
                    <b>{analysis.indicators.atrPercent.toFixed(3)}%</b>
                  </div>
                  <div>
                    <span>Z-score 20</span>
                    <b>{analysis.indicators.zScore20.toFixed(2)}</b>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="evidence-grid">
            <div className="card evidence">
              <h2>
                <CheckCircle2 /> Evidencias de {timeframe}
              </h2>
              {analysis.evidence.length ? (
                analysis.evidence.map((x) => <p key={x}>{x}</p>)
              ) : (
                <p>No existe alineación técnica suficiente.</p>
              )}
            </div>
            <div className="card evidence warnings">
              <h2>
                <AlertTriangle /> Advertencias
              </h2>
              {analysis.warnings.length ? (
                analysis.warnings.map((x) => <p key={x}>{x}</p>)
              ) : (
                <p>No se detectaron advertencias estadísticas principales.</p>
              )}
            </div>
          </div>
          {multi?.contradictions.length ? (
            <div className="card evidence warnings mtf-warnings">
              <h2>
                <AlertTriangle /> Contradicciones multi-temporales
              </h2>
              {multi.contradictions.map((x) => (
                <p key={x}>{x}</p>
              ))}
            </div>
          ) : null}
          <ProviderConsensusPanel
            key={`${rates.symbol}-${rates.tick?.time}`}
            symbol={symbol}
            mt5={rates}
          />
          {macro ? (
            <p className="macro-link-status">
              Contexto macro conectado · {macro.events.length} eventos ·{" "}
              {macro.indicators.length} indicadores
            </p>
          ) : null}
          <p className="analysis-disclaimer">
            El consenso multi-temporal y de proveedores describe evidencia
            técnica. Todavía no incorpora macroeconomía ni noticias.
          </p>
        </>
      )}
    </div>
  );
}
