const TIMEFRAME_ALIASES: Record<string, string> = {
  '1':'M1','2':'M2','3':'M3','4':'M4','5':'M5','6':'M6','10':'M10','12':'M12','15':'M15','20':'M20','30':'M30',
  '60':'H1','1H':'H1','120':'H2','2H':'H2','180':'H3','3H':'H3','240':'H4','4H':'H4','360':'H6','6H':'H6',
  '480':'H8','8H':'H8','720':'H12','12H':'H12','1D':'D1','D':'D1','1W':'W1','W':'W1','1M':'MN1','M':'MN1',
};

const SENTINEL_TIMEFRAMES = new Set([
  'M1','M2','M3','M4','M5','M6','M10','M12','M15','M20','M30','H1','H2','H3','H4','H6','H8','H12','D1','W1','MN1',
]);

export function normalizeTradingViewTimeframe(value: string): string | null {
  const key = String(value ?? '').trim().toUpperCase();
  const normalized = TIMEFRAME_ALIASES[key] ?? key;
  return SENTINEL_TIMEFRAMES.has(normalized) ? normalized : null;
}

export function normalizeTradingViewSymbol(value: string): string | null {
  const rawTicker = String(value ?? '').split(':').at(-1)?.trim().toUpperCase().replace(/(?:\.P|PERP)$/i, '') ?? '';
  const ticker = rawTicker.replace(/[^A-Z0-9]/g, '');
  if (!ticker) return null;
  const normalized = ticker.endsWith('USDT') ? `${ticker.slice(0, -4)}USD` : ticker;
  return /^(?:[A-Z]{3})(?:USD|EUR|GBP|JPY|CHF|AUD|CAD|NZD)$/.test(normalized)
    ? `${normalized.slice(0, 3)}/${normalized.slice(3)}`
    : normalized;
}

export function tradingViewSignalAgeMinutes(signal: TradingViewSignal, now = Date.now()): number {
  const emitted = new Date(signal.emittedAt || signal.receivedAt).getTime();
  return Number.isFinite(emitted) ? (now - emitted) / 60_000 : Number.POSITIVE_INFINITY;
}

export function isFreshTradingViewSignal(signal: TradingViewSignal, maxAgeMinutes: number, now = Date.now()): boolean {
  const age = tradingViewSignalAgeMinutes(signal, now);
  return age >= -5 && age <= Math.max(5, maxAgeMinutes);
}
