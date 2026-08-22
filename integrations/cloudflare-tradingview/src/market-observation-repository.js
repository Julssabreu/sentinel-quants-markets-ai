const UPSERT = `
  INSERT INTO market_observations (
    id, source, raw_symbol, exchange, market_type, timeframe, observed_at,
    open, high, low, close, volume, currency, base_currency,
    received_at, metadata, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source, raw_symbol, timeframe, observed_at) DO UPDATE SET
    exchange=excluded.exchange, market_type=excluded.market_type,
    open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close,
    volume=excluded.volume, currency=excluded.currency, base_currency=excluded.base_currency,
    received_at=excluded.received_at, metadata=excluded.metadata, updated_at=excluded.updated_at
  WHERE market_observations.open IS NOT excluded.open
     OR market_observations.high IS NOT excluded.high
     OR market_observations.low IS NOT excluded.low
     OR market_observations.close IS NOT excluded.close
     OR market_observations.volume IS NOT excluded.volume
`;

export async function upsertMarketObservation(db, observation) {
  const result = await db.prepare(UPSERT).bind(
    observation.id, observation.source, observation.rawSymbol, observation.exchange,
    observation.marketType, observation.timeframe, observation.observedAt,
    observation.open, observation.high, observation.low, observation.close, observation.volume,
    observation.currency, observation.baseCurrency, observation.receivedAt,
    observation.metadataJson, observation.receivedAt, observation.receivedAt
  ).run();
  return Number(result?.meta?.changes ?? 0) > 0;
}

export async function checkMarketObservationDatabase(db) {
  try {
    await db.prepare('SELECT id FROM market_observations LIMIT 1').all();
    return true;
  } catch {
    return false;
  }
}

export async function getMarketObservations(db, { symbol, timeframe = null, limit = 50 }) {
  const clauses = ['raw_symbol LIKE ?'];
  const bindings = [`%${symbol}`];
  if (timeframe) {
    clauses.push('timeframe = ?');
    bindings.push(timeframe);
  }
  bindings.push(limit);
  const result = await db.prepare(`
    SELECT id, source, raw_symbol, exchange, market_type, timeframe, observed_at,
           open, high, low, close, volume, currency, base_currency,
           received_at, metadata, updated_at
    FROM market_observations
    WHERE ${clauses.join(' AND ')}
    ORDER BY observed_at DESC
    LIMIT ?
  `).bind(...bindings).all();
  return (result?.results ?? []).map(row => ({
    id: row.id,
    source: row.source,
    contextType: 'MARKET_OBSERVATION',
    operationalSignal: false,
    rawSymbol: row.raw_symbol,
    exchange: row.exchange,
    marketType: row.market_type,
    timeframe: row.timeframe,
    observedAt: row.observed_at,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    currency: row.currency,
    baseCurrency: row.base_currency,
    receivedAt: row.received_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    updatedAt: row.updated_at
  }));
}

export async function purgeMarketObservations(db, cutoff) {
  return db.prepare('DELETE FROM market_observations WHERE observed_at < ?').bind(cutoff).run();
}
