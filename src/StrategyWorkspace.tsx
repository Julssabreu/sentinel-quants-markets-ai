import { useState } from 'react';
import { CheckCircle2, CircleDashed, RefreshCw, ShieldCheck } from 'lucide-react';
import { calculatePerformance } from './performanceStats';
import { evaluateSmcQuantGate, type QuantSmcVerdict } from './quantSmcGate';
import { analyzeSmcStrategy, SMC_STRATEGY_ID, type SmcSetup } from './smcStrategy';

const FRAME_COUNT = 1200;

export default function StrategyWorkspace() {
  const [symbol, setSymbol] = useState('EUR/USD');
  const [setup, setSetup] = useState<SmcSetup | null>(null);
  const [quant, setQuant] = useState<QuantSmcVerdict | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('Ejecuta el análisis para evaluar la cadena D1 → H4 → H1 → M15 → M5.');

  const run = async () => {
    if (!window.sentinel?.getMt5MultiRates) return;
    setLoading(true);
    setMessage('Leyendo las cinco temporalidades y validando la secuencia SMC...');
    try {
      const [rates, history] = await Promise.all([
        window.sentinel.getMt5MultiRates(symbol, ['D1', 'H4', 'H1', 'M15', 'M5'], FRAME_COUNT),
        window.sentinel.listAnalysisHistory?.() ?? Promise.resolve({ ok: true, records: [] }),
      ]);
      const current = analyzeSmcStrategy({
        D1: rates.results.D1?.candles,
        H4: rates.results.H4?.candles,
        H1: rates.results.H1?.candles,
        M15: rates.results.M15?.candles,
        M5: rates.results.M5?.candles,
      });
      const stats = calculatePerformance((history.records ?? []).filter(record => record.strategy === SMC_STRATEGY_ID));
      const verdict = evaluateSmcQuantGate(current, {
        resolvedTrades: stats.resolved,
        averageR: stats.averageR,
        profitFactor: stats.profitFactor ?? 0,
        maxDrawdownR: stats.maxDrawdownR,
      });
      setSetup(current);
      setQuant(verdict);
      setMessage(current.stage === 'READY'
        ? 'La cadena técnica está completa; el quant determina si posee evidencia suficiente.'
        : `Sentinel permanece esperando: ${current.stage}.`);
    } catch (error) {
      setSetup(null);
      setQuant(null);
      setMessage(error instanceof Error ? error.message : 'No fue posible analizar la estrategia SMC.');
    } finally {
      setLoading(false);
    }
  };

  return <div className="strategy-page smc-strategy-page">
    <div className="analysis-page-head">
      <div><p className="eyebrow">ESTRATEGIA OPERATIVA ÚNICA</p><h1>SMC multitemporal</h1><p>D1 define, H4 localiza, H1 configura, M15 refina y M5 genera el disparador.</p></div>
      <span className="readonly-badge"><ShieldCheck size={15}/> REVISIÓN MANUAL</span>
    </div>
    <div className="card module-controls smc-controls">
      <label>Activo<input value={symbol} onChange={event => setSymbol(event.target.value.toUpperCase())}/></label>
      <button className="primary" onClick={run} disabled={loading}><RefreshCw size={15}/>{loading ? ' Analizando...' : ' Analizar SMC'}</button>
      <p>{message}</p>
    </div>
    {setup ? <>
      <section className="card smc-overview">
        <div><span>SESGO D1</span><b>{setup.direction ?? 'NEUTRAL'}</b></div>
        <div><span>ETAPA ACTUAL</span><b>{setup.stage}</b></div>
        <div><span>CADENA COMPLETA</span><b>{setup.score}%</b></div>
        <div><span>VEREDICTO QUANT</span><b>{quant?.status ?? 'RESEARCH'}</b></div>
        <div><span>AUTORIZACIÓN</span><b>{quant?.authorized ? 'ELEGIBLE' : 'NO AUTORIZADA'}</b></div>
      </section>
      <section className="smc-pipeline">
        {setup.steps.map(step => <article className={`card smc-step ${step.confirmed ? 'confirmed' : 'waiting'}`} key={step.timeframe}>
          {step.confirmed ? <CheckCircle2/> : <CircleDashed/>}
          <div><span>{step.timeframe}</span><b>{step.role}</b><p>{step.summary}</p></div>
        </article>)}
      </section>
      <section className="card smc-plan-preview">
        <h2>Plan M5</h2>
        <div><span>Entrada</span><b>{setup.entry?.toFixed(5) ?? '—'}</b></div>
        <div><span>Stop</span><b>{setup.stop?.toFixed(5) ?? '—'}</b></div>
        <div><span>Objetivo H4</span><b>{setup.target?.toFixed(5) ?? '—'}</b></div>
        <div><span>Riesgo/beneficio</span><b>{setup.riskReward?.toFixed(2) ?? '—'}R</b></div>
      </section>
      <section className="card smc-quant-note">
        <b>Cómo encaja el quant</b>
        <p>El quant no inventa dirección. Audita la única configuración SMC, exige evidencia resuelta, expectativa positiva, profit factor suficiente y drawdown controlado antes de autorizarla.</p>
        {quant?.reasons.map(reason => <small key={reason}>{reason}</small>)}
      </section>
    </> : <div className="card empty-module">Todavía no existe un análisis SMC ejecutado.</div>}
    <p className="analysis-disclaimer">Sentinel no envía órdenes. Una configuración técnica completa no equivale a rentabilidad demostrada ni garantiza resultados futuros.</p>
  </div>;
}
