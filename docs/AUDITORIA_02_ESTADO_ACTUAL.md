# Auditoría 02 — estado del código fuente

Fecha: 2026-08-21
Alcance: `SENTINELQUANTS/` completo, incluido lo introducido en esta sesión.
Método: `tsc --noEmit`, `vitest run`, build de producción, análisis de importaciones
sobre `src/`, `shared/` y `electron/`, y medición real contra la SEC.

Esta auditoría **incluye los defectos que introduje yo**. Están en la sección 5.

---

## Estado medido

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | limpio |
| `vitest run` | 170 archivos, **528 pruebas** en verde, 1 omitida |
| `npm run build` | correcto |
| Módulos `src/` de producción | 182 |
| Módulos `shared/` | 24 |
| Archivos de prueba | 171 |

---

## 1. Módulos huérfanos: 50 de 182

Sin cambio material desde la auditoría inicial. Lo único conectado en esta sesión fue
EDGAR, que es código nuevo y vive en `shared/`.

`main` aparecía como huérfano en el conteo automático, pero es un falso positivo:
`index.html` lo referencia como `/src/main.tsx`. El número real es **50**.

Los bloques siguen siendo los mismos: fuentes verificables (~17), cálculos
deterministas (~15), contraste crítico (5), revisión de IA (1), trazabilidad (8).

## 2. Código muerto del commit inicial

Tres módulos del 1–2 de agosto sin una sola referencia en todo el árbol:

| Archivo | Líneas |
|---|---|
| `src/data.ts` | 21 |
| `src/engine.ts` | 14 |
| `src/liveData.ts` | 31 |

Son restos de la primera versión de la aplicación. Tienen pruebas propias, lo que hace
que aparezcan sanos en el informe de cobertura sin ejecutarse jamás en producción.

## 3. Tercer par duplicado

A los dos pares ya conocidos se suma uno nuevo:

| Par | Conectado | Huérfano |
|---|---|---|
| Calidad de datos | `dataQualityEngine` | `marketDataQuality` |
| Estrategia SMC | `smcStrategy` | motores ICT v2 (4 módulos) |
| **Monte Carlo** | `monteCarloEngine` (12 líneas) | `monteCarlo` (82 líneas) |

El huérfano de Monte Carlo es **siete veces más grande** que el conectado y expone
`runMonteCarlo` y `stressCosts`; el activo solo expone `runMonteCarloBootstrap`.
Hay que decidir cuál sobrevive, no arrastrar ambos.

## 4. Defectos de ejecución: 3 de 4 siguen abiertos

Corregido en esta sesión: el plan invertido (`prepareExecutedTrade` ya valida que stop
y objetivo estén del lado correcto de la entrada, con dos pruebas de regresión).

Pendientes, todos con la misma causa —el plan se valida donde se calcula, no donde se
ejecuta:

- **4.1** El filtro de 1.5R se aplica al cierre M5, pero la entrada real es el `open`
  siguiente. Una operación admitida como 1.5R puede ejecutarse a 0.9R.
- **4.2** `grossResultR` y `netResultR` usan denominadores de riesgo distintos, así que
  la diferencia entre bruto y neto no es solo costo.
- **4.3** La ambigüedad stop/objetivo en la misma vela se resuelve a STOP —correcto—
  pero no se cuenta. No hay forma de saber qué parte de la curva depende de ese
  supuesto.

## 5. Defectos introducidos en esta sesión

### 5.1 796 KB por consulta a EDGAR — *el más serio de los míos*

`resolveTicker` descarga el directorio completo de tickers de la SEC en **cada
llamada**, sin caché. Medido: **796.148 bytes, 0,54 s**.

El hook consulta cada vez que cambia la acción en foco. Con cinco candidatos distintos
en una sesión son ~4 MB innecesarios y cinco viajes evitables. El directorio cambia
como mucho una vez al día: debería cachearse en disco con expiración.

### 5.2 Contacto de la SEC incrustado en el código

Dije explícitamente que el contacto debía ser un ajuste editable sin valor por defecto.
Después lo incrusté en `electron/main.cjs:187`:

```js
const SEC_EDGAR_CONTACT='j_c_a34@hotmail.com';
```

El cliente compartido sí lo exige por parámetro, que es lo correcto. El fallo está en
el proceso principal, y contradice lo que yo mismo argumenté.

### 5.3 El guardia anti-repetición nunca expira

En `useDailyIntelligence`, `edgarRequested` evita volver a pedir el mismo ticker, pero
no caduca nunca. Un 8-K presentado más tarde el mismo día no aparecerá hasta reiniciar
la aplicación. Para un producto cuyo valor es *"¿qué cambió hoy?"*, eso es un fallo
funcional, no una optimización pendiente.

### 5.4 Modifiqué un módulo sin pruebas

`useDailyIntelligence` no tiene ninguna prueba, y le añadí el cableado de EDGAR. La
lógica nueva —selección de la acción en foco, manejo de fallo, guardia de repetición—
no está cubierta por nada.

