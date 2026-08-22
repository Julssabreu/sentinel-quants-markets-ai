const aiPolicy=require('./aiModelPolicy.json');
const ANTHROPIC_REVIEW_MODEL=aiPolicy.providers.anthropic.model;
if(ANTHROPIC_REVIEW_MODEL!=='anthropic/claude-opus-5'){
  throw new Error('Sentinel solo permite Anthropic Claude Opus 5.');
}

function isExternalReviewEligible(payload={}){
  return Boolean(
    payload.algorithmApproved===true
    && payload.recommendationAuthorized===true
    && payload.governanceCanVote===true
    && payload.executionAuthorized===false
  );
}

function externalReviewVerdict(reviewEligible,aiApproved){
  return reviewEligible&&aiApproved
    ? 'APTO PARA REVISIÓN MANUAL'
    : 'NO APTO · NO EJECUTAR';
}

module.exports={ANTHROPIC_REVIEW_MODEL,isExternalReviewEligible,externalReviewVerdict};
