import { previewScreening } from './viewer-screening.js';
import { spatialScreening } from './viewer-wafer-studies.js';
import { boundedInteger, invalid } from './viewer-model.js';

/** All rules see original data. Explicit first-match precedence resolves overlaps. */
export function combineScreeningResults(results, priority) {
  if (!Array.isArray(priority) || !priority.length || new Set(priority).size !== priority.length || priority.some(key => !['pat','gdbn','cd'].includes(key))) invalid('Choose a distinct screening priority.');
  const decisions = new Map(), counts = {};
  for (const method of priority) {
    const result = results[method]; if (!result) invalid('A selected screening result is missing.');
    if (result.decisionsTruncated) invalid('Combined screening needs all decisions. Narrow the selected population.');
    const failBin = boundedInteger(result.failBin, 0, 65534, 'Failure bin'); counts[method] = result.decisions.length;
    for (const decision of result.decisions) {
      const key = JSON.stringify([decision.group, decision.datasetId, decision.prrSeq]);
      const reason = { method, ...(decision.reason ? { detail:decision.reason } : {}), ...(decision.reasons ? { tests:decision.reasons } : {}) };
      const prior = decisions.get(key);
      if (prior) prior.ruleReasons.push(reason);
      else decisions.set(key, { ...decision, toBin: decision.toBin ?? failBin, projectedOutcome: 'fail', winner:method, ruleReasons:[reason], reason:method });
    }
  }
  const rows = [...decisions.values()];
  return { decisions: rows, summary: { flagged:rows.length, newlyFailed:rows.filter(row => (row.originalOutcome ?? row.outcome)==='pass').length, overlaps:rows.filter(row=>row.ruleReasons.length>1).length }, ruleCounts:counts };
}

export async function combinedScreening(view, options) {
  const priority = options.priority ?? ['pat','gdbn','cd'], results = {};
  if (!options.rules || typeof options.rules !== 'object') invalid('Provide screening rules.');
  for (const method of priority) {
    if (!['pat','gdbn','cd'].includes(method) || results[method]) invalid('Choose distinct PAT, GDBN or CD rules.');
    const rule = options.rules[method]; if (!rule) invalid('A selected rule is missing.');
    const failBin = boundedInteger(rule.failBin, 0, 65534, 'Failure bin');
    results[method] = method === 'pat'
      ? await previewScreening(view, {...rule,method:'pat',limit:20000})
      : await spatialScreening(view, {...rule,method});
    results[method].failBin = failBin;
  }
  return { method:'combined', methodVersion:'independent-first-match-v1', ...combineScreeningResults(results,priority),
    recipe:{ priority, rules:options.rules, selection:view.selection, cascading:false },
    sources:Object.values(results).flatMap(result=>result.sources??result.provenance??[]).filter((source,index,all)=>all.findIndex(s=>s.datasetId===source.datasetId)===index),
    ruleSummaries:Object.fromEntries(Object.entries(results).map(([method,result])=>[method,{summary:result.summary??result.counts,tests:result.tests,warnings:result.warnings}])),
    warnings:['Rules evaluate the original population independently. The first matching rule assigns the bin; every matching reason is retained.'],decisionsTruncated:false };
}
