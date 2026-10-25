const test=require('node:test');const assert=require('node:assert/strict');
global.window=global;global.Matter=require('../js/vendor/matter-0.20.0.min.js');require('../js/block-geometry.js');require('../js/physics.js');require('../js/ball-effects.js');require('../js/rewards.js');
test('contact upgrades stack unique abilities and stop size growth at large',()=>{
 const p=new BallPhysics(1);p.start();p.step(1/120);
 for(const effect of ['lightning','vitality','explosive']){assert.ok(p.upgradeBall(0,effect));assert.equal(p.upgradeBall(0,effect),false);}
 assert.ok(p.upgradeBall(0,'size'));assert.equal(p.ballInfo(0).size,'medium');assert.ok(p.upgradeBall(0,'size'));assert.equal(p.upgradeBall(0,'size'),false);
 const info=p.ballInfo(0),body=p.flying[0];assert.equal(info.radius,9);assert.equal(body.plugin.radius,9);assert.equal(info.abilities.length,3);assert.ok(body.restitution>1);
 assert.ok(Math.hypot(body.velocity.x,body.velocity.y)>=520/60-1e-9);
 const effect=BallEffects.plan(info,{id:1,x:0,y:0},[{id:2,x:30,y:0,r:10}]);assert.equal(effect.damage,3);assert.equal(effect.radius,140);assert.equal(effect.bolts.length,1);
 assert.equal(effect.targets.filter(id=>id===2).length,2,'lightning and blast both apply');
 Matter.Body.setPosition(body,{x:-30,y:400});
 for(let i=0;i<1200&&p.phase!=='ready';i++)p.step(1/120);
 assert.equal(p.storeBalls.find(b=>b.id===0).abilities.length,3);assert.ok(p.start());
 // Ready-to-launch includes a ball still finishing its short feeder animation.
 for(let i=0;i<30&&!p.activeBalls.length;i++)p.step(1/120);
 assert.ok(p.activeBalls.length);assert.equal(p.activeBalls[0].abilities.length,3);assert.equal(p.activeBalls[0].radius,9);
});
test('buff reward types survive normalization and have readable labels',()=>{
 for(const effect of ['size','lightning','vitality','explosive']){const b={type:'square',bonus:true,rewardType:`buff-${effect}`};RewardRules.initialize(b);assert.equal(RewardRules.type(b),`buff-${effect}`);assert.ok(RewardRules.label(b).length>0);}
});
test('combined ball rendering splits the ball into two or three equal sectors',()=>{
 for(const n of [2,3]){const arcs=[];const ctx={beginPath(){},moveTo(){},arc(...a){arcs.push(a)},closePath(){},fill(){}};
 BallEffects.drawBall(ctx,{x:0,y:0,radius:9,abilities:['lightning','vitality','explosive'].slice(0,n)});assert.equal(arcs.length,n);for(const a of arcs)assert.ok(Math.abs(a[4]-a[3]-Math.PI*2/n)<1e-9);}
});

test('size upgrades stay with the attacking ball and are wasted at maximum size',()=>{
 const p=new BallPhysics(3);assert.equal(p.applyBuff(1,'size'),1);assert.equal(p.ballInfo(1).size,'medium');
 assert.equal(p.applyBuff(1,'size'),1);assert.equal(p.ballInfo(1).size,'large');
 assert.equal(p.applyBuff(1,'size'),null);assert.equal(p.applyBuff(1,'size'),null);
 assert.equal(p.ballInfo(0).size,'small');assert.equal(p.ballInfo(2).size,'small');
 assert.equal(p.applyBuff(-1,'size'),null);assert.equal(p.ballInfo(0).size,'small');
});
