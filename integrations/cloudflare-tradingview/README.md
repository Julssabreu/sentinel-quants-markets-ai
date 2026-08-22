# Bandeja TradingView → Sentinel en Cloudflare

Estado: **implementada localmente, no desplegada**.

Este Cloudflare Worker recibe alertas HTTPS de TradingView, las valida, normaliza y guarda en D1. Sentinel puede consultar las señales pendientes y confirmarlas mediante un ACK autenticado. El Worker no consulta modelos de IA, no abre operaciones y no contiene ninguna ruta de ejecución automática.

## Flujo

1. TradingView envía JSON a `POST /webhooks/tradingview`.
2. Comprueba `CF-Connecting-IP` contra las cuatro IP oficiales de webhooks de TradingView.
3. Compara el campo `secret` con el secreto `TRADINGVIEW_WEBHOOK_SECRET`.
4. Normaliza la señal y crea un ID SHA-256 determinista.
5. D1 inserta con `INSERT OR IGNORE`, por lo que un reintento idéntico no crea otra señal.
6. Sentinel reclama un lote con `POST /api/v1/signals/claim`; D1 reserva cada señal durante cinco minutos para un solo consumidor.
7. Después de procesarla, Sentinel envía su ACK. Un fallo temporal libera la señal con espera progresiva y una caída del proceso deja vencer la reserva automáticamente.

La ruta de webhook solo valida y escribe en D1; no espera a Sentinel ni llama servicios externos. Todas las respuestas incluyen `Cache-Control: no-store`. No se habilita CORS y no se registran cuerpos, tokens ni secretos.

Las IP permitidas son `52.89.214.238`, `34.212.75.30`, `54.218.53.128` y `52.32.178.7`. En `wrangler dev` o pruebas automatizadas se puede habilitar explícitamente `ALLOW_NON_TRADINGVIEW_IPS='true'`. **No configure ese bypass en producción.** El bypass de IP nunca desactiva la comprobación del secreto del cuerpo.

## Observador universal de gráficos

[`templates/SentinelMarketObserver.pine`](templates/SentinelMarketObserver.pine) es un indicador Pine reutilizable en cualquiera de las 21 temporalidades de Sentinel. Envía una sola observación OHLCV cuando cierra cada vela mediante `POST /webhooks/tradingview/market`. La versión `SMO v2` muestra en el gráfico si el secreto está cargado, el símbolo, la temporalidad y el estado de envío. Un secreto vacío o incorrecto ya no silencia `alert()` dentro de Pine: TradingView registra el intento y Cloudflare lo rechaza de forma observable.

El endpoint universal nunca acepta `BUY`, `SELL`, `side` ni `action`. Las observaciones ordinarias se guardan en `market_observations`. Si el gráfico es exactamente `VIX` en `1D`, el Worker lo enruta a `vix_daily`; VIX en otra temporalidad se bloquea desde el indicador y no se interpreta como contexto diario.

El mismo indicador sirve en forex, cripto, acciones, índices, ETF, metales, materias primas, futuros y bonos disponibles en TradingView. Cada alerta queda asociada al símbolo y temporalidad donde fue creada, por lo que varios gráficos requieren varias alertas. No es necesario mantener el gráfico ni la computadora abiertos una vez creada la alerta.

La migración [`migrations/0003_create_market_observations.sql`](migrations/0003_create_market_observations.sql) agrega almacenamiento idempotente por símbolo, temporalidad y cierre de vela.

## VIX diario: contexto, no señal operativa

VIX utiliza un flujo deliberadamente separado:

```text
TradingView (VIX, vela diaria)
  → POST /webhooks/tradingview/vix
  → tabla D1 vix_daily
  → GET /api/v1/context/vix
  → motor de decisión de Sentinel
```

La ruta VIX nunca escribe en `signals`, no genera reservas ni ACK y rechaza los campos `side`, `action` y `order_action`. Su respuesta incluye siempre `contextType: "MARKET_CONTEXT"` y `operationalSignal: false`. El valor de VIX es un factor diario de volatilidad que Sentinel podrá combinar con sus demás controles; no representa por sí mismo una orden `BUY` o `SELL`.

`POST /webhooks/tradingview/vix` aplica la misma lista de IP de TradingView, el mismo límite JSON de 16 KB y el mismo `TRADINGVIEW_WEBHOOK_SECRET` que el webhook de señales. Campos admitidos:

