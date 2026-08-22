const INSERT_SIGNAL_SQL = `
  INSERT OR IGNORE INTO signals (
    id, source, symbol, raw_symbol, exchange, timeframe, side,
    price, emitted_at, received_at, strategy, status, attempts
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0)
`;

const CLAIM_SIGNALS_SQL = `
  UPDATE signals
  SET
    status = 'LEASED',
    lease_token = ?,
    lease_until = ?,
    next_attempt_at = NULL,
    attempts = attempts + 1
  WHERE id IN (
    SELECT id
    FROM signals
    WHERE
      (status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
      OR (status = 'LEASED' AND lease_until <= ?)
    ORDER BY received_at ASC, id ASC
    LIMIT ?
  )
`;

const SELECT_CLAIM_SQL = `
  SELECT
    id,
    source,
    symbol,
    raw_symbol AS rawSymbol,
    exchange,
    timeframe,
    side,
    price,
    emitted_at AS emittedAt,
    received_at AS receivedAt,
    strategy,
    lease_token AS leaseToken,
    lease_until AS leaseUntil,
    attempts,
    detail AS retryReason
  FROM signals
  WHERE status = 'LEASED' AND lease_token = ?
  ORDER BY received_at ASC, id ASC
`;

function mapSignal(row) {
  return {
    id:row.id,
    source:'TRADINGVIEW',
    symbol:row.symbol,
    rawSymbol:row.rawSymbol,
    exchange:row.exchange ?? null,
    timeframe:row.timeframe,
    side:row.side,
    price:row.price === null || row.price === undefined ? null : Number(row.price),
    emittedAt:row.emittedAt ?? null,
    receivedAt:row.receivedAt,
    strategy:row.strategy ?? null,
    leaseToken:row.leaseToken,
    leaseUntil:row.leaseUntil,
    attempts:Number(row.attempts ?? 0),
    retryReason:row.retryReason ?? null
  };
}

export async function insertSignal(db, signal) {
  const result = await db
    .prepare(INSERT_SIGNAL_SQL)
    .bind(
      signal.id,
      signal.source,
      signal.symbol,
      signal.rawSymbol,
      signal.exchange,
      signal.timeframe,
      signal.side,
      signal.price,
      signal.emittedAt,
      signal.receivedAt,
      signal.strategy
    )
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}

export async function claimPendingSignals(db, { limit, now, leaseToken, leaseUntil }) {
  const [, selected] = await db.batch([
    db.prepare(CLAIM_SIGNALS_SQL).bind(leaseToken, leaseUntil, now, now, limit),
    db.prepare(SELECT_CLAIM_SQL).bind(leaseToken)
  ]);
  return (selected.results ?? []).map(mapSignal);
}

export async function acknowledgeSignal(db, id, acknowledgement, acknowledgedAt) {
  if (acknowledgement.status === 'RETRY') {
    const nextAttemptAt = new Date(Date.parse(acknowledgedAt) + acknowledgement.retryAfterSeconds * 1000).toISOString();
    const update = await db.prepare(`
      UPDATE signals
      SET status='PENDING', next_attempt_at=?, detail=?, lease_token=NULL, lease_until=NULL
      WHERE id=? AND status='LEASED' AND lease_token=?
    `).bind(nextAttemptAt, acknowledgement.detail, id, acknowledgement.leaseToken).run();
    if (Number(update.meta?.changes ?? 0) > 0) {
      return { found:true, alreadyAcknowledged:false, status:'PENDING', nextAttemptAt };
    }
  } else {
    const update = await db.prepare(`
      UPDATE signals
      SET status=?, verdict=?, detail=?, acknowledged_at=?, lease_token=NULL, lease_until=NULL, next_attempt_at=NULL
      WHERE id=? AND status='LEASED' AND lease_token=?
    `).bind(
      acknowledgement.status,
      acknowledgement.verdict,
      acknowledgement.detail,
      acknowledgedAt,
      id,
      acknowledgement.leaseToken
    ).run();
    if (Number(update.meta?.changes ?? 0) > 0) {
      return { found:true, alreadyAcknowledged:false, status:acknowledgement.status, nextAttemptAt:null };
    }
  }

  const existing = await db.prepare('SELECT status, lease_token AS leaseToken, next_attempt_at AS nextAttemptAt FROM signals WHERE id=?').bind(id).first();
  if (!existing) return { found:false, alreadyAcknowledged:false, leaseMismatch:false, status:null, nextAttemptAt:null };
  const terminal = ['PROCESSED','EXPIRED','REJECTED'].includes(existing.status);
  const retried = acknowledgement.status === 'RETRY' && existing.status === 'PENDING';
  return {
    found:true,
    alreadyAcknowledged:terminal || retried,
    leaseMismatch:!terminal && !retried && existing.leaseToken !== acknowledgement.leaseToken,
    status:existing.status,
    nextAttemptAt:existing.nextAttemptAt ?? null
  };
}

export async function checkDatabase(db) {
  try {
    await db.prepare(`
      SELECT id, status, received_at, lease_token, lease_until, next_attempt_at, attempts
      FROM signals
      LIMIT 0
    `).all();
    return true;
  } catch {
    return false;
  }
}

export async function purgeTerminalSignals(db, cutoff) {
  await db.prepare(`
    DELETE FROM signals
    WHERE status IN ('PROCESSED','EXPIRED','REJECTED') AND acknowledged_at < ?
  `).bind(cutoff).run();
}
