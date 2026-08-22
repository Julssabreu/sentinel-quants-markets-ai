'use strict';
/**
 * Construye el HTML del informe diario en PDF. Función pura: recibe datos ya
 * obtenidos y devuelve una cadena; no hace red ni consulta IA.
 *
 * Estructura inspirada en el reporte de referencia que Julio compartió ("Erasmo"),
 * pero limitada a lo que Sentinel puede respaldar con una fuente real. No incluye
 * consenso de analistas, precios objetivo, pivotes clásicos ni ATR porque ninguno es
 * hoy una fuente conectada — se declaran como límite conocido en vez de inventarse.
 * El análisis profundo por símbolo solo aparece si existe un registro de análisis SMC
 * ya guardado por Sentinel; si no existe, el símbolo queda en la tabla resumen y se
 * dice explícitamente que no hay análisis guardado, en vez de fabricar niveles.
 */

const DAILY_REPORT_HTML_VERSION = '1.0.0';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function fmtNum(value, digits = 4) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
}

function formatDateTime(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return { fecha: iso, ast: '', et: '' };
  const fecha = date.toLocaleDateString('es-DO', { timeZone:'America/Santo_Domingo', day:'2-digit', month:'long', year:'numeric' });
  const ast = date.toLocaleTimeString('es-DO', { timeZone:'America/Santo_Domingo', hour:'2-digit', minute:'2-digit', hour12:false });
  const et = date.toLocaleTimeString('en-US', { timeZone:'America/New_York', hour:'2-digit', minute:'2-digit', hour12:false });
  return { fecha, ast, et };
}

function directionLabel(direction) {
  if (direction === 'BUY' || direction === 'LONG') return 'COMPRA';
  if (direction === 'SELL' || direction === 'SHORT') return 'VENTA';
  return 'SIN SESGO';
}

function riskRewardOf(plan) {
  if (!plan) return null;
  const risk = Math.abs(plan.maxEntry - plan.stop);
  const reward = Math.abs(plan.tp1 - plan.maxEntry);
  if (!(risk > 0)) return null;
  return reward / risk;
}

/** Convicción declarada a partir de la muestra de gobernanza real, no de una opinión. */
function convictionFromGovernance(record) {
  const sample = Number(record?.maturitySample) || 0;
  const status = record?.maturityStatus;
  if (status !== 'RESEARCH' && status !== 'PROBATION' && sample >= 30)
    return { label: 'Con evidencia', detail: `${sample}/30 resultados verificados de gobernanza.` };
  return { label: 'RESEARCH — sin autorización operativa', detail: `${sample}/30 resultados; el sesgo analítico se conserva, pero no se autoriza recomendación operativa hasta completar la muestra.` };
}

function renderDeepDive(candidate, record) {
  if (!record) {
    return `<div class="deepdive-missing">
      <h3>${esc(candidate.symbol)}</h3>
      <p>Sin análisis SMC guardado hoy para este símbolo. Aparece solo en la tabla del escáner.</p>
    </div>`;
  }
  const plan = record.plan;
  const rr = riskRewardOf(plan);
  const conviction = convictionFromGovernance(record);
  const sources = record.sources && record.sources.length ? record.sources.join(', ') : 'sin registrar';
  return `<section class="deepdive">
    <h3>${esc(candidate.symbol)} <span class="dir dir-${esc((record.analyticalDecision || '').toLowerCase())}">${esc(record.analyticalDecision || record.decision || 'SIN DECISIÓN')}</span></h3>
    <table class="levels">
      <tr><td>Entrada (disparador)</td><td>${fmtNum(plan?.trigger)}</td></tr>
      <tr><td>Entrada máxima</td><td>${fmtNum(plan?.maxEntry)}</td></tr>
      <tr><td>Stop</td><td>${fmtNum(plan?.stop)}</td></tr>
      <tr><td>Objetivo 1 (TP1)</td><td>${fmtNum(plan?.tp1)}</td></tr>
      <tr><td>Objetivo 2 (TP2)</td><td>${fmtNum(plan?.tp2)}</td></tr>
      <tr><td>R:R a TP1</td><td>${rr != null ? rr.toFixed(2) + ' : 1' : '—'}</td></tr>
      <tr><td>Régimen / estrategia</td><td>${esc(record.regime || '—')} · ${esc(record.strategy || '—')}</td></tr>
      <tr><td>Confianza técnica</td><td>${record.technicalConfidence != null ? esc(record.technicalConfidence) + '%' : '—'}</td></tr>
      <tr><td>Calidad de datos</td><td>${record.dataQualityScore != null ? esc(record.dataQualityScore) + '/100' : '—'}</td></tr>
    </table>
    <p class="conviction"><strong>Madurez de gobernanza:</strong> ${esc(conviction.label)} — ${esc(conviction.detail)}</p>
    ${record.authorizationReasons?.length ? `<p class="invalidation"><strong>Razonamiento / invalidación:</strong> ${esc(record.authorizationReasons.join(' '))}</p>` : ''}
    <p class="sources"><strong>Fuentes de este análisis:</strong> ${esc(sources)}</p>
  </section>`;
}

function renderCandidateRow(candidate) {
  return `<tr>
    <td>${esc(candidate.symbol)}</td>
    <td>${esc(candidate.market)}</td>
    <td>${esc(directionLabel(candidate.direction))}</td>
    <td>${esc(candidate.score)}</td>
    <td>${esc(candidate.description)}</td>
  </tr>`;
}

