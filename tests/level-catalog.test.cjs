const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function catalog(saved){const scope={window:{},localStorage:{getItem:()=>saved}};for(const file of ['js/levels/005.js','js/level-catalog.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),scope);return scope.window.LevelCatalog;}
test('built-in005 is on the picker without writing or replacing existing levels',()=>{const c=catalog(JSON.stringify({'004':{blocks:[{hp:99}]}}));assert.deepEqual(Object.keys(c.all()).sort(),['004','005']);assert.equal(c.get('004').blocks[0].hp,99);assert.equal(c.get('005').initialAttempts,3);assert.equal(catalog('{broken').get('005').title,'破局 · 回响');assert.equal(catalog(JSON.stringify({'005':{custom:true}})).get('005').custom,true);});
test('005 has a valid layered layout, synchronized buffs and separate early/late lifelines',()=>{
 const scope={window:{}};for(const file of ['js/block-geometry.js','js/layer-layout.js','js/levels/005.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),scope);
 const level=scope.window.BuiltinLevels['005'],blocks=level.blocks,geometry=scope.window.BlockGeometry;
 const graph=new Map(blocks.map(b=>[b.id,b.coveredBy]));const layers=scope.window.LayerLayout.layers(blocks.map(b=>b.id),graph);
 assert.equal(blocks.length,455);assert.equal(level.ballCounts[0][0],8);assert.equal(Math.max(...layers.values()),18);
 for(let layer=1;layer<=18;layer++)assert.ok(blocks.filter(b=>layers.get(b.id)===layer).length>=20);
 for(const b of blocks){assert.ok(b.coveredBy.every(id=>graph.has(id)));if(b.rewardType.startsWith('buff-'))assert.equal(b.hp,b.rewardAmount);}
 for(let i=0;i<blocks.length;i++)for(let j=i+1;j<blocks.length;j++)if(layers.get(blocks[i].id)===layers.get(blocks[j].id)){const shape=b=>({...b,x:b.dx,y:b.dy,angle:b.baseAngle,r:geometry.radius(b.type)});assert.ok(!geometry.overlaps(shape(blocks[i]),shape(blocks[j])),`same layer overlap ${i}/${j}`);}
 const rescues=blocks.filter(b=>b.bonus&&b.rewardType==='attempts');assert.ok(rescues.some(b=>layers.get(b.id)===2));assert.ok(rescues.some(b=>layers.get(b.id)>=14));assert.equal(rescues.reduce((n,b)=>n+b.rewardAmount,0),7);assert.equal(blocks.filter(b=>b.choiceGroup).length,6);
});
