# Sentinel Quant Architecture

## Principle

SMC generates hypotheses. Market data provides facts. AI interprets context.
Quant requires statistical evidence. Risk limits exposure. Sentinel explains.
The user makes the final decision.

No TradingView alert, news item, language model, SMC pattern, or OpenClaw task
can authorize a trade by bypassing Quant and Risk.

## Target pipeline

```text
RAW SOURCES
  -> DATA QUALITY
  -> MARKET NORMALIZATION
  -> CANONICAL MARKET DATA
  -> SMC ENGINE
  -> SETUP FEATURE ENGINE
  -> QUANT ENGINE / QUANT GATE
  -> RISK ENGINE
  -> SENTINEL
  -> USER
```

The analysis plane remains separate from any future execution plane. The safe
default is `ANALYSIS_ONLY`; automatic execution is disabled.

## Single strategy

SMC is the only opportunity-generating strategy. ATR, EMA, RSI, news, macro,
sessions, volatility, and AI-derived context may become research features, but
they are not independent strategies.

The initial research profile is D1 -> H4 -> H1 -> M15 -> M5. Timeframe roles
are represented by a profile contract and are not assumed to be optimal for all
asset classes.

## Phase status

### Implemented foundation

- explicit component versions;
- candle data-quality report and blocking status contract;
- multi-market normalization in ATR, percent, basis points, and tick units;
- market-regime category plus continuous measurements;
- market/session time context;
- quantitative setup feature-vector contract;
- immutable historical setup-record contract;
- configurable SMC timeframe profile;
- continuous SMC measurements for sweep, displacement, FVG, M5 break,
  distance to liquidity, premium/discount, and planned R/R;