/**
 * @param {object} data
 * @param {string} data.generatedAtIso
 * @param {Array} data.candidates - {symbol, market, direction, score, description}
 * @param {Array<{candidate:object, record:object|null}>} data.deepDive - candidatos destacados con su registro de análisis, si existe
 * @param {object|null} data.vix - {value, observedAt, source} | null
 * @param {object|null} data.macro - {indicators:[{name,value,unit,observedAt,source}], errors:[]}
 * @param {Record<string,{edgar:object|null, sessionMetrics:object|null}>} data.stockDetails
 */
function buildDailyReportHtml(data) {
  const { fecha, ast, et } = formatDateTime(data.generatedAtIso);
  const candidates = data.candidates ?? [];
  const deepDive = data.deepDive ?? [];
  const deepDiveSymbols = new Set(deepDive.map(item => item.candidate.symbol));
  const summaryOnly = candidates.filter(c => !deepDiveSymbols.has(c.symbol));

  const vixSection = data.vix
    ? `<p><strong>VIX:</strong> ${fmtNum(data.vix.value, 2)} · observado ${esc(data.vix.observedAt || '—')} · fuente ${esc(data.vix.source || 'TradingView')}</p>`
    : `<p><strong>VIX:</strong> Dato no disponible.</p>`;

  const macroRows = (data.macro?.indicators ?? []).slice(0, 8).map(item =>
    `<tr><td>${esc(item.name)}</td><td>${esc(item.value)} ${esc(item.unit || '')}</td><td>${esc(item.source)}</td></tr>`
  ).join('');

  const deepDiveHtml = deepDive.map(item => renderDeepDive(item.candidate, item.record)).join('\n');

  const summaryRows = summaryOnly.map(renderCandidateRow).join('\n');

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe Sentinel</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#1a2433;font-size:12px;margin:32px;}
    h1{color:#0b3d63;font-size:22px;margin-bottom:4px;}
    h2{color:#0b3d63;font-size:16px;border-bottom:2px solid #0b3d63;padding-bottom:4px;margin-top:28px;}
    h3{color:#0b3d63;font-size:14px;margin-top:18px;}
    table{width:100%;border-collapse:collapse;margin:8px 0;}
    td,th{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;font-size:11px;}
    th{background:#0b3d63;color:#fff;}
    .meta{background:#f1f5f9;padding:10px 14px;border-radius:4px;}
    .deepdive{background:#f8fafc;border:1px solid #cbd5e1;border-radius:4px;padding:12px 16px;margin-bottom:14px;}
    .deepdive-missing{border:1px dashed #94a3b8;border-radius:4px;padding:10px 16px;margin-bottom:14px;color:#475569;}
    .dir{font-size:12px;padding:2px 8px;border-radius:3px;color:#fff;}
    .dir-buy_condicionado,.dir-buy{background:#166534;}
    .dir-sell_condicionado,.dir-sell{background:#991b1b;}
    .dir-esperar,.dir-no_operar_evento{background:#78716c;}
    .conviction,.invalidation,.sources{margin:6px 0;}
    .footer{margin-top:28px;font-size:10px;color:#64748b;border-top:1px solid #cbd5e1;padding-top:8px;}
    .limits{font-size:10.5px;color:#475569;}
  </style></head><body>
    <h1>Informe Sentinel — ${esc(fecha)}</h1>
    <div class="meta">
      <p>Corte: ${esc(ast)} AST (República Dominicana, sin horario de verano) · ${esc(et)} ET</p>
      <p>Alcance: candidatos verificables del escáner MT5 en el ciclo actual. Análisis profundo solo para símbolos con registro SMC guardado por Sentinel.</p>
    </div>

    <h2>Contexto de volatilidad</h2>
    ${vixSection}

    <h2>Indicadores macro</h2>
    ${macroRows ? `<table><tr><th>Indicador</th><th>Valor</th><th>Fuente</th></tr>${macroRows}</table>` : '<p>Dato no disponible.</p>'}

    <h2>Análisis destacado</h2>
    ${deepDiveHtml || '<p>Ningún candidato del ciclo actual tiene análisis SMC guardado hoy.</p>'}

    <h2>Resto de candidatos del escáner</h2>
    ${summaryRows ? `<table><tr><th>Símbolo</th><th>Mercado</th><th>Dirección</th><th>Score</th><th>Descripción</th></tr>${summaryRows}</table>` : '<p>Sin candidatos adicionales.</p>'}

    <h2>Límites conocidos de este informe</h2>
    <p class="limits">
      No incluye consenso de analistas ni precio objetivo a 12 meses: no es una fuente conectada en Sentinel.
      No incluye pivotes clásicos ni presupuesto de recorrido sobre ATR: ese motor no está construido todavía.
      El VWAP y el rango de apertura, cuando aparecen, solo se calculan durante la sesión regular de EE. UU.
      Este documento se compone de forma determinista a partir de datos verificables; ninguna IA origina un dato.
    </p>

    <div class="footer">
      Sentinel observa, compara y documenta; no ejecuta. La decisión final es de Julio.
      Generado automáticamente el ${esc(fecha)} a las ${esc(ast)} AST — los precios cambian mientras lees.
    </div>
  </body></html>`;
}

module.exports = { DAILY_REPORT_HTML_VERSION, buildDailyReportHtml, riskRewardOf, convictionFromGovernance };
