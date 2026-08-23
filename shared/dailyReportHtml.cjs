'use strict';
/**
 * Construye el HTML del informe de premercado y posmercado — solo acciones de EE. UU.
 * Función pura: recibe datos ya obtenidos y devuelve una cadena; no hace red ni
 * consulta IA.
 *
 * Estructura calcada de los dos reportes de referencia que Julio compartió (uno de
 * premercado/posmercado, otro intradía preparado para su tío). Limitada a lo que
 * Sentinel puede respaldar con una fuente real:
 *
 * - Sin consenso de analistas ni precio objetivo a 12 meses: no es una fuente
 *   conectada.
 * - Sin precios de premercado/posmercado ni rango de horario extendido: el feed MT5
 *   de CFDs no los trae, y el bróker de acciones (TradeStation / Interactive Brokers)
 *   todavía no está decidido ni conectado. Esta sección se declara explícitamente no
 *   disponible en vez de aproximarla con datos de sesión regular.
 * - Los catalizadores verificables vienen de SEC EDGAR (8-K, 10-Q, 10-K reales, con
 *   enlace al documento), no de un titular resumido.
 */

const DAILY_REPORT_HTML_VERSION = '2.0.0';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function formatDateTime(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return { fecha: iso, ast: '', et: '' };
  const fecha = date.toLocaleDateString('es-DO', { timeZone:'America/Santo_Domingo', day:'2-digit', month:'long', year:'numeric' });
  const ast = date.toLocaleTimeString('es-DO', { timeZone:'America/Santo_Domingo', hour:'2-digit', minute:'2-digit', hour12:false });
  const et = date.toLocaleTimeString('en-US', { timeZone:'America/New_York', hour:'2-digit', minute:'2-digit', hour12:false });
  return { fecha, ast, et };
}

/**
 * Fecha (en ET) del último cierre de sesión regular antes de `now`.
 *
 * El informe corre todos los días del calendario, incluidos sábado y domingo. Un
 * lunes a las 9:00 AST, "el cierre regular anterior" es el del viernes, no el de un
 * domingo que nunca existió como sesión. No tiene en cuenta feriados de mercado
 * (Sentinel no tiene un calendario de feriados conectado); solo resuelve el caso de
 * fin de semana, que es el que se repite cada semana sin excepción.
 */
function previousRegularSessionCloseDate(now) {
  const et = new Date(now.toLocaleString('en-US', { timeZone:'America/New_York' }));
  const dayOfWeek = et.getDay(); // 0 = domingo, 1 = lunes, 6 = sábado
  const daysBack = dayOfWeek === 0 ? 2 : dayOfWeek === 1 ? 3 : 1;
  const close = new Date(et);
  close.setDate(close.getDate() - daysBack);
  return close.toLocaleDateString('es-DO', { timeZone:'America/New_York', day:'2-digit', month:'long', year:'numeric' });
}

function directionLabel(direction) {
  if (direction === 'BUY' || direction === 'LONG') return 'ALCISTA';
  if (direction === 'SELL' || direction === 'SHORT') return 'BAJISTA';
  return 'SIN SESGO';
}

