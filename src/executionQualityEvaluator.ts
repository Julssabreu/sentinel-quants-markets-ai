export interface ExecutionQualityInput{robustnessCompleted:boolean;collapsedScenarios:number|null;grossR:number|null;netR:number|null;completedTrades:number;maximumCostDragRatio:number;minimumTrades:number;}
export function evaluateExecutionQuality(input:ExecutionQualityInput){
  const reasonCodes:string[]=[];
  if(!input.robustnessCompleted||input.collapsedScenarios==null)reasonCodes.push('EXECUTION_ROBUSTNESS_MISSING');
  else if(input.collapsedScenarios>0)reasonCodes.push('EXECUTION_STRESS_COLLAPSE');
  if(input.completedTrades<input.minimumTrades)reasonCodes.push('EXECUTION_SAMPLE_INSUFFICIENT');
  let costDragRatio:number|null=null;
  if(input.grossR!=null&&input.netR!=null&&Math.abs(input.grossR)>1e-9){costDragRatio=(input.grossR-input.netR)/Math.abs(input.grossR);if(costDragRatio>input.maximumCostDragRatio)reasonCodes.push('EXECUTION_COST_DRAG_HIGH')}
  else reasonCodes.push('EXECUTION_COST_EVIDENCE_MISSING');
  const status:'PASSED'|'FAILED'|'MISSING'=reasonCodes.includes('EXECUTION_STRESS_COLLAPSE')||reasonCodes.includes('EXECUTION_COST_DRAG_HIGH')?'FAILED':reasonCodes.length?'MISSING':'PASSED';
  return{status,costDragRatio,completedTrades:input.completedTrades,reasonCodes,executionAuthorized:false as const};
}
