const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
global.Matter = require('../js/vendor/matter-0.20.0.min.js');
require('../js/block-geometry.js');
require('../js/bumpers.js');
require('../js/physics.js');
const disk = { x: 210, y: 390, r: 188, angle: 0 };
test('36 ten-degree slots have centered poles and reserve the top inlet', () => {
  assert.deepEqual(DiskBumpers.normalize([0, 1, 1, 18, 35, 36, -1]), [1, 18, 35]);
  assert.deepEqual(DiskBumpers.arcs([18]), [[Math.PI - Math.PI / 36, Math.PI + Math.PI / 36]]);
  for (let turn = 0; turn < 80; turn++) {
    const arcs = DiskBumpers.arcs(Array.from({ length: 36 }, (_, i) => i), turn * .123);
    for (const [a, b] of arcs) { assert.ok(a >= Math.PI / 36); assert.ok(b <= 2 * Math.PI - Math.PI / 36); }
  }
});
function shot(bumpers, angle = 0) {
  const p = new BallPhysics(1);
  p.syncBumpers(bumpers, { ...disk, angle });
  p.emit({ id: 0 });
  const b = p.flying[0];
  Matter.Body.setPosition(b, { x: 210, y: 550 });
  Matter.Body.setVelocity(b, { x: 0, y: 8 });
  for (let i = 0; i < 12; i++) p.step(1 / 120);
  return { p, b };
}
test('lit bottom arc rebounds while an unlit arc stays passable', () => {
  assert.ok(shot([18]).b.velocity.y < 0);
  assert.ok(shot([]).b.velocity.y > 0);
  assert.ok(shot([9], Math.PI / 2).b.velocity.y < 0, 'rotated side arc becomes bottom paddle');
});
test('rotating every paddle through the inlet never closes the top', () => {
  const p = new BallPhysics(1);
  p.syncBumpers([18], { ...disk, angle: Math.PI });
  assert.equal(p.bumperBodies.length, 0);
  p.syncBumpers([18], disk);
  assert.ok(p.bumperBodies.length > 0);
  p.syncBumpers([], disk);
  assert.equal(p.bumperBodies.length, 0);
  assert.ok(!p.fieldEngine.world.bodies.some(b => b.label === 'disk-bumper'));
});

test('swept arc guard catches a ball crossing the entire thin paddle in one substep', () => {
  const p = new BallPhysics(1);
  p.syncBumpers([18], disk);
  p.emit({ id: 0 });
  const b = p.flying[0];
  Matter.Body.setPosition(b, { x: 210, y: 565 });
  Matter.Body.setVelocity(b, { x: 0, y: 140 });
  p.step(1 / 120);
  assert.ok(b.velocity.y < 0, 'fast downward ball must rebound upward');
  assert.ok(b.position.y < 588, 'ball stays inside the disk');
});

test('a ball can travel between the side paddle and the widened outside rail', () => {
  for (const side of [-1, 1]) {
    const p = new BallPhysics(1);
    p.syncBumpers([side < 0 ? 27 : 9], disk);
    const rail = side < 0 ? BallPhysics.rails.left : BallPhysics.rails.right;
    const edge = disk.x + side * disk.r;
    assert.ok(Math.abs(rail - edge) - 2 > 2 * BallPhysics.config.radius, 'gap exceeds ball diameter');
    p.emit({ id: 0 });
    const ball = p.flying[0];
    Matter.Body.setPosition(ball, { x: (rail + edge) / 2, y: 365 });
    Matter.Body.setVelocity(ball, { x: 0, y: 4 });
    for (let i = 0; i < 50; i++) p.step(1 / 120);
    assert.ok(ball.position.y > 430, 'ball passes the narrowest side section without getting trapped');
  }
});
test('vitality balls leave grazing side rails and paddles rather than sliding down them',()=>{
 for(const obstacle of ['rail','paddle']){
  const p=new BallPhysics([{type:'vitality',radius:5}]);
  if(obstacle==='paddle')p.syncBumpers([9],disk);
  p.emit({id:0});const b=p.flying[0];
  Matter.Body.setPosition(b,{x:obstacle==='rail'?BallPhysics.rails.left+5.8:disk.x+disk.r-5.8,y:390});
  Matter.Body.setVelocity(b,{x:obstacle==='rail'?-.15:.15,y:6});
  for(let i=0;i<6;i++)p.step(1/120);
  assert.ok(obstacle==='rail'?b.velocity.x>3:b.velocity.x < -3,`${obstacle} must push ball away`);
 }
});
test('paddle reward chooses a fresh random full slot and protects the inlet',()=>{
 const taken=[1,2,3];const seen=new Set();
 for(const random of [0,.25,.5,.75,.99999]){const slot=DiskBumpers.chooseFree(taken,()=>random);assert.ok(slot>0&&slot<36);assert.ok(!taken.includes(slot));seen.add(slot);}
 assert.ok(seen.size>1);assert.equal(DiskBumpers.chooseFree(Array.from({length:35},(_,i)=>i+1)),null);
 for(const rotation of [0,.05,.5,Math.PI]){const slot=DiskBumpers.chooseFree([],()=>0,rotation);const angle=DiskBumpers.arcs([slot],rotation).reduce((n,[a,b])=>n+b-a,0);assert.ok(angle>=Math.PI/18-1e-8);}
});
test('slow and stationary normal balls receive a strong paddle kick from either side',()=>{
 for(const side of [-1,1])for(const speed of [0,.1,1]){
  const p=new BallPhysics(1);p.syncBumpers([18],disk);p.emit({id:0});const b=p.flying[0];b.plugin.pendingKickFrames=0;
  Matter.Body.setPosition(b,{x:210,y:390+188+side*5.8});Matter.Body.setVelocity(b,{x:0,y:-side*speed});
  p.step(1/120);assert.ok(b.velocity.y*side*60>600,'must actively kick away from paddle');
 }
});
test('edge magazine balls converge inward instead of sleeping on the lips',()=>{
 const p=new BallPhysics(2);const b=p.stored[0];Matter.Body.setPosition(b,{x:20,y:70});Matter.Body.setVelocity(b,{x:0,y:0});Matter.Sleeping.set(b,true);
 for(let i=0;i<240;i++)p.step(1/120);
 assert.ok(b.position.x>60,`edge ball should roll inward, x=${b.position.x}`);
});
