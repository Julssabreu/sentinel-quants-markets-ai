# Auditoría técnica — origen de SENTINELQUANTS

Fecha: 2026-08-21
Base auditada: `source/` en el commit `9d59f8a` más el árbol de trabajo sin commitear.
Método: `tsc --noEmit`, `vitest run`, build de producción, `electron-builder`, y lectura
directa de los módulos citados.

## Estado de partida (medido, no estimado)

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | limpio, 0 errores |
| `vitest run` | 168 archivos, 498 pruebas en verde, 1 omitida |
| `npm run build` | correcto (2447 módulos + backend quant) |
| `verify:release-inputs` | correcto (bridge, EA, icono) |
| `electron-builder --win nsis` | correcto — instalador de 114 MB |

**Conclusión:** el proyecto no está roto en el sentido habitual. Compila, pasa sus
pruebas y produce instalador. Los defectos son de integración y de modelo de
ejecución, no de sintaxis. Por eso las pruebas en verde no los detectan: cada módulo
se prueba en aislamiento y casi la mitad nunca se ejecuta en la aplicación real.

---

## 1. Cuarenta y cinco módulos huérfanos

45 de 181 módulos de `src/` no son importados por ningún componente, hook ni por el
proceso principal. Están escritos y probados, pero no se ejecutan nunca en la app.

Agrupados por el eslabón de la cadena de Sentinel al que pertenecen:

- **Fuentes verificables (~17):** `mt5MarketDataAdapter`, `marketDataIngestion`,
  `marketDataQuality`, `symbolRegistry`, `instrumentMappingEngine`, `causalDataFeed`,
  `pointInTimeContext`, `newsEventStore`, `tradingViewEventAdapter`,
  `corporateActionEngine`, `cryptoInstrumentEngine`, `futuresContractEngine`,
  `marketConfigurationProfiles`, `marketEpisodeAnalysis`, `tradeStationAdapter`,
  `datasetEligibility`, `dataRetentionPolicy`
- **Cálculos deterministas (~15):** `quantScoreEngine`, `probabilityCalibration`,
  `featureLeakageGuard`, `hierarchicalEvidence`, `correlatedSampleEngine`,
  `drawdownRegimeAnalysis`, `setupSimilarityEngine`, `quantHealthSnapshot`,
  `quantCompletionAudit`, `quantSetupPersistence`, `quantBackendEntry`,
  `researchExport`, `experimentPersistence`, `strategyLearning`, `edgeMonitor`
- **Contraste crítico (5):** `counterfactualTracker`, `championChallenger`,
  `ablationEngine`, `strategyCompetition`, `executionStressEngine`
- **Revisión de IA (1):** `aiModelRouter`
- **Trazabilidad y gobernanza (8):** `auditTrail`, `humanDecisionAudit`,
  `observabilityEngine`, `operationalAlertEngine`, `operationalHealthCoordinator`,
  `executionAuthorization`, `providerPermissions`, `secretPolicy`

Los huérfanos no son restos aleatorios: son el **primer eslabón** de la cadena
(fuentes verificables) y el **contraste crítico**. Es decir, justo las dos cosas que
distinguen a Sentinel de un indicador que dice BUY/SELL.

## 2. Dos implementaciones SMC en paralelo; corre la débil

`smcStrategy.ts` (224 líneas) está conectado a `autonomousRuntime`,
`StrategyWorkspace`, `quantBacktestRunner`, `quantSmcGate`, `setupFeatureEngine` y
`smcQuantBacktester`. Implementa su propia lógica ICT simplificada en línea.

Los cuatro motores deterministas y su ensamblador **no los importa nadie**:
`smcStructureEngine`, `smcLiquidityEngine`, `smcOrderBlockEngine`,
`smcImbalanceEngine`, `smcChallengerFeatureEngine` (versión `2.0.0-challenger`,
25 features).

| Concepto ICT | `smcStrategy` (conectado) | Motores v2 (huérfanos) |
|---|---|---|
| Swings | últimos 2 pivotes | swings con `confirmedIndex`/`confirmedAt` |
| BOS vs CHoCH | no distingue | distingue |
| Pools de liquidez | no existe | con tolerancia ATR |
| Barrido | simple | + excursión ATR + `closedBackInside` |
| **Order blocks** | **no existen** | desplazamiento, mitigación %, edad, sweep previo |
| FVG | simple | + mitigación %, `fullyMitigated`, distancia |
| Premium/Discount | aproximado en línea | dealing range formal |

