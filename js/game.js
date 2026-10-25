(() => {
  'use strict';
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const fire = document.querySelector('#fire');
  const status = document.querySelector('#status');
  const params = new URLSearchParams(location.search);
  const playtestKey = params.get('playtest');
  const levelName = params.get('level');
  let playtest = null;
  try { if (playtestKey) playtest = JSON.parse(sessionStorage.getItem(playtestKey)); } catch {}
  // When the home page launches a saved level, synthesize a playtest-shaped bundle so the
  // rest of this file reads it the same way as an editor playtest session.
  if (!playtest && levelName) {
    try {
      const level = LevelCatalog.get(levelName);
      if (level) {
        playtest = { level, settings: GameSettings.saved() || {}, ballSpecs: [], unlimited: false,
          initialAttempts: level.initialAttempts, diskAngle: 0 };
        // Expand level.ballCounts into ballSpecs (default 10 plain if missing).
        const TYPES = [
          { type: 'normal', color: '#ffffff' },
          { type: 'lightning', color: '#42a5ff' },
          { type: 'vitality', color: '#b86aff' },
          { type: 'explosive', color: '#ff5656' },
        ];
        const SIZES = [{ size: 'small', radius: 5 }, { size: 'medium', radius: 7 }, { size: 'large', radius: 9 }];
        const counts = Array.isArray(level.ballCounts) ? level.ballCounts : [[10, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
        playtest.ballSpecs = TYPES.flatMap((t, r) => SIZES.flatMap((s, c) =>
          Array.from({ length: counts[r]?.[c] || 0 }, () => ({ type: t.type, color: t.color, ...s }))));
        document.title = `Falling Ballz · ${levelName}`;
        const badge = document.querySelector('#level-badge');
        if (badge) badge.textContent = `关卡 ${levelName}`;
      }
    } catch {}
  }
  if (!playtest) GameSettings.apply(GameSettings.saved());
  const unlimited = !!playtest?.unlimited;
  if (playtest) {
    // The "playtest" class hides page chrome (badge + exit) during editor playtest only.
    if (playtestKey) document.body.classList.add('playtest');
    const settings = playtest.settings || {};
    GameSettings.apply(settings);
  }
  const INITIAL_ATTEMPTS = Math.max(1, Math.floor(Number(playtest?.initialAttempts ?? playtest?.level?.initialAttempts) || 5));
  const initialBallCount = playtest ? (playtest.ballSpecs?.length ?? playtest.ballCount ?? 10) : BallPhysics.config.count;
  let attempts = INITIAL_ATTEMPTS;
  let rewardFeed = new RewardFeed();
  const { width: W, height: H, radius: R } = BallPhysics.config;
  const TOTAL = initialBallCount;
  const disk = { x: 210, y: 390, r: 188, angle: 0 };
  const pixelRatio = Math.min(devicePixelRatio || 1, 3);
  canvas.width = W * pixelRatio;
  canvas.height = H * pixelRatio;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  let blocks, balls, particles, mode, queued, recallTime, score, shot;
  let preExposedBonusIds = new Set(); // bonus IDs that were already exposed when the current shot started
  let drag = null;
  let physics = null, accumulator = 0, angularVelocity = 0;
  const FIXED_STEP = 1 / 120;
  let rings = [], bolts = [], trails = new Map();
  let depthVersion=0, cachedDepthVersion=-1, cachedDepths=new Map(), cachedFront=null, cachedBlockIndex=new Map();
  let activeBumpers = [];
  let runStats = new RunStats();
  let liveCombo = new LiveCombo(), comboDisplay = null, comboAnimation = null;
  let displayedBalls = TOTAL, countPhase = 'idle', countTimer = 0;

  function color(hp, brightness = 1) {
    return window.BallzPalette.color(hp, brightness);
  }

  function reset() {
    runStats = new RunStats();
    liveCombo = new LiveCombo(); comboDisplay = null;
    comboAnimation?.cancel();
    document.querySelector('#live-combo').hidden = true;
    document.querySelector('#result-overlay').hidden = true;
    depthVersion++;
    bolts = []; trails.clear();
    activeBumpers = DiskBumpers.normalize(playtest?.level?.bumpers);
    disk.angle = playtest?.diskAngle || 0; angularVelocity = 0; accumulator = 0;
    attempts = unlimited ? Infinity : INITIAL_ATTEMPTS;
    rewardFeed = new RewardFeed();
    document.querySelector('#reward').replaceChildren();
    displayedBalls = TOTAL; countPhase = 'idle'; countTimer = 0;
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
    if (playtest) blocks = playtest.level.blocks.map(b => ({ baseAngle: 0, tier: 'medium', hp: 3, ...b, coveredBy: [...(b.coveredBy || [])], flash: 0 }));
    blocks.forEach((b, z) => {
      b.r = window.BlockGeometry.radius(b.type, b.tier);
      b.size = 1;
      b.z = z;
      RewardRules.initialize(b);
    });
    rings = [];
    balls = []; particles = []; mode = 'ready'; queued = 0; preExposedBonusIds = new Set();
    recallTime = score = shot = 0;
    drag = null;
    positionBlocks();
    if (!playtest) rebuildCovers();
    const completeGraph = LayerLayout.completeCovers(blocks);
    for (const b of blocks) b.coveredBy = completeGraph.get(b.id);
    if (physics) { physics.specs = (playtest?.ballSpecs || []).map(s => ({ ...s })); physics.count = TOTAL; physics.reset(); }
    else physics = new window.BallPhysics(playtest?.ballSpecs || TOTAL);
    physics.syncBlocks(blocks.filter(exposed));
    physics.syncBumpers(activeBumpers, disk);
    hud();
    document.querySelector('#ball-count-value').textContent = displayedBalls;
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
    if(cachedDepthVersion!==depthVersion){
      cachedDepths.clear();cachedFront=null;cachedDepthVersion=depthVersion;
      cachedBlockIndex=new Map(blocks.filter(b=>b.hp>0).map(b=>[b.id,b]));
    }
    if(cachedDepths.has(block.id))return cachedDepths.get(block.id);
    const covers=block.coveredBy.map(id=>cachedBlockIndex.get(id)).filter(Boolean);
    const value=Math.max(block.layerFloor||1,covers.length?1+Math.max(...covers.map(depth)):1);
    cachedDepths.set(block.id,value);return value;
  }
  function exposed(block) {
    const value=depth(block);
    if(cachedFront===null)cachedFront=Math.min(...[...cachedBlockIndex.values()].map(depth));
    return value===cachedFront;
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
    fire.disabled = !['won', 'lost'].includes(mode) && (!physics.canStart || attempts <= 0 || !blocks.length);
    document.querySelector('#fire-label').textContent = mode === 'shooting' ? '发射中' : mode === 'recalling' ? (physics.canStart && attempts > 0 ? '发射' : '回收中') : mode === 'won' ? '再来一局' : mode === 'lost' ? '重新挑战' : '发射';
    status.textContent = '';
    document.querySelector('#manual-recall').disabled = mode !== 'shooting';
    document.querySelector('#attempts').textContent = unlimited ? '∞' : attempts;
    document.querySelector('.attempts').classList.toggle('low', attempts <= 1);

  }

  function vertices(b) {
    return window.BlockGeometry.vertices(b);
  }
  function manualRecall() {
    if (mode !== 'shooting') return;
    // Nuclear flush: dump every flying ball back to the pool, clear pending, and nudge the
    // physics state into recalling→ready. Also set up a ready ball so the next shot can fire.
    for (const ball of physics.flying.slice()) {
      try { Matter.Composite.remove(physics.fieldEngine.world, ball); } catch {}
      if ((ball.plugin.shot ?? physics.wave) === physics.wave) physics.exited++;
      physics.returnBall(ball);
    }
    physics.flying = [];
    physics.pending.clear();
    physics.phase = 'recalling';
    physics.recallAge = 0;
    physics.pendingStuckTime = 0;
    if (!physics.ready && !physics.feeder) {
      const anyStored = physics.stored.find(b => b.position.y > 75) || physics.stored[0];
      if (anyStored) {
        physics.ready = { id: anyStored.plugin.ballId, lastShot: anyStored.plugin.lastShot || 0, x: 210, y: 144 };
        physics.stored.splice(physics.stored.indexOf(anyStored), 1);
        try { Matter.Composite.remove(physics.storeEngine.world, anyStored); } catch {}
      }
    }
    mode = 'recalling';
    hud();
  }

  function launch() {
    if (mode === 'won' || mode === 'lost') { reset(); return; }
    if (!['ready', 'recalling'].includes(mode) || attempts <= 0 || !blocks.length) return;
    // One press releases the entire volley automatically along the same vertical line.
    if (!physics.canStart) return;
    runStats.startWave(physics.wave + 1, id => physics.ballInfo(id));
    if (!physics.start()) return;
    if (!unlimited) attempts--;
    // Snapshot the bonuses visible at launch. A bonus uncovered mid-shot shouldn't tick this round.
    preExposedBonusIds = new Set(blocks.filter(b => b.bonus && exposed(b)).map(b => b.id));
    mode = 'shooting'; queued = physics.count; shot++;
    RewardRules.updateChoices(blocks, shot, exposed);
    displayedBalls = physics.count; countPhase = 'shooting'; countTimer = 0;
    document.querySelector('#ball-count-value').textContent = displayedBalls;
    hud();
  }

  function damageBlock(id, impact = null, amount = 1) {
    const b = blocks.find(block => block.id === id);
    if (!b || b.hp <= 0 || !exposed(b)) return;
    const hitColor = color(b.hp);
    const dealt = Math.min(b.hp, amount);
    // Size grants one step per attack to its source ball, including blast/chain hits.
    // Other abilities keep their existing per-damage reward behavior.
    if (b.bonus && impact?.ballId != null) {
      const kind = RewardRules.type(b);
      if (kind.startsWith('buff-')) {
        const upgrades = kind === 'buff-size' ? 1 : dealt;
        for (let i = 0; i < upgrades; i++) {
          if (physics.applyBuff(impact.ballId, kind.slice(5)) !== null) { RewardRules.claimChoice(blocks, b); notifyReward(kind, 1); }
        }
      }
    }
    b.hp -= dealt; score += dealt; b.flash = 1;
    if (impact?.ballId != null) runStats.hit(impact.ballId, impact.wave ?? physics.wave, dealt);
    b.hitAngle = impact ? Math.atan2(impact.dy, impact.dx) : 0;
    const hitX = impact?.x ?? b.x, hitY = impact?.y ?? b.y;
    rings.push({ x: hitX, y: hitY, life: .18, maxLife: .18, color: hitColor });
    for (let i = 0; i < 5; i++) {
      const a = b.hitAngle + Math.PI + (Math.random() - .5) * Math.PI * 1.5;
      const speed = 45 + Math.random() * 80;
      const life = .16 + Math.random() * .1;
      particles.push({ x: hitX, y: hitY, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life, maxLife: life, size: 1.2, color: i % 2 ? hitColor : '#fff' });
    }
    if (b.hp > 0) return;
    depthVersion++;
    rings.push({ x: b.x, y: b.y, life: .28, maxLife: .28, color: hitColor, large: true });
    if (b.bonus) {
      RewardRules.claimChoice(blocks, b);
      const value = RewardRules.amount(b), kind = RewardRules.type(b);
      if (kind === 'bumper') {
        const slot = DiskBumpers.chooseFree(activeBumpers, Math.random, disk.angle);
        if (slot !== null) { activeBumpers.push(slot); notifyReward('bumper', 1); }
      } else if (kind === 'balls') notifyReward('balls', physics.addBalls(value));
      else if (kind === 'balls-multiply') {
        const added = physics.addBalls(Math.max(1, Math.round(physics.count * (value - 1))));
        notifyReward('balls', added);
      } else if (kind === 'attempts' && !unlimited) {
        attempts += value; notifyReward('attempts', value);
      }
      // Per-hit buffs were already applied and announced above.
      hud();
    }
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      particles.push({ x: b.x, y: b.y, vx: Math.cos(a) * 130, vy: Math.sin(a) * 130, life: .45, maxLife: .45, size: 2.2, color: hitColor });
    }
  }

  function notifyReward(kind, amount) {
    rewardFeed.add(kind, amount); updateRewardFeed(0);
  }
  function updateRewardFeed(dt) {
    const items = rewardFeed.advance(dt), el = document.querySelector('#reward');
    el.hidden = items.length === 0;
    const names = { 'buff-size': '尺寸升级', 'buff-lightning': '闪电球', 'buff-vitality': '活力球', 'buff-explosive': '爆炸球', bumper: '弹力板', attempts: '发射次数', balls: '小球' };
    const colors = { 'buff-lightning': '#42a5ff', 'buff-vitality': '#b86aff', 'buff-explosive': '#ff5656' };
    const ids = new Set(items.map(item => String(item.serial)));
    for (const row of [...el.children]) if (!ids.has(row.dataset.serial)) row.remove();
    items.forEach((item, index) => {
      let row = el.querySelector(`[data-serial="${item.serial}"]`);
      const bottom = item.slot * 22;
      if (!row) {
        row = document.createElement('span'); row.className = 'reward-row';
        row.dataset.serial = item.serial;
        const label = document.createElement('span'); label.textContent = `${names[item.kind] || item.kind} +`;
        const value = document.createElement('span'); value.className = 'reward-value';
        row.append(label, value);
        row.style.color = colors[item.kind] || '#ffffff';
        el.appendChild(row);
        row.animate([{ transform: 'translateY(5px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 160, easing: 'ease-out' });
      } else if (Number(row.dataset.bottom) !== bottom) {
        row.animate([{ transform: `translateY(${bottom - Number(row.dataset.bottom)}px)` }, { transform: 'translateY(0)' }], { duration: 160, easing: 'ease-out' });
      }
      const value = row.querySelector('.reward-value');
      if (value.dataset.value !== String(item.amount)) {
        const previous = value.dataset.value;
        value.dataset.value = item.amount;
        const next = document.createElement('span'); next.textContent = item.amount;
        value.replaceChildren(next);
        if (previous != null) {
          const old = document.createElement('span'); old.className = 'reward-value-old'; old.textContent = previous;
          value.appendChild(old);
          old.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }], { duration: 180, easing: 'ease-out', fill: 'forwards' }).onfinish = () => old.remove();
          next.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' });
        }
        row.setAttribute('aria-label', `${names[item.kind] || item.kind} +${item.amount}`);
      }
      row.dataset.bottom = bottom; row.style.bottom = `${bottom}px`;
      // Fade within the fixed lifetime, so no fourth/ghost row is retained during removal.
      const remaining = item.expiresAt - rewardFeed.time;
      row.style.opacity = Math.min(1, Math.max(0, remaining / .2));
      row.style.translate = `0 ${remaining < .2 ? -8 * (1 - remaining / .2) : 0}px`;
    });
  }

  function applyBallHit(hit) {
    const origin = blocks.find(b => b.id === hit.blockId && b.hp > 0 && exposed(b));
    if (!origin) return;
    liveCombo.hit(hit.ballId, hit.wave ?? physics.wave);
    const kind = RewardRules.type(origin);
    // The buff transfer now happens inside damageBlock when the bonus actually dies,
    // so each buff block hands out exactly one upgrade (no double-apply on touch + kill).
    const spec = Number.isInteger(hit.ballId) ? physics.ballInfo(hit.ballId) : hit.ball || {};
    const effects = BallEffects.plan(spec, origin, blocks.filter(b => b.hp > 0 && exposed(b)),
      { x: hit.ballX ?? hit.x ?? origin.x, y: hit.ballY ?? hit.y ?? origin.y });
    damageBlock(origin.id, hit, effects.damage);
    for (const id of effects.targets) damageBlock(id, hit, effects.damage);
    for (const range of effects.ranges) rings.push({ ...range, life: .32, maxLife: .32, color: '#edf5ff', rangeHint: true });
    for (const bolt of effects.bolts) bolts.push({ ...bolt, life: .22 });
    if (effects.radius) rings.push({ x: effects.center.x, y: effects.center.y, life: .35, maxLife: .35, color: '#ff6464', radius: effects.radius });
  }

  function update(dt) {
    if (mode === 'won' || mode === 'lost') return;
    updateRewardFeed(dt);
    for (const b of blocks) b.flash = Math.max(0, b.flash - dt * 8);
    bolts = bolts.filter(b => { b.life -= dt; return b.life > 0; });
    rings = rings.filter(r => { r.life -= dt; return r.life > 0; });
    particles = particles.filter(p => {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      return p.life > 0;
    });
    // Direct manipulation while held; exponential drag gives a smooth inertial coast after release.
    if (!drag?.active && angularVelocity) {
      const damping = 2.6;
      const decay = Math.exp(-damping * dt);
      disk.angle += angularVelocity * (1 - decay) / damping;
      angularVelocity *= decay;
      if (Math.abs(angularVelocity) < .025) angularVelocity = 0;
    }
    positionBlocks();
    RewardRules.updateChoices(blocks, shot, exposed);
    physics.syncBlocks(blocks.filter(exposed), dt);
    physics.syncBumpers(activeBumpers, disk);
    physics.step(dt);
    for (const hit of physics.consumeHits()) applyBallHit(hit);
    for (const returned of physics.consumeReturns()) runStats.finish(returned.ballId, returned.wave, physics.ballInfo(returned.ballId));
    for (const wave of new Set([...runStats.returned.values()].map(r=>r.wave))) {
      if ((wave < physics.wave || !physics.pending.size) && !physics.flying.some(b=>b.plugin.shot===wave))
        runStats.closeWave(wave, id=>physics.ballInfo(id));
    }
    blocks = blocks.filter(b => b.hp > 0);
    balls = physics.activeBalls;
    if (!blocks.length && shot > 0) {
      // The last brick ends the challenge immediately, even while balls are airborne/queued.
      // Freeze each unfinished flight's score and current appearance for the result portrait.
      for (const flight of [...runStats.flights.values()])
        runStats.finish(flight.ballId, flight.wave, physics.ballInfo(flight.ballId));
      for (const wave of new Set([...runStats.returned.values()].map(r=>r.wave)))
        runStats.closeWave(wave, id=>physics.ballInfo(id));
      mode = 'won'; drag = null; angularVelocity = 0; preExposedBonusIds.clear();
      hud(); showResult(); return;
    }
    updateLiveCombo(dt);
    const live = new Set();
    for (const ball of balls) {
      if (!BallEffects.has(ball, 'vitality') || ball.collecting) continue;
      live.add(ball.id);
      const points = (trails.get(ball.id) || []).filter(p => { p.life -= dt; return p.life > 0; });
      const last = points[points.length - 1];
      if (!last || Math.hypot(last.x - ball.x, last.y - ball.y) > 2) points.push({ x: ball.x, y: ball.y, radius: ball.radius, life: .16 });
      trails.set(ball.id, points);
    }
    for (const id of trails.keys()) if (!live.has(id)) trails.delete(id);
    queued = physics.queued;
    recallTime = physics.recallAge;
    if (mode === 'recalling' && physics.phase === 'shooting') mode = 'shooting';
    if (mode === 'shooting' && physics.phase === 'recalling') {
      mode = 'recalling'; hud();
    } else if (['shooting', 'recalling'].includes(mode) && physics.phase === 'ready') {
      // Only bonuses that were visible at launch and are still visible now tick down.
      // A bonus uncovered mid-shot gets its first full round next time.
      RewardRules.advance(blocks.filter(b => exposed(b) && preExposedBonusIds.has(b.id)));
      preExposedBonusIds = new Set();
      mode = !blocks.length ? 'won' : attempts > 0 ? 'ready' : 'lost';
      if (mode === 'won' || mode === 'lost') showResult();
      hud();
    }
    hud();
    updateBallCounter(dt);
  }

  function updateLiveCombo(dt) {
    const previous = comboDisplay;
    comboDisplay = liveCombo.update(dt, balls);
    const element = document.querySelector('#live-combo');
    element.hidden = !comboDisplay || mode === 'won' || mode === 'lost';
    if (!comboDisplay) return;
    const value = document.querySelector('#combo-value');
    value.textContent = comboDisplay.count;
    if (previous?.key !== comboDisplay.key || previous?.count !== comboDisplay.count) {
      comboAnimation?.cancel();
      comboAnimation = value.animate([{ transform: 'scale(1.2)', opacity: .7 }, { transform: 'scale(1)', opacity: 1 }], { duration: 160, easing: 'ease-out' });
    }
    const c = document.querySelector('#combo-ball').getContext('2d');
    c.clearRect(0, 0, 40, 40);
    BallEffects.drawBall(c, { ...comboDisplay.ball, x: 20, y: 20, radius: (comboDisplay.ball.radius || 5) * 1.5 });
  }

  function nextLevel() {
    let names = [];
    try { names = Object.keys(LevelCatalog.all()).sort(); } catch {}
    const index = names.indexOf(levelName);
    return index >= 0 ? names[index + 1] || null : null;
  }
  function showResult() {
    const won = mode === 'won', best = runStats.best;
    document.querySelector('#live-combo').hidden = true;
    const overlay = document.querySelector('#result-overlay');
    document.querySelector('#result-title').textContent = won ? '挑战成功' : '挑战失败';
    document.querySelector('#result-combo').textContent = best?.combo || 0;
    const combo = best?.combo || 0;
    const remaining = unlimited ? 0 : Math.max(0, attempts);
    document.querySelector('#result-score-formula').textContent = unlimited
      ? '× 1（试玩不计剩余次数）' : `×（1 + 剩余 ${remaining} 次）`;
    document.querySelector('#result-score').textContent = combo * (1 + remaining);
    const image = document.querySelector('#result-ball'), c = image.getContext('2d');
    c.clearRect(0, 0, image.width, image.height);
    const spec = best?.ball || { type: 'normal', size: 'small', radius: 5 };
    BallEffects.drawBall(c, { ...spec, x: 44, y: 44, radius: ({ small: 13, medium: 19, large: 25 })[spec.size] || 13 });
    const names = { lightning: '闪电', vitality: '活力', explosive: '爆炸' };
    const abilities = BallEffects.abilities(spec);
    document.querySelector('#result-ball-label').textContent = best
      ? `${({small:'小',medium:'中',large:'大'})[spec.size] || '小'} · ${abilities.length ? abilities.map(a=>names[a]).join(' / ') : '普通球'}`
      : '本局尚未命中方块';
    const action = document.querySelector('#result-action');
    action.textContent = won ? '下一关' : '重新开始';
    action.disabled = won && !nextLevel() && !playtestKey;
    action.title = action.disabled ? '已完成全部关卡' : '';
    action.onclick = () => {
      if (!won || playtestKey) reset();
      else { const next = nextLevel(); if (next) location.href = `play.html?level=${encodeURIComponent(next)}`; }
    };
    overlay.hidden = false;
    document.querySelector('.result-panel').focus();
  }

  function updateBallCounter(dt) {
    if (countPhase === 'shooting') {
      displayedBalls = physics.queued;
      if (displayedBalls === 0) {
        countPhase = 'returning';
        countTimer = -.15; // Keep zero visible before counting earlier returns back in.
      }
    } else if (countPhase === 'returning') {
      countTimer += dt;
      while (countTimer >= .04 && displayedBalls < physics.arrivedCount) {
        displayedBalls++; countTimer -= .04;
      }
      if (displayedBalls >= physics.arrivedCount) countTimer = Math.min(0, countTimer);
    }
    document.querySelector('#ball-count-value').textContent = displayedBalls;
  }

  function circle(x, y, r, fill) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
  }

  function draw() {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#707473'; ctx.lineWidth = 1.3;
    const rail = BallPhysics.rails;
    ctx.beginPath(); ctx.moveTo(rail.left, rail.bottom); ctx.lineTo(rail.left, rail.top);
    ctx.quadraticCurveTo(rail.left, 74, 35, 79); ctx.lineTo(185, 121);
    ctx.quadraticCurveTo(195, 125, 195, 138);
    ctx.moveTo(225, 138); ctx.quadraticCurveTo(225, 125, 235, 121);
    ctx.lineTo(W - 35, 79); ctx.quadraticCurveTo(rail.right, 74, rail.right, rail.top);
    ctx.lineTo(rail.right, rail.bottom); ctx.stroke();
    const ceiling = BallPhysics.ceiling;
    ctx.beginPath(); ctx.moveTo(rail.left, ceiling.y); ctx.lineTo(ceiling.gapLeft, ceiling.y);
    ctx.moveTo(ceiling.gapRight, ceiling.y); ctx.lineTo(rail.right, ceiling.y); ctx.stroke();

    ctx.strokeStyle = '#202728'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(disk.x, disk.y, disk.r, 0, Math.PI * 2); ctx.stroke();
    DiskBumpers.draw(ctx, disk, activeBumpers);
    // Covered pieces render behind all exposed pieces, including after rotation.
    const drawOrder = [...blocks].sort((a, b) => depth(b) - depth(a) || a.z - b.z);
    for (const b of drawOrder) {
      const visible = exposed(b);
      const layer = depth(b) - cachedFront + 1;
      // Match the editor: only the front and its next two covered layers have color.
      // Depth is recomputed from every surviving cover chain after a block is destroyed.
      if (layer > 3) continue;
      ctx.globalAlpha = 1;
      const brightness = playtest?.settings?.layerBrightness?.[layer] ?? ({1: 1, 2: .25, 3: .08})[layer];
      ctx.save();
      ctx.fillStyle = visible && b.flash > .65 ? '#fff' : color(b.hp, brightness);
      if (b.type === 'circle') circle(b.x, b.y, b.r, ctx.fillStyle);
      else {
        ctx.beginPath(); vertices(b).forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.closePath(); ctx.fill();
      }
      RewardRules.outline(ctx, b, RewardRules.outlineColor(layer));
      ctx.restore();
      ctx.globalAlpha = 1;
      if (!visible) continue;
      // Draw labels in screen coordinates, independently of the rotated geometry.
      ctx.fillStyle = '#07110a'; ctx.font = '16px Helvetica Neue';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (b.bonus) {
        ctx.fillText(b.hp, b.x, b.y - 3);
        ctx.font = '9px Helvetica Neue';
        ctx.fillText(RewardRules.label(b), b.x, b.y + 10);
      } else ctx.fillText(b.hp, b.x, b.y + 1);
    }

    // Render the same curve used by the rigid-body floor collider.
    ctx.fillStyle = '#262827'; ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, BallPhysics.floorY(x));
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3b4241'; ctx.beginPath();
    for (let x = 0; x <= W; x += 4) {
      if (!x) ctx.moveTo(x, BallPhysics.floorY(x));
      else ctx.lineTo(x, BallPhysics.floorY(x));
    }
    ctx.stroke();

    for (const points of trails.values()) for (const p of points) {
      const fade = p.life / .16; ctx.globalAlpha = fade * .45;
      circle(p.x, p.y, p.radius * (.15 + fade * .7), '#b86aff');
    }
    ctx.globalAlpha = 1;
    for (const ball of physics.storeBalls) BallEffects.drawBall(ctx, ball);
    for (const ball of balls) {
      BallEffects.drawBall(ctx, ball);
      if (ball.bounces) circle(ball.x + Math.cos(ball.spin) * 2.8, ball.y + Math.sin(ball.spin) * 2.8, .8, '#a1aaa3');
      if (ball.idleTime > 3) {
        const remaining = Math.max(1, Math.ceil(6 - ball.idleTime));
        ctx.save();
        ctx.fillStyle = '#ff5656'; ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(remaining, ball.x, ball.y);
        ctx.restore();
      }
    }
    for (const ring of rings) {
      const progress = 1 - ring.life / ring.maxLife;
      ctx.globalAlpha = (1 - progress) * .65;
      if (ring.radius && !ring.rangeHint) {
        ctx.globalAlpha = (1 - progress) * .025; ctx.fillStyle = ring.color;
        ctx.beginPath(); ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = (1 - progress);
      }
      if (ring.rangeHint) {
        ctx.globalAlpha = (1 - progress) * .14;
      }
      ctx.strokeStyle = ring.color; ctx.lineWidth = ring.rangeHint ? 1 : ring.radius ? 2.8 : ring.large ? 2 : 1.1;
      ctx.beginPath(); ctx.arc(ring.x, ring.y, (ring.rangeHint ? ring.radius : 2 + progress * (ring.radius || (ring.large ? 32 : 9))), 0, Math.PI * 2); ctx.stroke();
    }
    for (const b of bolts) {
      ctx.globalAlpha = b.life / .22; ctx.strokeStyle = '#7ed8ff'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(b.x1,b.y1);
      const dx=b.x2-b.x1,dy=b.y2-b.y1,len=Math.hypot(dx,dy)||1;
      for(let i=1;i<7;i++){ const offset=i%2?4:-4;ctx.lineTo(b.x1+dx*i/7-dy/len*offset,b.y1+dy*i/7+dx/len*offset); }
      ctx.lineTo(b.x2,b.y2);ctx.stroke();
    }
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / (p.maxLife || .45));
      circle(p.x, p.y, p.size || 2, p.color);
    }
    ctx.globalAlpha = 1;
  }

  function point(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width * W, y: (e.clientY - rect.top) / rect.height * H };
  }
  let suppressClick = false;
  const surface = document.documentElement;
  document.addEventListener('pointerdown', e => {
    if (drag || !e.isPrimary || e.button !== 0 || e.target.closest('#result-overlay')) return;
    const p = point(e);
    suppressClick = false;
    drag = { id: e.pointerId, angle: Math.atan2(p.y - disk.y, p.x - disk.x),
      startX: e.clientX, startY: e.clientY, lastPoint: p, active: false,
      time: e.timeStamp, motionTime: e.timeStamp };
  });
  document.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
      drag.active = true;
      angularVelocity = 0;
      surface.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    }
    const p = point(e), a = Math.atan2(p.y - disk.y, p.x - disk.x);
    const nearCenter = Math.min(Math.hypot(p.x - disk.x, p.y - disk.y),
      Math.hypot(drag.lastPoint.x - disk.x, drag.lastPoint.y - disk.y)) < 35;
    const delta = nearCenter ? (p.x - drag.lastPoint.x - (p.y - drag.lastPoint.y)) / 150
      : Math.atan2(Math.sin(a - drag.angle), Math.cos(a - drag.angle));
    const elapsed = Math.max(1 / 240, (e.timeStamp - drag.time) / 1000);
    const measured = Math.max(-22, Math.min(22, delta / elapsed));
    angularVelocity = angularVelocity * .3 + measured * .7;
    disk.angle += delta;
    drag.angle = a; drag.time = e.timeStamp; drag.lastPoint = p;
    if (Math.abs(delta) > .0001) drag.motionTime = e.timeStamp;
    positionBlocks();
    draw();
  });
  function stopDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.active) {
      suppressClick = true;
      if (e.type === 'pointercancel' || e.timeStamp - drag.motionTime > 90) angularVelocity = 0;
    }
    drag = null; canvas.style.cursor = '';
    if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
  }
  document.addEventListener('pointerup', stopDrag);
  document.addEventListener('pointercancel', stopDrag);
  surface.addEventListener('lostpointercapture', stopDrag);
  // A drag beginning on a button is still a disk drag, never an accidental launch/reset.
  document.addEventListener('click', e => {
    if (suppressClick && e.detail !== 0) {
      e.preventDefault(); e.stopImmediatePropagation(); suppressClick = false;
    }
  }, true);
  fire.addEventListener('click', launch);
  document.querySelector('#manual-recall').addEventListener('click', manualRecall);
  document.querySelector('#reset').addEventListener('click', reset);

  window.render_game_to_text = () => JSON.stringify({
    liveCombo: comboDisplay ? { ballId: comboDisplay.ballId, wave: comboDisplay.wave, count: comboDisplay.count } : null,
    rewardNotices: rewardFeed.items.map(item=>({...item})),
    bestCombo: runStats.best, defaultSettings: GameSettings.defaultName, resultVisible: !document.querySelector('#result-overlay').hidden,
    coordinates: '420x820; origin top-left; x right, y down', mode, score, shot, queued, attempts, initialAttempts: unlimited ? null : INITIAL_ATTEMPTS, unlimitedAttempts: unlimited, startLayer: playtest?.startLayer || 1,
    bumpers: [...activeBumpers], impactEffects: { sparks: particles.length, rings: rings.length, bolts: bolts.length, trails: trails.size }, displayedBalls, countPhase, disk, angularVelocity, dragging: !!drag?.active, recallTime, ballCount: physics.count, arrived: physics.arrivedCount, canLaunch: physics.canStart, wave: physics.wave, exited: physics.exited,
    physics: { engine: 'Matter.js 0.20.0', fixedStep: FIXED_STEP, ...physics.stats },
    storedBalls: physics.storeBalls,
    balls: balls.map(b => ({ ...b })),
    ballRadius: R, waitingBallRadius: R,
    blocks: blocks.map(b => ({
      id: b.id, type: b.type, bonus: !!b.bonus, reward: b.bonus ? RewardRules.amount(b) : 0, rewardType: RewardRules.type(b), rewardSegments: b.rewardSegments, x: b.x, y: b.y, hp: exposed(b) ? b.hp : null,
      angle: b.angle, color: depth(b) - cachedFront + 1 <= 3 ? color(b.hp) : null, rendered: depth(b) - cachedFront + 1 <= 3, labelAngle: 0,
      layer: depth(b), size: b.size, area: window.BlockGeometry.area, hidden: !exposed(b), coveredBy: b.coveredBy,
    })),
  });
  function advanceElapsed(seconds) {
    accumulator += seconds;
    while (accumulator + 1e-10 >= FIXED_STEP) {
      update(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }
  }
  window.advanceTime = ms => {
    advanceElapsed(Math.max(0, ms / 1000));
    draw();
  };
  let last = performance.now();
  function frame(now) {
    advanceElapsed(Math.min((now - last) / 1000, .1)); last = now;
    draw(); requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { last = performance.now(); });
  reset(); requestAnimationFrame(frame);
})();