- causal cut-at-T regression test for the current SMC analysis contract.
- dataset provenance with deterministic checksums, provider identity, quality linkage, and actual date range;
- append-only, hash-chained research persistence for datasets, setups, experiments, audits, and models;
- injectable system/simulation clocks and explicit point-in-time candle windows;
- deterministic multi-timeframe synchronization that exposes only closed candles and rejects duplicate timestamps.
- research-only SMC backtester driven by the simulation clock and the production SMC analysis function;
- next-trigger-bar entry semantics, conservative same-bar stop/target resolution, and adverse stop-gap handling;
- gross versus net R with configurable spread, slippage, and round-trip commission;
- per-trade MAE/MFE and deterministic experiment output;
- reusable cut-at-T feature-leakage check that compares full-data and truncated-data results.
- causal candidate feature construction combining normalized trigger data, H1 regime context, session context, and continuous SMC facts;
- candidates without complete causal features are excluded from the statistical sample and counted as feature failures;
- historical setup records separate planned entry from simulated execution and retain experiment, dataset, profile, component versions, costs, MAE/MFE, and reason codes;
- append-only persistence adapter stores completed and non-executed candidates without fabricating outcomes.
- net-R statistics include expectancy confidence interval, PF, payoff, Sharpe/Sortino, drawdown duration, loss streaks, and profit concentration;
- deterministic segmentation by market, symbol, regime, session, direction, and volatility band;
- reproducible Experiment Registry contracts retain provenance checksums, parameters, seed, code/environment, and all component versions;
- deterministic Random Same-RR benchmark, purged chronological splits, rolling walk-forward, Monte Carlo bootstrap, ablation, perturbation robustness, and parameter-stability tools;
- Quant Gate requires configurable simultaneous sample, expectancy, PF, drawdown, OOS, walk-forward, paper, and sample-quality criteria;
- unified Decision Contract, deterministic Audit Trail reason codes, Model Registry, and manual Champion/Challenger promotion contract.
- normalized MT5 bars/quotes/contract specifications and TradingView alert events under one provider-independent market-data contract;
- canonical source policy per instrument, idempotent ingestion, stale-data rejection, latency timestamps, and explicit cross-source price-discrepancy records;
- TradingView actions remain metadata only and cannot replace the primary MT5 price or authorize a trade.
- news facts are stored idempotently and separately from versioned AI interpretations;
- instrument mapping is provider-independent and records matched rules and relevance, never trade probability;
- AI Context runs only for explicit events and degrades to `AI_CONTEXT_UNAVAILABLE` without blocking the deterministic Quant core.
- operational market/news journals are append-only and idempotent; an atomic schema-versioned snapshot retains checkpoints, active setups, and Champion references;
- restart recovery never re-enables live mode automatically and falls back to `ANALYSIS_ONLY` when integrity or authorization must be re-established.
- Shadow Mode records real-pipeline decisions, latency and theoretical outcomes without execution;
- Edge Monitor compares recent net-R evidence with the frozen reference and can recommend degradation, never mutate production automatically;
- Live Readiness requires all validation, data, execution, Quant, Risk and health gates while retaining mandatory manual approval.
- market-specific execution profiles resolve spread, slippage, commission, exchange fees, swap/funding, latency and partial fills through one common research interface;
- stress scenarios isolate provider failure from optional AI/news degradation and block safely when minimum fill or execution health is unavailable.
- quote/contract quality detects inverted or extreme spreads and precision, tick-size or contract changes without silently rewriting facts;
- dataset eligibility requires provenance, non-invalid quality and a linked quality report before Quant promotion.
- historical and live sources implement the same causal-feed contract driven by an injected clock;
- point-in-time context exposes market facts only after receipt, news only after arrival, and the latest macro vintage actually known at T;
- generic leakage invariance tests cover future news/macro/context in addition to candle cut-at-T checks.
- research families count tested variants and expose data-mining risk; observations must become queued Challenger experiments rather than Champion edits;
- structured reports keep observation, hypothesis, evidence and conclusion separate and never authorize automatic Champion changes.
- research-only deterministic SMC engines record causally confirmed HH/HL/LH/LL swings, close-confirmed BOS/CHOCH, ATR-normalized liquidity pools/sweeps, and measurable Order Blocks;
- these detectors are not wired into the current Champion; adoption requires feature versioning, ablation, OOS, walk-forward, paper and Shadow validation.
- FVG research records direction, bounds, ATR size/distance, age and mitigation; dealing ranges expose continuous position plus premium/equilibrium/discount using only the supplied causal window.
- Feature Set `2.0.0-challenger` converts deterministic structure, liquidity, FVG, Order Block, dealing-range and M5 evidence into continuous research variables while leaving the current Feature Set frozen;
- versioned ablation plans create a baseline plus one removal per SMC component and reject mixed-version comparisons.
- historical similarity uses configurable mixed continuous/categorical distance, excludes future observations and mismatched Feature Sets, and does not require exact setup matches;
- neighbor statistics remain research evidence and cannot grant Quant eligibility without OOS, walk-forward, paper, quality and Risk gates.
- hierarchical evidence reports Global, asset-class, symbol, regime and session statistics separately; higher-level evidence never grants inherited authorization;
- Sample Quality exposes quantity, temporal/regime/volatility diversity and independence components;
- correlated event/market episodes reduce effective sample size and prevent simultaneous related setups from inflating evidence.
- Quant Score is a versioned weighted summary with visible component values and is explicitly not a trade probability;
- probability output requires one explicit success definition/horizon plus calibration evidence, curve bins and Brier Score; inadequate samples suppress probability display.
- market-episode analysis exposes profit/loss concentration across trend, range, news and volatility-shock episodes;
- drawdown profiles include frequency, depth, duration and recovery by regime/session/event;
- Edge Monitor tracks configurable long-to-short rolling windows and may recommend probation/blocking while never changing production automatically.
- equity lifecycle metadata distinguishes raw/split/total-return histories and point-in-time corporate actions;
- futures contracts retain expiry/notice/roll/adjustment metadata; continuous and individual contracts cannot be treated as identical;
- crypto identities distinguish exchange, spot, perpetual and dated futures plus funding/settlement rules;
- market profiles configure sessions, costs and lifecycle requirements without creating additional strategies.
- secrets are referenced by environment/secure-store identifiers, never exposed to frontend contracts, and structured logs redact credentials, tokens and authorization headers;
- least-privilege profiles reject unnecessary or write scopes outside explicit Live operation;
- the global Kill Switch blocks new orders while preserving analysis; Live requires SMC + Quant + Risk + execution health + explicit mode + manual approval.
- human audit separates presented/accepted/rejected/modified plans and never attributes modified execution results to the pure strategy;
- rejected opportunities may receive research-only counterfactual MAE/MFE/outcomes while the original decision and reason codes remain immutable.
- structured observability aggregates setup/Quant/Risk/news/AI/webhook/data-quality rates and latency;
- provider heartbeats apply configurable freshness and latency windows, distinguishing critical feeds from optional context;
- operational alerts use category `SYSTEM`, separate from trading opportunities, and may trip safe blocking;
- Quant Health snapshots report Champion, rolling edge, OOS/Paper/Shadow, data and provider health without including signals.
- research exports support JSON/CSV immediately and Parquet through an explicit writer adapter; absence fails visibly rather than producing a fake format;
- retention plans never delete automatically and can retain only references/metadata when news licenses forbid content storage;
- backups copy research/audit state outside the source directory with SHA-256 manifest verification before restoration.
- the Laboratory primary UI represents one SMC research strategy with configurable multi-market, timeframe, cost, and risk inputs plus explicit validation gates;
- laboratory stages remain disabled until an eligible dataset is selected, and legacy evidence is never silently mixed with the versioned Quant sample.
- Electron exposes a narrow research IPC for listing registered datasets and preparing immutable `ANALYSIS_ONLY` experiments; invalid or unknown datasets are rejected before persistence.
- MT5 multi-timeframe imports exclude still-open bars, preserve the received order, generate per-timeframe quality reports, persist raw data separately, and register deterministic SHA-256 provenance; invalid imports remain auditable but cannot be selected for experiments.
- prepared experiments load raw data only after backend checksum verification, reuse the causal TypeScript SMC backtester, persist immutable setup records and a separate backtest-result record, and display net statistics explicitly as in-sample research rather than eligibility evidence.
- chronological validation freezes a separately identified OOS partition, purges temporal neighborhoods around split boundaries, and runs walk-forward only on development records after excluding every locked OOS setup.
- OOS Monte Carlo uses a recorded seed; Random Same-RR uses the OOS time window, trade count, average planned RR and execution costs; robustness applies labeled deterministic cost/removal scenarios and does not masquerade approximations as market replays.
- ablation governance registers one versioned Challenger per planned component removal, records data-mining risk and real engine capabilities, and blocks fabricated comparisons until a causal toggle runner exists; Order Blocks are explicitly identified as absent from the current Champion.
- the Challenger runner now supports causal FVG and M5-confirmation toggles while preserving Champion defaults; each executable variant receives isolated setup identifiers and immutable results, while coupled structure/sweep and absent Order Block variants remain blocked.
- Challenger validation applies the parent experiment's fixed chronological boundaries and purge to every variant, excludes each variant's OOS setups from its walk-forward, and suppresses formal comparison until minimum OOS evidence exists.
- parameter-stability research varies one parameter at a time across five-point neighborhoods, physically truncates every timeframe before locked OOS, stores 15 derived experiments, reports validation-region stability and never selects or applies an optimum automatically.
- Laboratory Quant Gate consolidates net backtest/OOS/walk-forward/Monte Carlo/robustness/sample-quality evidence with configurable thresholds; Paper and Shadow remain mandatory, and the gate contract always returns `tradeAuthorized: false`.

