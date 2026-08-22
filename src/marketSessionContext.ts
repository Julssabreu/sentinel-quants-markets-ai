import type { MarketClass } from './marketArchitecture';
import { SENTINEL_QUANT_VERSIONS } from './sentinelQuantVersions';

export type MarketSession = 'ASIA' | 'LONDON' | 'NEW_YORK' | 'LONDON_NEW_YORK_OVERLAP' | 'PREMARKET' | 'REGULAR' | 'POSTMARKET' | 'CRYPTO_24_7' | 'FUTURES_SESSION' | 'CLOSED' | 'UNKNOWN';
export interface MarketSessionContext {
  timestampUtc: string;
  hourOfDay: number;
  dayOfWeek: number;
  session: MarketSession;
  minutesFromSessionOpen: number | null;
  minutesFromSessionClose: number | null;
  weekend: boolean;
  version: string;
}

const minutes = (date: Date) => date.getUTCHours() * 60 + date.getUTCMinutes();
export function getMarketSessionContext(assetClass: MarketClass, timestamp: string | number | Date): MarketSessionContext {
  const date = new Date(timestamp), minute = minutes(date), dayOfWeek = date.getUTCDay(), weekend = dayOfWeek === 0 || dayOfWeek === 6;
  let session: MarketSession = 'UNKNOWN', open: number | null = null, close: number | null = null;
  if (assetClass === 'CRYPTO') { session = 'CRYPTO_24_7'; open = 0; close = 1440; }
  else if (assetClass === 'FOREX' || assetClass === 'METAL') {
    if (weekend) session = 'CLOSED';
    else if (minute >= 12 * 60 && minute < 16 * 60) { session = 'LONDON_NEW_YORK_OVERLAP'; open = 720; close = 960; }
    else if (minute >= 7 * 60 && minute < 16 * 60) { session = 'LONDON'; open = 420; close = 960; }
    else if (minute >= 12 * 60 && minute < 21 * 60) { session = 'NEW_YORK'; open = 720; close = 1260; }
    else { session = 'ASIA'; open = 0; close = 420; }
  } else if (assetClass === 'STOCK' || assetClass === 'ETF' || assetClass === 'INDEX') {
    if (weekend) session = 'CLOSED';
    else if (minute >= 8 * 60 && minute < 13 * 60 + 30) { session = 'PREMARKET'; open = 480; close = 810; }
    else if (minute >= 13 * 60 + 30 && minute < 20 * 60) { session = 'REGULAR'; open = 810; close = 1200; }
    else if (minute >= 20 * 60 && minute < 24 * 60) { session = 'POSTMARKET'; open = 1200; close = 1440; }
    else session = 'CLOSED';
  } else if (assetClass === 'FUTURE' || assetClass === 'COMMODITY') session = 'FUTURES_SESSION';
  return {
    timestampUtc:date.toISOString(), hourOfDay:date.getUTCHours(), dayOfWeek, session,
    minutesFromSessionOpen:open == null ? null : minute - open,
    minutesFromSessionClose:close == null ? null : close - minute,
    weekend, version:SENTINEL_QUANT_VERSIONS.sessionContext,
  };
}
