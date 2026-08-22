import { lazy, Suspense, useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  BookOpen,
  Bot,
  BriefcaseBusiness,
  Calculator,
  Database,
  Eye,
  Gauge,
  Globe2,
  History,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Newspaper,
  Search,
  Settings,
  Target,
} from 'lucide-react';
const AnalysisWorkspace=lazy(()=>import('./AnalysisWorkspace')),MacroWorkspace=lazy(()=>import('./MacroWorkspace')),HistoryWorkspace=lazy(()=>import('./HistoryWorkspace')),LaboratoryWorkspace=lazy(()=>import('./LaboratoryWorkspace')),ScannerWorkspace=lazy(()=>import('./ScannerWorkspace')),JulssbotChat=lazy(()=>import('./JulssbotChat')),PortfolioWorkspace=lazy(()=>import('./PortfolioWorkspace')),AlertWorkspace=lazy(()=>import('./AlertWorkspace')),WatchlistWorkspace=lazy(()=>import('./WatchlistWorkspace')),SignalNotifierSettings=lazy(()=>import('./SignalNotifierSettings')),StrategyWorkspace=lazy(()=>import('./StrategyWorkspace')),RiskWorkspace=lazy(()=>import('./RiskWorkspace')),DailyIntelligenceHome=lazy(()=>import('./DailyIntelligenceHome'));
import { useAlertMonitor } from './useAlertMonitor';
import { useSignalMonitor } from './useSignalMonitor';
import { useTradingViewMonitor } from './useTradingViewMonitor';
import { useAutonomousRuntime } from './useAutonomousRuntime';
import { engageRuntimeKillSwitch, readRuntimeKillSwitch, releaseRuntimeKillSwitch, RUNTIME_CONTROLS_EVENT } from './runtimeControls';
import type { ActiveView } from './navigation';

const nav = [
  ['Centro global', LayoutDashboard], ['Oportunidades', Target], ['Analizar activo', Activity], ['Estrategias', Gauge],
  ['Riesgo', Calculator], ['Cartera', BriefcaseBusiness], ['Noticias y macro', Newspaper], ['Julssbot AI', MessageSquareText],
  ['Alertas', Bell], ['Listas de vigilancia', Eye], ['Avisos WhatsApp', MessageSquareText], ['Historial', History], ['Laboratorio', BookOpen],
] as const;