function pct(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function renderExtendedHoursRow(item, window) {
  const data = item[window];
  if (!data) return null;
  const cls = Number.isFinite(data.changePercent) ? (data.changePercent >= 0 ? 'up' : 'down') : '';
  return `<tr>
    <td>${esc(item.ticker)}</td>
    <td>${Number.isFinite(item.previousClose) ? item.previousClose.toFixed(2) : '—'}</td>
    <td>${Number.isFinite(data.last) ? data.last.toFixed(2) : '—'}</td>
    <td class="${cls}">${pct(data.changePercent)}</td>
    <td>${Number.isFinite(data.low) ? data.low.toFixed(2) : '—'} – ${Number.isFinite(data.high) ? data.high.toFixed(2) : '—'}</td>
    <td>${esc(data.bars)}</td>
  </tr>`;
}

function renderExtendedHoursTable(items, window, emptyLabel) {
  const rows = (items ?? []).map(item => renderExtendedHoursRow(item, window)).filter(Boolean).join('\n');
  if (!rows) return `<p>${esc(emptyLabel)}</p>`;
  return `<table>
    <tr><th>Ticker</th><th>Cierre regular</th><th>Último</th><th>Var.</th><th>Rango</th><th>Barras</th></tr>
    ${rows}
  </table>`;
}

function renderCatalystRow(item) {
  const latest = item.filings?.[0];
  return `<tr>
    <td>${esc(item.ticker)}</td>
    <td>${esc(item.companyName || '—')}</td>
    <td>${latest ? esc(latest.form) : '—'}</td>
    <td>${latest ? esc(latest.filingDate) : '—'}</td>
    <td>${latest ? `<a href="${esc(latest.documentUrl)}">documento original</a>` : '—'}</td>
  </tr>`;
}

function renderStockRow(stock) {
  return `<tr>
    <td>${esc(stock.symbol)}</td>
    <td>${esc(directionLabel(stock.direction))}</td>
    <td>${esc(stock.score)}</td>
    <td>${esc(stock.description)}</td>
  </tr>`;
}

/**
 * @param {object} data
 * @param {string} data.generatedAtIso
 * @param {string} data.regularCloseLabel - p.ej. "cierre regular del 21 de agosto"
 * @param {{connected:boolean, brokerName:string|null}} data.extendedHoursSource
 * @param {object|null} data.vix - {value, observedAt, source} | null
 * @param {object|null} data.macro - {indicators:[{name,value,unit,observedAt,source}]}
 * @param {Array<{ticker:string, companyName:string|null, filings:Array, error:string|null}>} data.catalysts - de SEC EDGAR
 * @param {Array<{symbol:string, direction:string, score:number, description:string}>} data.stocks - universo de acciones observado hoy (sesión regular MT5)
 */
function buildDailyReportHtml(data) {
  const { fecha, ast, et } = formatDateTime(data.generatedAtIso);
  const generatedAt = new Date(data.generatedAtIso);
  const regularCloseLabel = data.regularCloseLabel
    || (Number.isFinite(generatedAt.getTime())
      ? `cierre regular del ${previousRegularSessionCloseDate(generatedAt)}, after-hours de ese día y premercado de hoy`
      : 'cierre regular anterior, after-hours y premercado');
  const extended = data.extendedHoursSource ?? { connected:false, brokerName:null };
  const catalysts = (data.catalysts ?? []).filter(item => !item.error && item.filings?.length);
  const stocks = data.stocks ?? [];

  const vixSection = data.vix
    ? `<p><strong>VIX:</strong> ${Number.isFinite(data.vix.value) ? data.vix.value.toFixed(2) : '—'} · observado ${esc(data.vix.observedAt || '—')} · fuente ${esc(data.vix.source || 'TradingView')}</p>`
    : `<p><strong>VIX:</strong> Dato no disponible.</p>`;

  const macroRows = (data.macro?.indicators ?? []).slice(0, 8).map(item =>
    `<tr><td>${esc(item.name)}</td><td>${esc(item.value)} ${esc(item.unit || '')}</td><td>${esc(item.source)}</td></tr>`
  ).join('');

  const catalystRows = catalysts.map(renderCatalystRow).join('\n');
  const stockRows = stocks.map(renderStockRow).join('\n');

  const extendedHoursBanner = extended.connected
    ? ''
    : `<div class="warning">
        <strong>Premercado y after-hours: dato no disponible.</strong>
        No hay una fuente de horario extendido conectada — el feed MT5 de CFDs solo
        entrega sesión regular. Actívala en Avisos automáticos configurando Massive.
        ${extended.error ? `<br>Detalle: ${esc(extended.error)}` : ''}
        Este informe no aproxima esos precios con datos de sesión regular.
      </div>`;

  const extendedHoursSections = extended.connected
    ? `<h2>Posmercado del ${esc(data.previousSessionDate || 'día anterior')}</h2>
       ${renderExtendedHoursTable(data.extendedHours, 'afterHours', 'Sin operaciones registradas en after-hours para el universo observado.')}

       <h2>Premercado del ${esc(data.currentSessionDate || 'día actual')}</h2>
       ${renderExtendedHoursTable(data.extendedHours, 'premarket', 'Sin operaciones registradas en premercado para el universo observado.')}`
    : '';

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe Sentinel — Premercado y posmercado</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#1a2433;font-size:12px;margin:32px;}
    h1{color:#0b3d63;font-size:22px;margin-bottom:4px;}
    h2{color:#0b3d63;font-size:16px;border-bottom:2px solid #0b3d63;padding-bottom:4px;margin-top:28px;}
    table{width:100%;border-collapse:collapse;margin:8px 0;}
    td,th{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;font-size:11px;}
    th{background:#0b3d63;color:#fff;}
    .meta{background:#f1f5f9;padding:10px 14px;border-radius:4px;}
    .warning{background:#fef3c7;border:1px solid #d97706;border-radius:4px;padding:10px 14px;margin:14px 0;color:#78350f;}
    .footer{margin-top:28px;font-size:10px;color:#64748b;border-top:1px solid #cbd5e1;padding-top:8px;}
    .limits{font-size:10.5px;color:#475569;}
    .up{color:#166534;font-weight:bold;}
    .down{color:#991b1b;font-weight:bold;}
    a{color:#0b3d63;}
  </style></head><body>
    <h1>Análisis de premercado y posmercado — Acciones de EE. UU.</h1>
    <div class="meta">
      <p>Corte: ${esc(ast)} AST (República Dominicana, sin horario de verano) · ${esc(et)} ET</p>
      <p>Alcance: ${esc(regularCloseLabel)}, acciones de EE. UU. únicamente.</p>
    </div>

    ${extendedHoursBanner}

    ${extendedHoursSections}

    <h2>Contexto de volatilidad</h2>
    ${vixSection}

    <h2>Indicadores macro</h2>
    ${macroRows ? `<table><tr><th>Indicador</th><th>Valor</th><th>Fuente</th></tr>${macroRows}</table>` : '<p>Dato no disponible.</p>'}

    <h2>Catalizadores verificables (SEC EDGAR)</h2>
    ${catalystRows ? `<table><tr><th>Ticker</th><th>Empresa</th><th>Formulario</th><th>Fecha</th><th>Documento</th></tr>${catalystRows}</table>` : '<p>Sin presentaciones recientes para el universo observado hoy.</p>'}

    <h2>Universo de acciones observado (sesión regular)</h2>
    <p class="limits">Precio y dirección de la última sesión regular disponible en MT5. No es una lectura de premercado.</p>
    ${stockRows ? `<table><tr><th>Símbolo</th><th>Sesgo</th><th>Score</th><th>Descripción</th></tr>${stockRows}</table>` : '<p>Sin candidatos de acciones en este ciclo.</p>'}

    <h2>Disciplina de ejecución</h2>
    <ul class="limits">
      <li>Esperar la confirmación de los primeros minutos de la sesión antes de actuar sobre cualquier gap.</li>
      <li>Usar orden limitada: el spread de horario extendido suele ser amplio.</li>
      <li>No perseguir gaps grandes sin retroceso, volumen y nivel de invalidación claro.</li>
      <li>Separar catalizador verificable (EDGAR) de simple movimiento especulativo.</li>
    </ul>

    <h2>Límites conocidos de este informe</h2>
    <p class="limits">
      No incluye consenso de analistas ni precio objetivo a 12 meses: no es una fuente conectada.
      ${extended.connected
        ? 'Los datos de horario extendido llegan con hasta 15 minutos de retraso (plan gratuito de Massive): suficiente para resumir lo ocurrido, no para ejecutar en vivo.'
        : 'No incluye precios ni movimientos de premercado o after-hours: sin fuente de horario extendido conectada (ver aviso arriba).'}
      Este documento se compone de forma determinista a partir de datos verificables; ninguna IA origina un dato.
    </p>

    <div class="footer">
      Sentinel observa, compara y documenta; no ejecuta. La decisión final es de Julio.
      Generado automáticamente el ${esc(fecha)} a las ${esc(ast)} AST — los precios cambian mientras lees.
    </div>
  </body></html>`;
}

module.exports = { DAILY_REPORT_HTML_VERSION, buildDailyReportHtml, previousRegularSessionCloseDate };
