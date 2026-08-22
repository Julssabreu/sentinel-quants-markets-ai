const UPSERT_VIX_DAILY_SQL = `
  INSERT INTO vix_daily (
    id, source, symbol, raw_symbol, exchange, timeframe, observation_date,
    value, open, high, low, close, observed_at, received_at, metadata,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (source, symbol, observation_date) DO UPDATE SET
    raw_symbol=excluded.raw_symbol,
    exchange=excluded.exchange,
    timeframe=excluded.timeframe,
    value=excluded.value,
    open=excluded.open,
    high=excluded.high,
    low=excluded.low,
    close=excluded.close,
    observed_at=excluded.observed_at,
    received_at=excluded.received_at,
    metadata=excluded.metadata,
    updated_at=excluded.updated_at
  WHERE
    vix_daily.raw_symbol IS NOT excluded.raw_symbol
    OR vix_daily.exchange IS NOT excluded.exchange
    OR vix_daily.timeframe IS NOT excluded.timeframe
    OR vix_daily.value IS NOT excluded.value
    OR vix_daily.open IS NOT excluded.open
    OR vix_daily.high IS NOT excluded.high
    OR vix_daily.low IS NOT excluded.low
    OR vix_daily.close IS NOT excluded.close
    OR vix_daily.observed_at IS NOT excluded.observed_at
    OR vix_daily.metadata IS NOT excluded.metadata
`;

const SELECT_VIX_HISTORY_SQL = `
  SELECT
    id,
    source,
    symbol,
    raw_symbol AS rawSymbol,
    exchange,
    timeframe,
    observation_date AS observationDate,
    value,
    open,
    high,
    low,
    close,
    observed_at AS observedAt,
    received_at AS receivedAt,
    metadata,
    updated_at AS updatedAt
  FROM vix_daily
  ORDER BY observation_date DESC, observed_at DESC
  LIMIT ?
`;

function nullableNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function parseMetadata(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function mapVixObservation(row) {
  return {
    id: row.id,
    source: 'TRADINGVIEW',
    contextType: 'MARKET_CONTEXT',
    symbol: 'VIX',
    rawSymbol: row.rawSymbol,
    exchange: row.exchange ?? null,
    timeframe: 'D1',
    observationDate: row.observationDate,
    value: Number(row.value),
    open: nullableNumber(row.open),
    high: nullableNumber(row.high),
    low: nullableNumber(row.low),
    close: nullableNumber(row.close),
    observedAt: row.observedAt,
    receivedAt: row.receivedAt,
    metadata: parseMetadata(row.metadata),
    updatedAt: row.updatedAt
  };
}

export async function upsertVixDaily(db, observation) {
  const result = await db.prepare(UPSERT_VIX_DAILY_SQL).bind(
    observation.id,
    observation.source,
    observation.symbol,
    observation.rawSymbol,
    observation.exchange,
    observation.timeframe,
    observation.observationDate,
    observation.value,
    observation.open,
    observation.high,
    observation.low,
    observation.close,
    observation.observedAt,
    observation.receivedAt,
    observation.metadataJson,
    observation.receivedAt,
    observation.receivedAt
  ).run();

  return Number(result.meta?.changes ?? 0) > 0;
}

export async function getVixHistory(db, limit) {
  const selected = await db.prepare(SELECT_VIX_HISTORY_SQL).bind(limit).all();
  return (selected.results ?? []).map(mapVixObservation);
}

export async function checkVixDatabase(db) {
  try {
    await db.prepare(`
      SELECT id, observation_date, value, observed_at, received_at
      FROM vix_daily
      LIMIT 0
    `).all();
    return true;
  } catch {
    return false;
  }
}

export async function purgeVixHistory(db, cutoffDate) {
  await db.prepare(`
    DELETE FROM vix_daily
    WHERE observation_date < ?
  `).bind(cutoffDate).run();
}
