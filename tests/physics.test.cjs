const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
global.Matter = require('../js/vendor/matter-0.20.0.min.js');
require('../js/block-geometry.js');
require('../js/physics.js');
const dt = 1 / 120;
const run = (physics, seconds) => { for (let i = 0; i < Math.ceil(seconds / dt); i++) physics.step(dt); };

// All tests use the same rigid-body engine and outlines as the browser game.
test('magazine balls settle into a connected, non-overlapping pile', () => {
  const physics = new BallPhysics();
  run(physics, 1);
  const pile = physics.storeBalls.filter(b => !b.prepared);
  assert.equal(pile.length, 23);
  assert.equal(physics.storeBalls.filter(b => b.prepared).length, 1);
  for (const ball of pile) {
    assert.ok(ball.speed < 2, 'pile should rest without shaking');
    assert.ok(ball.y < 135 && ball.y > 75, 'ball is contained by the funnel');
    assert.ok(pile.some(other => other !== ball && Math.hypot(ball.x - other.x, ball.y - other.y) < 10.5), 'every stored ball touches the pile');
  }
  for (let i = 0; i < pile.length; i++) for (let j = i + 1; j < pile.length; j++) {
    assert.ok(Math.hypot(pile[i].x - pile[j].x, pile[i].y - pile[j].y) > 9.7, 'balls must not visibly intersect');
  }
});

test('launched balls pass independently through one another', () => {
  const p = new BallPhysics();
  p.emit({ id: 100 }); p.emit({ id: 101 });
  const [a, b] = p.flying;
  // Isolate collision response from the deliberate post-launch random scatter.
  a.plugin.pendingKickFrames = b.plugin.pendingKickFrames = 0;
  Matter.Body.setPosition(a, { x: 160, y: 300 });
  Matter.Body.setPosition(b, { x: 200, y: 300 });
  Matter.Body.setVelocity(a, { x: 8, y: 0 });
  Matter.Body.setVelocity(b, { x: 0, y: 0 });
  run(p, .18);
  assert.equal(p.stats.ballContacts, 0);
  assert.ok(a.velocity.x * 60 > 450);
  assert.ok(Math.abs(b.velocity.x) < .001);
  assert.ok(a.position.x > b.position.x);
});

test('fast ball rebounds from a thin rotated block and records one impact', () => {
  const p = new BallPhysics();
  p.syncBlocks([{ id: 12, type: 'square', r: 17.7245, x: 210, y: 300, angle: .3 }]);
  p.emit({ id: 100 });
  Matter.Body.setPosition(p.flying[0], { x: 210, y: 255 });
  Matter.Body.setVelocity(p.flying[0], { x: 0, y: 700 / 60 });
  run(p, .07);
  assert.equal(p.consumeHits().length, 1);
  assert.ok(p.flying[0].velocity.y < 0, 'ball must bounce, not tunnel through');
});

test('curved floor rebounds a ball and dissipates energy', () => {
  const p = new BallPhysics();
  p.emit({ id: 100 });
  const ball = p.flying[0];
  Matter.Body.setPosition(ball, { x: 250, y: BallPhysics.floorY(250) - 12 });
  Matter.Body.setVelocity(ball, { x: 0, y: 5 });
  run(p, .07);
  assert.ok(p.stats.floorContacts > 0);
  assert.ok(ball.velocity.y < 0);
  assert.ok(Math.hypot(ball.velocity.x, ball.velocity.y) < 5, 'rebound must not add energy');
});

test('open boundaries remove escaped balls permanently', () => {
  const p = new BallPhysics();
  p.emit({ id: 100 });
  Matter.Body.setPosition(p.flying[0], { x: 423, y: 300 });
  Matter.Body.setVelocity(p.flying[0], { x: 4, y: 0 });
  run(p, .1);
  assert.equal(p.flying.length, 0);
  assert.equal(p.exited, 1);
  run(p, 1);
  assert.equal(p.flying.length, 0);
});

test('full volley drains, rolls off the floor and physically repacks on recall', () => {
  const p = new BallPhysics();
  p.start();
  let recalled = false, completed = false;
  for (let i = 0; i < 120 * 35; i++) {
    p.step(dt);
    if (p.phase === 'shooting') assert.equal(p.storeBalls.length + p.flying.length, 24);
    if (p.phase === 'recalling') {
      recalled = true;
      assert.equal(p.storeBalls.length + p.flying.length, 24);
    }
    if (recalled && p.phase === 'ready') { completed = true; break; }
    for (const b of p.activeBalls) assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
  }
  assert.ok(completed, 'no final ball should remain stuck at the crest');
  assert.equal(p.storeBalls.length, 24);
  assert.equal(p.stats.ballContacts, 0);
  assert.ok(p.stats.floorContacts > 0);
});

test('lingering balls near the curve crest roll off promptly', () => {
  for (const x of [147.877, 200, 205, 210, 220]) {
    const p = new BallPhysics();
    p.emit({ id: 100 });
    Matter.Body.setPosition(p.flying[0], { x, y: BallPhysics.floorY(x) - 5 });
    Matter.Body.setVelocity(p.flying[0], { x: 0, y: 0 });
    for (let i = 0; i < 120 * 2 && p.flying.length; i++) p.step(dt);
    assert.equal(p.flying.length, 0, `ball stalled at ${x}`);
    assert.equal(p.exited, 1);
  }
});


