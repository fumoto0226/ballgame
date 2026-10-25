const test=require('node:test'),assert=require('node:assert/strict');global.window=global;global.Matter=require('../js/vendor/matter-0.20.0.min.js');require('../js/block-geometry.js');require('../js/physics.js');
const run=(p,n=120)=>{for(let i=0;i<n;i++)p.step(1/120)};
test('returned balls above the visible hopper count as owned and allow launch',()=>{const p=new BallPhysics(8);for(const b of p.stored)Matter.Body.setPosition(b,{x:b.position.x,y:-50});assert.equal(p.arrivedCount,8);assert.ok(p.canStart);});
test('a previously returned ready ball does not block newly awarded pending balls',()=>{const p=new BallPhysics(1);p.wave=1;p.phase='recalling';const prepared=p.ready.id;p.addBalls(2);assert.ok(!p.pending.has(prepared));run(p,90);assert.equal(p.pending.size,0);assert.notEqual(p.phase,'shooting');assert.equal(p.flying.length,2);});
test('all returned balls can finish recall even when no ball has settled at the nozzle',()=>{const p=new BallPhysics(1);p.wave=1;p.phase='recalling';const ready=p.ready;p.ready=null;p.reserve.set(ready.id,1);run(p,20);assert.equal(p.phase,'ready');assert.ok(p.canStart);});
test('duplicate return cannot inflate pool or keep equality-based completion waiting',()=>{const p=new BallPhysics(1);p.returnBall({plugin:{ballId:0,shot:1}});assert.equal(p.arrivedCount,1);assert.equal(p.stored.length,0);});
test('early next volleys with reward balls preserve one owner per ID and finish without manual recall',()=>{
 const p=new BallPhysics(8);let starts=0,added=false;
 for(let i=0;i<2400;i++){
  if(!added&&starts===2&&p.phase==='recalling'){p.addBalls(3);added=true;}
  if(starts<8&&p.canStart&&p.phase!=='shooting'){assert.ok(p.start());starts++;}
  for(const b of p.flying){b.plugin.testAge=(b.plugin.testAge||0)+1/120;if(b.plugin.testAge>(b.plugin.ballId%3===0?1.5:.12))Matter.Body.setPosition(b,{x:-30,y:400});}
  p.step(1/120);
  const ids=[...p.reserve.keys(),...p.stored.map(b=>b.plugin.ballId),...p.flying.map(b=>b.plugin.ballId),...(p.ready?[p.ready.id]:[]),...(p.feeder?[p.feeder.id]:[])];
  assert.equal(ids.length,p.count);assert.equal(new Set(ids).size,p.count);
 }
 assert.equal(starts,8);assert.ok(added);assert.equal(p.phase,'ready');assert.equal(p.pending.size,0);assert.equal(p.arrivedCount,p.count);assert.ok(p.canStart);
});
test('a numerically invalid flight returns once instead of becoming an invisible pending blocker',()=>{const p=new BallPhysics(1);p.start();p.step(1/120);const b=p.flying[0];b.position.x=NaN;p.step(1/120);assert.equal(p.flying.length,0);assert.equal(p.arrivedCount,1);assert.equal(p.stats.recoveredNonFinite,1);assert.ok(p.canStart);});
test('inactive older flights cannot indefinitely block the next volley pending queue',()=>{const p=new BallPhysics(2);p.start();p.step(1/120);const old=p.flying[0];p.wave=2;p.pending=new Set([old.plugin.ballId]);p.phase='shooting';old.plugin.lastBlockHit=-10;p.step(1/120);assert.ok(!p.flying.includes(old));run(p,30);assert.equal(p.pending.size,0);assert.equal(p.arrivedCount+p.flying.length,p.count);});
