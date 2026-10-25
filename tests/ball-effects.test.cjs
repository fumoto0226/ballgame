const test=require('node:test');const assert=require('node:assert/strict');global.window=global;require('../js/ball-effects.js');
const origin={id:0,x:0,y:0,r:10};const chain=[origin,{id:1,x:75,y:0,r:10},{id:2,x:150,y:0,r:10},{id:3,x:225,y:0,r:10}];
test('lightning sizes chain one/two/three fixed-radius hops without repeat damage',()=>{
 for(const [size,n] of [['small',1],['medium',2],['large',3]]){const p=BallEffects.plan({type:'lightning',size},origin,chain);assert.equal(p.damage,n);assert.equal(p.targets.length,n);assert.equal(p.bolts.length,n);assert.deepEqual(p.ranges.map(r=>r.radius),Array(n).fill(70));assert.equal(new Set(p.targets).size,n);}
});
test('explosion damage and radius grow while normal ball damage stays one',()=>{
 for(const [size,n,r] of [['small',1,70],['medium',2,100],['large',3,140]]){const p=BallEffects.plan({type:'explosive',size},origin,chain);assert.equal(p.damage,n);assert.equal(p.radius,r);assert.ok(!p.targets.includes(0));assert.equal(BallEffects.plan({type:'vitality',size},origin,chain).damage,n);assert.equal(BallEffects.plan({type:'normal',size},origin,chain).damage,1);}
});
test('explosion targets use ball center rather than the struck block center',()=>{
 const hit={id:0,x:0,y:0,r:10};const left={id:1,x:-50,y:0,r:10},right={id:2,x:120,y:0,r:10};
 const p=BallEffects.plan({type:'explosive',size:'small'},hit,[hit,left,right],{x:50,y:0});
 assert.deepEqual(p.center,{x:50,y:0});assert.deepEqual(p.targets,[2]);
});
test('lightning caps outgoing links at every source and never grows its range',()=>{
 const dense=[origin,...Array.from({length:25},(_,i)=>({id:i+1,x:20+(i%5)*8,y:-16+Math.floor(i/5)*8,r:2}))];
 for(const [size,cap] of [['small',2],['medium',3],['large',4]]){
  const p=BallEffects.plan({type:'lightning',size},origin,dense);const outgoing=new Map();
  for(const bolt of p.bolts){const key=`${bolt.x1},${bolt.y1}`;outgoing.set(key,(outgoing.get(key)||0)+1);}
  assert.equal(outgoing.get('0,0'),cap);assert.ok([...outgoing.values()].every(n=>n<=cap));
  assert.ok(p.ranges.every(r=>r.radius===70));assert.equal(new Set(p.targets).size,p.targets.length);
 }
});
