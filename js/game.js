(() => {
  'use strict';
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const fire = document.querySelector('#fire');
  const status = document.querySelector('#status');
  const INITIAL_ATTEMPTS = 5, BONUS_ATTEMPTS = 3;
  let attempts = INITIAL_ATTEMPTS, rewardTime = 0;
  const W = 420, H = 820, R = 5, TOTAL = 24;
  const disk = { x: 210, y: 390, r: 188, angle: 0 };
  const origin = { x: 210, y: 144 };
  const pixelRatio = Math.min(devicePixelRatio || 1, 3);
  canvas.width = W * pixelRatio;
  canvas.height = H * pixelRatio;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  let blocks, balls, particles, mode, queued, timer, recallTime, score, shot;
  let drag = null;

  function color(hp, brightness = 1) {
    return window.BallzPalette.color(hp, brightness);
  }

  function reset() {
    disk.angle = 0;
    attempts = INITIAL_ATTEMPTS; rewardTime = 0;
    document.querySelector('#reward').hidden = true;
    // Build three separated clusters. Every lower block overlaps one or two upper blocks.
    blocks = [];
    const shapes = ['circle', 'triangle', 'square'];
    const offset = Math.random() * .4 - .2;
    for (let cluster = 0; cluster < 3; cluster++) {
      const angle = -Math.PI / 2 + cluster * Math.PI * 2 / 3 + offset;
      const radius = 65 + Math.random() * 20;
      const dx = Math.cos(angle) * radius, dy = Math.sin(angle) * radius;
      const lower = {
        id: cluster * 3, type: shapes[cluster], dx, dy, r: 23,
        hp: 21 + Math.floor(Math.random() * 9), baseAngle: Math.random() * Math.PI,
        layer: 2, coveredBy: [], flash: 0,
      };
      blocks.push(lower);
      const count = cluster === 0 ? 2 : 1;
      const direction = Math.random() * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        const a = direction + i * Math.PI;
        const upper = {
          id: cluster * 3 + i + 1, type: shapes[(cluster + i + 1) % 3],
          dx: dx + Math.cos(a) * 22, dy: dy + Math.sin(a) * 22,
          r: 20, hp: Math.random() < .5 ? 3 : 5,
          baseAngle: Math.random() * Math.PI, layer: 1, coveredBy: [], flash: 0,
        };
        lower.coveredBy.push(upper.id);
        blocks.push(upper);
      }
    }
    // Place the bonus over a cluster; it participates in exactly the same cover graph.
    const front = blocks[1];
    const inward = Math.atan2(-front.dy, -front.dx);
    blocks.push({
      id: 9, type: 'square', dx: front.dx + Math.cos(inward) * 24, dy: front.dy + Math.sin(inward) * 24, hp: 3,
      baseAngle: Math.PI / 4, layer: 1, coveredBy: [], flash: 0, bonus: true,
    });
    blocks.forEach((b, z) => {
      b.r = window.BlockGeometry.radius(b.type);
      b.size = 1;
      b.z = z;
    });
    balls = []; particles = []; mode = 'ready'; queued = 0;
    timer = recallTime = score = shot = 0;
    drag = null;
    positionBlocks();
    rebuildCovers();
    hud();
    draw();
  }

  function rebuildCovers() {
    for (const b of blocks) b.coveredBy = [];
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        if (window.BlockGeometry.overlaps(blocks[i], blocks[j])) {
          blocks[i].coveredBy.push(blocks[j].id);
        }
      }
    }
  }

  function depth(block) {
    const covers = blocks.filter(b => b.hp > 0 && block.coveredBy.includes(b.id));
    return covers.length ? 1 + Math.max(...covers.map(depth)) : 1;
  }

  function exposed(block) {
    return depth(block) === 1;
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
    fire.textContent = mode === 'shooting' ? '发射中' : mode === 'recalling' ? '回收中' : mode === 'won' ? '再来一局' : mode === 'lost' ? '重新挑战' : '发射';
    status.textContent = mode === 'ready' ? '清空全部方块 · 击碎 +3击 方块增加机会' : mode === 'shooting' ? '等待本轮结束 · 击碎 +3击 方块增加机会' : mode === 'recalling' ? '小球正在从上方回到球仓' : mode === 'won' ? '挑战成功！全部方块已清空' : '机会已用尽 · 未能清空全部方块';
    document.querySelector('#attempts').textContent = attempts;
    document.querySelector('.attempts').classList.toggle('low', attempts <= 1);

  }

  function vertices(b) {
    return window.BlockGeometry.vertices(b);
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
    if (mode === 'won' || mode === 'lost') { reset(); return; }
    if (mode !== 'ready' || attempts <= 0) return;
    // One press releases the entire volley automatically along the same vertical line.
    attempts--;
    mode = 'shooting'; queued = TOTAL; timer = 0; shot++;
    hud();
  }

  // Same quadratic curve as the rendered gray surface: (0,655), (210,603), (420,655).
  function surfaceY(x) {
    return 629 + 26 * ((x - W / 2) / (W / 2)) ** 2;
  }
  function surfaceSlope(x) {
    return 52 * (x - W / 2) / (W / 2) ** 2;
  }
  function roll(ball, dt) {
    const slope = surfaceSlope(ball.x);
    // Solid sphere rolling acceleration along the slope (5/7 of sliding acceleration).
    ball.vx += (5 / 7) * 460 * slope / (1 + slope * slope) * dt;
    ball.vx = Math.max(-240, Math.min(240, ball.vx));
    const distance = ball.vx * dt;
    ball.x += distance;
    const nextSlope = surfaceSlope(ball.x);
    ball.y = surfaceY(ball.x) - R * Math.sqrt(1 + nextSlope * nextSlope);
    ball.vy = nextSlope * ball.vx;
    ball.spin += distance * Math.sqrt(1 + nextSlope * nextSlope) / R;
  }

  function outside(ball) {
    return ball.x < -R || ball.x > W + R || ball.y < -R || ball.y > H + R;
  }

  function update(dt) {
    if (rewardTime > 0) {
      rewardTime = Math.max(0, rewardTime - dt);
      document.querySelector('#reward').hidden = rewardTime === 0;
    }
    for (const b of blocks) b.flash = Math.max(0, b.flash - dt * 6);
    particles = particles.filter(p => {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      return p.life > 0;
    });
    if (mode === 'recalling') {
      recallTime += dt;
      if (recallTime >= 1.7) {
        mode = !blocks.length ? 'won' : attempts > 0 ? 'ready' : 'lost';
        hud();
      }
      return;
    }
    if (mode !== 'shooting') return;
    timer -= dt;
    while (queued && timer <= 0) {
      balls.push({ id: TOTAL - queued, x: origin.x, y: origin.y, vx: 0, vy: 240, rolling: false, spin: 0, bounces: 0 });
      queued--; timer += .075;
    }
    // Gravity prevents horizontal trajectories from becoming stuck indefinitely.
    for (let step = 0; step < 4; step++) {
      const t = dt / 4;
      for (const ball of balls) {
        if (ball.rolling) {
          roll(ball, t);
          continue;
        }
        ball.vy += 145 * t;
        const velocity = Math.hypot(ball.vx, ball.vy);
        if (velocity > 580) { ball.vx *= 580 / velocity; ball.vy *= 580 / velocity; }
        ball.x += ball.vx * t; ball.y += ball.vy * t;
        // Open screen edges: once outside, a ball never bounces back into play.
        if (outside(ball)) continue;
        for (const b of blocks) {
          if (b.hp > 0 && exposed(b) && hit(ball, b)) {
            b.hp--; score++; b.flash = 1;
            if (!b.hp) {
              if (b.bonus) {
                attempts += BONUS_ATTEMPTS;
                rewardTime = 2;
                document.querySelector('#reward').hidden = false;
                hud();
              }
              for (let i = 0; i < 16; i++) {
                const a = i / 16 * Math.PI * 2;
                particles.push({ x: b.x, y: b.y, vx: Math.cos(a) * 65, vy: Math.sin(a) * 65, life: .45, color: color(1) });
              }
            }
          }
        }
        const slope = surfaceSlope(ball.x);
        const normalSize = Math.hypot(slope, 1);
        const nx = slope / normalSize, ny = -1 / normalSize;
        const normalVelocity = ball.vx * nx + ball.vy * ny;
        if (normalVelocity < 0 && ball.y + R * normalSize >= surfaceY(ball.x)) {
          ball.y = surfaceY(ball.x) - R * normalSize - .05;
          ball.vx -= 1.84 * normalVelocity * nx;
          ball.vy -= 1.84 * normalVelocity * ny;
          ball.bounces++;
          // A tiny lateral nudge resolves a perfectly centered bounce on the crest.
          if (Math.abs(ball.vx) < 16) ball.vx = (ball.id % 2 ? 1 : -1) * 24;
          if (-normalVelocity * .84 < 100) {
            ball.rolling = true;
            const direction = Math.abs(ball.x - W / 2) > 2 ? Math.sign(ball.x - W / 2) : (ball.id % 2 ? 1 : -1);
            ball.vx = direction * Math.max(38, direction * ball.vx);
          }
        }
      }
      balls = balls.filter(b => !outside(b));
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
    // Covered pieces render behind all exposed pieces, including after rotation.
    const drawOrder = [...blocks].sort((a, b) => a.z - b.z);
    for (const b of drawOrder) {
      const visible = exposed(b);
      ctx.globalAlpha = 1;
      const brightness = visible ? 1 : Math.max(.1, .26 - (depth(b) - 2) * .07);
      ctx.fillStyle = visible && b.flash > .65 ? '#fff' : color(b.hp, brightness);
      if (b.type === 'circle') circle(b.x, b.y, b.r, ctx.fillStyle);
      else {
        ctx.beginPath(); vertices(b).forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.closePath(); ctx.fill();
      }
      if (b.bonus) {
        ctx.strokeStyle = visible ? '#fff' : '#454545'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (!visible) continue;
      // Draw labels in screen coordinates, independently of the rotated geometry.
      ctx.fillStyle = '#07110a'; ctx.font = '16px Helvetica Neue';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (b.bonus) {
        ctx.fillText(b.hp, b.x, b.y - 3);
        ctx.font = '9px Helvetica Neue';
        ctx.fillText('+3击', b.x, b.y + 10);
      } else ctx.fillText(b.hp, b.x, b.y + 1);
    }

    ctx.fillStyle = '#262827'; ctx.beginPath();
    ctx.moveTo(0, H); ctx.lineTo(0, 655);
    ctx.quadraticCurveTo(210, 603, 420, 655); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3b4241'; ctx.beginPath(); ctx.moveTo(0, 655);
    ctx.quadraticCurveTo(210, 603, 420, 655); ctx.stroke();

    const waiting = mode === 'shooting' ? queued : mode === 'recalling' ? 0 : TOTAL;
    for (let i = 0; i < waiting; i++) {
      const p = slot(i); circle(p.x, p.y, R, '#dedfdd');
    }
    if (mode === 'recalling') {
      for (let i = 0; i < TOTAL; i++) {
        const p = slot(i), t = Math.max(0, Math.min(1, (recallTime - i * .018) / 1.1));
        const eased = 1 - (1 - t) ** 2;
        circle(p.x, -22 - i * 5 + (p.y + 22 + i * 5) * eased, R, '#dedfdd');
      }
    }
    for (const ball of balls) {
      circle(ball.x, ball.y, R, '#fff');
      if (ball.rolling) circle(ball.x + Math.cos(ball.spin) * 2.8, ball.y + Math.sin(ball.spin) * 2.8, 1.1, '#84988a');
    }
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
    coordinates: '420x820; origin top-left; x right, y down', mode, score, shot, queued, attempts, initialAttempts: INITIAL_ATTEMPTS,
    disk, recallTime, ballCount: TOTAL, exited: TOTAL - queued - balls.length,
    balls: balls.map(b => ({ ...b })),
    ballRadius: R, waitingBallRadius: R,
    blocks: blocks.map(b => ({
      id: b.id, type: b.type, bonus: !!b.bonus, reward: b.bonus ? BONUS_ATTEMPTS : 0, x: b.x, y: b.y, hp: exposed(b) ? b.hp : null,
      angle: b.angle, color: color(b.hp), labelAngle: 0,
      layer: depth(b), size: b.size, area: window.BlockGeometry.area, hidden: !exposed(b), coveredBy: b.coveredBy,
    })),
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
