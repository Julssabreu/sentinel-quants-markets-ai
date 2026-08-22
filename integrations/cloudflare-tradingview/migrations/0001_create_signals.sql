CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL CHECK (source = 'TRADINGVIEW'),
  symbol TEXT NOT NULL,
  raw_symbol TEXT NOT NULL,
  exchange TEXT,
  timeframe TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  price REAL,
  emitted_at TEXT,
  received_at TEXT NOT NULL,
  strategy TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'LEASED', 'PROCESSED', 'EXPIRED', 'REJECTED')),
  verdict TEXT,
  detail TEXT,
  acknowledged_at TEXT,
  lease_token TEXT,
  lease_until TEXT,
  next_attempt_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_signals_claim
  ON signals (status, next_attempt_at, lease_until, received_at, id);
