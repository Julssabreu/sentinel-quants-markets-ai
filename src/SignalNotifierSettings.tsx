import { useEffect, useState } from 'react';
import { ALL_TIMEFRAMES } from './multiTimeframeAnalysis';

const fallback: SignalNotifierConfig = {
  schemaVersion:3, enabled:false, channel:'whatsapp', target:'', timeframes:[...ALL_TIMEFRAMES],
  intervalMinutes:5, minConfidence:60, riskPercent:.5, maxSymbols:10, keepInTray:true, startWithWindows:false,
};
const fallbackTradingView: TradingViewCloudflareConfig = {
  schemaVersion:1, enabled:false, endpoint:'', pollSeconds:10, maxAgeMinutes:30, hasToken:false,
};
type TradingViewMonitorStatus = {state:string;checkedAt:string;processed:number;error:string|null};

export default function SignalNotifierSettings() {
  const [config, setConfig] = useState(fallback);
  const [tradingView, setTradingView] = useState(fallbackTradingView);
  const [consumerToken, setConsumerToken] = useState('');
  const [message, setMessage] = useState('');
  const [monitorStatus, setMonitorStatus] = useState<TradingViewMonitorStatus | null>(() => {
    try { return JSON.parse(localStorage.getItem('sentinel-tradingview-monitor-status') || 'null'); } catch { return null; }
  });

  useEffect(() => {
    if (!window.sentinel) return;
    void Promise.all([
      window.sentinel.getSignalNotifier(),
      window.sentinel.getTradingViewConfig(),
    ]).then(([notifier, cloudflare]) => {
      setConfig(notifier.config);
      setTradingView(cloudflare.config);
    });
  }, []);
  useEffect(() => {
    const listener = (event:Event) => setMonitorStatus((event as CustomEvent<TradingViewMonitorStatus>).detail);
    window.addEventListener('sentinel:tradingview-status', listener);
    return () => window.removeEventListener('sentinel:tradingview-status', listener);
  }, []);

  const save = async () => {
    if (!window.sentinel) return;
    if (tradingView.enabled && (!tradingView.endpoint || (!tradingView.hasToken && !consumerToken.trim()))) {
      setMessage('Para activar TradingView faltan la URL del Worker o el token de consulta.');
      return;
    }
    setMessage('Guardando configuración...');
    try {
      const [notifier, cloudflare] = await Promise.all([
        window.sentinel.saveSignalNotifier(config),
        window.sentinel.saveTradingViewConfig({ ...tradingView, consumerToken:consumerToken.trim() || undefined }),
      ]);
      setConfig(notifier.config);
      setTradingView(cloudflare.config);
      setConsumerToken('');
      setMessage('Configuración guardada. Cloudflare consulta sin IA; Claude Opus 5 solo revisa candidatos que superan los controles Sentinel.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la configuración.');
    }
  };

  const testWhatsApp = async () => {
    if (!window.sentinel) return;
    setMessage('Enviando prueba por WhatsApp...');
    try {
      await window.sentinel.saveSignalNotifier(config);
      await window.sentinel.testSignalNotifier();
      setMessage('Prueba de transporte enviada por WhatsApp.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo enviar la prueba.');
    }
  };

  const testCloudflare = async () => {
    if (!window.sentinel) return;
    setMessage('Comprobando Worker y D1...');
    const desired = { ...tradingView };
    try {
      const staged = await window.sentinel.saveTradingViewConfig({ ...desired, enabled:false, consumerToken:consumerToken.trim() || undefined });
      setTradingView(staged.config);
      setConsumerToken('');
      await window.sentinel.testTradingViewConnection();
      const saved = desired.enabled
        ? await window.sentinel.saveTradingViewConfig({ ...desired, enabled:true })
        : staged;
      setTradingView(saved.config);
      setMessage('Cloudflare respondió correctamente y la bandeja está autenticada.');
    } catch (error) {
      try {
        const current = await window.sentinel.getTradingViewConfig();
        const disabled = await window.sentinel.saveTradingViewConfig({ ...current.config, enabled:false });
        setTradingView(disabled.config);
      } catch { setTradingView(x=>({...x,enabled:false})); }
      setMessage(`${error instanceof Error ? error.message : 'No fue posible conectar con Cloudflare.'} La recepción quedó desactivada.`);
    }
  };

  const clearCloudflareToken = async () => {
    if (!window.sentinel) return;
    try {
      const saved = await window.sentinel.saveTradingViewConfig({ ...tradingView, enabled:false, clearToken:true });
      setTradingView(saved.config);
      setConsumerToken('');
      setMessage('Token local eliminado y recepción TradingView desactivada.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo eliminar el token.');
    }
  };

  return <div className="signal-settings-page">
    <div className="analysis-page-head"><div>
      <p className="eyebrow">VALIDACIÓN DE SEÑALES</p>
      <h1>Avisos automáticos</h1>
      <p>Atomic y TradingView pueden disparar una revisión; MT5 conserva la verdad operativa y Sentinel nunca ejecuta órdenes.</p>
    </div></div>

    <section className="card signal-notifier">
      <h2>WhatsApp y revisión Sentinel</h2>
      <label><input type="checkbox" checked={config.enabled} onChange={e=>setConfig(x=>({...x,enabled:e.target.checked}))}/> Activar validación automática</label>
      <div className="signal-notifier-grid">
        <label>Destino<input value={config.target} onChange={e=>setConfig(x=>({...x,target:e.target.value}))}/></label>
        <label>Temporalidades<input value={`Todas (${config.timeframes.length})`} readOnly/></label>
        <label>Revisión Atomic (min)<input type="number" min="2" max="60" value={config.intervalMinutes} onChange={e=>setConfig(x=>({...x,intervalMinutes:+e.target.value}))}/></label>
        <label>Confianza mínima<input type="number" min="50" max="95" value={config.minConfidence} onChange={e=>setConfig(x=>({...x,minConfidence:+e.target.value}))}/></label>
        <label>Riesgo sugerido %<input type="number" min=".1" max="2" step=".1" value={config.riskPercent} onChange={e=>setConfig(x=>({...x,riskPercent:+e.target.value}))}/></label>
        <label>Máximo por ciclo<input type="number" min="1" max="25" value={config.maxSymbols} onChange={e=>setConfig(x=>({...x,maxSymbols:+e.target.value}))}/></label>
      </div>
      <label><input type="checkbox" checked={config.keepInTray} onChange={e=>setConfig(x=>({...x,keepInTray:e.target.checked}))}/> Mantener Sentinel vigilando en segundo plano</label>
      <label><input type="checkbox" checked={config.startWithWindows} onChange={e=>setConfig(x=>({...x,startWithWindows:e.target.checked}))}/> Iniciar Sentinel automáticamente con Windows</label>
      <div className="signal-notifier-actions"><button onClick={testWhatsApp}>Probar WhatsApp</button></div>
    </section>

    <section className="card signal-notifier cloudflare-notifier">
      <h2>TradingView → Cloudflare D1 → Sentinel</h2>
      <label><input type="checkbox" checked={tradingView.enabled} onChange={e=>setTradingView(x=>({...x,enabled:e.target.checked}))}/> Activar bandeja de alertas TradingView</label>
      <div className="signal-notifier-grid">
        <label className="wide-field">URL base del Worker<input value={tradingView.endpoint} onChange={e=>setTradingView(x=>({...x,endpoint:e.target.value}))} placeholder="https://sentinel-tradingview.usuario.workers.dev"/></label>
        <label>Token de consulta<input type="password" autoComplete="new-password" value={consumerToken} onChange={e=>setConsumerToken(e.target.value)} placeholder={tradingView.hasToken?'Cifrado en Windows · escribe solo para reemplazar':'Pegar SENTINEL_CONSUMER_TOKEN'}/></label>
        <label>Consulta (seg)<input type="number" min="5" max="60" value={tradingView.pollSeconds} onChange={e=>setTradingView(x=>({...x,pollSeconds:+e.target.value}))}/></label>
        <label>Vigencia máxima (min)<input type="number" min="5" max="1440" value={tradingView.maxAgeMinutes} onChange={e=>setTradingView(x=>({...x,maxAgeMinutes:+e.target.value}))}/></label>
      </div>
      <div className="signal-notifier-actions">
        <button onClick={testCloudflare}>Probar Cloudflare</button>
        {tradingView.hasToken?<button onClick={clearCloudflareToken}>Eliminar token</button>:null}
        <span>{tradingView.hasToken?'Token protegido con el cifrado local de Windows.':'Aún no hay token local.'}</span>
      </div>
      {monitorStatus?<p className={`monitor-status ${monitorStatus.state.toLowerCase()}`}>Monitor: {monitorStatus.state} · {new Date(monitorStatus.checkedAt).toLocaleString('es-DO')} · procesadas {monitorStatus.processed}{monitorStatus.error?` · ${monitorStatus.error}`:''}</p>:null}
      <p className="signal-note">D1 conserva alertas si la PC está apagada. El sondeo no usa IA; una alerta fresca se recalcula con MT5, 21 temporalidades, riesgo, macro y Atomic. Claude Opus 5 solo se consulta si esos controles la aprueban.</p>
    </section>

    <div className="signal-notifier-actions settings-save"><button className="primary" onClick={save}>Guardar todo</button><span>{message}</span></div>
  </div>;
}
