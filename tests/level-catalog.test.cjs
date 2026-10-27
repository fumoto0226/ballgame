const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function catalog(saved){const scope={window:{},localStorage:{getItem:()=>saved}};for(const file of ['001','002','003','004','005'].map(n=>'js/levels/'+n+'.js').concat('js/level-catalog.js'))vm.runInNewContext(fs.readFileSync(file,'utf8'),scope);return scope.window.LevelCatalog;}
test('published catalog is independent of editor drafts and storage failures',()=>{
 const c=catalog(JSON.stringify({'004':{blocks:[{hp:99}]},'005':{custom:true}}));
 assert.deepEqual(Object.keys(c.all()),['001','002','003','004','005']);
 assert.equal(c.get('004').blocks.length,119);
 assert.deepEqual(['001','002','003','004'].map(n=>c.get(n).blocks.length),[2,13,25,119]);
 assert.deepEqual(['001','002','003','004'].map(n=>c.get(n).initialAttempts),[8,8,8,4]);
 assert.equal(c.get('005').initialAttempts,3);
 assert.equal(c.editorLevels()['004'].blocks[0].hp,99);
 assert.equal(c.editorLevels()['005'].custom,true);
 assert.equal(catalog('{broken').get('005').title,'破局 · 回响');
});
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
