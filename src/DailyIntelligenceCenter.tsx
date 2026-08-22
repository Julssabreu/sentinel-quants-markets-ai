import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Clock3,
  Database,
  ExternalLink,
  Gauge,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
} from 'lucide-react';
import {
  DATA_NOT_AVAILABLE,
  type DailyIntelligenceModel,
  type IntelligenceCandidate,
} from './dailyIntelligence';
import type { DailyIntelligenceSection } from './marketNavigation';

interface DailyIntelligenceCenterProps {
  model: DailyIntelligenceModel;
  section: DailyIntelligenceSection;
  loading: boolean;
  scanning: boolean;
  errors: string[];
  onRefresh: () => void;
  onScan: () => void;
  onAnalyze?: (symbol: string) => void;
}

const number = (value: number) => value.toLocaleString('es-DO', { maximumFractionDigits:5 });
const dateTime = (value: string | null) => value
  ? new Date(value).toLocaleString('es-DO', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
  : DATA_NOT_AVAILABLE;

function EmptyState({ children = DATA_NOT_AVAILABLE }:{ children?: string }) {
  return <div className="card intelligence-empty"><Database size={18}/><span>{children}</span></div>;
}

function CandidateCard({
  candidate,
  onAnalyze,
}: {
  candidate: IntelligenceCandidate;
  onAnalyze?: (symbol: string) => void;
}) {
  return <article className="card intelligence-candidate">
    <div className="intelligence-candidate-head">
      <div><b>{candidate.symbol}</b><span>{candidate.description} · {candidate.market}</span></div>
      <strong className={`decision ${candidate.direction === 'BUY' ? 'buy' : candidate.direction === 'SELL' ? 'sell' : 'wait'}`}>
        SESGO {candidate.direction}
      </strong>
    </div>
    <div className="intelligence-candidate-metrics">
      <span>Prefiltro <b>{candidate.score.toFixed(1)}/100</b></span>
      <span>Spread <b>{candidate.spreadPoints.toFixed(1)} pt</b></span>
      <span>Tick <b>{candidate.tickAgeMinutes.toFixed(1)} min</b></span>
    </div>
    <p>{candidate.caveat}</p>
    <small>{candidate.source} · {dateTime(candidate.observedAt)}</small>
    {onAnalyze ? <button type="button" className="text-btn" onClick={() => onAnalyze(candidate.symbol)}>
      Abrir análisis profundo <ArrowRight size={14}/>
    </button> : null}
  </article>;
}

function SummarySection({ model }:{ model: DailyIntelligenceModel }) {
  const leading=model.candidates[0];
  const missing=model.capabilities.filter((item)=>!item.available).map((item)=>item.label);
  return <>
    <section className="card intelligence-editorial">
      <div className="intelligence-section-head"><div><h2>Base editorial para Julssbot</h2><p>Síntesis determinista; no consulta IA ni consume tokens.</p></div><ShieldCheck size={18}/></div>
      <p>{leading
        ? `${leading.symbol} encabeza el prefiltro con sesgo ${leading.direction} y ${leading.score.toFixed(1)}/100, pero todavía requiere análisis profundo, catalizador verificable e invalidación válida.`
        : 'Todavía no existe un candidato activo verificado para este mercado.'}</p>
      <div><b>Qué contradice o limita la lectura</b><span>{missing.length?missing.join(' · '):'Sin huecos de cobertura declarados en esta vista.'}</span></div>
    </section>
    <div className="intelligence-context-grid">
      {model.context.map((item) => <article className="card intelligence-context" key={item.id}>
        <span>{item.label}</span>
        <b>{item.value}</b>
        <p>{item.detail}</p>
        <small>{item.source} · {dateTime(item.observedAt)}</small>
      </article>)}
    </div>
    <div className="intelligence-summary-columns">
      <section className="card intelligence-changes">
        <div className="intelligence-section-head"><div><h2>Qué cambió</h2><p>Movimientos observados, sin atribuir un catalizador no verificado.</p></div></div>
        {model.changes.length ? model.changes.map((item) => <div className="intelligence-change" key={item.id}>
          <div><b>{item.title}</b><small>{item.detail}</small></div>
          <strong>{item.value}</strong>
          <span>{item.source} · {dateTime(item.observedAt)}</span>
        </div>) : <p className="intelligence-no-data">{DATA_NOT_AVAILABLE}</p>}
      </section>
      <section className="card intelligence-coverage">
        <div className="intelligence-section-head"><div><h2>Cobertura actual</h2><p>Sentinel declara lo que tiene y lo que aún falta.</p></div></div>
        {model.capabilities.map((item) => <div className={item.available ? 'available' : 'missing'} key={item.id}>
          {item.available ? <ShieldCheck size={15}/> : <AlertTriangle size={15}/>}<span><b>{item.label}</b><small>{item.detail}</small></span>
        </div>)}
      </section>
    </div>
  </>;
}

function RadarSection({
  model,
  scanning,
  onScan,
  onAnalyze,
}: {
  model: DailyIntelligenceModel;
  scanning: boolean;
  onScan: () => void;
  onAnalyze?: (symbol: string) => void;
}) {
  return <>
    <div className="intelligence-section-head">
      <div><h2>Radar técnico real</h2><p>Prefiltro MT5 H1/H4{model.scanMethod ? ` · ${model.scanMethod}` : ''}; ningún resultado habilita ejecución.</p></div>
      <button type="button" className="primary" onClick={onScan} disabled={scanning}>
        <ScanSearch size={15}/>{scanning ? 'Escaneando...' : 'Escanear MT5 ahora'}
      </button>
    </div>
    {model.scanStatus === 'NOT_RUN'
      ? <EmptyState>El escáner automático inicial todavía no ha terminado; también puedes iniciarlo manualmente.</EmptyState>
      : model.scanStatus === 'UNAVAILABLE'
        ? <EmptyState>Escáner MT5 no disponible. Revisa el estado del terminal o el detalle mostrado arriba.</EmptyState>
      : model.candidates.length
        ? <div className="intelligence-candidate-grid">{model.candidates.map((candidate) => <CandidateCard
          candidate={candidate}
          onAnalyze={onAnalyze}
          key={`${candidate.symbol}-${candidate.direction}`}
        />)}</div>
        : <EmptyState>No hay candidatos activos para este mercado en el último escaneo.</EmptyState>}
    <div className="intelligence-section-head avoid-head"><div><h2>Evitar o esperar</h2><p>Instrumentos desactualizados o sin dirección alineada.</p></div></div>
    {model.scanStatus === 'UNAVAILABLE'
      ? <EmptyState>No se puede clasificar qué evitar sin un escaneo válido.</EmptyState>
      : model.avoidCandidates.length
      ? <div className="intelligence-candidate-grid avoid">{model.avoidCandidates.map((candidate) => <CandidateCard
        candidate={candidate}
        onAnalyze={onAnalyze}
        key={`${candidate.symbol}-${candidate.direction}-avoid`}
      />)}</div>
      : <EmptyState>No hay activos clasificados para evitar en el último escaneo.</EmptyState>}
  </>;
}

function AnalysisSection({model,onAnalyze}:{model:DailyIntelligenceModel;onAnalyze?:(symbol:string)=>void}){
  return <>
    <div className="intelligence-section-head">
      <div><h2>Análisis profundo individual</h2><p>Selecciona un candidato clasificado para abrir sus 21 temporalidades, contradicciones, entrada condicionada e invalidación.</p></div>
    </div>
    {model.scanStatus==='UNAVAILABLE'
      ? <EmptyState>El análisis profundo requiere primero un escaneo MT5 válido.</EmptyState>
      : model.candidates.length
        ? <div className="intelligence-candidate-grid">{model.candidates.map((candidate)=><CandidateCard candidate={candidate} onAnalyze={onAnalyze} key={`${candidate.symbol}-analysis`}/>)}</div>
        : <EmptyState>No hay candidatos activos que pasar al análisis profundo en este corte.</EmptyState>}
  </>;
}

function CalendarSection({ model }:{ model: DailyIntelligenceModel }) {
  if (!model.events.length) return <EmptyState>No hay eventos verificables disponibles para este mercado.</EmptyState>;
  return <section className="card intelligence-calendar">
    <div className="intelligence-section-head"><div><h2>Calendario macro</h2><p>Hora, previsión, dato previo y procedencia.</p></div><CalendarDays size={20}/></div>
    {model.events.map((event) => <div className="intelligence-event" key={event.id}>
      <time>{dateTime(event.scheduledAt)}</time>
      <b>{event.currency}</b>
      <span>{event.impact}</span>
      <div><strong>{event.title}</strong><small>Previsto {event.forecast ?? DATA_NOT_AVAILABLE} · Previo {event.previous ?? DATA_NOT_AVAILABLE} · Calidad {event.quality}</small></div>
      <em>{event.action.replaceAll('_', ' ')}</em>
      <a href={event.sourceUrl} target="_blank" rel="noreferrer" title={event.source}><ExternalLink size={13}/></a>
    </div>)}
  </section>;
}

function NewsSection({ model }:{ model: DailyIntelligenceModel }) {
  if (!model.news.length) return <EmptyState>No hay noticias verificables clasificadas para este mercado.</EmptyState>;
  return <section className="card intelligence-news">
    <div className="intelligence-section-head"><div><h2>Noticias y catalizadores</h2><p>La relación con activos es una clasificación; abre la fuente para verificar el hecho.</p></div></div>
    {model.news.map((item) => <article className="intelligence-news-row" key={item.id}>
      <div><span>{item.impact}</span><em>{item.topic}</em></div>
      <a href={item.url} target="_blank" rel="noreferrer">{item.title} <ExternalLink size={12}/></a>
      <p>{item.assets.length ? `Relacionada con ${item.assets.join(' · ')}` : 'Sin activo específico confirmado'}.</p>
      <small>{item.source} · calidad {item.credibility}/100 · {dateTime(item.publishedAt)}</small>
    </article>)}
  </section>;
}

function HistorySection({ model }:{ model: DailyIntelligenceModel }) {
  if (!model.history.length) return <EmptyState>No hay planes simulados registrados para este mercado.</EmptyState>;
  return <section className="card intelligence-history">
    <div className="intelligence-section-head"><div><h2>Resultados simulados</h2><p>Solo planes marcados como simulación; no representa operaciones ejecutadas.</p></div></div>
    <div className="intelligence-history-head"><span>Activo</span><span>Sesgo</span><span>Confianza</span><span>Madurez</span><span>Resultado</span><span>Hora</span></div>
    {model.history.map((item) => <div className="intelligence-history-row" key={item.id}>
      <b>{item.symbol} · {item.timeframe}</b>
      <span>{item.decision}</span>
      <span>{item.confidence}%</span>
      <span>{item.maturity}</span>
      <em>{item.outcome}</em>
      <small>{dateTime(item.createdAt)}</small>
    </div>)}
  </section>;
}

function ReportsSection({model}:{model:DailyIntelligenceModel}){
  return <>
    <section className="card intelligence-report">
      <div className="intelligence-section-head"><div><h2>Informe diario reproducible</h2><p>Borrador construido solo con la evidencia cargada en este corte.</p></div><span className="readonly-badge">BORRADOR</span></div>
      <div className="intelligence-report-grid">
        <div><span>Vista generada</span><b>{dateTime(model.generatedAt)}</b></div>
        <div><span>Mercado</span><b>{model.market}</b></div>
        <div><span>Candidatos activos</span><b>{model.candidates.length}</b></div>
        <div><span>Fuentes listas</span><b>{model.sources.filter((source)=>source.status==='READY').length}/{model.sources.length}</b></div>
      </div>
      <p>La exportación automática a PDF todavía no está habilitada. Sentinel no completará campos ausentes ni inventará catalizadores.</p>
    </section>
    <HistorySection model={model}/>
  </>;
}

export default function DailyIntelligenceCenter({
  model,
  section,
  loading,
  scanning,
  errors,
  onRefresh,
  onScan,
  onAnalyze,
}: DailyIntelligenceCenterProps) {
  return <div className="daily-intelligence-page">
    <div className="analysis-page-head intelligence-page-head">
      <div>
        <p className="eyebrow">CENTRO DE INTELIGENCIA DIARIO</p>
        <h1>Panorama verificable del mercado</h1>
        <p>Datos reales disponibles, procedencia visible y ausencia explícita cuando una fuente todavía no existe.</p>
      </div>
      <div className="intelligence-actions">
        <span className="readonly-badge"><ShieldCheck size={15}/> EJECUCIÓN DESACTIVADA</span>
        <button type="button" className="primary" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={15}/>{loading ? 'Actualizando...' : 'Actualizar panorama'}
        </button>
      </div>
    </div>

    {errors.map((error) => <div className="connector-message error" key={error}><AlertTriangle size={15}/>{error}</div>)}

    <div className="intelligence-benchmark-grid">
      {model.benchmarks.map((item) => <article className={`card intelligence-benchmark ${item.value === null ? 'missing' : ''}`} key={item.id}>
        <span>{item.label}</span>
        <b>{item.value === null ? DATA_NOT_AVAILABLE : number(item.value)}</b>
        <strong className={(item.change24h ?? 0) >= 0 ? 'positive' : 'negative'}>
          {item.change24h === null ? 'Cambio no disponible' : `${item.change24h >= 0 ? '+' : ''}${item.change24h.toFixed(2)}%`}
        </strong>
        <small>{item.source ?? DATA_NOT_AVAILABLE} · {item.freshness}</small>
      </article>)}
    </div>

    <div className="card intelligence-source-strip">
      <div><Gauge size={17}/><b>Estado de fuentes</b></div>
      {model.sources.map((source) => <span className={source.status.toLowerCase()} key={source.id} title={source.errors.join(' · ')}>
        {source.label} <b>{source.status.replace('_', ' ')}</b><small>{dateTime(source.checkedAt)}{source.errors.length ? ` · ${source.errors[0]}` : ''}</small>
      </span>)}
      <time><Clock3 size={13}/> Vista generada {dateTime(model.generatedAt)}</time>
    </div>

    {section === 'SUMMARY' ? <SummarySection model={model}/> : null}
    {section === 'RADAR' ? <RadarSection
      model={model}
      scanning={scanning}
      onScan={onScan}
      onAnalyze={onAnalyze}
    /> : null}
    {section === 'ANALYSIS' ? <AnalysisSection model={model} onAnalyze={onAnalyze}/> : null}
    {section === 'CALENDAR' ? <CalendarSection model={model}/> : null}
    {section === 'NEWS' ? <NewsSection model={model}/> : null}
    {section === 'REPORTS' ? <ReportsSection model={model}/> : null}

    <p className="analysis-disclaimer">Sentinel presenta contexto, sesgos analíticos y planes simulados. Nunca ejecuta operaciones automáticamente.</p>
  </div>;
}
