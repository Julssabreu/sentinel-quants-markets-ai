export const MARKET_CLASSES = [
  'FOREX',
  'CRYPTO',
  'STOCK',
  'INDEX',
  'ETF',
  'METAL',
  'COMMODITY',
  'FUTURE',
  'CFD',
  'BOND_RATE',
  'OPTION',
  'UNKNOWN',
] as const;

export type MarketClass = typeof MARKET_CLASSES[number];
export type ClassificationConfidence = 'EXACT' | 'INFERRED' | 'DECLARED' | 'UNKNOWN';
export type SymbolAliasProvider = 'INPUT' | 'CANONICAL' | 'MT5' | 'TRADINGVIEW' | 'BINANCE_SPOT';
export type InstrumentKind = 'SPOT' | 'CASH' | 'FUTURE' | 'CFD' | 'OPTION' | 'RATE' | 'UNKNOWN';

export interface ProviderSymbolAlias {
  provider: SymbolAliasProvider;
  symbol: string;
  exchange: string | null;
  origin: 'INPUT' | 'KNOWN' | 'DERIVED';
}

/**
 * Contract accepted by the multi-market router. `symbol` may be a Sentinel
 * canonical id, a provider symbol or a human-readable pair. A market hint is
 * a declaration, not proof; known aliases and explicit canonical ids take
 * precedence when they contradict it.
 */
export interface MarketAnalysisRequest {
  symbol: string;
  exchange?: string | null;
  marketHint?: Exclude<MarketClass, 'UNKNOWN'>;
  timeframe?: string | null;
  providerSymbols?: Partial<Record<Exclude<SymbolAliasProvider, 'CANONICAL'>, string>>;
  intent?: 'RESEARCH' | 'WATCH' | 'SIGNAL_VALIDATION';
  underlying?: {
    symbol: string;
    exchange?: string | null;
    marketHint?: Exclude<MarketClass, 'UNKNOWN' | 'CFD'>;
  };
  brokerMetadata?: {
    symbol?: string | null;
    description?: string | null;
    path?: string | null;
    category?: string | null;
    exchange?: string | null;
    isin?: string | null;
    sector?: string | null;
    industry?: string | null;
    currencyBase?: string | null;
    currencyProfit?: string | null;
    currencyMargin?: string | null;
    tradeCalcMode?: number | null;
  };
}

export interface UnderlyingIdentity {
  market: Exclude<MarketClass, 'UNKNOWN' | 'CFD'>;
  canonicalId: string;
  symbol: string;
  exchange: string | null;
}

export interface MarketClassification {
  market: MarketClass;
  instrumentKind: InstrumentKind;
  canonicalId: string;
  contractId: string;
  brokerSymbol: string | null;
  underlying: UnderlyingIdentity | null;
  symbol: string;
  exchange: string | null;
  confidence: ClassificationConfidence;
  aliases: ProviderSymbolAlias[];
  warnings: string[];
}

interface KnownInstrument {
  market: Exclude<MarketClass, 'UNKNOWN'>;
  canonicalId: string;
  symbol: string;
  exchange: string | null;
  match: string[];
  aliases: Omit<ProviderSymbolAlias, 'origin'>[];
}

