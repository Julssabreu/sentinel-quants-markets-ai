import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deriveDailyIntelligence,
  type DailyIntelligenceInput,
  type DailyIntelligenceModel,
} from './dailyIntelligence';
import type { DailyMarketTab } from './marketNavigation';
import { EDGAR_REFRESH_TTL_MS, SESSION_METRICS_REFRESH_TTL_MS, shouldRequestForTicker, type TickerRequestState } from './tickerRefreshPolicy';
import { buildStockSessionMetrics } from './sessionMetricsFetch';

const EMPTY_INPUT: DailyIntelligenceInput = {
  market:null,
  macro:null,
  news:null,
  factors:null,
  vix:null,
  scan:null,
  history:null,
  edgar:null,
  sessionMetrics:null,
};

export interface DailyIntelligenceState {
  model: DailyIntelligenceModel;
  loading: boolean;
  scanning: boolean;
  errors: string[];
  refresh: () => Promise<void>;
  scanNow: (force?:boolean) => Promise<void>;
}

interface NamedResult<T> {
  name: string;
  result: PromiseSettledResult<T>;
}

function failureMessage(name: string, reason: unknown): string {
  const detail = reason instanceof Error ? reason.message : String(reason ?? 'sin respuesta');
  return `${name}: ${detail}`;
}

/**
 * Loads each lightweight source and one cached/protected MT5 scan on mount.
 * Manual refresh can force the scanner, while Electron prevents concurrent
 * processes and reuses results for five minutes.
 */
export function useDailyIntelligence(selectedMarket: DailyMarketTab): DailyIntelligenceState {
  const [input, setInput] = useState<DailyIntelligenceInput>(EMPTY_INPUT);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const refreshRunning = useRef(false);
  const scanRunning = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshRunning.current) return;
    const api = window.sentinel;
    if (!api) {
      setErrors(['El Centro de Inteligencia requiere la aplicación de escritorio.']);
      return;
    }
    refreshRunning.current = true;
    setLoading(true);
    try {
      const names = ['Precios', 'Macro', 'Noticias', 'Factores MT5', 'VIX', 'Historial'] as const;
      const settled = await Promise.allSettled([
        api.getMarketSnapshot(),
        api.getMacroSnapshot(),
        api.getNewsSnapshot(),
        api.getMt5Factors(),
        api.getTradingViewVixContext(false),
        api.listAnalysisHistory(),
      ]);
      const named = names.map((name, index) => ({ name, result:settled[index] })) as NamedResult<unknown>[];
      const refreshErrors=named.flatMap(({ name, result }) => result.status === 'rejected'
        ? [failureMessage(name, result.reason)] : []);
      setErrors((previous)=>[
        ...previous.filter((message)=>message.startsWith('Escáner MT5:')),
        ...refreshErrors,
      ]);
      setInput((previous) => ({
        ...previous,
        market:settled[0].status === 'fulfilled' ? settled[0].value : previous.market,
        macro:settled[1].status === 'fulfilled' ? settled[1].value : previous.macro,
        news:settled[2].status === 'fulfilled' ? settled[2].value : previous.news,
        factors:settled[3].status === 'fulfilled' ? settled[3].value : previous.factors,
        vix:settled[4].status === 'fulfilled' ? settled[4].value : previous.vix,
        history:settled[5].status === 'fulfilled' ? settled[5].value.records : previous.history,
      }));
    } finally {
      refreshRunning.current = false;
      setLoading(false);
    }
  }, []);

  const scanNow = useCallback(async (force = false) => {
    if (scanRunning.current) return;
    const api = window.sentinel;
    if (!api?.scanMt5Market) {
      setErrors((previous) => [...new Set([...previous, 'El escáner MT5 requiere la aplicación de escritorio.'])]);
      return;
    }
    scanRunning.current = true;
    setScanning(true);
    try {
      const result = await api.scanMt5Market(300, force);
      setInput((previous) => ({ ...previous, scan:result }));
      if (!result.ok) setErrors((previous) => [
        ...previous.filter((message) => !message.startsWith('Escáner MT5:')),
        `Escáner MT5: ${result.error ?? 'sin respuesta'}`,
      ]);
      else setErrors((previous) => previous.filter((message) => !message.startsWith('Escáner MT5:')));
    } catch (cause) {
      setErrors((previous) => [
        ...previous.filter((message) => !message.startsWith('Escáner MT5:')),
        failureMessage('Escáner MT5', cause),
      ]);
    } finally {
      scanRunning.current = false;
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void scanNow(false);
  }, [refresh, scanNow]);

  const model = useMemo(
    () => deriveDailyIntelligence(input, selectedMarket),
    [input, selectedMarket],
  );

  /**
   * Acción en foco para EDGAR: el primer candidato bursátil del escáner. Solo cambia
   * cuando cambian los candidatos, así que añadir el snapshot no vuelve a dispararlo.
   */
  const focusTicker = useMemo(
    () => model.candidates.find(candidate => candidate.market === 'STOCK')?.symbol ?? null,
    [model.candidates],
  );
  const edgarRequested = useRef<TickerRequestState | null>(null);
  /**
   * Pulso de un minuto: sin él la caducidad de EDGAR no serviría de nada, porque el
   * efecto solo se reevalúa cuando cambia la acción en foco.
   */
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setRefreshTick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const api = window.sentinel;
    if (!api?.getSecCompanySnapshot || !focusTicker) return;
    if (!shouldRequestForTicker(edgarRequested.current, focusTicker, Date.now(), EDGAR_REFRESH_TTL_MS)) return;
    edgarRequested.current = { ticker:focusTicker, requestedAt:Date.now() };
    let cancelled = false;
    void (async () => {
      try {
        const edgar = await api.getSecCompanySnapshot(focusTicker);
        if (!cancelled) setInput((previous) => ({ ...previous, edgar }));
      } catch (cause) {
        if (cancelled) return;
        // Un fallo de EDGAR no debe vaciar el snapshot previo ni fingir cobertura.
        setErrors((previous) => [
          ...previous.filter((message) => !message.startsWith('SEC EDGAR:')),
          failureMessage('SEC EDGAR', cause),
        ]);
      }
    })();
    return () => { cancelled = true; };
  }, [focusTicker, refreshTick]);

  const sessionMetricsRequested = useRef<TickerRequestState | null>(null);
  useEffect(() => {
    const api = window.sentinel;
    if (!api?.getMt5Rates || !focusTicker) return;
    if (!shouldRequestForTicker(sessionMetricsRequested.current, focusTicker, Date.now(), SESSION_METRICS_REFRESH_TTL_MS)) return;
    sessionMetricsRequested.current = { ticker:focusTicker, requestedAt:Date.now() };
    let cancelled = false;
    void (async () => {
      try {
        const sessionMetrics = await buildStockSessionMetrics(api.getMt5Rates, focusTicker, new Date());
        if (!cancelled) setInput((previous) => ({ ...previous, sessionMetrics }));
      } catch (cause) {
        if (cancelled) return;
        setErrors((previous) => [
          ...previous.filter((message) => !message.startsWith('VWAP/opening range:')),
          failureMessage('VWAP/opening range', cause),
        ]);
      }
    })();
    return () => { cancelled = true; };
  }, [focusTicker, refreshTick]);

  return { model, loading, scanning, errors, refresh, scanNow };
}
