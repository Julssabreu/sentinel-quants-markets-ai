export type VixAvailability = 'NO_DISPONIBLE' | 'INSUFICIENTE' | 'DISPONIBLE';
export type VixRegime = 'CALMA' | 'NORMAL' | 'ELEVADO' | 'ALTO' | 'EXTREMO';
export type VixTrend = 'SUBIENDO' | 'BAJANDO' | 'ESTABLE' | 'INSUFICIENTE';

export interface VixDailyPoint {
  /** Nombre canónico en Sentinel. El Worker actualmente entrega observationDate. */
  tradingDate?: string;
  observationDate?: string;
  value: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  observedAt: string;
  receivedAt: string;
}

export interface VixChange {
  fromTradingDate: string;
  toTradingDate: string;
  sessions: number;
  points: number;
  percent: number | null;
}

export interface VixContextAnalysis {
  kind: 'MARKET_CONTEXT';
  source: 'TRADINGVIEW_VIX_DAILY';
  ruleVersion: string;
  availability: VixAvailability;
  available: boolean;
  fresh: boolean;
  usableAsContext: boolean;
  vote: 'NO_VOTE';
  currentLevel: number | null;
  currentTradingDate: string | null;
  currentObservedAt: string | null;
  regime: VixRegime | null;
  trend: VixTrend;
  change1d: VixChange | null;
  change5Sessions: VixChange | null;
  score: number | null;
  businessDayLag: number | null;
  validSessions: number;
  rejectedPoints: number;
  reasons: string[];
}

export interface AnalyzeVixContextOptions {
  now?: Date;
}

/**
 * Reglas deliberadamente públicas y versionadas. El score representa tensión de
 * volatilidad (0 = mínima, 100 = extrema); nunca representa dirección operativa.
 */
