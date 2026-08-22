import { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_TIMEFRAMES, analyzeMultiTimeframe } from './multiTimeframeAnalysis';
import { buildGuardedDecision } from './decisionEngine';
import { buildTradePlan } from './tradePlan';
import { assessAtomic } from './atomicConsensus';
import { assessTickFreshness } from './dataFreshness';
import { rankNews } from './newsIntelligence';
import { applyPortfolioGate } from './portfolioGate';
import { evaluateModelGovernance } from './modelGovernance';
import { assessDatasetQuality } from './dataQuality';
import { analyzeIntermarket } from './intermarketEngine';
import { assessInstitutionalFactorRisk } from './institutionalFactorRisk';
import { analyzeMicrostructure } from './microstructureEngine';
import { analyzeVixContext } from './vixContext';
import { resolveMarketUiContext, verifiedProviderObservation, type MarketRatesEvidence } from './marketUiContext';
import { evaluateDecisionPosture } from './decisionPosture';
import { formatDecisionPostureLines, formatSimulatedPlanLine } from './signalNotification';
import { buildAnalysisHistoryDraft } from './analysisHistoryRecord';

const signalEpoch = (signal: AtomicMt5Signal) => {
  const match = signal.id?.match(/-(\d{10})-(?:BUY|SELL)$/);
  return match ? Number(match[1]) * 1000 : Number.NaN;
};
const price = (value: number | null) => value == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(value);
const dominicanTime = (signal: AtomicMt5Signal, brokerClockOffset = 0) => {
  const emittedAt = signalEpoch(signal) - brokerClockOffset;
  return Number.isFinite(emittedAt)
    ? new Date(emittedAt).toLocaleString('es-DO', { timeZone:'America/Santo_Domingo' })
    : signal.time ?? signal.id ?? 'Hora no disponible';
};

