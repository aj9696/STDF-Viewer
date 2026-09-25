import assert from 'node:assert/strict';
import { aggregateWaferCells } from '../site/viewer-wafer-aggregate.js';
import { combineScreeningResults } from '../site/viewer-reclassification.js';
import { validateTestAliases, compareTestAliases } from '../site/viewer-test-aliases.js';
const device={group:0,datasetId:'11111111-1111-1111-1111-111111111111',deviceId:2,prrSeq:8,originalPartFlags:0,originalOutcome:'pass'};
const results={pat:{failBin:8,decisions:[{...device,toBin:12,reasons:[{testKey:'test-a'}]}]},gdbn:{failBin:7,decisions:[{...device,toBin:7,reason:'gdbn'},{...device,group:1,toBin:7}]},cd:{failBin:9,decisions:[{...device,deviceId:3,prrSeq:12,toBin:9}]}};
const output=combineScreeningResults(results,['pat','gdbn','cd']);
assert.equal(output.decisions.length,3);assert.equal(output.decisions[0].toBin,12);assert.equal(output.decisions[0].ruleReasons.length,2);assert.equal(output.summary.overlaps,1);assert.equal(output.summary.newlyFailed,3);
assert.equal(combineScreeningResults(results,['gdbn','pat','cd']).decisions[0].toBin,7);
assert.throws(()=>combineScreeningResults(results,[]),/priority/);
assert.throws(()=>combineScreeningResults({...results,pat:{...results.pat,decisionsTruncated:true}},['pat']),/Narrow/);
assert.throws(()=>combineScreeningResults(results,['pat','pat']),/distinct/);
assert.equal(results.pat.decisions[0].ruleReasons,undefined);
console.log('Combined screening: independent identity, first-match precedence, per-test bin, group isolation, truncation and immutable inputs passed.');

const aliasSelection={groups:[{name:'Original',datasetIds:['a']},{name:'Renamed',datasetIds:['b']}],heads:[1],sites:[2],attempts:'current'};
const key=(number,name,unit='V')=>JSON.stringify([10,number,name,unit,'','resolved']);
const aliases=[key(1,'voltage'),key(999,'Vout')];assert.equal(validateTestAliases(aliasSelection,aliases)[1].name,'Vout');
assert.throws(()=>validateTestAliases(aliasSelection,[aliases[0],key(999,'Vout','mV')]),/unit/);
assert.throws(()=>validateTestAliases(aliasSelection,[aliases[0]]),/each/);
const calls=[];const compared=await compareTestAliases({state:{selection:aliasSelection},checkCancelled(){},client:()=>({viewer:async(action,selection,options)=>{calls.push({action,selection,options});return {series:[{key:'0',label:selection.groups[0].name,stats:{total:4}}],warnings:[],population:{observations:4}};}})},aliases,{bins:30});
assert.equal(compared.series.length,2);assert.notEqual(compared.series[0].key,compared.series[1].key);assert.equal(compared.recipe.mappings[1].testKey,aliases[1]);assert.deepEqual(calls.map(c=>c.selection.groups[0].datasetIds),[['a'],['b']]);assert.deepEqual(calls[1].selection.sites,[2]);assert.equal(calls[1].options.testKey,aliases[1]);assert.equal(aliasSelection.groups.length,2);
console.log('Explicit test aliases: compatible units/families, distinct identities, scoped groups, preserved filters and mapping provenance passed.');

const mean=aggregateWaferCells([{x:1,y:2,value:2,attempts:1},{x:1,y:2,value:6,attempts:2},{x:1,y:2,value:null,attempts:1,missing:true},{x:3,y:4,value:null,attempts:1,invalid:true}]);assert.equal(mean[0].value,4);assert.equal(mean[0].count,2);assert.equal(mean[0].attempts,4);assert.equal(mean[0].members.length,3);assert.equal(mean[1].value,null);assert.equal(mean[1].invalid,true);console.log('Coordinate means: valid contributors, missing/invalid distinction, identities and attempt counts passed.');
