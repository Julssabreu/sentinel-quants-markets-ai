# SentinelQuants

Centro personal de inteligencia financiera multimercado. Versión 0.5.0, derivada de
Sentinel Markets AI 0.4.1.

Ubicación de desarrollo: `C:\Users\ADMIN\Desktop\sentinel market ai\SENTINELQUANTS`.
El proyecto anterior se conserva intacto en `../source` como referencia histórica.

## Qué es, y qué no es

SentinelQuants es un **analista financiero personal con memoria, disciplina y
trazabilidad**. No es un robot de trading, ni un generador de señales, ni una
colección de conectores.

Su cadena, en este orden:

```
fuentes verificables → cálculos deterministas → decisión analítica
→ revisión crítica de IA → explicación de Julssbot → dashboard/informe/alerta
→ Julio decide
```

Debe responder: qué cambió, qué activos merecen atención hoy, por qué existe la
oportunidad, **qué contradice esa tesis**, entrada condicionada, dónde queda
invalidada, objetivos, riesgo, y si conviene actuar o esperar.

Cuando una fuente falta o falla, muestra `Dato no disponible` o `UNAVAILABLE`. No
completa el campo con una estimación. **La IA redacta; nunca origina el dato.**

La ejecución la hace Julio a mano en su terminal MT5. SentinelQuants no opera.

## Fuentes: estado real

Verificado contra el código y contra las fuentes en vivo, no declarado de memoria.

| Fuente | Estado |
|---|---|
| MT5 (bridge Python + EA) | **conectado**, solo lectura — sin APIs de orden |
| TradingView vía Worker de Cloudflare | **conectado y verificado** |
| SEC EDGAR | **conectado y verificado en vivo** (2026-08-21) |
| Macro y noticias públicas | conectado |
| WhatsApp vía OpenClaw | conectado, admite adjuntos (`--media`) |
| Anthropic | conectado, solo revisión editorial final |
| VWAP y opening range | **conectados** — velas M1 de MT5, solo en sesión regular |
| TradeStation | adaptador escrito, **sin OAuth ni cuenta** |
| Premarket / after-hours | **sin fuente** — el feed MT5 de CFDs no lo trae |
| Resultados y guías | vía EDGAR (8-K, 10-Q, 10-K) |
| Informe diario por WhatsApp | **conectado** — 9:00 AST, texto compuesto, sin PDF todavía |

EDGAR exige un `User-Agent` con correo de contacto y admite 10 solicitudes por
segundo. El contacto es un ajuste editable (`sec:config-get` / `sec:config-save`), no
una constante. El directorio de tickers pesa 796 KB y se cachea 24 h.

Con EDGAR activo, la cobertura de **acciones pasó de `PARTIAL` a `COMPLETE`**:
`FUNDAMENTAL` y `REGULATORY` eran los dos roles sin proveedor.

## Estrategia: campeón y aspirante

Existen **dos implementaciones SMC** y conviene no confundirlas:

- **Campeón, en producción:** `smcStrategy` — cascada D1→H4→H1→M15→M5. Lógica ICT
  simplificada en línea. **No tiene order blocks.**
- **Aspirante, escrito y probado pero sin conectar:** `smcStructureEngine`,
  `smcLiquidityEngine`, `smcOrderBlockEngine`, `smcImbalanceEngine` y
  `smcChallengerFeatureEngine` (`2.0.0-challenger`, 25 features). Distingue BOS de
  CHoCH, detecta pools de liquidez, order blocks con mitigación y dealing range
  premium/discount, y modela *cuándo se confirmó* cada evento.

El aspirante **no es automáticamente mejor**: es más riguroso, que no es lo mismo. Más
parámetros sobre poca muestra es más sobreajuste. Debe medirse en sombra contra el
campeón y decidirlo la evidencia, nunca una opinión. `championMutationAllowed` es
`false` y `automaticPromotion` es `false`.

De las cinco variantes de ablación, solo **dos son ejecutables** (`FVG` y
`M5_CONFIRMATION`). `STRUCTURE_BREAK`, `LIQUIDITY_SWEEP` y `ORDER_BLOCK` no tienen
toggle y el runner las excluye declarándolas `blocked`.

## Modelo de ejecución

Cuatro defectos corregidos en 0.5.0. Los cuatro compartían causa: **el plan se validaba
donde se calculaba, nunca donde se ejecutaba.**

1. **Plan invertido rechazado.** En `LONG` el stop debe quedar bajo la entrada y el
   objetivo encima; en `SHORT` al revés. Antes se aceptaba un plan invertido que se
   cerraba a ~0R y contaminaba las ablaciones.
2. **El ratio se revalida en el precio de llenado**, no en el cierre que originó la
   señal. Un plan admitido como 1.5R que abre con hueco y cae a 0.68R se descarta.
3. **Bruto y neto comparten denominador** (`riskPrice`), así que su diferencia es
   exactamente el costo.
4. **Las velas ambiguas se cuentan** (`ambiguousExit`, `ambiguousExits`). Cuando una
   vela toca stop y objetivo se resuelve como STOP por prudencia, pero queda medido.

