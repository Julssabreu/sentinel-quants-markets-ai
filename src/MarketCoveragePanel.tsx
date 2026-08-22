import { AlertTriangle, CheckCircle2, Database, Network } from 'lucide-react';
import type { ProviderSymbolAlias } from './marketArchitecture';
import type { JulssbotMarketContext } from './julssbotAnalysis';

export interface MarketRuntimeEvidence {
  brokerSymbol: string | null;
  source: string | null;
  description: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  isin: string | null;
}

export default function MarketCoveragePanel({
  context,
  aliases,
  runtime,
}: {
  context: JulssbotMarketContext;
  aliases: ProviderSymbolAlias[];
  runtime?: MarketRuntimeEvidence | null;
}) {
  const stockCoverageMissing = context.market === 'STOCK'
    && context.gaps.some(gap => /fundamental|regulator/i.test(gap));

  return (
    <section className={`card market-coverage ${context.coverage.toLowerCase()}`}>
      <div className="market-coverage-head">
        <div>
          <Network size={18} />
          <span>
            <small>ARQUITECTURA MULTIMERCADO</small>
            <b>{context.marketLabel} · {context.market}</b>
          </span>
        </div>
        <em>{context.coverage.replaceAll('_', ' ')}</em>
      </div>

      <div className="market-identity-grid">
        <div><span>Identidad canónica</span><b>{context.canonicalId}</b></div>
        <div><span>Contrato</span><b>{context.contractId}</b></div>
        <div><span>Forma del instrumento</span><b>{context.instrumentKind}</b></div>
        <div><span>Clasificación</span><b>{context.classificationConfidence}</b></div>
      </div>

      <div className="market-readiness">
        <div className={context.readyForTechnicalAnalysis ? 'ready' : 'blocked'}>
          <span>Lectura técnica</span>
          <b>{context.readyForTechnicalAnalysis ? 'HABILITADA' : 'BLOQUEADA'}</b>
        </div>
        <div className={context.readyForOperationalAnalysis ? 'ready' : 'blocked'}>
          <span>Análisis operativo completo</span>
          <b>{context.readyForOperationalAnalysis ? 'LISTO' : 'BLOQUEADO'}</b>
        </div>
        <div>
          <span>Funciones verificadas</span>
          <b>{context.verifiedRoleCount}/{context.requiredRoleCount}</b>
        </div>
        <div>
          <span>Funciones planificadas</span>
          <b>{context.plannedRoleCount}/{context.requiredRoleCount}</b>
        </div>
      </div>

      <div className="market-source-grid">
        <div>
          <h3><CheckCircle2 size={15} /> Conectores activos</h3>
          {context.activeSources.length
            ? context.activeSources.map(source => <p key={source}>{source}</p>)
            : <p>Ningún conector activo para esta clasificación.</p>}
          <small>
            {context.operationalPriceVerified
              ? 'MT5 respondió para este instrumento; el precio operativo quedó verificado.'
              : 'Activo no significa verificado: aún falta una respuesta válida para este instrumento.'}
          </small>
        </div>
        <div>
          <h3><Database size={15} /> Pendientes</h3>
          {context.pendingSources.length
            ? context.pendingSources.map(source => <p key={source}>{source}</p>)
            : <p>No hay fuentes pendientes declaradas.</p>}
          <small>No se cuentan como datos usados ni generan gasto automático.</small>
        </div>
      </div>

      {aliases.length ? (
        <div className="market-aliases">
          <span>Aliases verificados o derivados</span>
          <div>{aliases.map(alias => (
            <code key={`${alias.provider}-${alias.symbol}-${alias.exchange ?? ''}`}>
              {alias.provider}: {alias.symbol}
            </code>
          ))}</div>
        </div>
      ) : null}

      {runtime ? (
        <div className="market-runtime">
          <span>Respuesta del bróker</span>
          <b>{runtime.brokerSymbol ?? 'Sin símbolo resuelto'}</b>
          <small>{[
            runtime.exchange,
            runtime.description,
            runtime.sector,
            runtime.industry,
            runtime.isin ? `ISIN ${runtime.isin}` : null,
            runtime.source,
          ].filter(Boolean).join(' · ') || 'MT5 no expuso metadatos adicionales.'}</small>
        </div>
      ) : null}

      {context.gaps.length || context.warnings.length ? (
        <div className="market-warnings">
          <AlertTriangle size={16} />
          <div>
            {context.gaps.map(gap => <p key={`gap-${gap}`}>Cobertura pendiente: {gap}.</p>)}
            {context.warnings.slice(0, 5).map(warning => <p key={`warning-${warning}`}>{warning}</p>)}
          </div>
        </div>
      ) : null}

      {stockCoverageMissing ? (
        <p className="market-stock-warning">
          Acción identificada como STOCK. El análisis técnico puede continuar con datos del bróker,
          pero no se presentará como análisis fundamental completo hasta disponer de estados,
          resultados y documentos regulatorios verificables.
        </p>
      ) : null}
      <p className="market-vix-note">
        El VIX es un patrón diario de referencia de volatilidad cuando aplica y está vigente; nunca es una señal BUY/SELL ni una condición universal.
      </p>
    </section>
  );
}
