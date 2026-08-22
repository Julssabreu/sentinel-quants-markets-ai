'use strict';
/**
 * Compone el texto corto que acompaña al PDF del informe diario por WhatsApp.
 * Función pura: recibe datos ya obtenidos y devuelve el mensaje en español. No hace
 * red, no consulta IA, no decide qué activo mirar — eso lo resuelve quien llama, en
 * electron/main.cjs.
 *
 * El detalle completo (niveles, VWAP, EDGAR, análisis por símbolo) vive en el PDF
 * adjunto (shared/dailyReportHtml.cjs); este texto es solo la vista previa que cabe
 * legible en una notificación de WhatsApp.
 */

const DAILY_REPORT_COMPOSER_VERSION = '2.0.0';

function formatDirection(direction) {
  if (direction === 'BUY') return 'COMPRA';
  if (direction === 'SELL') return 'VENTA';
  return 'SIN SESGO';
}

/**
 * @param {object} input
 * @param {string} input.generatedAtIso
 * @param {Array<{symbol:string, market:string, direction:string, score:number, description:string}>} input.candidates
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
  const maxCandidates = input.maxCandidates ?? 3;
  const shown = candidates.slice(0, maxCandidates);

  if (!shown.length) {
    lines.push('El escáner no encontró candidatos verificables en este ciclo.');
  } else {
    lines.push(`Vista previa (${shown.length} de ${candidates.length} candidatos verificables):`);
    shown.forEach((candidate, index) => {
      lines.push(`${index + 1}. ${candidate.symbol} (${candidate.market}) ${formatDirection(candidate.direction)} · score ${candidate.score}`);
    });
    lines.push('', 'Niveles, VWAP, SEC EDGAR y el resto del escáner van en el PDF adjunto.');
  }

  lines.push('', 'Sentinel observa, compara y documenta; no ejecuta. La decisión final es tuya.');

  return lines.join('\n');
}

module.exports = { DAILY_REPORT_COMPOSER_VERSION, composeDailyReportText };
