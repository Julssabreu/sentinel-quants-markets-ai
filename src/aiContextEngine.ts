import{validateAiContext,type AIProvider,type AiProviderRequest,type AiProviderResponse,type AiContextTask}from'./aiProvider';
export type AiTrigger='SMC_CANDIDATE'|'IMPORTANT_MACRO_EVENT'|'HIGH_IMPACT_NEWS'|'MAJOR_REGIME_CHANGE'|'UNUSUAL_VOLATILITY'|'QUANT_EXPLANATION'|'USER_REPORT'|'RESEARCH_INTERPRETATION';
export interface AiContextRecord{contextId:string;factReferences:string[];trigger:AiTrigger;task:AiContextTask;status:'COMPLETED'|'UNAVAILABLE'|'INVALID'|'FAILED';response:AiProviderResponse|null;reasonCodes:string[];createdAt:string;}
export interface AiContextRequest{request:AiProviderRequest;trigger:AiTrigger;factReferences:string[];createdAt:string;}
export class AiContextEngine{
  constructor(private readonly providers:readonly AIProvider[]){}
  async interpret(input:AiContextRequest):Promise<AiContextRecord>{
    const contextId=`AICTX:${input.request.requestId}`;
    for(const provider of this.providers){
      try{if(!await provider.available())continue;const response=await provider.generate(input.request),validation=validateAiContext(response);return{contextId,factReferences:[...input.factReferences],trigger:input.trigger,task:input.request.task,status:validation.valid?'COMPLETED':'INVALID',response:validation.valid?response:null,reasonCodes:validation.reasonCodes,createdAt:input.createdAt};}
      catch{continue;}
    }
    return{contextId,factReferences:[...input.factReferences],trigger:input.trigger,task:input.request.task,status:this.providers.length?'FAILED':'UNAVAILABLE',response:null,reasonCodes:[this.providers.length?'AI_PROVIDER_FAILED':'AI_CONTEXT_UNAVAILABLE'],createdAt:input.createdAt};
  }
}
