# Sentinel Quant — auditoría de cierre de implementación

Esta auditoría separa explícitamente dos conceptos:

- **implementación técnica:** contratos, motores, persistencia, UI, seguridad y pruebas existentes en el código;
- **evidencia de campo:** resultados Paper/Shadow y disponibilidad operativa que solo pueden acumularse hacia adelante con tiempo real.

## Bloques técnicos

1. `CAUSAL_RESEARCH`: datos point-in-time, SMC, features, backtest y protección contra leakage.
2. `VALIDATION_GOVERNANCE`: OOS, Monte Carlo, robustez, ablation, Champion/Challenger y Quant Gate con autoridad backend. El rolling diagnóstico no se etiqueta como walk-forward y no puede persistirse ni aprobar el gate.
3. `PAPER_SHADOW`: motores forward-only, journals, recuperación, métricas y prohibición de órdenes.
4. `OPERATIONAL_SAFETY`: Risk, Execution Quality, System Health, breakers, Kill Switch y Live Readiness.
5. `DURABLE_OBSERVABILITY`: snapshots, tendencias, alertas reconciliadas, retención y Evidence Ledger.
6. `FORWARD_PIPELINE`: persistencia IPC validada de Paper/Shadow y recolector periódico con checkpoint/backoff.
7. `UI_TRACEABILITY`: Laboratorio con estados y reason codes separados por etapa.
8. `VERIFICATION_RELEASE`: pruebas, TypeScript, build, sintaxis Electron y comprobación de diff.

El contrato `quantCompletionAudit.ts` arranca en `INCOMPLETE` y solo devuelve
`IMPLEMENTATION_COMPLETE` cuando los ocho bloques reciben comprobaciones medidas
y artefactos confirmados, incluida la instalación verificada. Aun en ese estado
mantiene `liveEnabled=false` y `executionAuthorized=false`. Una implementación
futura de walk-forward debe reentrenar o reajustar exclusivamente en cada tramo
de entrenamiento y evaluar el tramo siguiente sin fuga de información.

## Condiciones que no pueden declararse completas por código

- 30 o más operaciones Paper cerradas y estables.
- 30 o más observaciones Shadow cerradas con feeds y latencia aceptables.
- al menos 20 snapshots operativos distribuidos durante 24 horas.
- cualquier aprobación humana futura para Live.

Estas condiciones deben ocurrir hacia adelante. Rellenarlas con replays o datos fabricados invalidaría la auditoría.
