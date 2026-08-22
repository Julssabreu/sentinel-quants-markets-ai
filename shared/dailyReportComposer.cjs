'use strict';
/**
 * Compone el texto del informe diario. Función pura: recibe datos ya obtenidos
 * (escáner, EDGAR, VWAP/opening range) y devuelve el mensaje en español para
 * WhatsApp. No hace red, no consulta IA, no decide qué activo mirar — eso lo resuelve
 * quien llama, en electron/main.cjs.
 *
 * La IA redacta, nunca origina el dato: este compositor es la mitad determinista.
 * Si en el futuro se añade una capa de redacción con Claude, debe recibir este mismo
 * texto como evidencia y no reemplazar ningún número.
 */

const DAILY_REPORT_COMPOSER_VERSION = '1.0.0';

function formatDirection(direction) {
  if (direction === 'BUY') return 'COMPRA';
  if (direction === 'SELL') return 'VENTA';
  return 'SIN SESGO';
}

function formatVwapLine(vwap) {
  if (!vwap) return null;
  const basis = vwap.basis === 'REAL_VOLUME' ? 'volumen real' : 'proxy de ticks — no institucional';
  return `   VWAP: ${vwap.value.toFixed(4)} (${basis})`;
}

function formatOpeningRangeLine(openingRange) {
  if (!openingRange) return null;
  const breakout = openingRange.breakout === 'ABOVE' ? 'ruptura al alza confirmada'
    : openingRange.breakout === 'BELOW' ? 'ruptura a la baja confirmada'
    : 'sin ruptura confirmada';
  return `   Rango de apertura: ${openingRange.low.toFixed(4)}–${openingRange.high.toFixed(4)} (${breakout})`;
}

function formatEdgarLine(edgar) {
  if (!edgar || edgar.error || !edgar.filings.length) return null;
  const latest = edgar.filings[0];
  return `   SEC EDGAR: ${edgar.filings.length} presentaciones recientes; última ${latest.form} (${latest.filingDate}).`;
}

/**
 * @param {object} input
 * @param {string} input.generatedAtIso
 * @param {Array<{symbol:string, market:string, direction:string, score:number, description:string}>} input.candidates
 * @param {Record<string, {edgar: object|null, sessionMetrics: object|null}>} input.stockDetails - keyed por symbol
 * @param {number} [input.maxCandidates]
 */
function composeDailyReportText(input) {
  const generatedAt = new Date(input.generatedAtIso);
  const dateLabel = Number.isFinite(generatedAt.getTime())
    ? generatedAt.toLocaleDateString('es-DO', { timeZone: 'America/Santo_Domingo', day:'2-digit', month:'2-digit', year:'numeric' })
    : input.generatedAtIso;
  const timeLabel = Number.isFinite(generatedAt.getTime())
    ? generatedAt.toLocaleTimeString('es-DO', { timeZone: 'America/Santo_Domingo', hour:'2-digit', minute:'2-digit', hour12:false })
    : '';

  const lines = [`📊 *Informe Sentinel* — ${dateLabel} ${timeLabel} AST`, ''];

  const candidates = input.candidates ?? [];
  const maxCandidates = input.maxCandidates ?? 5;
  const shown = candidates.slice(0, maxCandidates);

  if (!shown.length) {
    lines.push('El escáner no encontró candidatos verificables en este ciclo.');
  } else {
    lines.push(`Candidatos del escáner (${shown.length} de ${candidates.length}):`);
    shown.forEach((candidate, index) => {
      lines.push(`${index + 1}. ${candidate.symbol} (${candidate.market}) ${formatDirection(candidate.direction)} · score ${candidate.score} — ${candidate.description}`);
      const detail = input.stockDetails?.[candidate.symbol];
      if (detail) {
        const vwapLine = formatVwapLine(detail.sessionMetrics?.vwap);
        const rangeLine = formatOpeningRangeLine(detail.sessionMetrics?.openingRange);
        const edgarLine = formatEdgarLine(detail.edgar);
        [vwapLine, rangeLine, edgarLine].filter(Boolean).forEach(line => lines.push(line));
      }
    });
  }

  lines.push('', 'Sentinel observa, compara y documenta; no ejecuta. La decisión final es tuya.');

  return lines.join('\n');
}

module.exports = { DAILY_REPORT_COMPOSER_VERSION, composeDailyReportText };
