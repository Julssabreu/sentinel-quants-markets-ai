/**
 * Cuándo volver a pedir el snapshot de EDGAR.
 *
 * La primera versión de este guardia recordaba el último ticker consultado y no
 * caducaba nunca: un 8-K presentado más tarde el mismo día no aparecía hasta reiniciar
 * la aplicación. Para un producto que existe para responder "¿qué cambió hoy?", eso es
 * un fallo funcional, no una optimización pendiente.
 *
 * Vive fuera del hook a propósito: así la decisión es una función pura verificable,
 * en vez de lógica enterrada en un efecto de React.
 */

/** Un 8-K presentado a las 10:00 debe estar visible hacia las 10:15. */
export const EDGAR_REFRESH_TTL_MS = 15 * 60 * 1000;

export interface EdgarRequestState {
  ticker: string;
  requestedAt: number;
}

export function shouldRequestEdgar(
  previous: EdgarRequestState | null,
  ticker: string | null,
  now: number,
  ttlMs: number = EDGAR_REFRESH_TTL_MS,
): boolean {
  if (!ticker) return false;
  if (!previous || previous.ticker !== ticker) return true;
  if (!Number.isFinite(previous.requestedAt)) return true;
  return now - previous.requestedAt >= ttlMs;
}
