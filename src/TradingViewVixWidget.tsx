import { useCallback, useEffect, useState } from 'react';
import { Activity, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { analyzeVixContext, type VixContextAnalysis } from './vixContext';

const EMPTY_VIX = analyzeVixContext([]);

function connectionLabel(response: TradingViewVixContextResponse | null, analysis: VixContextAnalysis) {
  if (!response) return 'Consultando';
  if (response.status === 'DISABLED') return 'Cloudflare desactivado';
  if (response.status === 'UNAVAILABLE') return 'Contexto no disponible';
  if (!analysis.available) return 'Sin cierres diarios';
  if (!analysis.fresh) return 'Dato desactualizado';
  if (!analysis.usableAsContext) return 'Historial insuficiente';
  return response.status === 'CACHED' ? 'Vigente · caché local' : 'Vigente';
}

export default function TradingViewVixWidget() {
  const [response, setResponse] = useState<TradingViewVixContextResponse | null>(null);
  const [analysis, setAnalysis] = useState<VixContextAnalysis>(EMPTY_VIX);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (force = false) => {
    if (!window.sentinel?.getTradingViewVixContext) {
      setError('El contexto VIX requiere la aplicación de escritorio.');
      return;
    }
    setLoading(true);
    try {
      const result = await window.sentinel.getTradingViewVixContext(force);
      setResponse(result);
      setAnalysis(analyzeVixContext(result.history));
      setError(result.error ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible consultar el VIX diario.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const level = analysis.currentLevel == null ? '—' : analysis.currentLevel.toFixed(2);
  const status = connectionLabel(response, analysis);
  const observed = analysis.currentTradingDate ?? 'Sin cierre recibido';

  return <section className="card tradingview-vix-card">
    <div className="calendar-head">
      <div>
        <h2>VIX · Índice de volatilidad Cboe</h2>
        <p>Patrón diario de referencia para el contexto de riesgo de Sentinel.</p>
      </div>
      <div className="vix-actions">
        <button className="primary macro-refresh" onClick={() => void load(true)} disabled={loading}>
          <RefreshCw size={13}/>{loading ? 'Consultando...' : 'Actualizar'}
        </button>
        <a href="https://www.tradingview.com/symbols/CBOE-VIX/" target="_blank" rel="noreferrer">
          Abrir en TradingView <ExternalLink size={12}/>
        </a>
      </div>
    </div>

    <div className="vix-context-grid">
      <div><span>ÚLTIMO CIERRE</span><b>{level}</b><small>{observed}</small></div>
      <div><span>RÉGIMEN</span><b>{analysis.regime ?? 'SIN DATOS'}</b><small>Volatilidad observada</small></div>
      <div><span>TENDENCIA</span><b>{analysis.trend}</b><small>{analysis.score == null ? 'Score no disponible' : `Tensión ${analysis.score}/100`}</small></div>
      <div className={analysis.fresh ? 'ready' : 'degraded'}><span>ESTADO</span><b>{status}</b><small>{response?.status ?? 'SIN CONEXIÓN'}</small></div>
    </div>

    {error ? <p className="monitor-status degraded">{error}</p> : null}
    <div className="vix-safe-link">
      {analysis.available ? <Activity size={30}/> : <ShieldCheck size={30}/>} 
      <div>
        <b>Contexto diario, nunca señal operativa</b>
        <p>Sentinel puede usar el nivel, régimen, tendencia y frescura del VIX como referencia de volatilidad. No genera BUY/SELL, no abre operaciones y no decide por sí solo.</p>
      </div>
    </div>
    <p className="provider-note">El dato estructurado llega mediante la alerta autorizada de TradingView. El gráfico externo sigue aislado y no recibe acceso a MT5, cartera ni credenciales locales.</p>
  </section>;
}
