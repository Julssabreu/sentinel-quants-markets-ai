'use strict';
/**
 * Construye el HTML del informe de premercado y posmercado — solo acciones de EE. UU.
 * Función pura: recibe datos ya obtenidos y devuelve una cadena; no hace red ni
 * consulta IA.
 *
 * Estructura calcada del informe de referencia que Julio compartió (18 de agosto de
 * 2026), limitada a lo que Sentinel puede respaldar con una fuente real y verificable:
 *
 * - Índices, premercado, posmercado y universo del día: Massive (antes Polygon.io).
 * - Rendimientos del Tesoro: fuente oficial ya conectada.
 * - VIX: TradingView vía Cloudflare.
 * - Catalizadores de resultados: SEC EDGAR, con enlace al documento primario.
 * - Noticias: Massive, con editorial identificado y enlace al artículo.
 *
 * NO incluye consenso ni objetivos de analistas (UBS, Citi, etc.): no existe una
 * fuente gratuita y verificable para eso. Se declara como límite en vez de inventarlo.
 */

const DAILY_REPORT_HTML_VERSION = '3.0.0';

const INDEX_LABELS = Object.freeze({
  SPY: 'S&P 500', QQQ: 'Nasdaq 100', DIA: 'Dow Jones', IWM: 'Russell 2000',
});

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function pct(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function money(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function moveClass(value) {
  if (!Number.isFinite(value)) return '';
  return value >= 0 ? 'up' : 'down';
}

function formatDateTime(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return { fecha: iso, ast: '', et: '' };
  return {
    fecha: date.toLocaleDateString('es-DO', { timeZone:'America/Santo_Domingo', weekday:'long', day:'2-digit', month:'long', year:'numeric' }),
    ast: date.toLocaleTimeString('es-DO', { timeZone:'America/Santo_Domingo', hour:'2-digit', minute:'2-digit', hour12:false }),
    et: date.toLocaleTimeString('en-US', { timeZone:'America/New_York', hour:'2-digit', minute:'2-digit', hour12:false }),
  };
}

/**
 * Sesgo base derivado del premercado de los índices. Es una lectura mecánica del dato,
 * no una opinión: si no hay índices no se declara sesgo alguno.
 */
function deriveBias(indices) {
  const moves = (indices ?? []).map(i => i.premarket?.changePercent).filter(Number.isFinite);
  if (!moves.length) return { label: 'Sin datos suficientes', detail: 'No hay lecturas de premercado para los índices de referencia.' };
  const average = moves.reduce((sum, value) => sum + value, 0) / moves.length;
  const qqq = (indices ?? []).find(i => i.ticker === 'QQQ')?.premarket?.changePercent;
  const spy = (indices ?? []).find(i => i.ticker === 'SPY')?.premarket?.changePercent;
  const techLags = Number.isFinite(qqq) && Number.isFinite(spy) && qqq < spy - 0.25;

  if (average <= -0.4)
    return { label: 'Defensivo', detail: `Los proxies de índice promedian ${pct(average)} en premercado.${techLags ? ' El Nasdaq va rezagado frente al S&P 500.' : ''}` };
  if (average >= 0.4)
    return { label: 'Constructivo', detail: `Los proxies de índice promedian ${pct(average)} en premercado.${techLags ? ' Aun así el Nasdaq va rezagado.' : ''}` };
  return { label: 'Mixto / selectivo', detail: `Los proxies de índice promedian ${pct(average)} en premercado.${techLags ? ' El Nasdaq va rezagado frente al S&P 500, señal compatible con rotación.' : ''}` };
}

function renderIndexRows(indices, window) {
  return (indices ?? []).map(index => {
    const data = index[window];
    if (!data) return `<tr><td>${esc(index.ticker)}</td><td>${esc(INDEX_LABELS[index.ticker] ?? '—')}</td><td colspan="2">Dato no disponible</td></tr>`;
    return `<tr>
      <td>${esc(index.ticker)}</td>
      <td>${esc(INDEX_LABELS[index.ticker] ?? '—')}</td>
      <td>${money(data.last)}</td>
      <td class="${moveClass(data.changePercent)}">${pct(data.changePercent)}</td>
    </tr>`;
  }).join('\n');
}

function renderMoverRows(movers, window) {
  return (movers ?? [])
    .filter(item => item[window])
    .sort((a, b) => Math.abs(b[window].changePercent ?? 0) - Math.abs(a[window].changePercent ?? 0))
    .map(item => {
      const data = item[window];
      return `<tr>
        <td>${esc(item.ticker)}</td>
        <td class="${moveClass(data.changePercent)}">${pct(data.changePercent)}</td>
        <td>${money(item.previousClose)}</td>
        <td>${money(data.last)}</td>
        <td>${money(data.low)} – ${money(data.high)}</td>
        <td>${esc(data.bars)}</td>
      </tr>`;
    }).join('\n');
}

function renderNews(newsItems) {
  if (!newsItems?.length) return '<p>Sin noticias recuperadas para el universo de hoy.</p>';
  return `<ul class="news">${newsItems.slice(0, 10).map(item => `<li>
    <strong>${esc(item.title)}</strong><br>
    <span class="muted">${esc(item.publisher ?? 'editorial no identificado')}${item.publishedAt ? ` · ${esc(String(item.publishedAt).slice(0, 10))}` : ''}${item.tickers?.length ? ` · ${esc(item.tickers.slice(0, 4).join(', '))}` : ''}</span>
    ${item.url ? `<br><a href="${esc(item.url)}">${esc(item.url)}</a>` : ''}
  </li>`).join('\n')}</ul>`;
}

function renderYields(macro) {
  const rows = (macro?.indicators ?? [])
    .filter(item => /yield|tesoro|treasury|tasa|sofr/i.test(`${item.name} ${item.category ?? ''}`))
    .slice(0, 6)
    .map(item => `<tr><td>${esc(item.name)}</td><td>${esc(item.value)} ${esc(item.unit ?? '')}</td><td>${esc(item.source)}</td></tr>`)
    .join('\n');
  return rows
    ? `<table><tr><th>Referencia</th><th>Valor</th><th>Fuente</th></tr>${rows}</table>`
    : '<p>Dato no disponible.</p>';
}

function renderCatalysts(catalysts) {
  const rows = (catalysts ?? [])
    .filter(item => !item.error && item.filings?.length)
    .map(item => {
      const latest = item.filings[0];
      return `<tr>
        <td>${esc(item.ticker)}</td>
        <td>${esc(item.companyName ?? '—')}</td>
        <td>${esc(latest.form)}</td>
        <td>${esc(latest.filingDate)}</td>
        <td><a href="${esc(latest.documentUrl)}">documento</a></td>
      </tr>`;
    }).join('\n');
  return rows
    ? `<table><tr><th>Ticker</th><th>Empresa</th><th>Formulario</th><th>Fecha</th><th>Fuente primaria</th></tr>${rows}</table>`
    : '<p>Sin presentaciones recientes ante la SEC para el universo observado.</p>';
}

function buildDailyReportHtml(data) {
  const { fecha, ast, et } = formatDateTime(data.generatedAtIso);
  const extended = data.extendedHoursSource ?? { connected:false, brokerName:null };
  const indices = data.indices ?? [];
  const movers = data.movers ?? [];
  const bias = deriveBias(indices);
  const holidays = data.marketHolidays ?? [];

  const banner = extended.connected ? '' : `<div class="warning">
      <strong>Premercado y after-hours: dato no disponible.</strong>
      No hay fuente de horario extendido conectada. Actívala en Avisos automáticos
      configurando Massive.${extended.error ? ` Detalle: ${esc(extended.error)}` : ''}
    </div>`;

  const premarketMoverRows = renderMoverRows(movers, 'premarket');
  const afterHoursMoverRows = renderMoverRows(movers, 'afterHours');

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe pre y posmercado</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#1a2433;font-size:11.5px;margin:30px;line-height:1.45;}
    h1{color:#0b3d63;font-size:21px;margin-bottom:2px;}
    h2{color:#0b3d63;font-size:15px;border-bottom:2px solid #0b3d63;padding-bottom:3px;margin-top:24px;}
    h3{color:#0b3d63;font-size:12.5px;margin:14px 0 4px;}
    table{width:100%;border-collapse:collapse;margin:6px 0;}
    td,th{border:1px solid #cbd5e1;padding:5px 7px;text-align:left;font-size:10.5px;}
    th{background:#0b3d63;color:#fff;}
    .meta{background:#f1f5f9;padding:9px 13px;border-radius:4px;}
    .meta p{margin:3px 0;}
    .warning{background:#fef3c7;border:1px solid #d97706;border-radius:4px;padding:9px 13px;margin:12px 0;color:#78350f;}
    .callout{background:#eff6ff;border-left:4px solid #0b3d63;padding:9px 13px;margin:10px 0;}
    .up{color:#166534;font-weight:bold;}
    .down{color:#991b1b;font-weight:bold;}
    .muted{color:#64748b;font-size:10px;}
    .news{padding-left:16px;}
    .news li{margin-bottom:7px;}
    .footer{margin-top:24px;font-size:9.5px;color:#64748b;border-top:1px solid #cbd5e1;padding-top:7px;}
    .limits{font-size:10px;color:#475569;}
    ol.checklist{padding-left:18px;} ol.checklist li{margin-bottom:3px;}
    a{color:#0b3d63;word-break:break-all;}
  </style></head><body>

    <h1>Informe pre y posmercado</h1>
    <p class="muted">Bolsa de valores de Estados Unidos</p>
    <div class="meta">
      <p><strong>Fecha:</strong> ${esc(fecha)}</p>
      <p><strong>Corte de datos:</strong> ${esc(ast)} hora de República Dominicana · ${esc(et)} ET</p>
      <p><strong>Alcance:</strong> cierre regular y after-hours del ${esc(data.previousSessionDate ?? '—')} + premercado del ${esc(data.currentSessionDate ?? '—')}.</p>
      <p><strong>Sesgo base:</strong> ${esc(bias.label)} — ${esc(bias.detail)}</p>
    </div>

    ${banner}

    <h2>1. Estado del mercado y apertura</h2>
    <h3>Cierre regular del ${esc(data.previousSessionDate ?? 'día anterior')}</h3>
    ${indices.length ? `<table><tr><th>Proxy</th><th>Índice</th><th>Cierre</th><th>Sesión</th></tr>${renderIndexRows(indices, 'previousRegular')}</table>` : '<p>Dato no disponible.</p>'}

    <h3>Premercado del ${esc(data.currentSessionDate ?? 'día actual')}</h3>
    ${indices.length ? `<table><tr><th>Proxy</th><th>Índice</th><th>Último</th><th>Variación</th></tr>${renderIndexRows(indices, 'premarket')}</table>` : '<p>Dato no disponible.</p>'}

    <div class="callout">
      <strong>Lectura:</strong> ${esc(bias.detail)}
      Los porcentajes son fotografías del premercado, no precios de ejecución: la validación
      real llega con el rango de los primeros 15–30 minutos de sesión regular.
    </div>

    <h2>2. Macro y riesgo de sesión</h2>
    <h3>Rendimientos y referencias de tasas</h3>
    ${renderYields(data.macro)}

    <h3>Volatilidad</h3>
    ${data.vix
      ? `<p><strong>VIX:</strong> ${money(data.vix.value)} · observado ${esc(data.vix.observedAt ?? '—')} · fuente ${esc(data.vix.source ?? 'TradingView')}</p>`
      : '<p><strong>VIX:</strong> Dato no disponible.</p>'}

    <h3>Escenarios para la sesión</h3>
    <table>
      <tr><th>Escenario</th><th>Confirmación</th><th>Respuesta prudente</th></tr>
      <tr><td>A · Continuación</td><td>Los proxies sostienen el gap y el Nasdaq no se deteriora frente al S&P 500.</td><td>Buscar retroceso controlado sobre VWAP; no comprar la primera vela.</td></tr>
      <tr><td>B · Rotación</td><td>Dow aguanta mientras el Nasdaq sigue rezagado.</td><td>Favorecer nombres con catalizador propio; evitar canastas indiscriminadas de tecnología.</td></tr>
      <tr><td>C · Reversión del gap</td><td>Los proxies pierden el cierre previo y los rendimientos suben.</td><td>No promediar pérdidas; exigir estructura de recuperación antes de considerar largos.</td></tr>
    </table>
    <p class="limits">Los escenarios son un marco de decisión fijo, no una predicción: la confirmación de cada uno se lee contra los datos de arriba.</p>

    ${holidays.length ? `<h3>Próximos cierres del mercado</h3>
      <table><tr><th>Fecha</th><th>Motivo</th><th>Estado</th></tr>
      ${holidays.slice(0, 4).map(h => `<tr><td>${esc(h.date)}</td><td>${esc(h.name ?? '—')}</td><td>${esc(h.status ?? '—')}</td></tr>`).join('')}
      </table>` : ''}

    <h2>3. Movimientos destacados del premercado</h2>
    ${premarketMoverRows
      ? `<table><tr><th>Ticker</th><th>Premercado</th><th>Cierre previo</th><th>Último</th><th>Rango</th><th>Barras</th></tr>${premarketMoverRows}</table>
         <p class="limits">Universo seleccionado por liquidez y movimiento de la sesión anterior sobre el mercado completo de EE. UU. Un porcentaje grande sin volumen no equivale a una oportunidad.</p>`
      : '<p>Sin operaciones de premercado registradas para el universo observado.</p>'}

    <h2>4. Posmercado del ${esc(data.previousSessionDate ?? 'día anterior')}</h2>
    ${afterHoursMoverRows
      ? `<table><tr><th>Ticker</th><th>After-hours</th><th>Cierre regular</th><th>Último</th><th>Rango</th><th>Barras</th></tr>${afterHoursMoverRows}</table>`
      : '<p>Sin operaciones registradas en after-hours para el universo observado.</p>'}

    <h3>Catalizadores verificables (SEC EDGAR)</h3>
    ${renderCatalysts(data.catalysts)}

    <h2>5. Noticias del universo observado</h2>
    ${renderNews(data.news)}

    <h2>6. Plan de apertura</h2>
    <ol class="checklist">
      <li>No comprar la primera vela: los primeros dos minutos no son una señal.</li>
      <li>Esperar 15–30 minutos para definir el rango inicial y el VWAP.</li>
      <li>Largo preferido: precio sobre VWAP, mínimo creciente, volumen comprador y el índice sin deteriorarse.</li>
      <li>Usar orden limitada: el spread de horario extendido suele ser amplio.</li>
      <li>No perseguir gaps grandes sin retroceso, volumen y nivel de invalidación definido.</li>
      <li>Separar catalizador verificable (presentación ante la SEC) de simple movimiento especulativo.</li>
      <li>Definir la pérdida máxima aceptable antes de entrar, no después.</li>
    </ol>

    <h2>7. Fuentes y metodología</h2>
    <h3>Fuentes consultadas</h3>
    <ul class="limits">
      <li><strong>Massive</strong> (antes Polygon.io): índices, premercado, after-hours, universo del día y noticias con editorial identificado.</li>
      <li><strong>SEC EDGAR</strong>: presentaciones 8-K, 10-Q y 10-K, con enlace al documento primario.</li>
      <li><strong>Reserva Federal y Tesoro de EE. UU.</strong>: rendimientos y referencias de tasas.</li>
      <li><strong>TradingView vía Cloudflare</strong>: contexto de volatilidad (VIX).</li>
    </ul>

    <h3>Metodología</h3>
    <p class="limits">
      El universo del día se obtiene de las barras diarias del mercado completo de EE. UU.
      y se filtra por precio y volumen en dólares antes de ordenar por movimiento absoluto:
      un salto porcentual sin liquidez detrás no es una señal de mercado. Las ventanas de
      premercado (04:00–09:30 ET), sesión regular y after-hours (16:00–20:00 ET) se
      delimitan contra la zona horaria real de Nueva York, no con un desfase fijo, para
      que sigan siendo correctas en horario de verano y de invierno.
    </p>

    <h3>Límites conocidos</h3>
    <p class="limits">
      <strong>No incluye consenso ni objetivos de precio de analistas</strong> (subidas de
      recomendación, precios objetivo a 12 meses): no existe una fuente gratuita y
      verificable conectada, y se prefiere declararlo antes que inventarlo.
      No incluye calendario de resultados futuros ni narrativa geopolítica.
      Los datos de horario extendido llegan con hasta 15 minutos de retraso: sirven para
      resumir lo ocurrido, no para ejecutar en vivo.
      Este documento se compone de forma determinista a partir de datos verificables;
      ninguna IA origina un dato.
    </p>

    <div class="footer">
      Uso educativo. Confirmar precios en el bróker antes de operar; los datos intradía
      cambian rápidamente. Sentinel observa, compara y documenta; no ejecuta.
      La decisión final es de Julio.
      Generado el ${esc(fecha)} a las ${esc(ast)} AST.
    </div>
  </body></html>`;
}

module.exports = { DAILY_REPORT_HTML_VERSION, buildDailyReportHtml, deriveBias };
