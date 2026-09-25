import { listWafers } from './viewer-maps.js';
import { iterateJoinedDevices, studyTests, sourceProvenance } from './viewer-population.js';
import { addWaferCell, summarizeWaferCells, MAX_WAFER_COORDINATES } from './viewer-wafer-studies.js';
import { invalid } from './viewer-model.js';

/** Combine final coordinate values with explicit contributor identities. */
export function aggregateWaferCells(cells){
  const positions=new Map();
  for(const cell of cells){
    const key=`${cell.x}/${cell.y}`;
    if(!positions.has(key))positions.set(key,{x:cell.x,y:cell.y,value:null,count:0,sum:0,attempts:0,missing:false,invalid:false,outcome:'unknown',members:[]});
    const item=positions.get(key);item.members.push(cell);item.attempts+=cell.attempts;
    if(Number.isFinite(cell.value)){item.count++;item.sum+=(cell.value-item.sum)/item.count;}
  }
  return [...positions.values()].map(({sum,...cell})=>({...cell,value:cell.count?sum:null,missing:cell.count===0&&cell.members.every(m=>m.missing),invalid:cell.count===0&&cell.members.some(m=>m.invalid)}));
}

export async function waferValueAggregate(view,options){
  const [test]=studyTests([options.testKey]),wafers=listWafers(view).items;
  if(!wafers.length)invalid('This selection has no wafers.');
  const waferByKey=new Map(wafers.map(wafer=>[JSON.stringify([wafer.group,wafer.datasetId,wafer.id]),wafer]));
  const scopes=new Map();let coordinates=0,orientation=null,geometry=null;
  for await(const row of iterateJoinedDevices(view,{tests:[test.key]})){
    if(row.wafer_id==null||row.x===-32768||row.y===-32768)continue;
    const key=JSON.stringify([row.group_id,row.dataset_id,row.wafer_id,row.head]);
    if(!scopes.has(key)){
      const wafer=waferByKey.get(JSON.stringify([row.group_id,row.dataset_id,row.wafer_id]));
      if(!wafer)invalid('A contributing device has no recorded wafer context.');
      const shape=JSON.stringify(wafer.orientation);
      if(geometry!==null&&shape!==geometry)invalid('Coordinate aggregation requires matching recorded wafer geometry and orientation. Compare the wafers separately.');
      geometry=shape;orientation=wafer.orientation;scopes.set(key,new Map());
    }
    const cells=scopes.get(key),position=`${row.x}/${row.y}`;
    if(!cells.has(position)&&++coordinates>MAX_WAFER_COORDINATES)invalid('Coordinate aggregation exceeds 50,000 contributing wafer positions. Select fewer wafers.');
    addWaferCell(cells,row,test.key);
  }
  const cells=aggregateWaferCells([...scopes.values()].flatMap(cells=>[...cells.values()])),stats=summarizeWaferCells(cells);
  return {method:'coordinate-mean-v1',methodVersion:'coordinate-mean-v1',wafer:{name:'Mean at each coordinate',sourceName:`${scopes.size} selected wafer populations`},orientation:orientation??{},test,cells,...stats,
    sources:sourceProvenance(view),recipe:{selection:view.selection,testKey:test.key,aggregation:'Mean of valid latest-per-wafer-coordinate values',maximumPositions:MAX_WAFER_COORDINATES},
    contributingPositions:coordinates,warnings:['Each wafer contributes its latest selected attempt at an XY position. Valid values are averaged; missing/invalid contributors are omitted.','This aggregate has no device pass/fail or bin assignment. Click a coordinate to inspect its contributors.']};
}
