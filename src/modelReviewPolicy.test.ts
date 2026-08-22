import {describe,expect,it} from 'vitest';
// @ts-expect-error CommonJS shared production module
import policy from '../shared/modelReviewPolicy.cjs';

describe('política del revisor externo',()=>{
  it('restringe Anthropic exclusivamente a Opus 5',()=>{
    expect(policy.ANTHROPIC_REVIEW_MODEL).toBe('anthropic/claude-opus-5');
  });

  it('no consulta Anthropic durante RESEARCH',()=>{
    expect(policy.isExternalReviewEligible({
      algorithmApproved:false,
      recommendationAuthorized:false,
      governanceCanVote:false,
      executionAuthorized:false,
    })).toBe(false);
  });

  it('exige autorización analítica y gobernanza sin habilitar ejecución',()=>{
    const input={algorithmApproved:true,recommendationAuthorized:true,governanceCanVote:true,executionAuthorized:false};
    expect(policy.isExternalReviewEligible(input)).toBe(true);
    expect(policy.isExternalReviewEligible({...input,executionAuthorized:true})).toBe(false);
    expect(policy.externalReviewVerdict(true,true)).toBe('APTO PARA REVISIÓN MANUAL');
    expect(policy.externalReviewVerdict(true,false)).toContain('NO EJECUTAR');
  });
});