## 6. Cobertura de pruebas: 31 módulos sin ninguna prueba

La mayoría son componentes React, lo cual es esperable. Los que no lo son y sí
importan:

- `useDailyIntelligence` (modificado en esta sesión)
- `useAutonomousRuntime`, `useSignalMonitor`, `useTradingViewMonitor`, `useAlertMonitor`
- `marketNavigation`, `runtimeControls`, `experimentPersistence`

Los cuatro hooks concentran el cableado entre la interfaz y el proceso principal: es
justo donde un fallo de integración no lo detecta ninguna prueba unitaria.

## 7. Seguridad

El endurecimiento del renderer es correcto y no debe tocarse:

```js
contextIsolation: true
nodeIntegration: false
sandbox: true
```

Más `setWindowOpenHandler` que deniega y abre fuera, y `will-navigate` bloqueado.

**Hueco:** no existe ninguna `Content-Security-Policy`, ni en `index.html` ni por
cabecera en el proceso principal. Con `sandbox` y `contextIsolation` activos el riesgo
es menor, pero es una capa de defensa ausente: nada impediría que contenido inyectado
en el renderer abriera conexiones de red por su cuenta.

## 8. `classifyMarket` no reconoce sufijos de bróker

```
AAPL.US   → market=UNKNOWN
MSFT.NAS  → market=UNKNOWN
AAPL      → market=STOCK
```

El escáner emite `AAPL.US`. Hoy no rompe nada porque los candidatos se clasifican por
la ruta del bróker (`CFD\Stocks\...`), no por el símbolo. Es un bug latente: cualquier
código que clasifique por símbolo fallará en silencio.

La normalización correcta ya existe pero solo dentro de EDGAR
(`normalizeSecTicker`), donde además resuelve el choque entre `BRK.B` del bróker y
`BRK-B` de la SEC —verificado en vivo—. Esa lógica debería subir a `classifyMarket`.

## 9. Rebranding incompleto

Quedan referencias al nombre anterior:

- `index.html:7` — `<title>Sentinel Markets AI</title>`
- `electron/main.cjs:942` — texto de la bandeja del sistema
- `README.md` — documento completo, todavía describe el producto anterior

---

## Resolución — 2026-08-21

Estado tras la corrección. Verificado con `tsc --noEmit`, `vitest run` (537 pruebas) y
build de producción.

| # | Hallazgo | Estado |
|---|---|---|
| 5.1 | 796 KB por consulta a EDGAR | **corregido** — caché con TTL de 24 h y 2 pruebas |
| 5.2 | Contacto incrustado | **corregido** — ajuste persistido con IPC `sec:config-get/save` |
| 5.3 | Guardia sin caducidad | **corregido** — TTL de 15 min y pulso de un minuto |
| 5.4 | Módulo modificado sin pruebas | **corregido** — lógica extraída a `edgarRefreshPolicy`, 7 pruebas |
| 4.1 | Ratio evaluado al precio equivocado | **corregido** — `prepareExecutedTrade` revalida sobre `entryFill` |
| 4.2 | Denominadores distintos | **corregido** — bruto y neto sobre `riskPrice`; su diferencia es el costo |
| 4.3 | Ambigüedad silenciosa | **corregido** — `ambiguous` por operación y `ambiguousExits` por experimento |
| 2 | Código muerto | **eliminado** — `data`, `engine`, `liveData` (conservados en `source/`) |
| 3 | Par Monte Carlo | **resuelto** — `monteCarlo` eliminado; sobrevive `monteCarloEngine` |
| 8 | `classifyMarket` sin sufijos | **corregido** — sufijo de plaza retirado y declarado en advertencias |
| 9 | Rebranding | **corregido** en `index.html`, bandeja y `appUserModelId`; **README pendiente** |
| 7 | Sin CSP | **corregido** — política estricta por cabecera, solo empaquetado |

### Notas sobre la corrección

**4.2 cambia valores publicados.** El bruto ya no es el «2R de manual»: con entrada
solicitada en 100, stop 98 y objetivo 104, el llenado real ocurre en 100.75 y el riesgo
es 2.75, así que el bruto correcto es 1.18R. Cualquier resultado anterior a este cambio
no es comparable con los posteriores.

**El par de ablación sigue siendo el mismo.** Corregir 4.1 no reactiva las variantes
bloqueadas: `STRUCTURE_BREAK`, `LIQUIDITY_SWEEP` y `ORDER_BLOCK` continúan sin toggle,
y `challengerAblationRunner` sigue excluyéndolas.

### Sigue abierto

- **47 módulos huérfanos.** Es trabajo de integración, no de corrección.
- **Dos pares duplicados**: `dataQualityEngine` / `marketDataQuality` y `smcStrategy` /
  motores ICT v2.
- **`README.md`** todavía describe el producto anterior.
- **`sessionMetrics` sin poblar**: el consumidor está listo, falta quien lo alimente.
- **Nada verificado en la aplicación en ejecución.** Todo lo anterior está comprobado
  por pruebas y por consultas reales a la SEC, pero Electron no se ha lanzado.