export default function App() {
  const [active, setActive] = useState<ActiveView>('Centro global');
  const [selectedSymbol, setSelectedSymbol] = useState('EUR/USD');
  const [query, setQuery] = useState('');
  const [sidebar, setSidebar] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [uiZoom, setUiZoom] = useState(() => Number(localStorage.getItem('sentinel-ui-zoom')) || 1);
  const [killSwitch, setKillSwitch] = useState(readRuntimeKillSwitch);
  const alertMonitor = useAlertMonitor(selectedSymbol);
  const atomicMonitor=useSignalMonitor();
  const tradingViewMonitor=useTradingViewMonitor();
  const autonomousRuntime=useAutonomousRuntime();

  useEffect(() => {
    localStorage.setItem('sentinel-ui-zoom', String(uiZoom));
    window.sentinel?.setUiZoom?.(uiZoom);
  }, [uiZoom]);

  useEffect(()=>{const sync=()=>setKillSwitch(readRuntimeKillSwitch());window.addEventListener(RUNTIME_CONTROLS_EVENT,sync);return()=>window.removeEventListener(RUNTIME_CONTROLS_EVENT,sync);},[]);

  const toggleKillSwitch=()=>{
    if(killSwitch.engaged){if(window.confirm('¿Liberar el Kill Switch? El análisis autónomo Paper/Shadow podrá crear nuevas observaciones; las órdenes reales seguirán desactivadas.'))releaseRuntimeKillSwitch();}
    else if(window.confirm('¿Activar el Kill Switch? Sentinel seguirá analizando, pero bloqueará nuevas observaciones Paper/Shadow.'))engageRuntimeKillSwitch();
  };
  const runtimeError=autonomousRuntime.errors[0]??atomicMonitor.lastError??tradingViewMonitor.lastError??alertMonitor.lastError;

  const openAnalysis = (symbol: string) => {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return;
    setSelectedSymbol(normalized);
    setQuery(normalized);
    setActive('Analizar activo');
  };

  return <div className={`app ${sidebar ? '' : 'collapsed'}`}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Globe2 size={22}/></div><div><b>SENTINEL</b><span>MARKETS AI</span></div></div>
      <nav>{nav.map(([label, Icon]) => <button key={label} className={active === label ? 'active' : ''} onClick={() => setActive(label)}><Icon size={18}/><span>{label}</span></button>)}</nav>
      <div className="sidebar-foot"><div className="status-dot"/><div><b>Investigación · {window.sentinel?.version ?? 'desarrollo'}</b><span>Ejecución automática desactivada</span></div><Settings size={17}/></div>
    </aside>
    <main>
      <header>
        <button className="icon-btn" onClick={() => setSidebar(!sidebar)}><Menu size={20}/></button>
        <div className="search"><Search size={18}/><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') openAnalysis(query); }} placeholder="Buscar activo, mercado o símbolo..."/><kbd>Enter</kbd></div>
        <div className="header-actions">
          <span className="demo-pill verified"><Database size={14}/> DATOS TRAZABLES</span>
          <span className={`demo-pill runtime-${autonomousRuntime.state.toLowerCase()}`} title={runtimeError??autonomousRuntime.reasonCodes.join(' · ')}><Activity size={14}/> AUTO {autonomousRuntime.state} · P{autonomousRuntime.activePaper} S{autonomousRuntime.activeShadow}</span>
          <button className={`demo-pill runtime-kill ${killSwitch.engaged?'engaged':''}`} onClick={toggleKillSwitch} title={killSwitch.engaged?'Kill Switch activo: nuevas oportunidades bloqueadas':'Activar Kill Switch'}>{killSwitch.engaged?'KILL ACTIVO':'KILL READY'}</button>
          <button className="icon-btn display-button" title="Tamaño de interfaz" onClick={() => setDisplayOpen((value) => !value)}><Settings size={19}/></button>
          <button className={`icon-btn alert-bell ${alertMonitor.criticalCount ? 'critical' : ''}`} title={`${alertMonitor.activeCount} alertas activas`} onClick={() => setActive('Alertas')}><Bell size={19}/>{alertMonitor.activeCount ? <strong>{alertMonitor.activeCount > 99 ? '99+' : alertMonitor.activeCount}</strong> : null}</button>
          <div className="avatar">JA</div>
        </div>
        {displayOpen ? <div className="display-popover">
          <div><b>Tamaño de interfaz</b><small>Se guarda automáticamente</small></div>
          {[{label:'Compacta',value:.85,note:'Pantallas pequeñas'},{label:'Normal',value:1,note:'Equilibrada'},{label:'Cómoda',value:1.15,note:'Más legible'},{label:'Grande',value:1.3,note:'Máxima lectura'}].map((option) => <button className={Math.abs(uiZoom - option.value) < .01 ? 'selected' : ''} key={option.label} onClick={() => { setUiZoom(option.value); setDisplayOpen(false); }}><span>{option.label}<small>{option.note}</small></span><b>{Math.round(option.value * 100)}%</b></button>)}
          <label>Escala personalizada <input type="range" min="80" max="140" step="5" value={Math.round(uiZoom * 100)} onChange={(event) => setUiZoom(Number(event.target.value) / 100)}/><strong>{Math.round(uiZoom * 100)}%</strong></label>
        </div> : null}
      </header>
      <section className="content"><Suspense fallback={<div className="card quant-validation">Cargando módulo…</div>}>
        {active === 'Centro global' ? <DailyIntelligenceHome onAnalyze={openAnalysis}/>
          : active === 'Analizar activo' ? <AnalysisWorkspace initialSymbol={selectedSymbol}/>
            : active === 'Oportunidades' ? <ScannerWorkspace onAnalyze={openAnalysis}/>
              : active === 'Estrategias' ? <StrategyWorkspace/>
                : active === 'Riesgo' ? <RiskWorkspace/>
                  : active === 'Julssbot AI' ? <JulssbotChat symbol={selectedSymbol}/>
                    : active === 'Cartera' ? <PortfolioWorkspace/>
                      : active === 'Noticias y macro' ? <MacroWorkspace/>
                        : active === 'Alertas' ? <AlertWorkspace/>
                          : active === 'Listas de vigilancia' ? <WatchlistWorkspace/>
                            : active === 'Avisos WhatsApp' ? <SignalNotifierSettings/>
                              : active === 'Historial' ? <HistoryWorkspace/>
                                : <LaboratoryWorkspace/>}</Suspense>
      </section>
    </main>
    <button className="ai-fab" onClick={() => setChatOpen(true)}><Bot size={22}/><span>Analizar con Julssbot</span></button>
    {chatOpen ? <div className="chat-panel"><Suspense fallback={<div className="ai-message"><p>Cargando Julssbot…</p></div>}><JulssbotChat symbol={selectedSymbol} compact onClose={() => setChatOpen(false)}/></Suspense></div> : null}
  </div>;
}