### Operational connection status

The research foundation remains intentionally separate from the legacy
`decisionEngine`, but it is now connected to persisted MT5 datasets, the
Laboratory, Paper and Shadow journals, provider health probes, operational
alerts and Live Readiness. This connection is observational and research-only:
it does not authorize live recommendations or orders. No installer is produced
by the implementation workflow.

## Implemented gates

1. Persistent Electron IPC integration and database migration path for the research store.
2. Expand execution profiles for asset classes, variable spread, latency, partial fills, funding, swap, and exchange fees.
3. Dataset ingestion must require a verified, non-invalid Data Quality report before eligibility research.
4. Statistical metrics, confidence intervals, and segmentation for the research laboratory.
5. Experiment Registry records tying code/data/configuration to every backtest.
4. Anti-look-ahead and feature-leakage suites.
5. Conservative execution/cost models and MAE/MFE.
6. Statistical metrics, benchmarks, walk-forward, OOS, Monte Carlo, ablation,
   robustness, and data-mining awareness.
7. Configurable Quant states: RESEARCH, PROBATION, PRELIMINARY, ELIGIBLE,
   BLOCKED. Sample size alone can never produce ELIGIBLE.
8. Paper and Shadow forward-only validation before any operational migration.
9. Champion/Challenger governance, audit trail, edge monitor, and rollback.

