export interface InstitutionalFactorRisk {
  score: number
  level: 'NORMAL' | 'VIGILAR' | 'ELEVADO'
  reasons: string[]
  fresh: boolean
}

export function assessInstitutionalFactorRisk(
  symbol: string,
  snapshot: InstitutionalFactorSnapshot | null,
  now = new Date(),
): InstitutionalFactorRisk {
  if (!snapshot) {
    return { score: 0, level: 'VIGILAR', reasons: ['Factores institucionales no disponibles.'], fresh: false }
  }

  const key = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const reasons: string[] = []
  let score = 0
  let fresh = true

  if ((key.includes('BTC') || key.includes('ETH')) && snapshot.cryptoDerivatives) {
    const derivatives = snapshot.cryptoDerivatives
    const ageMinutes = (now.getTime() - new Date(derivatives.observedAt).getTime()) / 60_000
    fresh = ageMinutes <= 30

    if (Math.abs(derivatives.fundingRate) >= 0.0005) {
      score += 35
      reasons.push(`Funding extremo: ${(derivatives.fundingRate * 100).toFixed(4)}%.`)
    }
    if (Math.abs(derivatives.openInterest24hChangePct ?? 0) >= 10) {
      score += 30
      reasons.push(`Interés abierto cambió ${derivatives.openInterest24hChangePct?.toFixed(1)}% en 24 h.`)
    }
    if (
      derivatives.longShortAccountRatio !== null &&
      (derivatives.longShortAccountRatio >= 2.5 || derivatives.longShortAccountRatio <= 0.4)
    ) {
      score += 30
      reasons.push(`Posicionamiento de cuentas saturado: ratio long/short ${derivatives.longShortAccountRatio.toFixed(2)}.`)
    }
    if (
      derivatives.takerBuySellRatio !== null &&
      (derivatives.takerBuySellRatio >= 1.3 || derivatives.takerBuySellRatio <= 0.7)
    ) {
      score += 20
      reasons.push(`Flujo taker desequilibrado: ratio compra/venta ${derivatives.takerBuySellRatio.toFixed(2)}.`)
    }
  }

  if (key.includes('XAU') && snapshot.realYields && snapshot.realYields.y10 >= 2) {
    score += 15
    reasons.push(`Tasa real a 10 años elevada: ${snapshot.realYields.y10.toFixed(2)}%.`)
  }
  if (snapshot.cot.length) {
    reasons.push('COT disponible como contexto semanal; sin voto hasta calcular percentiles históricos.')
  }

  const level = score >= 50 ? 'ELEVADO' : score >= 15 ? 'VIGILAR' : 'NORMAL'
  return { score, level, reasons: reasons.length ? reasons : ['Sin extremos institucionales detectados.'], fresh }
}
