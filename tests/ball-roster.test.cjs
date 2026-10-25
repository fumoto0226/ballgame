const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
global.Matter = require('../js/vendor/matter-0.20.0.min.js');
require('../js/block-geometry.js');require('../js/physics.js');
test('mixed ball types and sizes persist through launch and return', () => {
  const specs = [{ type:'normal', color:'#fff', radius:5, size:'small' },
    { type:'lightning', color:'#42a5ff', radius:7, size:'medium' },
    { type:'explosive', color:'#ff5656', radius:9, size:'large' }];
  const p = new BallPhysics(specs);
  assert.equal(p.storeBalls.length, 3);
  for (const spec of specs) assert.ok(p.storeBalls.some(b => b.type===spec.type && b.radius===spec.radius));
  p.start();
  for(let i=0;i<5000 && p.phase!=='ready';i++) p.step(1/120);
  assert.equal(p.phase,'ready');assert.equal(p.storeBalls.length,3);
  for (const spec of specs) assert.ok(p.storeBalls.some(b=>b.type===spec.type && b.radius===spec.radius));
});
test('an empty roster creates no prepared ball and cannot launch',()=>{
  const p=new BallPhysics([]);assert.equal(p.storeBalls.length,0);assert.equal(p.canStart,false);assert.equal(p.start(),false);
});
test('visible hopper capacity follows occupied area instead of a fixed ball count',()=>{
 const small=new BallPhysics(1000);
 const large=new BallPhysics(Array.from({length:1000},()=>({radius:9,size:'large'})));
 assert.ok(small.storeBalls.length>300);
 assert.ok(large.storeBalls.length<small.storeBalls.length/2);
 for(const p of [small,large]){assert.ok(p.storeArea<=p.storeAreaBudget+1);assert.ok(p.storeBalls.some(b=>b.y-b.radius<0),'pile reaches offscreen');}
});
test('vitality ball launches faster and has stronger restitution than normal',()=>{
 const normal=new BallPhysics([{type:'normal',radius:5}]);const vitality=new BallPhysics([{type:'vitality',radius:5}]);
 normal.emit({id:0});vitality.emit({id:0});assert.ok(vitality.flying[0].velocity.y>normal.flying[0].velocity.y*1.5);assert.ok(vitality.flying[0].restitution>normal.flying[0].restitution);
});