Implementation coverage for these gates is audited in
`SENTINEL_QUANT_COMPLETION_AUDIT.md`. Paper, Shadow and sustained provider
health still require real forward evidence; implementation does not fabricate
that evidence.

## Source separation

- MT5: primary broker-dependent market data and possible future execution layer.
- TradingView: complementary structured events; never an authorization source.
- News providers: factual news and metadata.
- Reuters/LSEG: future official adapter only; no scraping and no assumed access.
- AI providers: interpretation and explanation only; Quant works without them.

Every timestamp is normalized to UTC while retaining source, received, and
processing timestamps. Canonical prices from different providers are never
silently merged or overwritten.

## Version discipline

Every setup and experiment must retain strategy, feature, Quant, Risk,
execution, normalization, data-quality, session, and regime versions. A change
to rules, thresholds, or prompts creates a new research/challenger version;
historical records are never overwritten.
## Paper Trading forward-only

`paperTradingEngine.ts` implementa el ciclo determinista `PENDING_ENTRY -> OPEN -> CLOSED/BLOCKED` usando el mismo modelo de costes y salidas del backtester. Solo acepta decisiones `READY_TO_PRESENT`, entra en la siguiente vela cerrada, conserva MAE/MFE y nunca envía órdenes (`liveOrderSent=false`). Sus transiciones se persisten como eventos inmutables e idempotentes en el journal operacional `paper`.

Una repetición histórica no cuenta como Paper Trading. `PAPER_STABLE` requiere observaciones forward cerradas y umbrales configurables; hasta entonces el Quant Gate debe conservar `paperTradingStable=false`.

El coordinador reconstruye el último estado por `paperId` desde el journal después de reinicios. El Laboratorio lee ese journal en modo solo lectura y muestra muestra cerrada, expectancy y profit factor; no puede crear operaciones ni promover el modelo por sí mismo.

## Shadow Live

Shadow usa decisiones y feeds del pipeline real, pero `liveOrderSent=false` es inmutable. Simula la entrada en la siguiente vela cerrada con el mismo modelo de ejecución, registra costes, MAE/MFE, latencia, salud de feeds y salida conservadora. Sus eventos se guardan append-only y se reconstruyen por `shadowId` tras reinicios. La estabilidad exige muestra forward, expectancy/PF, latencia y feeds configurables; un replay histórico no satisface Shadow.

## Live Readiness

El coordinador consolida Backtest, OOS, Walk-Forward, Monte Carlo, Paper, Shadow, Data Quality, Execution Quality, Quant Edge, Risk y System Health. Produce `NOT_READY`, `CONDITIONAL` o `READY` con reason codes, referencias de evidencia y versiones. Incluso `READY` conserva `liveEnabled=false`, `executionAuthorized=false` y aprobación manual obligatoria. Los reportes requieren Backtest y OOS persistidos y se almacenan como resultados inmutables.

Risk Model Validation ejecuta escenarios deterministas para cada protección sin depender del edge. Execution Quality exige muestra, rendimiento bruto/neto y robustez bajo costes. Operational Health transforma heartbeats configurables en estado de readiness y bloquea ante fallos críticos. Si no existen heartbeats críticos reales, System Health permanece `MISSING`; nunca se presume saludable.
