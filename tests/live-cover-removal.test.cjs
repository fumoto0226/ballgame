const test=require('node:test'),assert=require('node:assert/strict');global.window=global;require('../js/block-geometry.js');require('../js/layer-layout.js');require('../js/levels/005.js');
const shape=b=>({...b,x:b.dx,y:b.dy,angle:b.baseAngle,r:BlockGeometry.radius(b.type)});
function depths(blocks,graph){const ids=new Set(blocks.map(b=>b.id));return LayerLayout.layers([...ids],new Map(blocks.map(b=>[b.id,graph.get(b.id).filter(id=>ids.has(id))])));}
test('removing an intermediate cover never exposes intersecting upper and lower bricks together',()=>{
 const b=[{id:0,type:'circle',x:0,y:0,r:20,angle:0,coveredBy:[]},{id:1,type:'square',x:10,y:0,r:18,angle:0,coveredBy:[0]},{id:2,type:'triangle',x:8,y:4,r:28,angle:0,coveredBy:[1]}];
 const original=new Map(b.map(b=>[b.id,b.coveredBy]));assert.equal(depths([b[0],b[2]],original).get(2),1);
 const fixed=LayerLayout.completeCovers(b),live=depths([b[0],b[2]],fixed);assert.equal(live.get(0),1);assert.equal(live.get(2),2);
});
test('005 preserves initial layers and every overlapping pair stays ordered under arbitrary removals',()=>{
 const b=BuiltinLevels['005'].blocks.map(shape),graph=LayerLayout.completeCovers(b),initial=depths(b,graph);for(const p of b)assert.equal(initial.get(p.id),p.designLayer);
 let pairs=0;for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++)if(BlockGeometry.overlaps(b[i],b[j])){const live=depths([b[i],b[j]],graph);assert.notEqual(live.get(b[i].id),live.get(b[j].id),`${b[i].id}/${b[j].id}`);pairs++;}assert.ok(pairs>1000);
 // Nonsequential blast/chain kills, rather than clearing complete authored layers.
 for(let seed=1;seed<=6;seed++){const live=b.filter(p=>(Math.imul(p.id+seed,2654435761)>>>0)%5<2),d=depths(live,graph);for(let i=0;i<live.length;i++)for(let j=i+1;j<live.length;j++)if(BlockGeometry.overlaps(live[i],live[j]))assert.notEqual(d.get(live[i].id),d.get(live[j].id));}
});
