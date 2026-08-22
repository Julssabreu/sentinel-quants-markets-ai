CREATE TABLE IF NOT EXISTS market_observations (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL CHECK (source = 'TRADINGVIEW'),
  raw_symbol TEXT NOT NULL,
  exchange TEXT,
  market_type TEXT,
  timeframe TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL,
  currency TEXT,
  base_currency TEXT,
  received_at TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source, raw_symbol, timeframe, observed_at),
  CHECK (high >= low),
  CHECK (high >= open AND high >= close),
  CHECK (low <= open AND low <= close),
  CHECK (volume IS NULL OR volume >= 0)
);

CREATE INDEX IF NOT EXISTS idx_market_observations_lookup
  ON market_observations (raw_symbol, timeframe, observed_at DESC);
