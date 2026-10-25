(() => {
  const abilities = ball => ['lightning','vitality','explosive'].filter(type => ball.type === type || ball.abilities?.includes(type));
  const has = (ball, type) => abilities(ball).includes(type);
  const tier = ball => ball.size === 'large' ? 3 : ball.size === 'medium' ? 2 : 1;
  function plan(ball, origin, candidates, ballCenter = origin) {
    const power = tier(ball), type = ball.type || 'normal';
    const result = { damage: abilities(ball).length ? power : 1, targets: [], bolts: [], ranges: [], radius: 0, center: { x: ballCenter.x, y: ballCenter.y } };
    if (has(ball, 'explosive')) {
      result.radius = [0, 70, 100, 140][power];
      result.targets = candidates.filter(b => b.id !== origin.id && Math.hypot(b.x-ballCenter.x,b.y-ballCenter.y) <= result.radius + b.r).map(b=>b.id);
    }
    if (has(ball, 'lightning')) {
      const visited = new Set([origin.id]); let frontier = [origin];
      for(let hop=0;hop<power;hop++) {
        const next=[], range=70;
        for (const source of frontier) result.ranges.push({ x: source.x, y: source.y, radius: range });
        for (const source of frontier) {
          const nearby = candidates.filter(b => !visited.has(b.id) && Math.hypot(b.x-source.x,b.y-source.y) <= range+b.r)
            .sort((a,b) => Math.hypot(a.x-source.x,a.y-source.y)-Math.hypot(b.x-source.x,b.y-source.y) || a.id-b.id)
            .slice(0, power + 1);
          for (const b of nearby) {
            visited.add(b.id); next.push(b); result.targets.push(b.id);
            result.bolts.push({x1:source.x,y1:source.y,x2:b.x,y2:b.y});
          }
        }
        frontier=next;
      }
    }
    return result;
  }
  function drawBall(ctx, ball) {
    const types=abilities(ball), colors={lightning:'#42a5ff',vitality:'#b86aff',explosive:'#ff5656'};
    const slices=types.length?types:['normal'];
    for(let i=0;i<slices.length;i++) {
      const start=-Math.PI/2+i*Math.PI*2/slices.length;
      ctx.beginPath(); ctx.moveTo(ball.x,ball.y);
      ctx.arc(ball.x,ball.y,ball.radius||5,start,start+Math.PI*2/slices.length);
      ctx.closePath(); ctx.fillStyle=colors[slices[i]]||ball.color||'#fff'; ctx.fill();
    }
  }
  window.BallEffects = { tier, plan, abilities, has, drawBall };
})();