const KNOWN_INSTRUMENTS: KnownInstrument[] = [
  {
    market: 'FOREX', canonicalId: 'FOREX:EUR/USD', symbol: 'EUR/USD', exchange: null,
    match: ['EUR/USD', 'EURUSD', 'OANDA:EURUSD', 'FX:EURUSD'],
    aliases: [
      { provider:'MT5', symbol:'EURUSD', exchange:null },
      { provider:'TRADINGVIEW', symbol:'OANDA:EURUSD', exchange:'OANDA' },
    ],
  },
  {
    market: 'CRYPTO', canonicalId: 'CRYPTO:BTC/USD', symbol: 'BTC/USD', exchange: null,
    match: ['BTC/USD', 'BTCUSD', 'BTCUSDT', 'BINANCE:BTCUSDT', 'BINANCE:BTCUSDT.P'],
    aliases: [
      { provider:'MT5', symbol:'BTCUSD', exchange:null },
      { provider:'TRADINGVIEW', symbol:'BINANCE:BTCUSDT', exchange:'BINANCE' },
      { provider:'BINANCE_SPOT', symbol:'BTCUSDT', exchange:'BINANCE' },
    ],
  },
  {
    market: 'STOCK', canonicalId: 'STOCK:NASDAQ:AAPL', symbol: 'AAPL', exchange: 'NASDAQ',
    match: ['AAPL', 'NASDAQ:AAPL'],
    aliases: [
      { provider:'MT5', symbol:'AAPL', exchange:null },
      { provider:'TRADINGVIEW', symbol:'NASDAQ:AAPL', exchange:'NASDAQ' },
    ],
  },
  {
    market: 'INDEX', canonicalId: 'INDEX:SPX', symbol: 'SPX', exchange: 'SP',
    match: ['SPX', 'SP:SPX', 'US500'],
    aliases: [
      { provider:'MT5', symbol:'SPX', exchange:null },
      { provider:'MT5', symbol:'US500', exchange:null },
      { provider:'TRADINGVIEW', symbol:'SP:SPX', exchange:'SP' },
    ],
  },
  {
    market: 'ETF', canonicalId: 'ETF:NYSEARCA:SPY', symbol: 'SPY', exchange: 'NYSEARCA',
    match: ['SPY', 'AMEX:SPY', 'NYSEARCA:SPY'],
    aliases: [
      { provider:'MT5', symbol:'SPY', exchange:null },
      { provider:'TRADINGVIEW', symbol:'AMEX:SPY', exchange:'AMEX' },
    ],
  },
  {
    market: 'METAL', canonicalId: 'METAL:XAU/USD', symbol: 'XAU/USD', exchange: null,
    match: ['XAU/USD', 'XAUUSD', 'OANDA:XAUUSD'],
    aliases: [
      { provider:'MT5', symbol:'XAUUSD', exchange:null },
      { provider:'TRADINGVIEW', symbol:'OANDA:XAUUSD', exchange:'OANDA' },
    ],
  },
  {
    market: 'FUTURE', canonicalId: 'FUTURE:NYMEX:CL1!', symbol: 'CL1!', exchange: 'NYMEX',
    match: ['CL1!', 'NYMEX:CL1!'],
    aliases: [
      { provider:'MT5', symbol:'CL', exchange:null },
      { provider:'TRADINGVIEW', symbol:'NYMEX:CL1!', exchange:'NYMEX' },
    ],
  },
  {
    market: 'BOND_RATE', canonicalId: 'BOND_RATE:US10Y', symbol: 'US10Y', exchange: null,
    match: ['US10Y', 'TVC:US10Y'],
    aliases: [
      { provider:'TRADINGVIEW', symbol:'TVC:US10Y', exchange:'TVC' },
    ],
  },
];

const CRYPTO_CODES = new Set(['BTC','ETH','SOL','XRP','ADA','DOGE','BNB','LTC','AVAX','DOT','LINK']);
const FIAT_CODES = new Set(['USD','EUR','GBP','JPY','CHF','AUD','CAD','NZD','CNY','CNH','HKD','SGD','NOK','SEK','DKK','MXN','BRL','ZAR','TRY','PLN']);
const METAL_CODES = new Set(['XAU','XAG','XPT','XPD']);
const INDEX_SYMBOLS = new Set(['SPX','NDX','DJI','RUT','VIX','DAX','CAC40','FTSE','NIKKEI','STOXX50']);
const ETF_SYMBOLS = new Set(['SPY','QQQ','IWM','DIA','VOO','VTI','GLD','SLV','TLT','HYG','EEM','XLF','XLK']);
const COMMODITY_SYMBOLS = new Set(['WTI','BRENT','NATGAS','COPPER','CORN','WHEAT','SOYBEAN','COCOA','COFFEE']);
const STOCK_EXCHANGES = new Set(['NASDAQ','NYSE','AMEX','NYSEARCA','LSE','TSX','ASX','HKEX','XETR','EURONEXT','BME','BMV','TSE','SSE','SZSE']);

const upper = (value: unknown) => String(value ?? '').trim().toUpperCase();
const compact = (value: string) => upper(value).replace(/[\s_\-./]/g, '');
const safeIdPart = (value: string) => upper(value).replace(/[^A-Z0-9!._/-]/g, '_') || 'UNSPECIFIED';

function uniqueWarnings(values: string[]): string[] {
  return [...new Set(values)];
}

function splitExplicitCanonical(raw: string): {market: Exclude<MarketClass, 'UNKNOWN'> | null; value: string} {
  const match = raw.match(/^(FOREX|CRYPTO|STOCK|INDEX|ETF|METAL|COMMODITY|FUTURE|CFD|BOND_RATE|OPTION):(.+)$/);
  return match
    ? { market:match[1] as Exclude<MarketClass, 'UNKNOWN'>, value:match[2] }
    : { market:null, value:raw };
}

