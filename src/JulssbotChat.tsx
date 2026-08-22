import { useState } from 'react';
import { Bot, ChevronRight, Sparkles, X } from 'lucide-react';
import { ALL_TIMEFRAMES, analyzeMultiTimeframe } from './multiTimeframeAnalysis';
import { buildGuardedDecision } from './decisionEngine';
import { assessAtomic } from './atomicConsensus';
import { buildTradePlan } from './tradePlan';
import { rankNews } from './newsIntelligence';
import { assessTickFreshness } from './dataFreshness';
import { answerJulssbot, type JulssbotContext } from './julssbotAnalysis';
import { applyPortfolioGate } from './portfolioGate';
import { evaluateModelGovernance } from './modelGovernance';
import { evaluateDecisionPosture } from './decisionPosture';
import { assessDatasetQuality } from './dataQuality';
import { analyzeVixContext } from './vixContext';
import { analyzeIntermarket } from './intermarketEngine';
import { assessInstitutionalFactorRisk } from './institutionalFactorRisk';
import { analyzeMicrostructure } from './microstructureEngine';
import { buildAnalysisHistoryDraft } from './analysisHistoryRecord';
import {
  resolveMarketUiContext,
  verifiedProviderObservation,
  type MarketRatesEvidence,
} from './marketUiContext';

type Message = {role:'user'|'assistant'; text:string};

