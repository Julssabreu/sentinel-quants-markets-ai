import policy from '../shared/aiModelPolicy.json';

export type AiTask='REALTIME_MONITORING'|'EDITORIAL_REVIEW'|'DEVELOPMENT'|'BACKUP_ANALYSIS';
export type AiRoute='DETERMINISTIC_ONLY'|'LOCAL'|'ANTHROPIC_OPUS_5'|'OPENAI_OAUTH_GPT_5_6_SOL'|'OPENAI_API_GPT_5_6_SOL';

export interface AiRouteAvailability {
  localAvailable:boolean;
  anthropicAvailable:boolean;
  openaiOAuthAvailable:boolean;
  openaiApiKeyAvailable:boolean;
  governanceCanVote:boolean;
  explicitPaidBackup:boolean;
}

export const AI_MODEL_POLICY=policy;

export function selectAiRoute(task:AiTask,availability:AiRouteAvailability):AiRoute{
  if(task==='REALTIME_MONITORING')return availability.localAvailable?'LOCAL':'DETERMINISTIC_ONLY';
  if(task==='DEVELOPMENT')return availability.openaiOAuthAvailable?'OPENAI_OAUTH_GPT_5_6_SOL':'DETERMINISTIC_ONLY';
  if(task==='EDITORIAL_REVIEW')return availability.anthropicAvailable&&availability.governanceCanVote
    ?'ANTHROPIC_OPUS_5':'DETERMINISTIC_ONLY';
  return availability.openaiApiKeyAvailable&&availability.explicitPaidBackup
    ?'OPENAI_API_GPT_5_6_SOL':'DETERMINISTIC_ONLY';
}

export function modelForRoute(route:AiRoute):string|null{
  if(route==='LOCAL')return AI_MODEL_POLICY.providers.local.model;
  if(route==='ANTHROPIC_OPUS_5')return AI_MODEL_POLICY.providers.anthropic.model;
  if(route==='OPENAI_OAUTH_GPT_5_6_SOL')return AI_MODEL_POLICY.providers.openaiOAuth.model;
  if(route==='OPENAI_API_GPT_5_6_SOL')return AI_MODEL_POLICY.providers.openaiApiKey.model;
  return null;
}