export const VIX_CONTEXT_RULES = Object.freeze({
  version: 'VIX_CONTEXT_V1',
  marketTimeZone: 'America/New_York',
  minimumSessions: 6,
  freshness: Object.freeze({
    maxBusinessDayLag: 1,
  }),
  regimes: Object.freeze([
    Object.freeze({ name: 'CALMA' as const, minInclusive: 0, maxExclusive: 15 }),
    Object.freeze({ name: 'NORMAL' as const, minInclusive: 15, maxExclusive: 20 }),
    Object.freeze({ name: 'ELEVADO' as const, minInclusive: 20, maxExclusive: 25 }),
    Object.freeze({ name: 'ALTO' as const, minInclusive: 25, maxExclusive: 30 }),
    Object.freeze({ name: 'EXTREMO' as const, minInclusive: 30, maxExclusive: Infinity }),
  ]),
  trend: Object.freeze({
    oneSessionConfirmationPoints: 1,
    fiveSessionConfirmationPoints: 2,
    counterMoveTolerancePoints: 0.5,
  }),
  scoring: Object.freeze({
    levelAnchors: Object.freeze([
      Object.freeze({ level: 10, score: 0 }),
      Object.freeze({ level: 15, score: 20 }),
      Object.freeze({ level: 20, score: 40 }),
      Object.freeze({ level: 25, score: 60 }),
      Object.freeze({ level: 30, score: 80 }),
      Object.freeze({ level: 40, score: 100 }),
    ]),
    risingAdjustment: 8,
    fallingAdjustment: -5,
    stableAdjustment: 0,
  }),
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface NormalizedVixDailyPoint extends VixDailyPoint {
  tradingDate: string;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function parseTradingDate(value: string): Date | null {
  if (!DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? date
    : null;
}

function marketDate(now: Date): string | null {
  if (!Number.isFinite(now.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: VIX_CONTEXT_RULES.marketTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function businessDayLag(fromDate: string, toDate: string): number | null {
  const from = parseTradingDate(fromDate);
  const to = parseTradingDate(toDate);
  if (!from || !to || from.getTime() > to.getTime()) return null;

  let lag = 0;
  const cursor = new Date(from);
  while (cursor.getTime() < to.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) lag += 1;
  }
  return lag;
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function pointTradingDate(point: VixDailyPoint): string | null {
  const date = point.tradingDate ?? point.observationDate;
  if (!date || (point.tradingDate && point.observationDate && point.tradingDate !== point.observationDate)) {
    return null;
  }
  return parseTradingDate(date) ? date : null;
}

function isValidPoint(point: VixDailyPoint): boolean {
  if (!point || !pointTradingDate(point) || !isFiniteNonNegative(point.value)) return false;
  const optionalOhlc = [point.open, point.high, point.low];
  if (optionalOhlc.some((value) => value != null && !isFiniteNonNegative(value))) return false;
  if (point.high != null && point.low != null && point.high < point.low) return false;
  const tolerance = 0.0001;
  if (point.high != null && point.high + tolerance < point.value) return false;
  if (point.high != null && point.open != null && point.high + tolerance < point.open) return false;
  if (point.low != null && point.low - tolerance > point.value) return false;
  if (point.low != null && point.open != null && point.low - tolerance > point.open) return false;
  return Number.isFinite(Date.parse(point.observedAt)) && Number.isFinite(Date.parse(point.receivedAt));
}

function normalizePoints(points: readonly VixDailyPoint[]): {
  sessions: NormalizedVixDailyPoint[];
  rejectedPoints: number;
} {
  const byTradingDate = new Map<string, NormalizedVixDailyPoint>();
  let rejectedPoints = 0;

  for (const point of points) {
    if (!isValidPoint(point)) {
      rejectedPoints += 1;
      continue;
    }
    const tradingDate = pointTradingDate(point)!;
    const normalizedPoint: NormalizedVixDailyPoint = { ...point, tradingDate };
    const previous = byTradingDate.get(tradingDate);
    if (!previous) {
      byTradingDate.set(tradingDate, normalizedPoint);
      continue;
    }

    rejectedPoints += 1;
    if (Date.parse(point.receivedAt) > Date.parse(previous.receivedAt)) {
      byTradingDate.set(tradingDate, normalizedPoint);
    }
  }

  return {
    sessions: [...byTradingDate.values()].sort((left, right) =>
      left.tradingDate.localeCompare(right.tradingDate)),
    rejectedPoints,
  };
}

export function classifyVixRegime(level: number): VixRegime | null {
  if (!isFiniteNonNegative(level)) return null;
  return VIX_CONTEXT_RULES.regimes.find(
    (rule) => level >= rule.minInclusive && level < rule.maxExclusive,
  )?.name ?? null;
}

function calculateChange(
  from: NormalizedVixDailyPoint,
  to: NormalizedVixDailyPoint,
  sessions: number,
): VixChange {
  const points = to.value - from.value;
  return {
    fromTradingDate: from.tradingDate,
    toTradingDate: to.tradingDate,
    sessions,
    points: round(points),
    percent: from.value > 0 ? round((points / from.value) * 100) : null,
  };
}

function classifyTrend(change1d: VixChange, change5Sessions: VixChange): VixTrend {
  const rules = VIX_CONTEXT_RULES.trend;
  const rising = (
    change1d.points >= rules.oneSessionConfirmationPoints
    && change5Sessions.points >= 0
  ) || (
    change5Sessions.points >= rules.fiveSessionConfirmationPoints
    && change1d.points >= -rules.counterMoveTolerancePoints
  );
  const falling = (
    change1d.points <= -rules.oneSessionConfirmationPoints
    && change5Sessions.points <= 0
  ) || (
    change5Sessions.points <= -rules.fiveSessionConfirmationPoints
    && change1d.points <= rules.counterMoveTolerancePoints
  );

  if (rising && !falling) return 'SUBIENDO';
  if (falling && !rising) return 'BAJANDO';
  return 'ESTABLE';
}

function interpolateLevelScore(level: number): number {
  const anchors = VIX_CONTEXT_RULES.scoring.levelAnchors;
  if (level <= anchors[0].level) return anchors[0].score;
  const last = anchors[anchors.length - 1];
  if (level >= last.level) return last.score;

  for (let index = 1; index < anchors.length; index += 1) {
    const upper = anchors[index];
    const lower = anchors[index - 1];
    if (level <= upper.level) {
      const position = (level - lower.level) / (upper.level - lower.level);
      return lower.score + position * (upper.score - lower.score);
    }
  }
  return last.score;
}

function scoreVix(level: number, trend: Exclude<VixTrend, 'INSUFICIENTE'>): number {
  const adjustments = VIX_CONTEXT_RULES.scoring;
  const adjustment = trend === 'SUBIENDO'
    ? adjustments.risingAdjustment
    : trend === 'BAJANDO'
      ? adjustments.fallingAdjustment
      : adjustments.stableAdjustment;
  return Math.round(clamp(interpolateLevelScore(level) + adjustment, 0, 100));
}

export function analyzeVixContext(
  points: readonly VixDailyPoint[],
  options: AnalyzeVixContextOptions = {},
): VixContextAnalysis {
  const now = options.now ?? new Date();
  const normalized = normalizePoints(points);
  const { sessions, rejectedPoints } = normalized;
  const latest = sessions.at(-1) ?? null;
  const available = latest !== null;
  const availability: VixAvailability = !available
    ? 'NO_DISPONIBLE'
    : sessions.length < VIX_CONTEXT_RULES.minimumSessions
      ? 'INSUFICIENTE'
      : 'DISPONIBLE';
  const today = marketDate(now);
  const lag = latest && today ? businessDayLag(latest.tradingDate, today) : null;
  const fresh = available
    && lag !== null
    && lag <= VIX_CONTEXT_RULES.freshness.maxBusinessDayLag;
  const currentLevel = latest?.value ?? null;
  const regime = currentLevel === null ? null : classifyVixRegime(currentLevel);
  const previous = sessions.at(-2);
  const fiveSessionsAgo = sessions.at(-6);
  const change1d = latest && previous ? calculateChange(previous, latest, 1) : null;
  const change5Sessions = latest && fiveSessionsAgo
    ? calculateChange(fiveSessionsAgo, latest, 5)
    : null;
  const trend = change1d && change5Sessions
    ? classifyTrend(change1d, change5Sessions)
    : 'INSUFICIENTE';
  const usableAsContext = availability === 'DISPONIBLE' && fresh && trend !== 'INSUFICIENTE';
  const score = usableAsContext && currentLevel !== null
    ? scoreVix(currentLevel, trend)
    : null;

  const reasons: string[] = [];
  if (!latest) {
    reasons.push('VIX no disponible: no hay observaciones diarias válidas.');
  } else {
    reasons.push(`VIX ${latest.value.toFixed(2)} en régimen ${regime} (${latest.tradingDate}).`);
  }

  if (rejectedPoints > 0) {
    reasons.push(`${rejectedPoints} punto(s) inválido(s) o duplicado(s) fueron ignorados.`);
  }

  if (availability === 'INSUFICIENTE') {
    reasons.push(
      `Historial insuficiente: ${sessions.length}/${VIX_CONTEXT_RULES.minimumSessions} sesiones válidas; no se calcula score contextual.`,
    );
  }

  if (latest && lag === null) {
    reasons.push('No se pudo determinar la frescura o la fecha de mercado está en el futuro.');
  } else if (latest && fresh) {
    reasons.push(
      `Dato vigente con ${lag} día(s) hábil(es) de rezago; fines de semana no cuentan.`,
    );
  } else if (latest) {
    reasons.push(
      `Dato atrasado: ${lag} día(s) hábil(es) de rezago; no aporta score contextual.`,
    );
  }

  if (change1d && change5Sessions) {
    reasons.push(
      `Tendencia ${trend}: ${change1d.points >= 0 ? '+' : ''}${change1d.points.toFixed(2)} puntos en 1 sesión y ${change5Sessions.points >= 0 ? '+' : ''}${change5Sessions.points.toFixed(2)} en 5 sesiones.`,
    );
  } else if (latest) {
    reasons.push('Tendencia INSUFICIENTE: se requieren seis cierres diarios válidos.');
  }

  if (score !== null) {
    reasons.push(`Score de tensión ${score}/100; es contexto de riesgo, no una dirección operativa.`);
  }
  reasons.push('El VIX no emite votos ni señales BUY/SELL.');

  return {
    kind: 'MARKET_CONTEXT',
    source: 'TRADINGVIEW_VIX_DAILY',
    ruleVersion: VIX_CONTEXT_RULES.version,
    availability,
    available,
    fresh,
    usableAsContext,
    vote: 'NO_VOTE',
    currentLevel,
    currentTradingDate: latest?.tradingDate ?? null,
    currentObservedAt: latest?.observedAt ?? null,
    regime,
    trend,
    change1d,
    change5Sessions,
    score,
    businessDayLag: lag,
    validSessions: sessions.length,
    rejectedPoints,
    reasons,
  };
}

const CONSERVATIVE_RISK_ON_SYMBOLS = new Set([
  'SPX', 'SP500', 'US500', 'US500CASH', 'SPY',
  'NDX', 'NASDAQ100', 'NAS100', 'US100', 'US100CASH', 'QQQ',
  'DJI', 'DJ30', 'US30', 'US30CASH',
  'RUT', 'RUSSELL2000', 'US2000', 'IWM',
  'BTCUSD', 'BTCUSDT', 'ETHUSD', 'ETHUSDT',
]);

/**
 * Clasificación conservadora y puramente descriptiva. Deliberadamente excluye
 * divisas, materias primas y VIX; el consumidor decide después cómo usarla.
 */
export function isConservativeRiskOnAsset(symbol: string): boolean {
  const withoutExchange = symbol.trim().toUpperCase().split(':').at(-1) ?? '';
  const normalized = withoutExchange.replace(/[^A-Z0-9]/g, '');
  return CONSERVATIVE_RISK_ON_SYMBOLS.has(normalized);
}