export default function JulssbotChat({
  symbol,
  onClose,
  compact = false,
}: {
  symbol: string;
  onClose?: () => void;
  compact?: boolean;
}) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  const buildContext = async (): Promise<JulssbotContext> => {
    if (!window.sentinel) throw new Error('Julssbot requiere la aplicación de escritorio.');
    const [rates, macro, news, atomic, history, portfolio, factors, institutional, microstructure, vixResponse] = await Promise.all([
      window.sentinel.getMt5MultiRates(symbol, [...ALL_TIMEFRAMES], 350),
      window.sentinel.getMacroSnapshot(),
      window.sentinel.getNewsSnapshot(),
      window.sentinel.getAtomicMt5(),
      window.sentinel.listAnalysisHistory(),
      window.sentinel.getMt5Portfolio(),
      window.sentinel.getMt5Factors().catch(()=>null),
      window.sentinel.getInstitutionalFactors().catch(()=>null),
      window.sentinel.getMt5Microstructure(symbol).catch(()=>null),
      window.sentinel.getTradingViewVixContext?.(false).catch(() => null) ?? Promise.resolve(null),
    ]);
    if (!rates.ok) throw new Error(`MT5 no entregó datos para ${symbol}.`);

    const multi = analyzeMultiTimeframe(rates.results);
    const enriched = rankNews(news);
    const vixContext = analyzeVixContext(vixResponse?.history ?? []);
    const intermarket=factors?.ok?analyzeIntermarket(symbol,factors):undefined;
    const institutionalRisk=assessInstitutionalFactorRisk(symbol,institutional);
    const microstructureRisk=analyzeMicrostructure(microstructure);
    const decision = buildGuardedDecision(
      symbol,
      multi,
      macro.events,
      new Date(),
      enriched,
      intermarket,
      institutionalRisk,
      microstructureRisk,
      vixContext,
    );
    const atomicAssessment = assessAtomic(atomic, symbol, 'H1', decision);
    const visual = rates.results.H1 ?? Object.values(rates.results).find(item => item.ok);
    if (!visual?.candles) throw new Error('No hay velas suficientes para explicar el activo.');
    const freshness = assessTickFreshness(visual.tick?.time);
    const quality=assessDatasetQuality(rates.results);
    const portfolioGate=applyPortfolioGate(decision, portfolio, symbol, .5);
    const governance = evaluateModelGovernance(history.records);

    const marketResolution = resolveMarketUiContext(
      symbol,
      visual.timeframe ?? 'H1',
      visual as unknown as MarketRatesEvidence,
      {
        tradingViewConfigured:['READY', 'CACHED'].includes(vixResponse?.status ?? ''),
        observations:vixContext.usableAsContext
          ? [verifiedProviderObservation('tradingview', ['CONTEXT'], vixContext.currentObservedAt)]
          : [],
      },
    );
    const plan = buildTradePlan(visual.candles, decision);
    const posture=evaluateDecisionPosture({
      decision,
      governance,
      plan,
      dataQualityValid:quality.valid,
      tickFresh:freshness.fresh,
      technicalReady:marketResolution.context.readyForTechnicalAnalysis,
      operationalMarketReady:marketResolution.route.readyForOperationalAnalysis,
      additionalBlockers:[
        atomicAssessment.advisoryDecision==='ESPERAR' ? atomicAssessment.reason : null,
        portfolioGate.action==='BLOQUEAR' ? portfolioGate.reasons.join(' ') : null,
      ].filter((reason):reason is string=>Boolean(reason)),
    });
    const normalized = symbol.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const relevantNews = enriched.filter(item => item.assets.some(asset => {
      const key = asset.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      return normalized.includes(key) || key.includes(normalized);
    })).slice(0, 10);
    const macroSources = [
      ...macro.indicators.map(item => item.source),
      ...macro.events.map(item => item.source),
      ...(macro.yieldCurve ? [macro.yieldCurve.source] : []),
    ];
    const relevantNewsSources = relevantNews.map(item => (
      item.id.startsWith('GDELT-') ? 'GDELT' : item.source
    ));
    const verifiedSources = [
      visual.source ?? 'MT5',
      ...macroSources,
      ...relevantNewsSources,
      ...(atomic.ok ? ['Atomic Analyst MT5'] : []),
      ...(factors?.ok?['Factores intermercado MT5']:[]),
      ...(institutional?.realYields?['U.S. Treasury real yields']:[]),
      ...(institutional?.cot?.length?['CFTC COT']:[]),
      ...(vixContext.usableAsContext ? ['TradingView / Cboe VIX'] : []),
    ];
    await window.sentinel.saveAnalysisHistory(buildAnalysisHistoryDraft({
      symbol,
      brokerSymbol:visual.symbol??symbol,
      timeframe:visual.timeframe??'H1',
      anchorTime:visual.candles.at(-1)?.time??null,
      decision,
      posture,
      technical:multi,
      plan,
      quality,
      marketRoute:marketResolution.routeSnapshot,
      sources:verifiedSources,
    })).catch(()=>null);
    return {
      symbol,
      decision,
      posture,
      multi,
      atomic:atomicAssessment,
      plan,
      news:relevantNews,
      freshness:freshness.reason,
      historyCount:history.records.filter(item => (
        item.symbol.replace(/[^A-Z0-9]/gi, '').toUpperCase() === normalized
      )).length,
      sources:[...new Set(verifiedSources)],
      market:marketResolution.context,
    };
  };

  const send = async (text = input) => {
    const question = text.trim();
    if (!question || loading) return;
    setMessages(current => [...current, {role:'user', text:question}]);
    setInput('');
    setLoading(true);
    try {
      const context = await buildContext();
      setMessages(current => [...current, {role:'assistant', text:answerJulssbot(question, context)}]);
    } catch (error) {
      setMessages(current => [...current, {
        role:'assistant',
        text:error instanceof Error
          ? `No puedo completar el análisis: ${error.message}`
          : 'No fue posible construir el contexto.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={compact ? 'julssbot compact' : 'julssbot card'}>
      <div className="chat-head">
        <div>
          <div className="ai-orb"><Bot /></div>
          <span><b>Julssbot AI</b><small>Contexto verificable de {symbol}</small></span>
        </div>
        {onClose ? <button className="icon-btn" onClick={onClose}><X /></button> : null}
      </div>
      <div className="chat-body">
        <div className="ai-message">
          <Sparkles size={17} />
          <p>
            Clasificaré el mercado y consultaré MT5, 21 temporalidades, contexto macro,
            noticias, Atomic e historial. El VIX solo se usará como referencia diaria de volatilidad.
            Si falta una fuente específica —como fundamentales de una acción— lo diré.
          </p>
        </div>
        {messages.map((message, index) => (
          <div className={`chat-message ${message.role}`} key={index}><pre>{message.text}</pre></div>
        ))}
        {loading ? <div className="ai-message"><p>Construyendo contexto real...</p></div> : null}
        <div className="quick-prompts">
          {[
            'Analiza completamente este activo',
            '¿Qué mercado y fuentes estás usando?',
            'Dame el escenario contrario',
            'Construye un plan de entrada',
            '¿Qué indica el VIX?',
            '¿Qué dice Atomic?',
            '¿Qué noticias afectan?',
          ].map(prompt => <button key={prompt} onClick={() => void send(prompt)}>{prompt}</button>)}
        </div>
      </div>
      <div className="chat-input">
        <input
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && void send()}
          placeholder={`Pregunta sobre ${symbol}...`}
        />
        <button onClick={() => void send()} disabled={loading}><ChevronRight /></button>
      </div>
      <div className="chat-warning">Análisis consultivo; no garantiza resultados ni ejecuta operaciones.</div>
    </div>
  );
}
