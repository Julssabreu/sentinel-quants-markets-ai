import type { DecisionResult } from "./decisionEngine";
export type AtomicAgreement =
  | "CONFIRMA"
  | "CONTRADICE"
  | "SIN_DATOS"
  | "DESACTUALIZADO"
  | "OTRO_CONTEXTO"
  | "CONFLICTO";
export interface AtomicAssessment {
  agreement: AtomicAgreement;
  signal: AtomicMt5Signal | null;
  reason: string;
  advisoryDecision: DecisionResult["decision"] | null;
}
const canonical = (v: string) =>
  v
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/(M|PRO|RAW|ECN)$/, "");
export function assessAtomic(
  response: AtomicMt5Response | null,
  symbol: string,
  timeframe: string,
  decision: DecisionResult,
): AtomicAssessment {
  if (!response?.ok || !response.active)
    return {
      agreement: "SIN_DATOS",
      signal: null,
      reason: "Atomic está instalado, pero su enlace de solo lectura con Sentinel todavía no está activo.",
      advisoryDecision: null,
    };
  const sameSymbol = (candidate: AtomicMt5Signal) =>
    canonical(candidate.symbol).includes(canonical(symbol)) ||
    canonical(symbol).includes(canonical(candidate.symbol));
  const matchingSignals = (response.signals ?? []).filter(
    (candidate) => sameSymbol(candidate) && candidate.timeframe === timeframe,
  );
  const signal = matchingSignals.at(-1) ?? response.latest;
  if (!signal)
    return {
      agreement: "SIN_DATOS",
      signal: null,
      reason: "Atomic todavía no ha registrado señales.",
      advisoryDecision: null,
    };
  if (signal.type === "TEST_OK")
    return {
      agreement: "SIN_DATOS",
      signal,
      reason: `Prueba correcta: el lector respondió y detectó ${signal.value} fuente(s) Atomic.`,
      advisoryDecision: null,
    };
  if (
    Date.now() - new Date(response.signalFileModifiedAt || 0).getTime() >
    7 * 24 * 3600000
  )
    return {
      agreement: "DESACTUALIZADO",
      signal,
      reason: "La última señal tiene más de siete días.",
      advisoryDecision: null,
    };
  if (
    !sameSymbol(signal)
  )
    return {
      agreement: "OTRO_CONTEXTO",
      signal,
      reason: `La señal corresponde a ${signal.symbol}.`,
      advisoryDecision: null,
    };
  if (signal.timeframe !== timeframe)
    return {
      agreement: "OTRO_CONTEXTO",
      signal,
      reason: `La señal corresponde a ${signal.timeframe}, no ${timeframe}.`,
      advisoryDecision: null,
    };
  if (signal.type === "CONFLICT")
    return {
      agreement: "CONFLICTO",
      signal,
      reason: "Atomic reportó BUY y SELL simultáneamente.",
      advisoryDecision: "ESPERAR",
    };
  const direction = decision.decision.startsWith("BUY")
    ? "BUY"
    : decision.decision.startsWith("SELL")
      ? "SELL"
      : null;
  if (!direction)
    return {
      agreement: "SIN_DATOS",
      signal,
      reason: "Sentinel no tiene dirección técnica con la cual comparar.",
      advisoryDecision: null,
    };
  if (signal.type === direction)
    return {
      agreement: "CONFIRMA",
      signal,
      reason: `Atomic ${signal.type} coincide con Sentinel.`,
      advisoryDecision: decision.decision,
    };
  return {
    agreement: "CONTRADICE",
    signal,
    reason: `Atomic ${signal.type} contradice el sesgo ${direction}.`,
    advisoryDecision: "ESPERAR",
  };
}