export function useSignalMonitor() {
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const busy = useRef(false);

  const run = useCallback(async () => {
    if (!window.sentinel || busy.current) return;
    busy.current = true;
    setRunning(true);
    try {
      setLastError(null);
      const [{ config }, atomic] = await Promise.all([
        window.sentinel.getSignalNotifier(),
        window.sentinel.getAtomicMt5().catch(() => null),
      ]);
      if (!config.enabled || !atomic?.ok || !atomic.active) return;

      const freshnessWindow = Math.max(30, config.intervalMinutes * 3) * 60_000;
      const tradableSignals = atomic.signals.filter(signal => ['BUY', 'SELL'].includes(signal.type) && signal.id && Number.isFinite(signalEpoch(signal)));
      const newestEpoch = tradableSignals.length ? signalEpoch(tradableSignals.at(-1)!) : Number.NaN;
      const fileObservedAt = new Date(atomic.signalFileModifiedAt ?? 0).getTime();
      const rawBrokerOffset = newestEpoch - fileObservedAt;
      const brokerClockOffset = Number.isFinite(rawBrokerOffset) && Math.abs(rawBrokerOffset) <= 14 * 3600_000 ? rawBrokerOffset : 0;
      const latestByContext = new Map<string, AtomicMt5Signal>();
      for (const signal of tradableSignals) {
        if (!['BUY', 'SELL'].includes(signal.type) || !signal.id) continue;
        const emittedAt = signalEpoch(signal) - brokerClockOffset;
        if (!Number.isFinite(emittedAt) || Date.now() - emittedAt > freshnessWindow || emittedAt - Date.now() > 5 * 60_000) continue;
        latestByContext.set(`${signal.symbol}|${signal.timeframe}`, signal);
      }
      const pending = [...latestByContext.values()].slice(-config.maxSymbols);
      if (!pending.length) return;

      const [macro, news, portfolio, history, factors, institutional, vixResponse] = await Promise.all([
        window.sentinel.getMacroSnapshot().catch(() => null),
        window.sentinel.getNewsSnapshot().catch(() => null),
        window.sentinel.getMt5Portfolio().catch(() => null),
        window.sentinel.listAnalysisHistory().catch(() => ({ ok: false, records: [] })),
        window.sentinel.getMt5Factors().catch(() => null),
        window.sentinel.getInstitutionalFactors().catch(() => null),
        window.sentinel.getTradingViewVixContext?.(false).catch(() => null) ?? Promise.resolve(null),
      ]);
      const vixContext = analyzeVixContext(vixResponse?.history ?? []);

      for (const signal of pending) {
        try {
          const deliveryFingerprint=`ATOMIC_VALIDATION|${signal.id}`;
          const retry=await window.sentinel.retrySignalDelivery(deliveryFingerprint).catch(()=>({ok:false,status:'NOT_FOUND'}));
          if(retry.ok&&['SENT','DUPLICATE'].includes(retry.status))continue;
          if(retry.status==='PENDING'){
            setLastError(`${signal.symbol} ${signal.timeframe}: entrega pendiente; Sentinel volverá a intentar sin recalcular la señal.`);
            continue;
          }
          const symbol = signal.symbol;
          const [rates, micro] = await Promise.all([
            window.sentinel.getMt5MultiRates(symbol, [...ALL_TIMEFRAMES], 350),
            window.sentinel.getMt5Microstructure(symbol).catch(() => null),
          ]);
          if (!rates.ok) {
            const frames=Object.values(rates.results??{});
            const ambiguous=frames.some(frame=>frame.error==='SYMBOL_AMBIGUOUS');
            if(ambiguous)setLastError(`${symbol}: resolución MT5 ambigua; señal Atomic descartada.`);
            continue;
          }
          const visual = rates.results[signal.timeframe];
          if (!visual?.ok || !visual.candles?.length) continue;

          const marketResolution=resolveMarketUiContext(
            symbol,
            signal.timeframe,
            visual as unknown as MarketRatesEvidence,
            {
              tradingViewConfigured:['READY','CACHED'].includes(vixResponse?.status??''),
              observations:vixContext.usableAsContext
                ? [verifiedProviderObservation('tradingview',['CONTEXT'],vixContext.currentObservedAt)]
                : [],
            },
          );

          const quality = assessDatasetQuality(rates.results);
          const technical = analyzeMultiTimeframe(rates.results);
          const factorAnalysis = factors?.ok ? analyzeIntermarket(symbol, factors) : undefined;
          const institutionalRisk = assessInstitutionalFactorRisk(symbol, institutional);
          const microAnalysis = analyzeMicrostructure(micro);
          const decision = buildGuardedDecision(symbol, technical, macro?.events ?? [], new Date(), news ? rankNews(news) : [], factorAnalysis, institutionalRisk, microAnalysis, vixContext);
          const portfolioGate=applyPortfolioGate(decision, portfolio, symbol, config.riskPercent);
          const atomicAssessment = assessAtomic(atomic, symbol, signal.timeframe, decision);
          const tickFreshness = assessTickFreshness(visual.tick?.time);
          const governance = evaluateModelGovernance(history.records);
          const plan = buildTradePlan(visual.candles, decision);
          const expectedDecision = signal.type === 'BUY' ? 'BUY_CONDICIONADO' : 'SELL_CONDICIONADO';
          const analyticalBlockers = [
            decision.decision !== expectedDecision ? `Sentinel indica ${decision.decision.replaceAll('_', ' ')}` : null,
            decision.confidence < config.minConfidence ? `confianza ${decision.confidence}% inferior a ${config.minConfidence}%` : null,
            atomicAssessment.agreement !== 'CONFIRMA' ? atomicAssessment.reason : null,
            portfolioGate.action==='BLOQUEAR' ? portfolioGate.reasons.join(' ') : null,
          ].filter((reason):reason is string=>Boolean(reason));
          const posture=evaluateDecisionPosture({
            decision,
            governance,
            plan,
            dataQualityValid:quality.valid,
            tickFresh:tickFreshness.fresh,
            technicalReady:marketResolution.context.readyForTechnicalAnalysis,
            operationalMarketReady:marketResolution.route.readyForOperationalAnalysis,
            additionalBlockers:analyticalBlockers,
          });
          const savedAnalysis=await window.sentinel.saveAnalysisHistory(buildAnalysisHistoryDraft({
            symbol,
            brokerSymbol:visual.symbol??symbol,
            timeframe:signal.timeframe,
            anchorTime:visual.candles.at(-1)?.time??null,
            decision,
            posture,
            technical,
            plan,
            quality,
            marketRoute:marketResolution.routeSnapshot,
            sources:[
              visual.source??'MT5',
              ...(macro?.indicators?.map(item=>item.source)??[]),
              ...(macro?.events?.map(item=>item.source)??[]),
              ...(news?.articles?.map(item=>item.source)??[]),
              ...(atomic?.ok?['Atomic Analyst MT5']:[]),
              ...(vixContext.usableAsContext?['TradingView / Cboe VIX']:[]),
            ],
          })).catch(()=>null);
          const algorithmApproved=posture.recommendationAuthorized;
          const algorithmLine = algorithmApproved
            ? `APTO PARA REVISIÓN MANUAL · Sentinel coincide con ${signal.type} y alcanza ${decision.confidence}% de confianza.`
            : `${posture.recommendationStatus.replaceAll('_',' ')} · ${posture.reasons.join('; ')}`;
          const volatility = decision.volatilityContext;
          const vixLine = volatility.value === null
            ? 'VIX diario: sin dato utilizable · SIN VOTO.'
            : `VIX diario: ${volatility.value.toFixed(2)} · ${volatility.regime} · ${volatility.trend} · ${volatility.freshness} · ${volatility.influence}${volatility.confidencePenalty ? ` (-${volatility.confidencePenalty} confianza)` : ''}.`;
          const prompt = [
            'Actúa como revisor final de una señal de trading ya calculada por Sentinel. No inventes datos.',
            'Responde exactamente con una línea que empiece APOYA_ENTRAR o NO_APOYA_ENTRAR, seguida de una razón breve.',
            `Atomic: ${signal.type} ${symbol} ${signal.timeframe} a ${signal.value}.`,
            `Mercado resuelto: ${marketResolution.context.marketLabel}; identidad ${marketResolution.context.canonicalId}; cobertura ${marketResolution.context.coverage}.`,
            `Algoritmos Sentinel: ${algorithmLine}`,
            `Sesgo multitemporal: ${technical.bias}; alineación ${technical.alignment}%; confianza ${decision.confidence}%.`,
            `Decisión calculada: ${decision.decision}. Calidad dataset: ${quality.score}/100. Tick: ${tickFreshness.reason}`,
            `${vixLine} Es referencia de volatilidad; no emite BUY/SELL ni decide por sí solo.`,
            `Gobernanza histórica: ${governance.status}, ${governance.sample}/30 resultados; úsala como advertencia, no inventes resultados.`,
            `Razones: ${decision.reasons.slice(0, 6).join(' | ')}`,
            'Solo APOYA_ENTRAR si la dirección coincide, no hay bloqueo y los datos son suficientes; ante duda responde NO_APOYA_ENTRAR.',
          ].join('\n');
          const messageTemplate = [
            `🔎 *SENTINEL VALIDA ATOMIC · ${symbol} ${signal.timeframe}*`,
            `Atomic: *${signal.type}* a ${price(signal.value)}`,
            `Mercado: ${marketResolution.context.marketLabel} · ${marketResolution.context.canonicalId} · cobertura ${marketResolution.context.coverage}`,
            ...formatDecisionPostureLines(posture),
            `Estado: ${algorithmLine}`,
            `Contexto 21 TF: ${technical.bias} · alineación ${technical.alignment}%`,
            `${vixLine} Solo contexto de riesgo; no es una señal.`,
            `Calidad de datos: ${quality.score}/100`,
            `Gobernanza: ${governance.status} · ${governance.sample}/30 resultados`,
            formatSimulatedPlanLine(posture,plan),
            `Hora RD: ${dominicanTime(signal, brokerClockOffset)}`,
            '',
            'EJECUCIÓN DESACTIVADA. Sentinel no ejecutó ninguna orden. Julio conserva la decisión final.',
          ].join('\n');
          const delivered=await window.sentinel.validateAtomicSignal({
            fingerprint: deliveryFingerprint,
            prompt,
            messageTemplate,
            symbol,
            timeframe: signal.timeframe,
            atomicSignalId: signal.id!,
            algorithmApproved,
            recommendationAuthorized: posture.recommendationAuthorized,
            governanceCanVote: governance.canVote,
            executionAuthorized: false,
            analysisRecordId:savedAnalysis?.record.id??null,
            checkedAt: new Date().toISOString(),
          });
          if(delivered.status==='PENDING')setLastError(`${symbol} ${signal.timeframe}: análisis guardado; entrega WhatsApp pendiente de reintento.`);
        } catch (error) {
          setLastError(error instanceof Error ? error.message : `No se pudo validar ${signal.id}.`);
        }
      }
      setLastRun(new Date().toISOString());
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'Falló la validación de señales Atomic.');
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    let stopped=false;
    let timer: number | undefined;
    const tick = async () => {
      const response = await window.sentinel?.getSignalNotifier();
      if(stopped)return;
      if(response?.config.enabled)await run();
      if(stopped)return;
      timer=window.setTimeout(()=>void tick(),Math.max(1,response?.config.intervalMinutes??2)*60_000);
    };
    void tick();
    return () => { stopped=true;if (timer !== undefined) window.clearTimeout(timer); };
  }, [run]);

  return { running, lastRun, lastError, run };
}
