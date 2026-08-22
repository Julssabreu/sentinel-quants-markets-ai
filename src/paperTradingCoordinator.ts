import { evaluatePaperStability, type PaperEvent, type PaperObservation, type PaperStabilityConfig } from './paperTradingEngine';

export function reconstructPaperObservations(events: PaperEvent[]): PaperObservation[] {
  const latest=new Map<string,PaperEvent>();
  for(const event of events){
    if(event.paperId!==event.observation.paperId)throw new Error('Evento Paper con identidad inconsistente.');
    const prior=latest.get(event.paperId);
    if(prior&&Date.parse(event.occurredAt)<Date.parse(prior.occurredAt))throw new Error(`Journal Paper fuera de orden para ${event.paperId}.`);
    latest.set(event.paperId,event);
  }
  return [...latest.values()].map(event=>structuredClone(event.observation)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
}

export function summarizePaperJournal(events: PaperEvent[],config:PaperStabilityConfig){
  const observations=reconstructPaperObservations(events),stability=evaluatePaperStability(observations,config);
  return{...stability,totalObservations:observations.length,pending:observations.filter(item=>item.status==='PENDING_ENTRY').length,open:observations.filter(item=>item.status==='OPEN').length,blocked:observations.filter(item=>item.status==='BLOCKED').length,lastEventAt:events.at(-1)?.occurredAt??null};
}
