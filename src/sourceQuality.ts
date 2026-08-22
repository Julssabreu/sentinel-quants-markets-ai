export type SourceKind = 'BROKER'|'EXCHANGE'|'CENTRAL_BANK'|'REGULATOR'|'NEWS'|'SCREENER'|'SOCIAL';
export interface SourceObservation {
  id:string; kind:SourceKind; observedAt:string; receivedAt:string;
  direct:boolean; authenticated:boolean; delayedMinutes?:number; independentGroup?:string;
}
export interface SourceQuality { score:number; freshness:number; authority:number; traceability:number; warnings:string[] }

const AUTHORITY:Record<SourceKind,number>={BROKER:82,EXCHANGE:95,CENTRAL_BANK:98,REGULATOR:98,NEWS:68,SCREENER:58,SOCIAL:25};

export function scoreSource(source:SourceObservation,now=new Date()):SourceQuality {
  const observed=new Date(source.observedAt).getTime(), received=new Date(source.receivedAt).getTime();
  const ageMinutes=Math.max(0,(now.getTime()-observed)/60000);
  const freshness=Math.max(0,Math.round(100-ageMinutes*2-(source.delayedMinutes??0)));
  const authority=AUTHORITY[source.kind];
  const traceability=Math.min(100,(source.direct?45:20)+(source.authenticated?35:10)+(source.observedAt?20:0));
  const score=Math.round(freshness*.35+authority*.4+traceability*.25);
  const warnings:string[]=[];
  if(!Number.isFinite(observed)||!Number.isFinite(received)) warnings.push('Marca temporal inválida.');
  if(ageMinutes>15) warnings.push('Dato desactualizado para análisis intradía.');
  if(!source.direct) warnings.push('Fuente secundaria: requiere confirmación independiente.');
  if(source.kind==='SOCIAL') warnings.push('Contenido social: solo puede utilizarse como indicador de atención o sentimiento.');
  return {score:Number.isFinite(score)?score:0,freshness:Number.isFinite(freshness)?freshness:0,authority,traceability,warnings};
}

export function independentSourceCount(sources:SourceObservation[]):number {
  return new Set(sources.map(source=>source.independentGroup||source.id)).size;
}
