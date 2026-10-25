const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../js/block-geometry.js');
require('../js/layer-layout.js');
const circle = (id, x, y, coveredBy = []) => ({ id, type: 'circle', x, y, r: 20, angle: 0, coveredBy });
function fixture() {
  return [circle(0, 162, 360), circle(1, 155, 390, [0]), circle(2, 210, 390, [4]),
    circle(3, 240, 390, [5]), circle(4, 210, 360), circle(5, 268, 365, [6]), circle(6, 290, 340)];
}
function noSameLayerOverlap(blocks, result) {
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    if (BlockGeometry.overlaps(blocks[i], blocks[j])) assert.notEqual(result.layers.get(blocks[i].id), result.layers.get(blocks[j].id));
  }
}
test('moving a second-layer block cascades its displaced neighbor past an occupied third layer', () => {
  const blocks = fixture();
  const previous = LayerLayout.layers(blocks.map(b => b.id), new Map(blocks.map(b => [b.id, b.coveredBy])));
  blocks[1].x = 180;
  const graph = new Map(blocks.map(b => [b.id, [...b.coveredBy]]));
  graph.get(2).push(1);
  const result = LayerLayout.resolve(blocks, { graph, previousLayers: previous, priorityId: 1, locked: new Map([[1, 2]]) });
  assert.equal(result.layers.get(1), 2);
  assert.equal(result.layers.get(3), 3, 'resident of third layer should stay there');
  assert.equal(result.layers.get(2), 4, 'newly displaced block must skip occupied third layer');
  assert.ok(result.graph.get(2).includes(3));
  assert.deepEqual(blocks[2].coveredBy, [4], 'preview must not mutate the live graph');
  noSameLayerOverlap(blocks, result);
  const again = LayerLayout.resolve(blocks, { graph: result.graph, previousLayers: result.layers });
  assert.deepEqual(again, result, 'repeated render/save must not keep pushing layers');
});
test('cascade continues through several occupied destination layers', () => {
  const blocks = fixture();
  blocks.push(circle(7, 225, 418, [8]), circle(8, 1000, 1000, [9]), circle(9, 1100, 1000, [10]), circle(10, 1200, 1000));
  const previous = LayerLayout.layers(blocks.map(b => b.id), new Map(blocks.map(b => [b.id, b.coveredBy])));
  blocks[1].x = 180;
  const graph = new Map(blocks.map(b => [b.id, [...b.coveredBy]])); graph.get(2).push(1);
  const result = LayerLayout.resolve(blocks, { graph, previousLayers: previous, priorityId: 1 });
  assert.equal(result.layers.get(2), 5);
  assert.equal(result.layers.get(7), 4);
  noSameLayerOverlap(blocks, result);
});
test('branching covers use independent recursion paths', () => {
  const graph = new Map([[0, []], [1, [0]], [2, [1]], [3, [0, 2]]]);
  assert.equal(LayerLayout.layers([...graph.keys()], graph).get(3), 4);
});
test('non-overlapping pieces on the same layer keep their existing links and positions', () => {
  const blocks = [circle(0, 0, 0), circle(1, 100, 0)];
  const before = JSON.stringify(blocks);
  const result = LayerLayout.resolve(blocks);
  assert.equal(result.layers.get(0), 1); assert.equal(result.layers.get(1), 1);
  assert.equal(JSON.stringify(blocks), before);
});

test('cascade also resolves square and triangle outlines rather than only circle bounds', () => {
  const blocks = fixture();
  blocks[2].type = 'square'; blocks[2].r = BlockGeometry.radius('square');
  blocks[3].type = 'triangle'; blocks[3].r = BlockGeometry.radius('triangle');
  const previous = LayerLayout.layers(blocks.map(b => b.id), new Map(blocks.map(b => [b.id, b.coveredBy])));
  blocks[1].x = 180;
  const graph = new Map(blocks.map(b => [b.id, [...b.coveredBy]])); graph.get(2).push(1);
  const result = LayerLayout.resolve(blocks, { graph, previousLayers: previous, priorityId: 1 });
  assert.equal(result.layers.get(2), 4);
  assert.equal(result.layers.get(3), 3);
  noSameLayerOverlap(blocks, result);
});
test('generic resolver retains legacy layer-floor metadata',()=>{
 const blocks=[{id:0,type:'circle',x:0,y:0,r:10,coveredBy:[]},{id:1,type:'circle',x:60,y:0,r:10,coveredBy:[],layerFloor:2}];
 const result=LayerLayout.resolve(blocks);assert.equal(result.layers.get(1),2);assert.deepEqual(result.graph.get(1),[]);
});
test('placing two separate second-layer pieces under one upper piece never pushes the upper piece down',()=>{
 const top={id:0,type:'circle',x:0,y:0,r:20,coveredBy:[]};
 const left={id:1,type:'circle',x:-30,y:0,r:20,coveredBy:[0]};
 const right={id:2,type:'circle',x:30,y:0,r:20,coveredBy:[]};
 const before=new Map([[0,1],[1,2]]), result=LayerLayout.place([top,left,right],[2],new Map([[2,2]]),before);
 assert.equal(result.layers.get(0),1);assert.equal(result.layers.get(1),2);assert.equal(result.layers.get(2),2);
 assert.deepEqual(result.graph.get(0),[]);assert.deepEqual(result.graph.get(1),[0]);assert.deepEqual(result.graph.get(2),[0]);
 assert.deepEqual(right.coveredBy,[],'placement does not mutate the half-built input graph');
});
test('second-layer overlap pushes only the lower pieces and an uncovered placement naturally becomes first-layer',()=>{
 const top={id:0,type:'circle',x:0,y:0,r:20,coveredBy:[]},old={id:1,type:'circle',x:-30,y:0,r:20,coveredBy:[0]};
 const newcomer={id:2,type:'circle',x:-30,y:0,r:20,coveredBy:[]};
 const result=LayerLayout.place([top,old,newcomer],[2],new Map([[2,2]]),new Map([[0,1],[1,2]]));
 assert.equal(result.layers.get(0),1);assert.equal(result.layers.get(1),3);assert.equal(result.layers.get(2),2);
 const orphan={id:3,type:'circle',x:100,y:100,r:20,coveredBy:[]};
 const standalone=LayerLayout.place([top,orphan],[3],new Map([[3,2]]),new Map([[0,1]]));assert.equal(standalone.layers.get(3),1);assert.deepEqual(standalone.graph.get(3),[]);
});
