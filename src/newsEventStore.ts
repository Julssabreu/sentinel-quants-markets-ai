import type{NormalizedNewsEvent}from'./newsEventEngine';import type{AiContextRecord}from'./aiContextEngine';
export class NewsEventStore{
  private readonly facts=new Map<string,NormalizedNewsEvent>();private readonly interpretations=new Map<string,AiContextRecord>();
  appendFact(event:NormalizedNewsEvent){if(this.facts.has(event.newsId))return false;this.facts.set(event.newsId,structuredClone(event));return true;}
  appendInterpretation(context:AiContextRecord){if(this.interpretations.has(context.contextId))return false;if(context.factReferences.some(id=>!this.facts.has(id)))throw new Error('AI Context referencia hechos inexistentes.');this.interpretations.set(context.contextId,structuredClone(context));return true;}
  fact(newsId:string){const value=this.facts.get(newsId);return value?structuredClone(value):null;}
  allFacts(){return[...this.facts.values()].map(value=>structuredClone(value));}
  contextsFor(newsId:string){return[...this.interpretations.values()].filter(value=>value.factReferences.includes(newsId)).map(value=>structuredClone(value));}
}
