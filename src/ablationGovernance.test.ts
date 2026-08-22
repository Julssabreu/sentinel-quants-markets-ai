import{describe,expect,it}from'vitest';import{createGovernedAblationPlan,evaluateRecordedParameterStability}from'./ablationGovernance';
describe('ablationGovernance',()=>{
  it('registra challengers y solo habilita toggles causales reales',()=>{const plan=createGovernedAblationPlan({familyId:'SMC-F1',experimentId:'Q1',createdAt:'2026-01-01T00:00:00Z',createdBy:'USER',datasetReuseCount:1});expect(plan.variants).toHaveLength(6);expect(plan.variants.filter(item=>item.readiness==='EXECUTABLE')).toHaveLength(2);expect(plan.models.every(model=>model.status==='CHALLENGER')).toBe(true);expect(plan.championMutationAllowed).toBe(false)});
  it('no calcula estabilidad con pocos puntos',()=>{expect(evaluateRecordedParameterStability([{value:1,expectancyR:.2}]).status).toBe('INSUFFICIENT_DATA')});
});