- `secret`: obligatorio.
- `ticker`: obligatorio y debe resolver exactamente a `VIX`, por ejemplo `CBOE:VIX`.
- `exchange`: opcional; también se infiere desde `ticker`.
- `timeframe` o `interval`: obligatorio; solo admite `D`, `1D` o `D1`.
- `value` o `close`: cierre diario positivo. Si llegan ambos deben coincidir.
- `open`, `high`, `low`, `close`: OHLC opcional, con validación de rango.
- `observed_at`, `timestamp` o `time`: fecha de la vela diaria, en ISO o época Unix.
- `observation_date`: opcional (`YYYY-MM-DD`); si se incluye debe coincidir con la fecha UTC observada.
- `metadata`: objeto JSON opcional de hasta 4 KB.

La plantilla lista para copiar está en [`templates/tradingview-vix-daily.json`](templates/tradingview-vix-daily.json). Debe usarse en un gráfico **VIX de temporalidad diaria**. No añada dirección de compra o venta.

La migración [`migrations/0002_create_vix_daily.sql`](migrations/0002_create_vix_daily.sql) mantiene una sola observación por día. Un reenvío idéntico es un duplicado sin efectos; una corrección posterior del mismo día actualiza ese día de forma idempotente. La tabla original `signals` permanece intacta.

## Contrato de entrada

El JSON no puede superar 16 KB. Campos admitidos:

- `secret`: obligatorio; debe coincidir con el secreto del Worker.
- `action` o `side`: `BUY`/`SELL`; también se normalizan `LONG`/`SHORT`.
- `ticker`: símbolo original de TradingView. Si incluye prefijo (`BINANCE:BTCUSDT`), se infiere el exchange.
- `sentinel_symbol`: opcional; prevalece sobre `ticker`. Cuando no existe, un sufijo `USDT` se convierte a `USD`; los sufijos perpetuos `.P`/`PERP` se eliminan para resolver el símbolo en MT5.
- `exchange`: opcional.
- `timeframe` o `interval`: temporalidad de TradingView.
- `price` o `close`: opcional, número positivo.
- `timestamp`, `emitted_at`, `time` o `timenow`: fecha ISO o época Unix.
- `strategy`: opcional.
- `alert_id`: identificador estable que participa en la deduplicación.

Debe existir al menos `timestamp` o `alert_id`; la plantilla incluye ambos. Esto evita que dos alertas legítimas con el mismo símbolo, lado y precio queden deduplicadas para siempre.

La plantilla lista para copiar está en [`templates/tradingview-alert.json`](templates/tradingview-alert.json). Reemplace sus dos valores `REEMPLAZAR_...`; nunca guarde allí el secreto real. `{{strategy.order.action}}` corresponde a alertas de estrategia. Para un indicador, el Pine Script debe construir `action` como `BUY` o `SELL`.

## Temporalidades

Las 21 temporalidades de Sentinel quedan cubiertas así:

```text
1→M1   2→M2   3→M3   4→M4   5→M5   6→M6
10→M10 12→M12 15→M15 20→M20 30→M30
60→H1 120→H2 180→H3 240→H4 360→H6 480→H8 720→H12
D→D1  W→W1  M→MN1
```

También se aceptan `1D`, `1W`, `1M` y los nombres nativos de Sentinel.

## API privada para Sentinel

Todas las rutas `/api/v1/*` exigen:

```http
Authorization: Bearer <SENTINEL_CONSUMER_TOKEN>
```

### Salud

`GET /api/v1/health` comprueba las tablas `signals`, `vix_daily` y `market_observations`; no declara sano un Worker sin las tres migraciones. También identifica el contrato con `service: "sentinel-tradingview-bridge"` y `contractVersion: 3`, para que Sentinel no acepte por accidente otra URL que solo responda HTTP 200.

### Contexto VIX reciente

`GET /api/v1/context/vix?limit=60` devuelve el último cierre como `snapshot` y el histórico reciente, ordenado del día más nuevo al más antiguo. `limit` es opcional, usa 60 por defecto y admite de 1 a 365:

```json
{
  "ok": true,
  "contextType": "MARKET_CONTEXT",
  "symbol": "VIX",
  "operationalSignal": false,
  "snapshot": {
    "id": "vix_...",
    "source": "TRADINGVIEW",
    "contextType": "MARKET_CONTEXT",
    "symbol": "VIX",
    "rawSymbol": "CBOE:VIX",
    "exchange": "CBOE",
    "timeframe": "D1",
    "observationDate": "2026-08-09",
    "value": 20.25,
    "open": 19.4,
    "high": 21.1,
    "low": 18.9,
    "close": 20.25,
    "observedAt": "2026-08-09T00:00:00.000Z",
    "receivedAt": "2026-08-09T21:05:00.000Z",
    "metadata": {
      "purpose": "sentinel-volatility-context"
    },
    "updatedAt": "2026-08-09T21:05:00.000Z"
  },
  "history": [],
  "checkedAt": "2026-08-09T21:06:00.000Z"
}
```

Cuando no hay observaciones, `snapshot` es `null` y `history` es un arreglo vacío. Esta API no devuelve `side` ni otro campo operativo.

### Reclamar señales pendientes

`POST /api/v1/signals/claim` con `{"limit":50}` reserva y devuelve de 1 a 100 señales pendientes, de la más antigua a la más nueva:

```json
{
  "ok": true,
  "signals": [
    {
      "id": "tv_...",
      "source": "TRADINGVIEW",
      "symbol": "BTCUSD",
      "rawSymbol": "BTCUSDT",
      "exchange": "BINANCE",
      "timeframe": "M15",
      "side": "BUY",
      "price": 68425.5,
      "emittedAt": "2026-08-08T12:00:00.000Z",
      "receivedAt": "2026-08-08T12:00:01.000Z",
      "strategy": "Atomic",
      "leaseToken": "11111111-1111-4111-8111-111111111111",
      "leaseUntil": "2026-08-08T12:05:02.000Z",
      "attempts": 1,
      "retryReason": null
    }
  ],
  "checkedAt": "2026-08-08T12:00:02.000Z"
}
```

### ACK

`POST /api/v1/signals/:id/ack` acepta:

```json
{
  "status": "PROCESSED",
  "leaseToken": "11111111-1111-4111-8111-111111111111",
  "verdict": "VALID",
  "detail": "Consumida por Sentinel"
}
```

`leaseToken` es obligatorio. `status` puede ser `PROCESSED`, `EXPIRED`, `REJECTED` o `RETRY`; este último acepta `retryAfterSeconds` de 10 a 3600 y devuelve la señal a la bandeja sin bloquear las posteriores. El primer ACK terminal saca la señal de la bandeja. Los reintentos son idempotentes y un token de reserva ajeno recibe `409 LEASE_MISMATCH`.

Sentinel reclama una señal por ciclo porque la revisión completa puede incluir una consulta final a Claude Opus 5. La outbox local conserva todos los mensajes pendientes y evita repetir ese análisis. El transporte hacia WhatsApp mantiene semántica **al menos una vez**: sin una clave de idempotencia aceptada por el destino, una caída después de aceptar el mensaje pero antes de persistir `SENT` puede causar un reenvío.

Un cron diario elimina registros terminales con más de 90 días. Las señales pendientes o reservadas nunca se eliminan por ese mantenimiento. El histórico VIX conserva 25 años de observaciones diarias, suficiente para ciclos prolongados de volatilidad con un costo de almacenamiento mínimo.

## Preparación y prueba local

Requiere Node.js 20 o posterior para las pruebas:

```powershell
npm test
npm run check
```

Para probar con Wrangler, cree primero una base D1 y reemplace únicamente el marcador `database_id` de `wrangler.toml`:

```powershell
npx wrangler@latest d1 create sentinel-alerts
npx wrangler@latest d1 migrations apply DB --local
npx wrangler@latest dev
```

En desarrollo local, Wrangler no añade una IP oficial de TradingView. Use una variable local o `.dev.vars` no versionado mientras ejecuta `wrangler dev`:

```dotenv
ALLOW_NON_TRADINGVIEW_IPS=true
```

Esta variable es únicamente para desarrollo y pruebas. No debe existir en el entorno desplegado.

Configure secretos con el almacén de Cloudflare, nunca en `wrangler.toml`:

```powershell
npx wrangler@latest secret put TRADINGVIEW_WEBHOOK_SECRET
npx wrangler@latest secret put SENTINEL_CONSUMER_TOKEN
```

Para un despliegue futuro se deben aplicar ambas migraciones remotas y después desplegar. Wrangler aplica en orden `0001_create_signals.sql` y `0002_create_vix_daily.sql`:

```powershell
npx wrangler@latest d1 migrations apply DB --remote
npx wrangler@latest deploy
```

Esos comandos se documentan para la siguiente fase; **esta entrega no creó recursos de Cloudflare ni desplegó el Worker**.
