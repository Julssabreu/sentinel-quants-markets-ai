const signalTimeframes = ['M1','M2','M3','M4','M5','M6','M10','M12','M15','M20','M30','H1','H2','H3','H4','H6','H8','H12','D1','W1','MN1'];

// Sentinel is expected to remain available after a Windows login.  Existing
// schema-v2 configurations did not have this field, so only an explicit false
// opts out during migration.
const defaultSignalNotifier = {
  schemaVersion: 3,
  enabled: false,
  channel: 'whatsapp',
  target: '',
  timeframes: signalTimeframes,
  intervalMinutes: 5,
  minConfidence: 60,
  riskPercent: 0.5,
  maxSymbols: 10,
  keepInTray: true,
  startWithWindows: true,
};

function normalizeSignalNotifier(value = {}) {
  return {
    schemaVersion: 3,
    enabled: value.enabled === true,
    channel: 'whatsapp',
    target: String(value.target ?? '').replace(/[^+0-9]/g, ''),
    timeframes: signalTimeframes,
    intervalMinutes: Math.max(2, Math.min(60, Number(value.intervalMinutes) || 5)),
    minConfidence: Math.max(50, Math.min(95, Number(value.minConfidence) || 60)),
    riskPercent: Math.max(0.1, Math.min(2, Number(value.riskPercent) || 0.5)),
    maxSymbols: Math.max(1, Math.min(25, Number(value.maxSymbols) || 10)),
    keepInTray: value.keepInTray !== false,
    startWithWindows: value.startWithWindows !== false,
  };
}

module.exports = { signalTimeframes, defaultSignalNotifier, normalizeSignalNotifier };
