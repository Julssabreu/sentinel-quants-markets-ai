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
import { isFreshTradingViewSignal, normalizeTradingViewSymbol, normalizeTradingViewTimeframe } from './tradingViewSignal';
import { analyzeVixContext } from './vixContext';
import { resolveMarketUiContext, verifiedProviderObservation, type MarketRatesEvidence } from './marketUiContext';
import { evaluateDecisionPosture } from './decisionPosture';
import { formatDecisionPostureLines, formatSimulatedPlanLine } from './signalNotification';
import { buildAnalysisHistoryDraft } from './analysisHistoryRecord';

const STATUS_KEY = 'sentinel-tradingview-monitor-status';
const fingerprint = (signal: TradingViewSignal) => `TRADINGVIEW_VALIDATION|${signal.id}`;
const price = (value: number | null) => value == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits:8 }).format(value);
const dominicanTime = (value: string | null) => {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('es-DO', { timeZone:'America/Santo_Domingo' }) : 'Hora no disponible';
};

function publishStatus(detail: {state:string;checkedAt:string;processed:number;error:string|null}) {
  try { localStorage.setItem(STATUS_KEY, JSON.stringify(detail)); } catch {}
  window.dispatchEvent(new CustomEvent('sentinel:tradingview-status', { detail }));
}

async function acknowledge(signal: TradingViewSignal, outcome: Omit<TradingViewAck,'leaseToken'>) {
  return window.sentinel!.acknowledgeTradingViewSignal(signal.id, { ...outcome, leaseToken:signal.leaseToken });
}

const retrySeconds = (attempts: number) => Math.min(900, 60 * 2 ** Math.max(0, attempts - 1));

async function releaseAnalysisFailure(signal: TradingViewSignal, detail: string, permanent = false) {
  if (permanent || signal.attempts >= 3) {
    await acknowledge(signal, { status:'REJECTED', detail });
  } else {
    await acknowledge(signal, { status:'RETRY', retryAfterSeconds:retrySeconds(signal.attempts), detail });
  }
}

