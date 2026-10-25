const test=require('node:test');const assert=require('node:assert/strict');
global.window=global;global.Matter=require('../js/vendor/matter-0.20.0.min.js');require('../js/block-geometry.js');require('../js/physics.js');
function owned(p){return p.stored.length+p.reserve.size+p.flying.length+Number(!!p.ready)+Number(!!p.feeder);}
for(const count of [500,5000]) test(`${count} balls keep a bounded hopper and fire exactly once each`,()=>{
 const p=new BallPhysics(Array.from({length:count},(_,i)=>({radius:[5,7,9][i%3],type:['normal','lightning','explosive'][i%3]})));
 assert.equal(owned(p),count);assert.ok(p.storeArea<=p.storeAreaBudget+1);assert.ok(p.canStart);
 const emitted=new Set();const emit=p.emit.bind(p);p.emit=b=>{assert.ok(!emitted.has(b.id));emitted.add(b.id);emit(b)};
 assert.ok(p.start());
 for(let frame=0;frame<count*16+2000&&emitted.size<count;frame++){
  if(p.feeder)p.feeder.t=1;
  for(const b of p.flying)Matter.Body.setPosition(b,{x:-30,y:400});
  p.step(1/120);
  if(frame%240===0){assert.equal(owned(p),count);assert.ok(p.storeArea<=p.storeAreaBudget+1);}
 }
 assert.equal(emitted.size,count);assert.equal(p.queued,0);
 for(let i=0;i<1200;i++){for(const b of p.flying)Matter.Body.setPosition(b,{x:-30,y:400});p.step(1/120);}
 assert.equal(owned(p),count);assert.equal(p.arrivedCount,count);assert.ok(p.canStart);
 assert.ok(p.start(),'next volley remains available');
});
test('500-ball volley naturally flies, exits, recalls and can launch again',()=>{
 const p=new BallPhysics(500);assert.ok(p.start());
 for(let i=0;i<20000&&p.phase!=='ready';i++)p.step(1/120);
 assert.equal(p.phase,'ready');assert.equal(p.exited,500);assert.equal(owned(p),500);assert.equal(p.arrivedCount,500);assert.ok(p.start());
});