/**
 * Sufijos de plaza que los brókers MT5 añaden al símbolo de acciones y CFDs.
 * Sin quitarlos, `AAPL.US` se clasificaba como UNKNOWN mientras `AAPL` daba STOCK.
 */
const BROKER_VENUE_SUFFIXES = new Set(['US', 'USA', 'NAS', 'NASDAQ', 'NYSE', 'ARCA', 'AMEX', 'OTC']);

/**
 * Elimina el sufijo de plaza sólo cuando es uno conocido. Un punto que no lo sea se
 * conserva: en `BRK.B` indica clase de acción, y perderlo apuntaría a otra cotización.
 */
function stripBrokerVenueSuffix(raw: string): string {
  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return raw;
  const suffix = raw.slice(separator + 1);
  const base = raw.slice(0, separator);
  return BROKER_VENUE_SUFFIXES.has(suffix) && base ? base : raw;
}

function splitExchange(raw: string): {exchange: string | null; symbol: string} {
  const parts = raw.split(':');
  return parts.length === 2 && parts[0] && parts[1]
    ? { exchange:parts[0], symbol:parts[1] }
    : { exchange:null, symbol:raw };
}

function knownInstrument(raw: string, symbol: string): KnownInstrument | null {
  if (raw.includes(':')) return KNOWN_INSTRUMENTS.find(item => item.match.includes(raw)) ?? null;
  return KNOWN_INSTRUMENTS.find(item => item.match.includes(raw) || item.match.includes(symbol)) ?? null;
}

function normalizePair(symbol: string): {base:string; quote:string; display:string} | null {
  const withoutPerpetual = symbol.replace(/(?:\.P|PERP)$/i, '');
  const direct = withoutPerpetual.match(/^([A-Z]{3,5})\/([A-Z]{3,5})$/);
  if (direct) return { base:direct[1], quote:direct[2], display:`${direct[1]}/${direct[2]}` };

  const joined = compact(withoutPerpetual);
  for (const quote of ['USDT','USDC','USD','EUR','GBP','JPY','CHF','AUD','CAD','NZD']) {
    if (joined.endsWith(quote) && joined.length > quote.length) {
      const base = joined.slice(0, -quote.length);
      return { base, quote, display:`${base}/${quote === 'USDT' || quote === 'USDC' ? 'USD' : quote}` };
    }
  }
  return null;
}

function requiresExchange(market: MarketClass): boolean {
  return ['STOCK','ETF','FUTURE','OPTION'].includes(market);
}

function canonicalFor(market: MarketClass, symbol: string, exchange: string | null): string {
  if (market === 'UNKNOWN') return `UNKNOWN:${safeIdPart(symbol)}`;
  if (requiresExchange(market) && exchange) return `${market}:${safeIdPart(exchange)}:${safeIdPart(symbol)}`;
  return `${market}:${safeIdPart(symbol)}`;
}

function defaultInstrumentKind(market: MarketClass): InstrumentKind {
  if (market === 'FOREX' || market === 'CRYPTO' || market === 'METAL') return 'SPOT';
  if (market === 'STOCK' || market === 'INDEX' || market === 'ETF' || market === 'COMMODITY') return 'CASH';
  if (market === 'FUTURE') return 'FUTURE';
  if (market === 'OPTION') return 'OPTION';
  if (market === 'BOND_RATE') return 'RATE';
  if (market === 'CFD') return 'CFD';
  return 'UNKNOWN';
}

function metadataLooksLikeCfd(request: MarketAnalysisRequest): boolean {
  const metadata = request.brokerMetadata;
  return [metadata?.description, metadata?.path, metadata?.category]
    .some(value => /(?:^|[^A-Z])CFD(?:[^A-Z]|$)/i.test(String(value ?? '')));
}

function cfdUnderlyingRequest(
  request: MarketAnalysisRequest,
  explicitValue: string,
): MarketAnalysisRequest | null {
  if (request.underlying) {
    return {
      symbol: request.underlying.symbol,
      exchange: request.underlying.exchange,
      marketHint: request.underlying.marketHint,
      intent: request.intent,
    };
  }
  const cleaned = explicitValue
    .replace(/^CFD[.:_-]/i, '')
    .replace(/(?:[._-]CFD)$/i, '');
  if (!cleaned || cleaned === explicitValue && !/^CFD:/i.test(request.symbol)) return null;
  return { symbol: cleaned, exchange: request.exchange, intent: request.intent };
}