export function useTradingViewMonitor() {
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const busy = useRef(false);

  const run = useCallback(async () => {
    if (!window.sentinel?.pullTradingViewSignals || busy.current) return;
    busy.current = true;
    setRunning(true);
    let cycleError: string | null = null;
    let processed = 0;
    try {
      const [{ config:notifier }, { config:cloudflare }] = await Promise.all([
        window.sentinel.getSignalNotifier(),
        window.sentinel.getTradingViewConfig(),
      ]);
      if (!notifier.enabled || !cloudflare.enabled) {
        setLastError(null);
        publishStatus({ state:'DISABLED', checkedAt:new Date().toISOString(), processed:0, error:null });
        return;
      }

      // Claude Opus 5 can take up to 100 seconds. Claiming one signal keeps the five-minute
      // D1 lease valid while Sentinel completes the full deterministic review.
      const batch = await window.sentinel.pullTradingViewSignals(1);
      const claimed = (batch.signals ?? []).slice(0, 1);
      if (!claimed.length) {
        const checkedAt = new Date().toISOString();
        setLastRun(checkedAt);setLastError(null);
        publishStatus({ state:'READY', checkedAt, processed:0, error:null });
        return;
      }

      const ready: {signal:TradingViewSignal;symbol:string;timeframe:string}[] = [];
      for (const signal of claimed) {
        try {
          if (!signal.id || !/^[a-f0-9-]{36}$/i.test(signal.leaseToken || '')) {
            cycleError = 'Cloudflare entregó una reserva de señal inválida.';
            continue;
          }
          if (signal.retryReason === 'DELIVERY_PENDING') {
            if (!isFreshTradingViewSignal(signal, cloudflare.maxAgeMinutes)) {
              await window.sentinel.abandonSignalDelivery(fingerprint(signal), 'DELIVERY_EXPIRED');
              await acknowledge(signal, { status:'EXPIRED', detail:'DELIVERY_EXPIRED' });
              continue;
            }
            const delivery = await window.sentinel.retrySignalDelivery(fingerprint(signal));
            if (delivery.ok && ['SENT','DUPLICATE'].includes(delivery.status)) {
              await acknowledge(signal, { status:'PROCESSED', verdict:delivery.verdict, detail:`Sentinel ${delivery.status.toLowerCase()}.` });
              processed += 1;
            } else if (delivery.status === 'NOT_FOUND') {
              await acknowledge(signal, { status:'RETRY', retryAfterSeconds:retrySeconds(signal.attempts), detail:'ANALYSIS_RETRY' });
            } else {
              await acknowledge(signal, { status:'RETRY', retryAfterSeconds:retrySeconds(signal.attempts), detail:'DELIVERY_PENDING' });
            }
            continue;
          }
          const timeframe = normalizeTradingViewTimeframe(signal.timeframe);
          const symbol = normalizeTradingViewSymbol(signal.symbol || signal.rawSymbol);
          if (symbol === 'VIX') {
            await acknowledge(signal, { status:'REJECTED', detail:'VIX_REQUIRES_MARKET_CONTEXT_ROUTE' });
            continue;
          }
          if (!timeframe || !symbol || !['BUY','SELL'].includes(signal.side)) {
            await acknowledge(signal, { status:'REJECTED', detail:'INVALID_CONTRACT' });
            continue;
          }
          if (!isFreshTradingViewSignal(signal, cloudflare.maxAgeMinutes)) {
            await acknowledge(signal, { status:'EXPIRED', detail:'STALE_BEFORE_VALIDATION' });
            continue;
          }
          ready.push({ signal, symbol, timeframe });
        } catch (error) {
          cycleError = error instanceof Error ? error.message : `No se pudo clasificar ${signal.id}.`;
        }
      }

      if (ready.length) {
        const [macro, news, portfolio, history, factors, institutional, atomic, vixResponse] = await Promise.all([
          window.sentinel.getMacroSnapshot().catch(() => null),
          window.sentinel.getNewsSnapshot().catch(() => null),
          window.sentinel.getMt5Portfolio().catch(() => null),
          window.sentinel.listAnalysisHistory().catch(() => ({ ok:false, records:[] })),
          window.sentinel.getMt5Factors().catch(() => null),
          window.sentinel.getInstitutionalFactors().catch(() => null),
          window.sentinel.getAtomicMt5().catch(() => null),
          window.sentinel.getTradingViewVixContext?.(false).catch(() => null) ?? Promise.resolve(null),
        ]);
        const vixContext = analyzeVixContext(vixResponse?.history ?? []);
        const ratesCache = new Map<string, Promise<Mt5MultiRatesResponse>>();
        const microCache = new Map<string, Promise<Mt5MicrostructureResponse | null>>();
        const getRates = (symbol:string) => {
          if (!ratesCache.has(symbol)) ratesCache.set(symbol, window.sentinel!.getMt5MultiRates(symbol, [...ALL_TIMEFRAMES], 350));
          return ratesCache.get(symbol)!;
        };
        const getMicro = (symbol:string) => {
          if (!microCache.has(symbol)) microCache.set(symbol, window.sentinel!.getMt5Microstructure(symbol).catch(() => null));
          return microCache.get(symbol)!;
        };

        for (const { signal, symbol, timeframe } of ready) {
          try {
            const [rates, micro] = await Promise.all([getRates(symbol), getMicro(symbol)]);
            if (!rates.ok) {
              const frames = Object.values(rates.results ?? {});
              const symbolMissing = frames.length > 0 && frames.every(frame => !frame.ok && frame.error === 'SYMBOL_NOT_FOUND');
              const symbolAmbiguous = frames.some(frame => !frame.ok && frame.error === 'SYMBOL_AMBIGUOUS');
              cycleError = symbolAmbiguous
                ? `${symbol}: coincide con más de un contrato MT5.`
                : symbolMissing
                  ? `${symbol}: no existe en el catálogo MT5.`
                  : `${symbol}: MT5 no entregó las temporalidades.`;
              await releaseAnalysisFailure(
                signal,
                symbolAmbiguous ? 'MT5_SYMBOL_AMBIGUOUS' : symbolMissing ? 'MT5_SYMBOL_NOT_FOUND' : 'MT5_RATES_UNAVAILABLE',
                symbolAmbiguous || symbolMissing,
              );
              continue;
            }
            const visual = rates.results[timeframe];
            if (!visual?.ok || !visual.candles?.length) {
              cycleError = `${symbol} ${timeframe}: temporalidad MT5 no disponible.`;
              const permanentSymbolError = ['SYMBOL_NOT_FOUND','SYMBOL_AMBIGUOUS'].includes(visual?.error ?? '');
              await releaseAnalysisFailure(
                signal,
                visual?.error === 'SYMBOL_AMBIGUOUS' ? 'MT5_SYMBOL_AMBIGUOUS' : visual?.error === 'SYMBOL_NOT_FOUND' ? 'MT5_SYMBOL_NOT_FOUND' : 'MT5_TIMEFRAME_UNAVAILABLE',
                permanentSymbolError,
              );
              continue;
            }

            const quality = assessDatasetQuality(rates.results);
            const marketResolution = resolveMarketUiContext(
              symbol,
              timeframe,
              visual as unknown as MarketRatesEvidence,
              {
                tradingViewConfigured:true,
                observations:vixContext.usableAsContext
                  ? [verifiedProviderObservation('tradingview', ['CONTEXT'], vixContext.currentObservedAt)]
                  : [],
              },
            );
            const technical = analyzeMultiTimeframe(rates.results);
            const factorAnalysis = factors?.ok ? analyzeIntermarket(symbol, factors) : undefined;
            const institutionalRisk = assessInstitutionalFactorRisk(symbol, institutional);
            const microAnalysis = analyzeMicrostructure(micro);
            const decision = buildGuardedDecision(symbol, technical, macro?.events ?? [], new Date(), news ? rankNews(news) : [], factorAnalysis, institutionalRisk, microAnalysis, vixContext);
            const portfolioGate=applyPortfolioGate(decision, portfolio, symbol, notifier.riskPercent);
            const atomicAssessment = assessAtomic(atomic, symbol, timeframe, decision);
            const tickFreshness = assessTickFreshness(visual.tick?.time);
            const governance = evaluateModelGovernance(history.records);
            const plan = buildTradePlan(visual.candles, decision);
            const expectedDecision = signal.side === 'BUY' ? 'BUY_CONDICIONADO' : 'SELL_CONDICIONADO';
            const atomicBlocks = ['CONTRADICE','CONFLICTO'].includes(atomicAssessment.agreement);
            const analyticalBlockers = [
              decision.decision !== expectedDecision ? `Sentinel indica ${decision.decision.replaceAll('_', ' ')}` : null,
              decision.confidence < notifier.minConfidence ? `confianza ${decision.confidence}% inferior a ${notifier.minConfidence}%` : null,
              atomicBlocks ? atomicAssessment.reason : null,
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
              timeframe,
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
                'TradingView / Cloudflare',
                ...(vixContext.usableAsContext?['TradingView / Cboe VIX']:[]),
              ],
            })).catch(()=>null);
            const algorithmApproved=posture.recommendationAuthorized;
            const algorithmLine = algorithmApproved
              ? `APTO PARA REVISIÓN MANUAL · MT5 y Sentinel coinciden con ${signal.side} y alcanzan ${decision.confidence}% de confianza.`
              : `${posture.recommendationStatus.replaceAll('_',' ')} · ${posture.reasons.join('; ')}`;
            const volatility = decision.volatilityContext;
            const vixLine = volatility.value === null
              ? 'VIX diario: sin dato utilizable · SIN VOTO.'
              : `VIX diario: ${volatility.value.toFixed(2)} · ${volatility.regime} · ${volatility.trend} · ${volatility.freshness} · ${volatility.influence}${volatility.confidencePenalty ? ` (-${volatility.confidencePenalty} confianza)` : ''}.`;
            const currentPrice = signal.side === 'BUY' ? visual.tick?.ask : visual.tick?.bid;
            const deviation = Number.isFinite(signal.price) && Number.isFinite(currentPrice)
              ? Math.abs(Number(currentPrice) - Number(signal.price)) / Number(signal.price) * 100
              : null;
            const prompt = [
              'Actúa como revisor final de una alerta externa ya recalculada por Sentinel. No inventes datos.',
              'Responde exactamente con una línea que empiece APOYA_ENTRAR o NO_APOYA_ENTRAR, seguida de una razón breve.',
              `TradingView disparó ${signal.side} ${symbol} ${timeframe} a ${price(signal.price)}. Es solo un disparador, no la fuente operativa.`,
              `Mercado resuelto: ${marketResolution.context.marketLabel}; identidad ${marketResolution.context.canonicalId}; cobertura ${marketResolution.context.coverage}.`,
              `Algoritmos Sentinel con datos MT5: ${algorithmLine}`,
              `Sesgo multitemporal: ${technical.bias}; alineación ${technical.alignment}%; confianza ${decision.confidence}%.`,
              `Decisión calculada: ${decision.decision}. Calidad dataset: ${quality.score}/100. Tick MT5: ${tickFreshness.reason}`,
              `${vixLine} Es referencia de volatilidad; no emite BUY/SELL ni decide por sí solo.`,
              `Atomic: ${atomicAssessment.agreement}. ${atomicAssessment.reason}`,
              `Gobernanza histórica: ${governance.status}, ${governance.sample}/30 resultados; úsala como advertencia.`,
              `Razones: ${decision.reasons.slice(0, 6).join(' | ')}`,
              'Solo APOYA_ENTRAR si la dirección coincide, no hay bloqueo y los datos MT5 son suficientes; ante duda responde NO_APOYA_ENTRAR.',
            ].join('\n');
            const messageTemplate = [
              `📡 *SENTINEL VALIDA TRADINGVIEW · ${symbol} ${timeframe}*`,
              `TradingView: *${signal.side}* a ${price(signal.price)}${signal.strategy ? ` · ${signal.strategy}` : ''}`,
              `Mercado: ${marketResolution.context.marketLabel} · ${marketResolution.context.canonicalId} · cobertura ${marketResolution.context.coverage}`,
              ...formatDecisionPostureLines(posture),
              `Estado: ${algorithmLine}`,
              `MT5 actual: ${price(Number.isFinite(currentPrice) ? Number(currentPrice) : null)}${deviation == null ? '' : ` · variación desde alerta ${deviation.toFixed(3)}%`}`,
              `Contexto 21 TF: ${technical.bias} · alineación ${technical.alignment}%`,
              `${vixLine} Solo contexto de riesgo; no es una señal.`,
              `Atomic: ${atomicAssessment.agreement}`,
              `Calidad de datos: ${quality.score}/100`,
              `Gobernanza: ${governance.status} · ${governance.sample}/30 resultados`,
              formatSimulatedPlanLine(posture,plan,'PLAN SIMULADO MT5'),
              `Hora de alerta RD: ${dominicanTime(signal.emittedAt || signal.receivedAt)}`,
              '',
              'TradingView solo disparó la consulta. EJECUCIÓN DESACTIVADA: Sentinel no ejecutó ninguna orden y Julio conserva la decisión final.',
            ].join('\n');
            const result = await window.sentinel.validateExternalSignal({
              fingerprint:fingerprint(signal), prompt, messageTemplate, source:'TRADINGVIEW', sourceSignalId:signal.id,
              symbol, timeframe, algorithmApproved,
              recommendationAuthorized:posture.recommendationAuthorized,
              governanceCanVote:governance.canVote,
              executionAuthorized:false,
              analysisRecordId:savedAnalysis?.record.id??null,
              checkedAt:new Date().toISOString(),
            });
            if (result.ok && ['SENT','DUPLICATE'].includes(result.status)) {
              await acknowledge(signal, { status:'PROCESSED', verdict:result.verdict, detail:`Sentinel ${result.status.toLowerCase()}.` });
              processed += 1;
            } else if (result.status === 'PENDING') {
              await acknowledge(signal, { status:'RETRY', retryAfterSeconds:retrySeconds(signal.attempts), detail:'DELIVERY_PENDING' });
            } else {
              await releaseAnalysisFailure(signal, `VALIDATION_${result.status || 'FAILED'}`, result.status === 'INVALID');
            }
          } catch (error) {
            cycleError = error instanceof Error ? error.message : `No se pudo validar ${signal.id}.`;
            try { await releaseAnalysisFailure(signal, 'ANALYSIS_RETRY'); } catch {}
          }
        }
      }

      const checkedAt = new Date().toISOString();
      setLastRun(checkedAt);setLastError(cycleError);
      publishStatus({ state:cycleError?'DEGRADED':'READY', checkedAt, processed, error:cycleError });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falló la consulta de señales TradingView.';
      setLastError(message);
      publishStatus({ state:'ERROR', checkedAt:new Date().toISOString(), processed, error:message });
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      await run();
      if (stopped) return;
      let seconds = 10;
      try { seconds = (await window.sentinel?.getTradingViewConfig())?.config.pollSeconds ?? 10; } catch {}
      timer = window.setTimeout(() => void tick(), Math.max(5, seconds) * 1000);
    };
    void tick();
    return () => { stopped = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [run]);

  return { running, lastRun, lastError, run };
}
