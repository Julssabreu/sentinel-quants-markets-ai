export interface QuantClock { now(): Date; nowMs(): number; nowIso(): string; }

export class SystemClock implements QuantClock {
  now() { return new Date(); }
  nowMs() { return Date.now(); }
  nowIso() { return this.now().toISOString(); }
}

export class SimulationClock implements QuantClock {
  private currentMs: number;
  constructor(start: string | number | Date) {
    this.currentMs = new Date(start).getTime();
    if (!Number.isFinite(this.currentMs)) throw new Error('SimulationClock requiere un timestamp válido.');
  }
  now() { return new Date(this.currentMs); }
  nowMs() { return this.currentMs; }
  nowIso() { return this.now().toISOString(); }
  advanceTo(next: string | number | Date) {
    const value = new Date(next).getTime();
    if (!Number.isFinite(value)) throw new Error('Timestamp de simulación inválido.');
    if (value < this.currentMs) throw new Error('SimulationClock no puede retroceder.');
    this.currentMs = value;
    return this.now();
  }
}