function aliasesFor(
  request: MarketAnalysisRequest,
  canonicalId: string,
  normalizedSymbol: string,
  exchange: string | null,
  known: KnownInstrument | null,
): ProviderSymbolAlias[] {
  const aliases: ProviderSymbolAlias[] = [
    { provider:'INPUT', symbol:upper(request.symbol), exchange:request.exchange ? upper(request.exchange) : null, origin:'INPUT' },
    { provider:'CANONICAL', symbol:canonicalId, exchange, origin:'DERIVED' },
    ...(known?.aliases.map(alias => ({...alias, origin:'KNOWN' as const})) ?? []),
  ];

  for (const [provider, value] of Object.entries(request.providerSymbols ?? {})) {
    if (!value) continue;
    aliases.push({
      provider:provider as Exclude<SymbolAliasProvider, 'CANONICAL'>,
      symbol:upper(value),
      exchange:null,
      origin:'INPUT',
    });
  }

  if (!known && ['FOREX','CRYPTO','METAL'].some(market => canonicalId.startsWith(`${market}:`))) {
    aliases.push({ provider:'MT5', symbol:compact(normalizedSymbol), exchange:null, origin:'DERIVED' });
  }
  if (!known && exchange) {
    aliases.push({ provider:'TRADINGVIEW', symbol:`${exchange}:${normalizedSymbol}`, exchange, origin:'DERIVED' });
  }

  const seen = new Set<string>();
  return aliases.filter(alias => {
    const key = `${alias.provider}|${alias.symbol}|${alias.exchange ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function classifyMarket(request: MarketAnalysisRequest | string): MarketClassification {
  const normalizedRequest: MarketAnalysisRequest = typeof request === 'string' ? {symbol:request} : request;
  const rawInput = upper(normalizedRequest.symbol);
  const warnings: string[] = [];
  if (!rawInput) {
    return {
      market:'UNKNOWN', instrumentKind:'UNKNOWN', canonicalId:'UNKNOWN:UNSPECIFIED',
      contractId:'UNKNOWN:UNSPECIFIED', brokerSymbol:null, underlying:null,
      symbol:'', exchange:null, confidence:'UNKNOWN',
      aliases:[], warnings:['No se recibió un símbolo para clasificar.'],
    };
  }

  const explicit = splitExplicitCanonical(rawInput);
  const withoutVenue = stripBrokerVenueSuffix(explicit.value);
  if (withoutVenue !== explicit.value)
    warnings.push(`Se interpretó ${explicit.value} como ${withoutVenue} más sufijo de plaza del bróker.`);
  const explicitValue = splitExchange(withoutVenue);
  const exchangeFromInput = upper(normalizedRequest.exchange) || explicitValue.exchange;
  const symbol = upper(explicitValue.symbol);
  const known = knownInstrument(withoutVenue, symbol);

  let market: MarketClass = 'UNKNOWN';
  let confidence: ClassificationConfidence = 'UNKNOWN';
  let resolvedSymbol = symbol;
  let resolvedExchange = exchangeFromInput;

  if (explicit.market) {
    market = explicit.market;
    confidence = 'DECLARED';
  } else if (known) {
    market = known.market;
    resolvedSymbol = known.symbol;
    resolvedExchange = exchangeFromInput || known.exchange;
    confidence = 'EXACT';
    if (normalizedRequest.marketHint && normalizedRequest.marketHint !== known.market) {
      warnings.push(`El alias conocido ${rawInput} pertenece a ${known.market}; se ignoró la declaración ${normalizedRequest.marketHint}.`);
    }
  } else {
    const pair = normalizePair(symbol);
    const option = symbol.match(/^[A-Z][A-Z0-9.]{0,9}\d{6}[CP]\d{8}$/);
    const bondRate = symbol.match(/^(?:US|DE|GB|JP|CA|AU)(?:0?[2-9]|[1-3]0)Y$/) || /^(?:BOND|RATE|YIELD)[._-]/.test(symbol);

    if (normalizedRequest.marketHint) {
      market = normalizedRequest.marketHint;
      confidence = 'DECLARED';
    } else if (exchangeFromInput === 'OPRA' || option) {
      market = 'OPTION'; confidence = 'INFERRED';
    } else if (exchangeFromInput === 'CFD' || /^CFD[.:_-]/.test(symbol) || /(?:\.CFD|_CFD)$/.test(symbol)) {
      market = 'CFD'; confidence = 'INFERRED';
    } else if (/\d!$/.test(symbol) || /^(?:FUTURE|FUT)[._-]/.test(symbol)) {
      market = 'FUTURE'; confidence = 'INFERRED';
    } else if (bondRate) {
      market = 'BOND_RATE'; confidence = 'INFERRED';
    } else if (pair && CRYPTO_CODES.has(pair.base) && (FIAT_CODES.has(pair.quote) || ['USDT','USDC'].includes(pair.quote))) {
      market = 'CRYPTO'; resolvedSymbol = pair.display; confidence = 'INFERRED';
    } else if (pair && METAL_CODES.has(pair.base) && FIAT_CODES.has(pair.quote)) {
      market = 'METAL'; resolvedSymbol = pair.display; confidence = 'INFERRED';
    } else if (pair && FIAT_CODES.has(pair.base) && FIAT_CODES.has(pair.quote)) {
      market = 'FOREX'; resolvedSymbol = pair.display; confidence = 'INFERRED';
    } else if (INDEX_SYMBOLS.has(symbol)) {
      market = 'INDEX'; confidence = 'INFERRED';
    } else if (ETF_SYMBOLS.has(symbol)) {
      market = 'ETF'; confidence = 'INFERRED';
    } else if (COMMODITY_SYMBOLS.has(symbol)) {
      market = 'COMMODITY'; confidence = 'INFERRED';
    } else if (exchangeFromInput && STOCK_EXCHANGES.has(exchangeFromInput) && /^[A-Z][A-Z0-9.-]{0,11}$/.test(symbol)) {
      market = 'STOCK'; confidence = 'INFERRED';
    }
  }

  if (market === 'UNKNOWN') {
    warnings.push(`No se pudo clasificar ${rawInput} de forma segura; indique mercado y, cuando corresponda, bolsa.`);
  }
  if (requiresExchange(market) && !exchangeFromInput) {
    warnings.push(`Falta la bolsa o mercado de contratación para ${resolvedSymbol}; confirme el exchange antes del análisis operativo.`);
  }
  let canonicalId = known && !explicit.market
    ? known.canonicalId
    : canonicalFor(market, resolvedSymbol, resolvedExchange);
  let contractId = canonicalId;
  let instrumentKind = defaultInstrumentKind(market);
  let underlying: UnderlyingIdentity | null = null;

  const isCfd = market === 'CFD' || metadataLooksLikeCfd(normalizedRequest);
  if (isCfd) {
    instrumentKind = 'CFD';
    const underlyingRequest = market === 'CFD'
      ? cfdUnderlyingRequest(normalizedRequest, explicit.value)
      : {
          symbol: resolvedSymbol,
          exchange: resolvedExchange,
          marketHint: market === 'UNKNOWN' ? undefined : market,
          intent: normalizedRequest.intent,
        };
    const resolvedUnderlying = underlyingRequest ? classifyMarket(underlyingRequest) : null;
    if (resolvedUnderlying && resolvedUnderlying.market !== 'UNKNOWN' && resolvedUnderlying.market !== 'CFD') {
      underlying = {
        market: resolvedUnderlying.market,
        canonicalId: resolvedUnderlying.canonicalId,
        symbol: resolvedUnderlying.symbol,
        exchange: resolvedUnderlying.exchange,
      };
      market = resolvedUnderlying.market;
      canonicalId = resolvedUnderlying.canonicalId;
      resolvedSymbol = resolvedUnderlying.symbol;
      resolvedExchange = resolvedUnderlying.exchange;
      contractId = `CFD:${safeIdPart(normalizedRequest.brokerMetadata?.symbol || normalizedRequest.symbol)}`;
      warnings.push('El precio, spread y contrato corresponden al CFD; el contexto analítico corresponde a su subyacente resuelto.');
    } else {
      contractId = `CFD:${safeIdPart(normalizedRequest.brokerMetadata?.symbol || normalizedRequest.symbol)}`;
      warnings.push('CFD sin subyacente inequívoco: solo admite lectura técnica descriptiva, no un plan operativo completo.');
    }
  }

  return {
    market,
    instrumentKind,
    canonicalId,
    contractId,
    brokerSymbol:upper(normalizedRequest.brokerMetadata?.symbol) || null,
    underlying,
    symbol:resolvedSymbol,
    exchange:resolvedExchange,
    confidence,
    aliases:aliasesFor(normalizedRequest, canonicalId, resolvedSymbol, resolvedExchange, known),
    warnings:uniqueWarnings(warnings),
  };
}
