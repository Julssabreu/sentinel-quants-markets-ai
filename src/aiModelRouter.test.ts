import {describe,expect,it} from 'vitest';
import {AI_MODEL_POLICY,modelForRoute,selectAiRoute,type AiRouteAvailability} from './aiModelRouter';

const availability:AiRouteAvailability={localAvailable:false,anthropicAvailable:true,openaiOAuthAvailable:true,openaiApiKeyAvailable:true,governanceCanVote:false,explicitPaidBackup:false};

describe('universal AI model routing contract',()=>{
  it('elimina Fable y fija los modelos solicitados',()=>{
    expect(JSON.stringify(AI_MODEL_POLICY).toLowerCase()).not.toContain('fable');
    expect(AI_MODEL_POLICY.providers.anthropic.model).toBe('anthropic/claude-opus-5');
    expect(AI_MODEL_POLICY.providers.openaiOAuth.model).toBe('gpt-5.6-sol');
    expect(AI_MODEL_POLICY.providers.openaiApiKey.model).toBe('gpt-5.6-sol');
  });

  it('usa reglas deterministas para tiempo real hasta instalar IA local',()=>{
    expect(selectAiRoute('REALTIME_MONITORING',availability)).toBe('DETERMINISTIC_ONLY');
    expect(selectAiRoute('REALTIME_MONITORING',{...availability,localAvailable:true})).toBe('LOCAL');
  });

  it('no consume Opus durante RESEARCH ni OpenAI API sin permiso explícito',()=>{
    expect(selectAiRoute('EDITORIAL_REVIEW',availability)).toBe('DETERMINISTIC_ONLY');
    expect(selectAiRoute('EDITORIAL_REVIEW',{...availability,governanceCanVote:true})).toBe('ANTHROPIC_OPUS_5');
    expect(selectAiRoute('BACKUP_ANALYSIS',availability)).toBe('DETERMINISTIC_ONLY');
    expect(selectAiRoute('BACKUP_ANALYSIS',{...availability,explicitPaidBackup:true})).toBe('OPENAI_API_GPT_5_6_SOL');
    expect(modelForRoute('OPENAI_API_GPT_5_6_SOL')).toBe('gpt-5.6-sol');
  });
});