> **Los resultados anteriores a 0.5.0 no son comparables con los posteriores.** El
> bruto ya no es el «2R de manual»: con entrada solicitada en 100, stop 98 y objetivo
> 104, el llenado real ocurre en 100.75 y el riesgo es 2.75, así que el bruto correcto
> es 1.18R. No es que empeorara; antes estaba inflado.

El backtester es causalmente correcto: solo velas cerradas, entrada al `open` de la
vela siguiente y huecos de apertura resueltos al precio real.

## Decisión y gobernanza

Se separan dos conceptos:

- **Resultado analítico:** `BUY_CONDICIONADO`, `SELL_CONDICIONADO`, `ESPERAR` o
  `NO_OPERAR_EVENTO`, con su confianza real.
- **Madurez operativa:** `RESEARCH`, `PROBATION`, `ACTIVE` o `SUSPENDED`, con muestra
  verificable.

En `RESEARCH` se conserva el sesgo analítico y se muestra `n/30`, pero no se autoriza
recomendación operativa. La ejecución automática está desactivada en todos los estados.

Solo resultados `TP2` o `STOP`, v3, deduplicados y compatibles con el modelo vigente
cuentan hacia los 30 de gobernanza.

## Seguridad

- Puente MT5 de solo lectura; el verificador de release confirma «cero APIs de orden real».
- Renderer endurecido: `contextIsolation`, `sandbox`, `nodeIntegration:false`,
  navegación bloqueada y enlaces externos fuera de la app.
- `Content-Security-Policy` estricta por cabecera **en la app empaquetada**; en
  desarrollo se omite para no romper el HMR de Vite.
- Secretos locales cifrados con el almacenamiento seguro de Electron.
- Todos los canales IPC exigen la ventana principal y la URL exacta autorizada.

El ledger de evidencia usa cola única, checkpoints y rotación a gzip inmutable. Un
campo opcional ausente se omite al serializar —como hace `JSON.stringify`— en lugar de
invalidar la entrada; funciones y símbolos sí se rechazan **nombrando el campo**.

## Carpeta de datos

La carpeta de usuario es `%APPDATA%\sentinel-quants`, distinta de la del producto
anterior. Consecuencia importante:

- Los ajustes **no se migran solos**.
- Los secretos cifrados **no se pueden copiar entre carpetas**: la clave AES vive en el
  `Local State` de cada carpeta. Hay que **volver a introducirlos** en la interfaz
  (token de consulta de TradingView, destino de WhatsApp).

## Desarrollo y validación

```powershell
npm install
npm run dev
```

```powershell
npm test
python -m unittest services.test_mt5_symbol_resolution -v
npm run test:cloudflare
npm run build
```

Estado medido: `tsc --noEmit` limpio, **575 pruebas** en verde, build de producción
correcta.

## Instalador

```powershell
npm run dist:win
```

Se genera en `release/`. El `appId` es `com.julssbot.sentinelquants`, distinto del
producto anterior, así que **se instala junto a él y no lo reemplaza**. La firma de
código requiere un certificado real; consulta [`docs/WINDOWS_SIGNING.md`](docs/WINDOWS_SIGNING.md).

## Limitaciones conocidas

- **47 módulos huérfanos**: escritos y probados, sin ejecutarse en la aplicación.
- **Dos pares duplicados** sin resolver: `dataQualityEngine` / `marketDataQuality` y
  campeón / aspirante SMC.
- VWAP y opening range solo se calculan durante la **sesión regular de EE. UU.**;
  fuera de esa franja se declaran no disponibles en lugar de reconstruir la apertura
  a ciegas. En símbolos sin volumen real el VWAP se marca como proxy de ticks.
- El umbral de frescura de tick para cripto es de **10 segundos**, exigente para un
  feed de CFD; dispara `DATA_FEED_STALE` sin detener el análisis.
- Componente `NEWS` en estado `DEGRADED`.
- El informe diario compone **texto**, no PDF; el envío usa OpenClaw (`--media`
  admite adjuntos, pero todavía no se genera ningún archivo que adjuntar).
- La lógica de VWAP/opening range existe **dos veces a propósito**
  (`src/sessionMetricsCalc.ts` y `shared/sessionMetrics.cjs`): Vite no interopera con
  exportaciones nombradas de un `.cjs` cuando ese archivo llega al bundle del
  navegador. Si se toca el cálculo, hay que tocar ambas — están documentadas entre sí.

## Auditorías

- [`docs/AUDITORIA_SENTINELQUANTS.md`](docs/AUDITORIA_SENTINELQUANTS.md) — auditoría de origen.
- [`docs/AUDITORIA_02_ESTADO_ACTUAL.md`](docs/AUDITORIA_02_ESTADO_ACTUAL.md) — estado actual y resolución.
- [`docs/SENTINEL_QUANT_COMPLETION_AUDIT.md`](docs/SENTINEL_QUANT_COMPLETION_AUDIT.md) — contrato de cierre Quant.

La auditoría Quant arranca en `INCOMPLETE` y solo cambia con evidencia medida. El
diagnóstico rolling no es walk-forward: esa etapa sigue bloqueada hasta disponer de
refit y prueba causal por fold. Ningún estado habilita ejecución Live.