Los motores v2 modelan explícitamente *cuándo se supo* cada evento, no solo que
ocurrió. Esa es la disciplina que hace válido un backtest, y hoy no se usa.

## 3. Defectos del modelo de ejecución

Los cuatro comparten causa: **el plan se valida donde se calcula, nunca donde se
ejecuta.**

### 3.1 Plan invertido aceptado como válido — *el más serio*

`prepareExecutedTrade` (`executionCostModel.ts:46`) solo valida `riskPrice > 0`.
Nunca verifica que el stop esté del lado correcto de la entrada.

Con `M5_CONFIRMATION: false` — una de las **dos** variantes de ablación ejecutables —
`m5Trigger` se salta la comprobación de ruptura (`smcStrategy.ts:170`). En una caída
fuerte, un BUY sale con `entry = cierre M5` por debajo de `stop = mínimo de las 6
velas previas`. `Math.abs(entryFill - stop) > 0` pasa la validación, la operación
entra y se cierra a ~0R.

**Consecuencia:** la ablación de `M5_CONFIRMATION` no mide cuánto aporta la
confirmación M5; mide cuántos planes inválidos se aplanan a cero. El resultado no es
interpretable.

### 3.2 El filtro de 1.5R se aplica al precio equivocado

`m5Trigger` calcula el ratio con `entry = cierre M5`, pero el backtester entra al
`open` de la vela siguiente (`smcQuantBacktester.ts:155`). El umbral nunca se
revalida. Una operación admitida como 1.5R puede ejecutarse a 0.9R.

### 3.3 `grossResultR` y `netResultR` no son comparables

Denominadores distintos: `|requestedEntry − stop|` frente a
`plan.riskPrice = |entryFill − stop|` (`executionCostModel.ts:77`). La diferencia
entre bruto y neto no es solo costo.

### 3.4 Ambigüedad silenciosa

Cuando stop y objetivo caen en la misma vela, resuelve a STOP —conservador y
correcto— pero **no lo cuenta**. No hay forma de saber si el 3 % o el 40 % de la
curva depende de esa suposición.

## 4. Pares duplicados sin resolver

El patrón del SMC se repite. Hay que elegir cuál sobrevive, no arrastrar ambos:

- `dataQualityEngine` (conectado) frente a `marketDataQuality` (huérfano)
- `smcStrategy` (conectado) frente a los motores v2 (huérfanos)

## 5. Colisión de versión en el instalador

Dos instaladores distintos declaran ser 0.4.1: el de 104 MB del 16 de agosto y el de
114 MB generado hoy con el bridge empaquetado. Solo se salvaron de sobrescribirse
porque cambió el patrón de nombre. SENTINELQUANTS parte de 0.5.0.

---

## Lo que está bien y no debe reescribirse

- **Frames causales correctos.** `createBoundedCausalFrames` solo incluye velas cuyo
  cierre ya ocurrió. Sin anticipación.
- **Entrada realista.** Entra al `open` de la vela siguiente, nunca al precio de la
  señal.
- **Huecos de apertura manejados.** Si abre atravesando el stop, sale al open real.
- **Gobernanza de ablación honesta.** `ablationGovernance.ts` marca explícitamente
  que 3 de 5 toggles no están implementados, y `challengerAblationRunner` los excluye
  y los reporta como `blocked`.
- **Costos de ejecución modelados:** spread, deslizamiento y comisión.

## Integraciones reales (verificado en `electron/main.cjs`)

| Integración | Estado |
|---|---|
| MT5 (bridge Python + EA) | conectado (`spawn`) |
| TradingView / Cloudflare | conectado (93 y 17 referencias) |
| Almacenamiento seguro | conectado (`safeStorage`) |
| WhatsApp vía OpenClaw | conectado, con soporte de adjuntos (`--media`) |
| Anthropic | conectado (2 referencias) |
| TradeStation | **0 referencias** — adaptador escrito, sin OAuth |
| SEC / EDGAR | **0 referencias** |
| OpenAI | **0 en el proceso principal** |

No conectados según el README y confirmado por ausencia de código: resultados
empresariales, guías, premarket/after-hours, opening range, VWAP y PDF automático.