test('individual exits return immediately and half a magazine can start the next volley', () => {
  const p = new BallPhysics();
  p.start();
  let immediate = false;
  for (let i = 0; i < 120 * 20; i++) {
    p.step(dt);
    assert.equal(p.storeBalls.length + p.flying.length, 24);
    if (p.exited > 0 && p.flying.length > 0 && p.stored.length > 0) immediate = true;
    if (p.canStart && p.arrivedCount < 24) break;
  }
  assert.ok(immediate, 'first escaped ball should already be returning');
  assert.ok(p.canStart && p.arrivedCount >= 12 && p.arrivedCount < 24);
  assert.ok(p.flying.length > 0 || p.stored.some(b => b.position.y <= 75));
  assert.ok(p.start(), 'next volley must accept a partially returned magazine');
  const fired = new Set();
  let previous = new Set();
  for (let i = 0; i < 120 * 30; i++) {
    p.step(dt);
    assert.equal(p.storeBalls.length + p.flying.length, 24, 'pool must neither duplicate nor lose balls');
    const current = new Set(p.flying.filter(b => b.plugin.shot === 2).map(b => b.plugin.ballId));
    for (const id of current) if (!previous.has(id)) {
      assert.ok(!fired.has(id), 'a ball fired twice in the same volley');
      fired.add(id);
    }
    previous = current;
    if (p.phase === 'ready') break;
  }
  assert.equal(fired.size, 24, 'late returning balls must join the next volley');
  assert.equal(p.phase, 'ready');
});

test('side rails bounce balls beside the disk but leave the bottom exit open', () => {
  for (const side of [-1, 1]) {
    const p = new BallPhysics();
    p.emit({ id: 100 });
    const ball = p.flying[0], rail = side < 0 ? BallPhysics.rails.left : BallPhysics.rails.right;
    Matter.Body.setPosition(ball, { x: rail - side * 10, y: 390 });
    Matter.Body.setVelocity(ball, { x: side * 5, y: 0 });
    run(p, .06);
    assert.ok(ball.velocity.x * side < 0, 'disk-side rail must reflect the ball');
  }
  const p = new BallPhysics();
  p.emit({ id: 100 });
  Matter.Body.setPosition(p.flying[0], { x: 22, y: 620 });
  Matter.Body.setVelocity(p.flying[0], { x: -5, y: 0 });
  run(p, .15);
  assert.equal(p.flying.length, 0, 'below the rails, balls should leave normally');
});

test('top barrier reflects upward balls across both visible bars and invisible outlet', () => {
  for (const x of [80, 210, 340]) {
    const p = new BallPhysics();
    p.emit({ id: 100 });
    const ball = p.flying[0];
    Matter.Body.setPosition(ball, { x, y: 180 });
    Matter.Body.setVelocity(ball, { x: 0, y: -8 });
    for (let i = 0; i < 24; i++) {
      p.step(dt);
      assert.ok(ball.position.y >= BallPhysics.ceiling.y + 4, 'upward ball crossed the top barrier');
    }
    assert.ok(ball.velocity.y > 0, 'top impact must rebound downward');
    assert.equal(p.exited, 0);
  }
  const p = new BallPhysics();
  p.emit({ id: 100 });
  run(p, .15);
  assert.ok(p.flying[0].position.y > BallPhysics.ceiling.y + 10, 'newly launched balls must pass downward normally');
});


test('a fresh outlet ball knocked upward is also kept below the top barrier', () => {
  const p = new BallPhysics();
  p.emit({ id: 100 });
  Matter.Body.setVelocity(p.flying[0], { x: 0, y: -8 });
  p.step(dt);
  assert.ok(p.flying[0].position.y >= BallPhysics.ceiling.y + 4);
  assert.ok(p.flying[0].velocity.y > 0);
});

test('a supported ball starts rolling immediately with smooth acceleration', () => {
  const p = new BallPhysics();
  p.emit({ id: 100 });
  const ball = p.flying[0];
  Matter.Body.setPosition(ball, { x: 210, y: BallPhysics.floorY(210) - 5 });
  Matter.Body.setVelocity(ball, { x: 0, y: 0 });
  p.step(dt);
  const initialSpeed = Math.abs(ball.velocity.x * 60);
  assert.ok(initialSpeed > 0 && initialSpeed < 15, 'roll assistance must begin immediately without a velocity jump');
  run(p, .12);
  assert.ok(Math.abs(ball.velocity.x * 60) > initialSpeed + 40, 'rolling should accelerate without a waiting period');
});

test('opposing crowds in collection mode pass through and all leave promptly', () => {
  const p = new BallPhysics();
  p.start();
  const prepared = [p.ready]; p.ready = null;
  while (p.stored.length) {
    const body = p.takeStored();
    prepared.push({ id: body.plugin.ballId });
  }
  for (let i = 0; i < prepared.length; i++) {
    p.emit(prepared[i]);
    const ball = p.flying.at(-1);
    const x = 190 + (i % 12) * 3;
    Matter.Body.setPosition(ball, { x, y: BallPhysics.floorY(x) - 5 });
    Matter.Body.setVelocity(ball, { x: (i % 2 ? 1 : -1) * 50 / 60, y: 0 });
    p.resolveFloor(ball, dt / 2);
    assert.ok(ball.plugin.collecting && ball.isSensor, 'settled balls must not obstruct one another');
  }
  run(p, 1.8);
  assert.equal(p.flying.length, 0, 'opposing collection streams should never jam');
  assert.equal(p.exited, 24);
  assert.equal(p.storeBalls.length, 24);
});
