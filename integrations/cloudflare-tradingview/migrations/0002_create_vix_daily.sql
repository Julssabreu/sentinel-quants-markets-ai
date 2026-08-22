CREATE TABLE IF NOT EXISTS vix_daily (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL CHECK (source = 'TRADINGVIEW'),
  symbol TEXT NOT NULL CHECK (symbol = 'VIX'),
  raw_symbol TEXT NOT NULL,
  exchange TEXT,
  timeframe TEXT NOT NULL CHECK (timeframe = 'D1'),
  observation_date TEXT NOT NULL,
  value REAL NOT NULL CHECK (value > 0),
  open REAL CHECK (open IS NULL OR open > 0),
  high REAL CHECK (high IS NULL OR high > 0),
  low REAL CHECK (low IS NULL OR low > 0),
  close REAL CHECK (close IS NULL OR close > 0),
  observed_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source, symbol, observation_date),
  CHECK (length(observation_date) = 10),
  CHECK (high IS NULL OR low IS NULL OR high >= low),
  CHECK (high IS NULL OR open IS NULL OR high >= open),
  CHECK (low IS NULL OR open IS NULL OR low <= open),
  CHECK (high IS NULL OR high >= value),
  CHECK (low IS NULL OR low <= value),
  CHECK (close IS NULL OR close = value)
);

CREATE INDEX IF NOT EXISTS idx_vix_daily_recent
  ON vix_daily (observation_date DESC, observed_at DESC);
