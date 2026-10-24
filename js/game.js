(() => {
  'use strict';
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const fire = document.querySelector('#fire');
  const status = document.querySelector('#status');
  const W = 420, H = 820, R = 5, TOTAL = 24;
  const disk = { x: 210, y: 390, r: 188, angle: 0 };
  const origin = { x: 210, y: 144 };
  const pixelRatio = Math.min(devicePixelRatio || 1, 3);
  canvas.width = W * pixelRatio;
  canvas.height = H * pixelRatio;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  let blocks, balls, particles, mode, queued, timer, recallTime, score, shot;
  let drag = null;

  function color(hp) {
    return `hsl(${Math.min(280, 48 + hp * 1.5)} 95% 65%)`;
  }

  function reset() {
    disk.angle = 0;
    // Positions are relative to the disk center. Shape orientation rotates with it.
    blocks = [
      ['square', -72, 10, 17, 52, 0],
      ['square', 76, -50, 17, 52, -.5],
      ['circle', 14, 56, 20, 52, 0],
    ].map(([type, dx, dy, r, hp, baseAngle], id) => ({
      id, type, dx, dy, r, hp, baseAngle, flash: 0,
    }));
    balls = []; particles = []; mode = 'ready'; queued = 0;
    timer = recallTime = score = shot = 0;
    drag = null;
    positionBlocks();
    hud();
    draw();
  }

  function positionBlocks() {
    const c = Math.cos(disk.angle), s = Math.sin(disk.angle);
    for (const b of blocks) {
      b.x = disk.x + b.dx * c - b.dy * s;
      b.y = disk.y + b.dx * s + b.dy * c;
      b.angle = b.baseAngle + disk.angle;
    }
  }

  function hud() {
    fire.disabled = mode === 'shooting' || mode === 'recalling';
    fire.textContent = mode === 'shooting' ? '发射中' : mode === 'recalling' ? '回收中' : mode === 'won' ? '再来一局' : '发射';
    status.textContent = mode === 'ready' ? '拖动圆盘旋转方块' : mode === 'shooting' ? '等待全部小球离开屏幕' : mode === 'recalling' ? '小球正在从上方回到球仓' : '全部清空！';
  }

  function vertices(b) {
    const n = b.type === 'triangle' ? 3 : 4;
    return Array.from({ length: n }, (_, i) => {
      const a = b.angle + (n === 3 ? -Math.PI / 2 : Math.PI / 4) + i * Math.PI * 2 / n;
      const r = n === 4 ? b.r * Math.SQRT2 : b.r;
      return { x: b.x + Math.cos(a) * r, y: b.y + Math.sin(a) * r };
    });
  }
  function hit(ball,b) {
    let nx,ny,depth;if(b.type==='circle') {
      let dx=ball.x-b.x,dy=ball.y-b.y,d=Math.hypot(dx,dy);if(d>=b.r+R)return false;nx=dx/(d||1);ny=dy/(d||1);depth=b.r+R-d
    }
    else {
      const vs=vertices(b);let dist=Infinity,px=0,py=0,inside=true;for(let i=0;i<vs.length;i++) {
        let a=vs[i],c=vs[(i+1)%vs.length],ex=c.x-a.x,ey=c.y-a.y;if(ex*(ball.y-a.y)-ey*(ball.x-a.x)<0)inside=false;let t=Math.max(0,Math.min(1,((ball.x-a.x)*ex+(ball.y-a.y)*ey)/(ex*ex+ey*ey)));let x=a.x+t*ex,y=a.y+t*ey,d=Math.hypot(ball.x-x,ball.y-y);if(d<dist) {
          dist=d;px=x;py=y
        }
      }
      if(!inside&&dist>=R)return false;nx=(ball.x-px)/(dist||1);ny=(ball.y-py)/(dist||1);if(inside) {
        nx=-nx;ny=-ny
      }
      depth=inside?R+dist:R-dist
    }
    ball.x+=nx*(depth+.1);ball.y+=ny*(depth+.1);const dot=ball.vx*nx+ball.vy*ny;if(dot>=0)return false;ball.vx-=2*dot*nx;ball.vy-=2*dot*ny;return true
  }

  function launch() {
    if (mode === 'won') { reset(); return; }
    if (mode !== 'ready') return;
    // One press releases the entire volley automatically along the same vertical line.
    mode = 'shooting'; queued = TOTAL; timer = 0; shot++;
    hud();
  }

  function update(dt) {
    for (const b of blocks) b.flash = Math.max(0, b.flash - dt * 6);
    particles = particles.filter(p => {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      return p.life > 0;
    });
    if (mode === 'recalling') {
      recallTime += dt;
      if (recallTime >= 1.7) {
        mode = blocks.length ? 'ready' : 'won';
        hud();
      }
      return;
    }
    if (mode !== 'shooting') return;
    timer -= dt;
    while (queued && timer <= 0) {
      balls.push({ x: origin.x, y: origin.y, vx: 0, vy: 240 });
      queued--; timer += .075;
    }
    // Gravity prevents horizontal trajectories from becoming stuck indefinitely.
    for (let step = 0; step < 4; step++) {
      const t = dt / 4;
      for (const ball of balls) {
        ball.vy += 145 * t;
        const velocity = Math.hypot(ball.vx, ball.vy);
        if (velocity > 580) { ball.vx *= 580 / velocity; ball.vy *= 580 / velocity; }
        ball.x += ball.vx * t; ball.y += ball.vy * t;
        if (ball.x < 22 + R) { ball.x = 22 + R; ball.vx = Math.abs(ball.vx); }
        if (ball.x > W - 22 - R) { ball.x = W - 22 - R; ball.vx = -Math.abs(ball.vx); }
        if (ball.y < 155 + R) { ball.y = 155 + R; ball.vy = Math.abs(ball.vy); }
        for (const b of blocks) {
          if (b.hp > 0 && hit(ball, b)) {
            b.hp--; score++; b.flash = 1;
            if (!b.hp) {
              for (let i = 0; i < 16; i++) {
                const a = i / 16 * Math.PI * 2;
                particles.push({ x: b.x, y: b.y, vx: Math.cos(a) * 65, vy: Math.sin(a) * 65, life: .45, color: color(1) });
              }
            }
          }
        }
      }
      // No early teleport: each ball must leave below the actual screen edge.
      balls = balls.filter(b => b.y <= H + R);
      blocks = blocks.filter(b => b.hp > 0);
    }
    if (!queued && !balls.length) {
      mode = 'recalling'; recallTime = 0; hud();
    }
  }

  function circle(x, y, r, fill) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
  }

  function slot(i) {
    if (!i) return { x: 210, y: 136 };
    const row = Math.floor((i - 1) / 8), col = (i - 1) % 8;
    return { x: 153 + col * 16 + (row % 2) * 7, y: 108 - row * 15 - Math.abs(col - 3.5) * 3 };
  }

  function draw() {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#707473'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(22, 181); ctx.lineTo(22, 96);
    ctx.quadraticCurveTo(22, 74, 43, 79); ctx.lineTo(185, 121);
    ctx.quadraticCurveTo(195, 125, 195, 138);
    ctx.moveTo(225, 138); ctx.quadraticCurveTo(225, 125, 235, 121);
    ctx.lineTo(377, 79); ctx.quadraticCurveTo(398, 74, 398, 96);
    ctx.lineTo(398, 181); ctx.stroke();

    ctx.strokeStyle = '#343d3e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(disk.x, disk.y, disk.r, 0, Math.PI * 2); ctx.stroke();
    for (const b of blocks) {
      ctx.fillStyle = b.flash > .65 ? '#fff' : color(b.hp);
      if (b.type === 'circle') circle(b.x, b.y, b.r, ctx.fillStyle);
      else {
        ctx.beginPath(); vertices(b).forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.closePath(); ctx.fill();
      }
      // Draw labels in screen coordinates, independently of the rotated geometry.
      ctx.fillStyle = '#07110a'; ctx.font = '16px Helvetica Neue';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.hp, b.x, b.y + 1);
    }

    ctx.fillStyle = '#262827'; ctx.beginPath();
    ctx.moveTo(0, H); ctx.lineTo(0, 655);
    ctx.quadraticCurveTo(210, 603, 420, 655); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3b4241'; ctx.beginPath(); ctx.moveTo(0, 655);
    ctx.quadraticCurveTo(210, 603, 420, 655); ctx.stroke();

    const waiting = mode === 'shooting' ? queued : mode === 'recalling' ? 0 : TOTAL;
    for (let i = 0; i < waiting; i++) {
      const p = slot(i); circle(p.x, p.y, 7, '#dedfdd');
    }
    if (mode === 'recalling') {
      for (let i = 0; i < TOTAL; i++) {
        const p = slot(i), t = Math.max(0, Math.min(1, (recallTime - i * .018) / 1.1));
        const eased = 1 - (1 - t) ** 2;
        circle(p.x, -22 - i * 5 + (p.y + 22 + i * 5) * eased, 7, '#dedfdd');
      }
    }
    for (const ball of balls) circle(ball.x, ball.y, R, '#fff');
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / .45);
      circle(p.x, p.y, 2, p.color);
    }
    ctx.globalAlpha = 1;
  }

  function point(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width * W, y: (e.clientY - rect.top) / rect.height * H };
  }
  canvas.addEventListener('pointerdown', e => {
    const p = point(e);
    const distance = Math.hypot(p.x - disk.x, p.y - disk.y);
    if (distance > disk.r || distance < 15) return;
    drag = { id: e.pointerId, angle: Math.atan2(p.y - disk.y, p.x - disk.x) };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = point(e), a = Math.atan2(p.y - disk.y, p.x - disk.x);
    const delta = Math.atan2(Math.sin(a - drag.angle), Math.cos(a - drag.angle));
    disk.angle += delta; drag.angle = a; positionBlocks();
  });
  function stopDrag() { drag = null; canvas.style.cursor = ''; }
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('lostpointercapture', stopDrag);
  fire.addEventListener('click', launch);
  document.querySelector('#reset').addEventListener('click', reset);

  window.render_game_to_text = () => JSON.stringify({
    coordinates: '420x820; origin top-left; x right, y down', mode, score, shot, queued,
    disk, recallTime, ballCount: TOTAL, exited: TOTAL - queued - balls.length,
    balls: balls.map(b => ({ ...b })),
    blocks: blocks.map(({ id, type, x, y, hp, angle }) => ({ id, type, x, y, hp, angle, labelAngle: 0 })),
  });
  window.advanceTime = ms => {
    const steps = Math.max(1, Math.ceil(ms / (1000 / 120)));
    for (let i = 0; i < steps; i++) update(ms / 1000 / steps);
    draw();
  };
  let last = performance.now();
  function frame(now) {
    update(Math.min((now - last) / 1000, .033)); last = now;
    draw(); requestAnimationFrame(frame);
  }
  reset(); requestAnimationFrame(frame);
})();
