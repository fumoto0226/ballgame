const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
global.Matter = require('../js/vendor/matter-0.20.0.min.js');
require('../js/block-geometry.js'); require('../js/rewards.js'); require('../js/physics.js');

test('reward borders expire after shape-specific segment decrements without changing HP', () => {
  for (const [type, count] of [['square', 4], ['triangle', 3], ['circle', 2]]) {
    const block = { type, hp: 25, bonus: true, rewardAmount: 7, rewardType: 'attempts' };
    RewardRules.initialize(block);
    assert.equal(block.rewardSegments, count);
    for (let i = 1; i <= count; i++) {
      RewardRules.advance([block]);
      assert.equal(block.rewardSegments, count - i);
      assert.equal(block.hp, 25);
      assert.equal(block.bonus, i < count);
    }
    RewardRules.advance([block]); assert.equal(block.hp, 25);
  }
});
test('reward type and editable amount determine its label', () => {
  assert.equal(RewardRules.label({ rewardType: 'attempts', rewardAmount: 7 }), '+7击');
  assert.equal(RewardRules.label({ rewardType: 'balls', rewardAmount: 4 }), '+4球');
  assert.equal(RewardRules.label({}), '+3击', 'legacy bonus blocks remain compatible');
});
test('each surviving border segment is rendered separately', () => {
  for (const type of ['square', 'triangle', 'circle']) {
    let strokes = 0;
    const ctx = { save(){}, restore(){}, beginPath(){}, arc(){}, moveTo(){}, lineTo(){}, stroke(){strokes++} };
    const b = { type, bonus: true, x: 0, y: 0, angle: 0, r: 20 };
    RewardRules.initialize(b); RewardRules.advance([b]);
    RewardRules.outline(ctx, b);
    assert.equal(strokes, RewardRules.segmentCount(type) - 1);
  }
});
test('ball reward adds unique balls to the current volley and future volleys', () => {
  const p = new BallPhysics(10); p.start();
  for (let i = 0; i < 60; i++) p.step(1/120);
  assert.equal(p.addBalls(4), 4); assert.equal(p.count, 14);
  const fired = new Set(p.flying.map(b => b.plugin.ballId));
  for (let i = 0; i < 120 * 30; i++) {
    p.step(1/120);
    for (const b of p.flying) fired.add(b.plugin.ballId);
    assert.equal(p.storeBalls.length + p.flying.length, 14);
    if (p.phase === 'ready') break;
  }
  assert.equal(fired.size, 14);
  assert.equal(p.phase, 'ready'); assert.ok(p.start()); assert.equal(p.queued, 14);
});
test('paddle reward has a normal HP-independent label and expires like other rewards',()=>{
 const b={type:'square',hp:3,bonus:true,rewardType:'bumper'};RewardRules.initialize(b);assert.equal(RewardRules.type(b),'bumper');assert.equal(RewardRules.label(b),'弹力板');
 for(let i=0;i<4;i++)RewardRules.advance([b]);assert.equal(b.bonus,false);assert.equal(b.hp,3);
});
test('editor reward defaults and independent outline darkness',()=>{
 assert.equal(RewardRules.defaultAmount('attempts'),1);assert.equal(RewardRules.defaultAmount('balls'),4);assert.equal(RewardRules.defaultAmount('balls-multiply'),1.5);
 for(const kind of ['buff-size','buff-lightning','buff-vitality','buff-explosive'])assert.equal(RewardRules.defaultAmount(kind),5);
 assert.equal(RewardRules.outlineColor(1),'#ffffff');assert.equal(RewardRules.outlineColor(2),'#141414');assert.equal(RewardRules.outlineColor(3),null);
 let strokes=0;const ctx={save(){},restore(){},beginPath(){},arc(){},stroke(){strokes++}};
 RewardRules.outline(ctx,{bonus:true,type:'circle',rewardSegments:2},RewardRules.outlineColor(3));assert.equal(strokes,0);
});

test('large ball multipliers grant the full amount rather than silently stopping at99',()=>{const p=new BallPhysics(1);assert.equal(p.addBalls(125),125);assert.equal(p.count,126);assert.equal(p.arrivedCount,126);assert.equal(p.addBalls(Infinity),0);assert.equal(p.count,126);});
