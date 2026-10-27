(() => {
  'use strict';
  const canvas = document.querySelector('#editor-canvas');
  const ctx = canvas.getContext('2d');
  const W = 420, H = 820;
  const disk = { x: 210, y: 390, r: 188, angle: 0 };
  const dpr = Math.min(devicePixelRatio || 1, 3);
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const SHAPES = ['circle', 'triangle', 'square'];
  const SHAPE_LABEL = { circle: '圆形', triangle: '三角形', square: '方形' };
  const TIERS = ['medium'];
  const TIER_LABEL = { medium: '中等' };
  const MAX_VISIBLE_LAYER = 3; // Layer 4+ hidden by rule.
  const LAYER_BRIGHTNESS = { 1: 1, 2: 0.25, 3: 0.08 };

  const BALL_TYPES = [
    { type: 'normal', label: '普通', color: '#ffffff' },
    { type: 'lightning', label: '闪电', color: '#42a5ff' },
    { type: 'vitality', label: '活力', color: '#b86aff' },
    { type: 'explosive', label: '爆炸', color: '#ff5656' },
  ];
  const BALL_SIZES = [{ size: 'small', radius: 5 }, { size: 'medium', radius: 7 }, { size: 'large', radius: 9 }];
  let ballCounts = BALL_TYPES.map((_, i) => [i === 0 ? 10 : 0, 0, 0]);
  let idlePhysics = null;
  let bumpers = [];
  let bumperDraft = null;
  let blocks = [];
  let nextId = 0;
  let selectedId = null;
  let selectedIds = new Set();
  let copiedBlocks = [], snapGuides = [];
  let angleLocked = false;
  let drag = null;
  let focusLayer = 1; // Preview: pretend layers < focusLayer are gone.
  let pendingPromote = null;      // { id, initial } waiting for user tick/cross after empty release
  let layerDeltas = {};           // { layerNumber: netChange } shown briefly on left panel
  let layerDeltasTimer = null;
  let angularVelocity = 0;        // Rotational inertia after release.
  let resetAnim = null;           // Smooth reset-to-zero animation state.
  let animRaf = null;
  let animLastTime = 0;
  let layoutCache = null;
  let committedLayers = new Map();

  // History stores block edits only; view, saves and test settings are deliberately excluded.
  let historyEnabled = false, historyRestoring = false, historyPresent = null;
  let undoEdits = [], redoEdits = [], historyGroup = null, repeatDuplicate = null;
  const editFields = ['id','type','tier','dx','dy','hp','baseAngle','layerFloor','bonus','rewardType','rewardAmount','coveredBy'];
  function editSnapshot() {
    const items = blocks.map(b => Object.fromEntries(editFields.map(k => [k, k === 'coveredBy' ? [...b[k]] : b[k]])));
    return { items, key: JSON.stringify(items), nextId, selectedId, ids: [...selectedIds], focusLayer,
      repeat: repeatDuplicate ? structuredClone(repeatDuplicate) : null };
  }
  function resetEditHistory() {
    undoEdits = []; redoEdits = []; historyGroup = null; repeatDuplicate = null;
    historyPresent = editSnapshot();
  }
  function checkpointEdit() {
    if (!historyEnabled || historyRestoring) return;
    const current = editSnapshot();
    if (!historyPresent) { historyPresent = current; return; }
    if (current.key === historyPresent.key) { historyPresent = current; return; }
    if (drag || pendingPromote) return;
    const input = document.activeElement;
    const group = input?.matches('#inspector input[type="number"]') ? input : null;
    if (!group || group !== historyGroup) {
      undoEdits.push(historyPresent);
      if (undoEdits.length > 100) undoEdits.shift();
    }
    redoEdits = []; historyPresent = current; historyGroup = group;
    if (group && undoEdits.at(-1)?.key === current.key) { undoEdits.pop(); historyGroup = null; }
  }
  function undoBlockEdit(redo = false) {
    if (drag) return;
    if (pendingPromote) { cancelPromote(); return; }
    const from = redo ? redoEdits : undoEdits, to = redo ? undoEdits : redoEdits;
    if (!from.length) return;
    to.push(editSnapshot()); const state = from.pop();
    historyRestoring = true; historyGroup = null;
    blocks = structuredClone(state.items); nextId = state.nextId;
    selectedId = state.selectedId; selectedIds = new Set(state.ids); focusLayer = state.focusLayer;
    repeatDuplicate = state.repeat ? structuredClone(state.repeat) : null;
    layoutCache = null; committedLayers = new Map(); angularVelocity = 0; resetAnim = null;
    refreshAllGeom(); render(); historyRestoring = false; historyPresent = editSnapshot();
  }
  document.addEventListener('focusout', () => { historyGroup = null; });
  document.addEventListener('pointerdown', () => { historyGroup = null; }, true);

  function makeBlock(type, dx, dy, extras = {}) {
    const b = {
      id: nextId++, type, tier: 'medium', dx, dy, hp: 3,
      baseAngle: 0, layerFloor: 1, bonus: false, rewardType: 'attempts', rewardAmount: 1, coveredBy: [], ...extras,
    };
    updateBlockGeom(b);
    return b;
  }

  // Overlap pair key for the drag snapshot (order-independent).
  function pairKey(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }

  // Preview the virtual cover graph during drag. Rules:
  // - overlap that existed before AND still exists -> original edge kept
  // - overlap that existed before but no longer -> edge removed
  // - new overlap -> dragged D covers the other block (dragged is the mover)
  function rawCoveredBy(b) {
    if (!drag || !drag.moved) return b.coveredBy;
    const movers = new Set(drag.ids || [drag.id]);
    const targetLayer=id=>drag.layers?.get(id)||drag.lockedLayer||1;
    let covers=b.coveredBy.filter(id=>{
      if(!movers.has(b.id)&&!movers.has(id))return true;
      const other=blocks.find(o=>o.id===id);
      return other&&BlockGeometry.overlaps(b,other);
    });
    if(movers.has(b.id)){
      for(const other of blocks){
        if(movers.has(other.id)||!BlockGeometry.overlaps(b,other))continue;
        if(targetLayer(other.id)<targetLayer(b.id)&&!covers.includes(other.id))covers.push(other.id);
      }
    }else{
      for(const id of movers){
        const mover=blocks.find(o=>o.id===id);
        if(mover&&targetLayer(b.id)>=targetLayer(id)&&BlockGeometry.overlaps(b,mover)&&
          !drag.originalOverlap.has(pairKey(id,b.id))&&!covers.includes(id))covers.push(id);
      }
    }
    return covers;
  }

  function layoutSignature() {
    return JSON.stringify([drag?.moved ? [drag.ids || [drag.id], drag.lockedLayer] : null,
      blocks.map(b => [b.id, b.x, b.y, b.r, b.type, b.angle, b.layerFloor, b.coveredBy])]);
  }

  function resolvedLayout() {
    const signature = layoutSignature();
    if (layoutCache?.signature === signature) return layoutCache.result;
    const moving = drag && drag.moved && drag.id != null;
    const graph = new Map(blocks.map(b => [b.id, rawCoveredBy(b).slice()]));
    const previousLayers = moving
      ? window.LayerLayout.layers(drag.graphSnapshot.map(b => b.id),
        new Map(drag.graphSnapshot.map(b => [b.id, b.coveredBy])), new Map(), new Map(drag.graphSnapshot.map(b=>[b.id,b.layerFloor||1])))
      : committedLayers;
    const locked = moving && drag.lockedLayer != null ? new Map((drag.ids || [drag.id]).map(id => [id, drag.layers?.get(id) || drag.lockedLayer])) : new Map();
    const result = window.LayerLayout.resolve(blocks, {
      graph, previousLayers, locked, priorityId: moving ? drag.id : null,
      priorityIds: moving ? new Set(drag.ids || [drag.id]) : new Set(),
    });
    if (!moving) {
      for (const b of blocks) b.coveredBy = result.graph.get(b.id);
      committedLayers = new Map(result.layers);
    }
    layoutCache = { signature: layoutSignature(), result };
    return result;
  }

  function virtualCoveredBy(b) { return resolvedLayout().graph.get(b.id) || []; }
  function displayLayer(b) { return resolvedLayout().layers.get(b.id) || 1; }

  function effectiveLayer(b) { return pendingPromote?.ids?.includes(b.id) && displayLayer(b)<focusLayer ? 1 : displayLayer(b) - focusLayer + 1; }
  function isVisible(b) {
    const e = effectiveLayer(b);
    return e >= 1 && e <= MAX_VISIBLE_LAYER;
  }
  function maxLayerInUse() {
    return blocks.length ? Math.max(...blocks.map(b => displayLayer(b))) : 1;
  }

  function ensureAnim() {
    if (animRaf != null) return;
    animLastTime = 0;
    animRaf = requestAnimationFrame(animTick);
  }
  function animTick(now) {
    animRaf = null;
    const dt = animLastTime ? Math.min((now - animLastTime) / 1000, 0.1) : 0.016;
    animLastTime = now;
    let keepGoing = false;
    if (resetAnim) {
      const t = Math.min(1, (now - resetAnim.start) / resetAnim.duration);
      const eased = 1 - Math.pow(1 - t, 3);
      disk.angle = resetAnim.from * (1 - eased);
      if (t >= 1) { disk.angle = 0; resetAnim = null; }
      else keepGoing = true;
      refreshAllGeom();
    } else if (angularVelocity) {
      const damping = 2.6;
      const decay = Math.exp(-damping * dt);
      disk.angle += angularVelocity * (1 - decay) / damping;
      angularVelocity *= decay;
      if (Math.abs(angularVelocity) < 0.025) angularVelocity = 0;
      else keepGoing = true;
      refreshAllGeom();
    }
    render();
    if (keepGoing) ensureAnim(); else animLastTime = 0;
  }

  function recordDeltas(changes) {
    // changes = [{ from, to }, ...]
    const net = {};
    for (const { from, to } of changes) {
      if (from === to) continue;
      net[from] = (net[from] || 0) - 1;
      net[to] = (net[to] || 0) + 1;
    }
    layerDeltas = net;
    renderLayerList();
    clearTimeout(layerDeltasTimer);
    layerDeltasTimer = setTimeout(() => { layerDeltas = {}; renderLayerList(); }, 2000);
  }

  function blockSnapshot() {
    return blocks.map(b=>({id:b.id,dx:b.dx,dy:b.dy,baseAngle:b.baseAngle,layerFloor:b.layerFloor,coveredBy:[...b.coveredBy]}));
  }
  function restoreSnapshot(snapshot, removeNew=false) {
    const map=new Map(snapshot.map(s=>[s.id,s]));
    if(removeNew)blocks=blocks.filter(b=>map.has(b.id));
    for(const b of blocks){const s=map.get(b.id);if(!s)continue;
      b.dx=s.dx;b.dy=s.dy;b.baseAngle=s.baseAngle??b.baseAngle;b.layerFloor=s.layerFloor||1;b.coveredBy=[...s.coveredBy];updateBlockGeom(b);
    }
    layoutCache=null;committedLayers=new Map();
  }
  function showPromotePrompt(b,snapshot,kind='move',ids=[b.id]) {
    pendingPromote={id:b.id,ids,snapshot,kind};
    const el=document.querySelector('#promote-prompt');el.classList.remove('hidden');
    document.querySelector('#promote-yes').title='确认移到第 1 层';
    document.querySelector('#promote-no').title=kind==='new'?'取消并删除新方块':'取消并恢复原位';
    el.style.left=`calc(${(b.x+b.r)/W*100}% + 4px)`;
    el.style.top=`calc(${(b.y-b.r)/H*100}% - 4px)`;
  }
  function hidePromotePrompt() {
    if(pendingPromote?.kind==='new'){
      restoreSnapshot(pendingPromote.snapshot,true);selectedId=null;selectedIds.clear();
    }
    pendingPromote=null;document.querySelector('#promote-prompt').classList.add('hidden');
  }
  function acceptPromote() {
    const pending=pendingPromote;pendingPromote=null;hidePromotePrompt();
    if(pending){focusLayer=1;selectedIds=new Set(pending.ids);selectedId=pending.id;}
    render();
  }
  function cancelPromote() {
    const pending=pendingPromote;if(!pending)return;
    pendingPromote=null;restoreSnapshot(pending.snapshot,pending.kind==='new');
    if(pending.kind==='new'){selectedId=null;selectedIds.clear();}
    hidePromotePrompt();layerDeltas={};render();
  }

  function updateBlockGeom(b) {
    b.r = window.BlockGeometry.radius(b.type, b.tier);
    const c = Math.cos(disk.angle), s = Math.sin(disk.angle);
    b.x = disk.x + b.dx * c - b.dy * s;
    b.y = disk.y + b.dx * s + b.dy * c;
    b.angle = b.baseAngle + disk.angle;
  }

  function refreshAllGeom() {
    for (const b of blocks) updateBlockGeom(b);
  }

  function rebuildCovers() {
    // Resolve collisions in every newly reached layer, including the virtual drag preview.
    resolvedLayout();
  }

  // ---- Default level ----
  function loadDefault() {
    hidePromotePrompt();
    bumpers = []; bumperDraft = null;
    blocks = []; nextId = 0;
    const lowers = [];
    for (let cluster = 0; cluster < 3; cluster++) {
      const angle = -Math.PI / 2 + cluster * Math.PI * 2 / 3;
      const dx = Math.cos(angle) * 75, dy = Math.sin(angle) * 75;
      lowers.push(makeBlock(SHAPES[cluster], dx, dy, { hp: 25 }));
    }
    blocks.push(...lowers);
    for (let cluster = 0; cluster < 3; cluster++) {
      const dx = lowers[cluster].dx, dy = lowers[cluster].dy;
      const count = cluster === 0 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const a = i * Math.PI;
        blocks.push(makeBlock(SHAPES[(cluster + i + 1) % 3],
          dx + Math.cos(a) * 22, dy + Math.sin(a) * 22,
          { hp: i % 2 ? 5 : 3 }));
      }
    }
    const front = blocks[3];
    const inward = Math.atan2(-front.dy, -front.dx);
    blocks.push(makeBlock('square',
      front.dx + Math.cos(inward) * 24, front.dy + Math.sin(inward) * 24,
      { hp: 3, baseAngle: Math.PI / 4, bonus: true }));
    // Later-created blocks cover earlier ones they overlap.
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        if (window.BlockGeometry.overlaps(blocks[i], blocks[j])) {
          blocks[i].coveredBy.push(blocks[j].id);
        }
      }
    }
    focusLayer = 1;
    selectedId = null;
    render();
    if(historyEnabled)resetEditHistory();
  }

  // ---- Game geometry (shared with physics.js) ----
  const RAIL = { left: 12, right: W - 12, top: 96, bottom: 596 };
  const CEILING = { y: 150, gapLeft: 194, gapRight: 226 };
  const floorY = x => 629 + 26 * ((x - 210) / 210) ** 2 + .006 * (x - 210);

  function drawGameChrome() {
    ctx.strokeStyle = '#707473'; ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(RAIL.left, RAIL.bottom); ctx.lineTo(RAIL.left, RAIL.top);
    ctx.quadraticCurveTo(RAIL.left, 74, 35, 79); ctx.lineTo(185, 121);
    ctx.quadraticCurveTo(195, 125, 195, 138);
    ctx.moveTo(225, 138); ctx.quadraticCurveTo(225, 125, 235, 121);
    ctx.lineTo(W - 35, 79); ctx.quadraticCurveTo(RAIL.right, 74, RAIL.right, RAIL.top);
    ctx.lineTo(RAIL.right, RAIL.bottom); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(RAIL.left, CEILING.y); ctx.lineTo(CEILING.gapLeft, CEILING.y);
    ctx.moveTo(CEILING.gapRight, CEILING.y); ctx.lineTo(RAIL.right, CEILING.y);
    ctx.stroke();
    ctx.fillStyle = '#262827'; ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, floorY(x));
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3b4241'; ctx.beginPath();
    for (let x = 0; x <= W; x += 4) {
      if (!x) ctx.moveTo(x, floorY(x));
      else ctx.lineTo(x, floorY(x));
    }
    ctx.stroke();
  }

  // ---- Rendering ----
  function render() {
    if (selectedId == null) selectedIds.clear();
    selectedIds = new Set([...selectedIds].filter(id => blocks.some(b => b.id === id)));
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    drawGameChrome();
    drawBumperPicker();
    ctx.strokeStyle = '#202728'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(disk.x, disk.y, disk.r, 0, Math.PI * 2); ctx.stroke();
    DiskBumpers.draw(ctx, disk, bumperDraft || bumpers);
    ctx.fillStyle = '#2a3237';
    ctx.beginPath(); ctx.arc(disk.x, disk.y, 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1a1f22'; ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.moveTo(disk.x, disk.y - disk.r); ctx.lineTo(disk.x, disk.y + disk.r);
    ctx.moveTo(disk.x - disk.r, disk.y); ctx.lineTo(disk.x + disk.r, disk.y);
    ctx.stroke(); ctx.setLineDash([]);

    rebuildCovers();
    // Deeper layers draw first (back), layer 1 draws last (on top); within layer, by id.
    const order = [...blocks].sort((a, b) => displayLayer(b) - displayLayer(a) || a.id - b.id);
    // Cover hints: when focused on layer N > 1, outline EVERY block whose actual layer is N-1
    // (the single layer directly above focus — not deeper layers, not just direct covers).
    const hintCoverIds = new Set();
    if (focusLayer > 1) {
      for (const b of blocks) {
        if (displayLayer(b) === focusLayer - 1) hintCoverIds.add(b.id);
      }
    }

    for (const b of order) {
      const d = effectiveLayer(b);
      if (d < 1 || d > MAX_VISIBLE_LAYER) continue;
      const brightness = LAYER_BRIGHTNESS[d] ?? 1;
      ctx.save();
      ctx.fillStyle = window.BallzPalette.color(b.hp, brightness);
      if (b.type === 'circle') {
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath();
        window.BlockGeometry.vertices(b).forEach((p, i) =>
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.closePath(); ctx.fill();
      }
      // Reward borders have their own visibility, independent of the fill palette.
      RewardRules.outline(ctx, b, RewardRules.outlineColor(d));
      if (b.id === selectedId || selectedIds.has(b.id)) {
        ctx.strokeStyle = '#54d65c'; ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 6, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();

      if (d === 1) {
        ctx.fillStyle = '#07110a'; ctx.font = '15px Helvetica Neue';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(b.hp, b.x, b.y + (b.bonus ? -3 : 1));
        if (b.bonus) {
          ctx.font = '9px Helvetica Neue';
          ctx.fillText(RewardRules.label(b), b.x, b.y + 10);
        }
      }

      if (b.id === selectedId || selectedIds.has(b.id)) {
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.font = '10px Helvetica Neue';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(`层 ${displayLayer(b)}`, b.x + b.r + 4, b.y - b.r);
      }
    }


    const selected = selectedBlock();
    if (selected && isVisible(selected)) {
      const h = rotationHandle(selected);
      ctx.save(); ctx.strokeStyle='#75dc8a'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(selected.x,selected.y); ctx.lineTo(h.x,h.y); ctx.stroke();
      ctx.fillStyle='#15251b'; ctx.beginPath(); ctx.arc(h.x,h.y,8,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#a7efb5'; ctx.font='14px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';ctx.fillText('↻',h.x,h.y);
      ctx.restore();
    }
    if (drag?.kind === 'marquee') {
      const a = drag.start, b = drag.current;
      ctx.save(); ctx.fillStyle = 'rgba(84,214,92,.1)'; ctx.strokeStyle = '#54d65c'; ctx.lineWidth = 1;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.restore();
    }
    // Blue cover hints: outline of each block that is covering something below it.
    ctx.save();
    ctx.strokeStyle = 'rgba(90, 170, 255, 0.75)';
    ctx.lineWidth = 1.3;
    ctx.setLineDash([3, 2]);
    for (const id of hintCoverIds) {
      const o = blocks.find(x => x.id === id);
      if (!o) continue;
      if (o.type === 'circle') {
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r + 1, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.beginPath();
        window.BlockGeometry.vertices(o).forEach((p, i) =>
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.closePath(); ctx.stroke();
      }
    }
    ctx.restore();

    EditorGuides.draw(ctx, snapGuides);
    // Test balls (real physics)
    const displayedPhysics = testPhysics || idlePhysics;
    if (displayedPhysics) {
      for (const ball of displayedPhysics.storeBalls) {
        BallEffects.drawBall(ctx, ball);
      }
      for (const ball of displayedPhysics.activeBalls) {
        BallEffects.drawBall(ctx, ball);
        if (ball.idleTime > 3) {
          const remaining = Math.max(1, Math.ceil(6 - ball.idleTime));
          ctx.save();
          ctx.fillStyle = '#ff5656'; ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(remaining, ball.x, ball.y);
          ctx.restore();
        }
      }
    }

    if (displayedPhysics) {
      ctx.fillStyle = '#e5ece8'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`● × ${displayedPhysics.phase === 'shooting' ? displayedPhysics.queued : displayedPhysics.count}`, 24, 116);
    }
    document.querySelector('#block-count').textContent = `${blocks.length} 个方块`;
    renderLayerList();
    renderLayerNudge();
    renderInspector();
    checkpointEdit();
  }

  // Playtest runs the actual game in an isolated session, leaving the editor level intact.
  let playtestSessionKey = null;
  function stopPlaytest() {
    const frame = document.querySelector('#playtest-frame');
    frame.removeAttribute('src');
    document.querySelector('#playtest-overlay').classList.add('hidden');
    document.querySelector('#playtest-stop').classList.add('hidden');
    document.querySelector('#playtest-start').disabled = false;
    document.querySelector('#playtest-start-unlimited').disabled = false;
    document.querySelector('#playtest-info').textContent = '';
    if (playtestSessionKey) sessionStorage.removeItem(playtestSessionKey);
    playtestSessionKey = null;
  }
  function startPlaytest(unlimited = false) {
    if(pendingPromote){flash('请先确认或取消当前方块的层级');return;}
    commitBumpers();
    if (!ballSpecs().length) { flash('请先添加测试用球'); return; }
    stopTest();
    stopPlaytest();
    const included = new Set(blocks.filter(b => displayLayer(b) >= focusLayer).map(b => b.id));
    const level = levelData();
    level.blocks = level.blocks.filter(b => included.has(b.id)).map(b => ({ ...b,
      coveredBy: b.coveredBy.filter(id => included.has(id)), layerFloor: Math.max(1, (b.layerFloor || 1) - focusLayer + 1),
    }));
    if (!level.blocks.length) { flash('当前层及以下没有可试玩的方块'); return; }
    const initialAttempts = readInitialAttempts();
    playtestSessionKey = `ballz-playtest-${Date.now()}`;
    sessionStorage.setItem(playtestSessionKey, JSON.stringify({ level, settings: settingsData(),
      startLayer: focusLayer, diskAngle: disk.angle, ballCount: ballSpecs().length, ballSpecs: ballSpecs(),
      unlimited, initialAttempts }));
    document.querySelector('#playtest-frame').src = `play.html?playtest=${encodeURIComponent(playtestSessionKey)}`;
    document.querySelector('#playtest-overlay').classList.remove('hidden');
    document.querySelector('#playtest-stop').classList.remove('hidden');
    document.querySelector('#playtest-start').disabled = true;
    document.querySelector('#playtest-start-unlimited').disabled = true;
    const budget = unlimited ? '无限发射' : `${initialAttempts} 次发射`;
    document.querySelector('#playtest-info').textContent = `从第 ${focusLayer} 层开始 · ${ballSpecs().length} 球 · ${budget}`;
  }

  // ---- Test physics (real BallPhysics / Matter.js, same as the game) ----
  let testPhysics = null;
  let testMode = false;
  let testStart = 0;
  let testLast = 0;
  const FIXED_STEP = 1 / 120;
  let testAccum = 0;

  function startTest(count) {
    if(pendingPromote){flash('请先确认或取消当前方块的层级');return;}
    commitBumpers();
    stopPlaytest();
    stopTest();
    try {
      const specs = ballSpecs();
      if (!specs.length) { flash('请先添加测试用球'); return; }
      testPhysics = new window.BallPhysics(count === 1 ? specs.slice(0, 1) : specs);
    } catch (e) {
      alert('物理测试初始化失败：' + e.message);
      return;
    }
    testPhysics.syncBlocks(blocks.filter(b => effectiveLayer(b) === 1));
    testPhysics.syncBumpers(bumpers, disk);
    testMode = true;
    testLast = 0;
    testAccum = 0;
    testStart = 0;
    document.querySelector('#test-stop').classList.remove('hidden');
    // Wait for enough balls to arrive, then launch.
    const waitAndLaunch = () => {
      if (!testPhysics || !testMode) return;
      if (testPhysics.canStart) {
        testPhysics.start();
        testStart = performance.now();
      } else {
        setTimeout(waitAndLaunch, 30);
      }
    };
    setTimeout(waitAndLaunch, 50);
    requestAnimationFrame(testFrame);
  }

  function stopTest() {
    testMode = false;
    testPhysics = null;
    document.querySelector('#test-stop').classList.add('hidden');
    render();
  }

  function testFrame(now) {
    if (!testMode) return;
    const dt = testLast ? Math.min((now - testLast) / 1000, 0.1) : 0.016;
    testLast = now;
    testAccum += dt;
    while (testAccum + 1e-10 >= FIXED_STEP) {
      testPhysics.syncBlocks(blocks.filter(b => effectiveLayer(b) === 1), FIXED_STEP);
      testPhysics.syncBumpers(bumpers, disk);
      testPhysics.step(FIXED_STEP);
      testPhysics.consumeHits(); // Drain so it doesn't accumulate; we don't damage blocks in test.
      testAccum -= FIXED_STEP;
    }
    render();
    // Auto-stop after 20s, or once the volley has been fired and recalled back to ready.
    const launched = testStart > 0;
    const done = launched && testPhysics.wave > 0 && testPhysics.phase === 'ready';
    if (launched && (performance.now() - testStart > 20000 || done)) {
      stopTest();
      return;
    }
    requestAnimationFrame(testFrame);
  }

  function renderLayerList() {
    const el = document.querySelector('#layer-list');
    const max = Math.max(focusLayer, maxLayerInUse(), ...Object.keys(layerDeltas).map(Number).concat(0));
    el.innerHTML = '';
    for (let i = 1; i <= max + 1; i++) {
      const btn = document.createElement('button');
      const d = layerDeltas[i] || 0;
      const deltaText = d > 0 ? ` +${d}` : d < 0 ? ` ${d}` : '';
      const deltaClass = d > 0 ? 'pos' : d < 0 ? 'neg' : '';
      btn.innerHTML = `${i}<span class="delta ${deltaClass}">${deltaText}</span>`;
      if (i === focusLayer) btn.classList.add('active');
      btn.title = i === 1 ? '显示所有层' : `隐藏第 1~${i-1} 层，预览第 ${i} 层露出的样子`;
      if (i > maxLayerInUse()) { btn.classList.add('empty-layer'); btn.innerHTML = `${i} ＋`; btn.title = '进入空层，拖入图形开始放置'; }
      btn.onclick = () => { hidePromotePrompt(); focusLayer = i; selectedId = null; selectedIds.clear(); render(); };
      el.appendChild(btn);
    }
  }

  function renderLayerNudge() {
    const el = document.querySelector('#layer-nudge');
    const b = selectedBlock();
    if (!b) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    document.querySelector('#layer-nudge-value').textContent = displayLayer(b);
  }

  // ---- Palette (left) ----
  function pointerSvg(type) {
    if (type === 'circle') return `<svg viewBox="-25 -25 50 50"><circle cx="0" cy="0" r="20" fill="#feef51"/></svg>`;
    if (type === 'triangle') {
      const r = window.BlockGeometry.radius('triangle');
      const pts = [0, 1, 2].map(i => {
        const a = -Math.PI / 2 + i * Math.PI * 2 / 3;
        return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
      }).join(' ');
      return `<svg viewBox="-25 -25 50 50"><polygon points="${pts}" fill="#feef51"/></svg>`;
    }
    const r = window.BlockGeometry.radius('square');
    const s = r * Math.SQRT2;
    return `<svg viewBox="-25 -25 50 50"><rect x="${-s/2}" y="${-s/2}" width="${s}" height="${s}" fill="#feef51"/></svg>`;
  }

  function snapNewPoint(point,type,free=false) {
    snapGuides=[];if(free)return point;
    const block={type,x:point.x,y:point.y,r:BlockGeometry.radius(type),angle:disk.angle};
    const result=EditorGuides.snap(EditorGuides.bounds([block]),blocks.filter(b=>displayLayer(b)===focusLayer));
    snapGuides=result.guides;return {x:point.x+result.dx,y:point.y+result.dy};
  }
  function buildPalette() {
    const ul = document.querySelector('#palette');
    ul.innerHTML = '';
    for (const type of SHAPES) {
      const li = document.createElement('li');
      li.dataset.type = type;
      li.innerHTML = `${pointerSvg(type)}<span>${SHAPE_LABEL[type]}</span>`;
      li.addEventListener('pointerdown', ev => {
        if (ev.button !== 0 || !document.querySelector('#playtest-overlay').classList.contains('hidden')) return;
        ev.preventDefault();
        angularVelocity = 0;
        resetAnim = null;
        li.setPointerCapture(ev.pointerId);
        const ghost = document.createElement('div');
        ghost.className = 'palette-drag-ghost';
        ghost.innerHTML = pointerSvg(type);
        ghost.hidden = true;
        document.body.appendChild(ghost);
        const startX = ev.clientX, startY = ev.clientY;
        let moved = false;
        const move = e => {
          if (e.pointerId !== ev.pointerId) return;
          moved ||= Math.hypot(e.clientX - startX, e.clientY - startY) >= 6;
          ghost.hidden = !moved;
          ghost.style.left = `${e.clientX}px`;
          ghost.style.top = `${e.clientY}px`;
          const rect=canvas.getBoundingClientRect();
          if(moved&&e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom){
            const p=snapNewPoint(toCanvas(e),type,e.altKey);
            ghost.style.left=`${rect.left+p.x*rect.width/W}px`;ghost.style.top=`${rect.top+p.y*rect.height/H}px`;
          }else snapGuides=[];
          render();
        };
        const finish = e => {
          if (e.pointerId !== ev.pointerId) return;
          li.removeEventListener('pointermove', move);
          li.removeEventListener('pointerup', finish);
          li.removeEventListener('pointercancel', finish);
          ghost.remove();
          if (li.hasPointerCapture(ev.pointerId)) li.releasePointerCapture(ev.pointerId);
          const rect = canvas.getBoundingClientRect();
          const p = snapNewPoint(toCanvas(e),type,e.altKey);
          snapGuides=[];render();
          const r = window.BlockGeometry.radius(type);
          if (e.type !== 'pointerup' || !moved || e.clientX < rect.left || e.clientX > rect.right ||
              e.clientY < rect.top || e.clientY > rect.bottom ||
              Math.hypot(p.x - disk.x, p.y - disk.y) > disk.r - r) return;
          hidePromotePrompt();
          const c = Math.cos(-disk.angle), s = Math.sin(-disk.angle);
          const lx = (p.x - disk.x) * c - (p.y - disk.y) * s;
          const ly = (p.x - disk.x) * s + (p.y - disk.y) * c;
          const snapshot=blockSnapshot(), before=new Map(blocks.map(b=>[b.id,displayLayer(b)]));
          const block = makeBlock(type, lx, ly, { hp: 5, layerFloor: 1 });
          blocks.push(block);
          selectedId = block.id; selectedIds = new Set([block.id]);
          commitPlacedBlocks([block],new Map([[block.id,focusLayer]]),before,snapshot);
          render();
        };
        li.addEventListener('pointermove', move);
        li.addEventListener('pointerup', finish);
        li.addEventListener('pointercancel', finish);
      });
      ul.appendChild(li);
    }
  }

  // ---- Color anchors ----
  function rgbToHex(rgb) {
    return '#' + rgb.map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
  }
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }

  function refreshColors() {
    buildLayerPreviews();
    render();
  }

  function buildAnchorList() {
    const list = document.querySelector('#anchor-list');
    const anchors = window.BallzPalette.anchors;
    list.innerHTML = '';
    anchors.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'anchor-row';
      const hp = document.createElement('input');
      hp.type = 'number'; hp.min = 1; hp.step = 1; hp.value = entry[0];
      const color = document.createElement('input');
      color.type = 'color'; color.value = rgbToHex(entry[1]);
      const del = document.createElement('button');
      del.className = 'del'; del.textContent = '×';
      del.disabled = anchors.length <= 2;
      hp.addEventListener('input', () => {
        entry[0] = Math.max(1, +hp.value | 0);
        refreshColors();
      });
      hp.addEventListener('change', () => {
        anchors.sort((a, b) => a[0] - b[0]);
        buildAnchorList(); refreshColors();
      });
      color.addEventListener('input', () => {
        entry[1] = hexToRgb(color.value);
        refreshColors();
      });
      del.addEventListener('click', () => {
        if (anchors.length <= 2) return;
        anchors.splice(i, 1);
        buildAnchorList(); refreshColors();
      });
      row.append(hp, color, del);
      list.appendChild(row);
    });
  }

  function buildLayerPreviews() {
    document.querySelectorAll('.gradient-preview').forEach(el => {
      const layer = +el.dataset.layer;
      const brightness = LAYER_BRIGHTNESS[layer] ?? 1;
      const anchors = window.BallzPalette.anchors;
      const minHp = 1;
      const maxHp = Math.max(80, anchors.at(-1)[0] + 5);
      const steps = 150;
      let stops = '';
      for (let i = 0; i <= steps; i++) {
        const hp = minHp + (maxHp - minHp) * i / steps;
        stops += `${window.BallzPalette.color(hp, brightness)} ${(i / steps * 100).toFixed(1)}%${i < steps ? ', ' : ''}`;
      }
      el.innerHTML = `<div class="bar" style="background: linear-gradient(to right, ${stops})"></div>`;
      for (const [hp] of anchors) {
        const pct = (hp - minHp) / (maxHp - minHp) * 100;
        if (pct < 0 || pct > 100) continue;
        const mark = document.createElement('div');
        mark.className = 'mark';
        mark.style.left = `${pct}%`;
        mark.innerHTML = `<span>${hp}</span>`;
        el.appendChild(mark);
      }
    });
  }

  // ---- Tier size editors ----
  function buildTierSizes() {
    const box = document.querySelector('#tier-sizes');
    box.innerHTML = '';
    const t = window.BlockGeometry.tiers.medium;
    for (const shape of SHAPES) {
      const row = document.createElement('div');
      row.className = 'row';
      const label = document.createElement('span');
      label.textContent = `${SHAPE_LABEL[shape]} 半径 r`;
      const input = document.createElement('input');
      input.type = 'number'; input.min = 1; input.step = 0.1;
      input.value = (+t[shape]).toFixed(2);
      input.addEventListener('input', () => {
        const v = Math.max(1, +input.value || 1);
        t[shape] = v;
        refreshAllGeom(); render();
        buildPalette();
      });
      row.append(label, input);
      box.appendChild(row);
    }
  }

  // ---- Inspector (right) ----
  function selectedBlock() {
    return blocks.find(b => b.id === selectedId) || null;
  }

  function renderInspector() {
    const b = selectedBlock();
    const form = document.querySelector('#inspector');
    const none = document.querySelector('#no-selection');
    if (!b) { form.classList.add('hidden'); none.classList.remove('hidden'); document.querySelector('#selection-layout').classList.add('hidden'); document.querySelector('#multi-selection').textContent=''; return; }
    none.classList.add('hidden'); form.classList.remove('hidden');
    document.querySelector('#multi-selection').textContent = selectedIds.size > 1 ? `已选 ${selectedIds.size} 个方块 · 修改数字会统一应用` : '';
    document.querySelector('#selection-layout').classList.toggle('hidden', selectedIds.size < 2);
    document.querySelector('#f-type').value = b.type;
    document.querySelector('#f-tier').value = b.tier;
    // Don't overwrite a field the user is currently typing in — their mid-edit
    // (e.g. an empty box they just cleared) must survive the re-render.
    const setIfIdle = (sel, value) => {
      const el = document.querySelector(sel);
      if (document.activeElement !== el) el.value = value;
    };
    setIfIdle('#f-hp', b.hp);
    setIfIdle('#f-dx', Math.round(b.dx));
    setIfIdle('#f-dy', Math.round(b.dy));
    setIfIdle('#f-angle', Math.round(b.baseAngle * 180 / Math.PI));
    document.querySelector('#f-layer').value = displayLayer(b);
    document.querySelector('#f-bonus').checked = !!b.bonus;
    const rt = RewardRules.type(b);
    document.querySelector('#f-reward-type').value = rt;
    const amtInput = document.querySelector('#f-reward-amount');
    setIfIdle('#f-reward-amount', RewardRules.amount(b));
    document.querySelector('#f-reward-type').disabled = !b.bonus;
    amtInput.disabled = !b.bonus || rt === 'bumper';
    if (rt === 'balls-multiply') { amtInput.min = 1.1; amtInput.max = 10; amtInput.step = 0.1; }
    else { amtInput.min = 1; amtInput.max = 99; amtInput.step = 1; }
    const unit = document.querySelector('#f-reward-unit');
    if (unit) unit.textContent = rt === 'balls-multiply' ? '× 倍' : rt === 'balls' ? '颗球' : rt === 'attempts' ? '次' : rt.startsWith('buff-') ? '次强化' : '';
    document.querySelector('#reward-lifetime').textContent = b.bonus
      ? `白边 ${RewardRules.segmentCount(b.type)} 段，每次发射消耗 1 段；耗尽后变为普通方块。` : '';
    if (b.bonus && RewardRules.type(b) === 'bumper') document.querySelector('#reward-lifetime').textContent += ' 有效期内击碎，随机生成一段弹力板。';
    if (b.bonus && RewardRules.type(b).startsWith('buff-')) document.querySelector('#reward-lifetime').textContent += ' 碰到即强化；能力不重复，尺寸最多升到大。';
    document.querySelector('#f-color-swatch').style.background = window.BallzPalette.color(b.hp);
  }

  function bindInspector() {
    const fields = {
      '#f-type':  (b, v) => { b.type = v; updateBlockGeom(b); },
      '#f-tier':  (b, v) => { b.tier = v; updateBlockGeom(b); },
      '#f-hp':    (b, v) => { b.hp = Math.max(1, +v | 0); if (b.bonus && RewardRules.type(b).startsWith('buff-')) { b.rewardAmount = Math.min(99, b.hp); b.hp = b.rewardAmount; } },
      '#f-dx':    (b, v) => { b.dx = +v; updateBlockGeom(b); },
      '#f-dy':    (b, v) => { b.dy = +v; updateBlockGeom(b); },
      '#f-angle': (b, v) => { b.baseAngle = (+v) * Math.PI / 180; updateBlockGeom(b); },
      '#f-bonus': (b, v) => { b.bonus = v; if (v) { const kind = RewardRules.type(b); if (kind.startsWith('buff-')) b.hp = RewardRules.amount(b); else b.rewardAmount = RewardRules.defaultAmount(kind); } },
      '#f-reward-type': (b, v) => { b.rewardType = v; b.rewardAmount = RewardRules.defaultAmount(v); if (b.bonus && v.startsWith('buff-')) b.hp = b.rewardAmount; },
      '#f-reward-amount': (b, v) => {
        const n = +v || 1;
        b.rewardAmount = b.rewardType === 'balls-multiply'
          ? Math.max(1.1, Math.min(10, Math.round(n * 10) / 10))
          : Math.max(1, Math.min(99, Math.floor(n)));
        if (b.bonus && RewardRules.type(b).startsWith('buff-')) b.hp = b.rewardAmount;
      },
    };
    const numberDefaults = { '#f-hp': 1, '#f-dx': 0, '#f-dy': 0, '#f-angle': 0, '#f-reward-amount': 1 };
    for (const [sel, fn] of Object.entries(fields)) {
      const el = document.querySelector(sel);
      const evt = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(evt, () => {
        const b = selectedBlock(); if (!b) return;
        const raw = el.type === 'checkbox' ? el.checked : el.value;
        // Allow a number field to be transiently empty while retyping; don't clamp back yet.
        if (el.type === 'number' && raw === '') return;
        const targets = sel === '#f-hp' && selectedIds.size > 1 ? blocks.filter(x=>selectedIds.has(x.id)) : [b];
        for (const target of targets) fn(target, raw);
        if (sel === '#f-reward-type' || sel === '#f-bonus') {
          document.querySelector('#f-hp').value = b.hp;
          document.querySelector('#f-reward-amount').value = RewardRules.amount(b);
        }
        render();
      });
      if (el.type === 'number' && sel in numberDefaults) {
        el.addEventListener('blur', () => {
          if (el.value !== '') return;
          const b = selectedBlock(); if (!b) return;
          el.value = numberDefaults[sel];
          const targets = sel === '#f-hp' && selectedIds.size > 1 ? blocks.filter(x=>selectedIds.has(x.id)) : [b];
          for (const target of targets) fn(target, el.value);
          render();
        });
      }
    }
    document.querySelector('#delete').addEventListener('click', deleteSelection);
    document.querySelector('#duplicate').addEventListener('click', () => duplicateSelection());
  }

  function commitPlacedBlocks(added,targetLayers,before,snapshot) {
    const result=LayerLayout.place(blocks,added.map(b=>b.id),targetLayers,before);
    for(const b of blocks)b.coveredBy=[...result.graph.get(b.id)];
    layoutCache=null;committedLayers=new Map(result.layers);
    const orphaned=added.filter(b=>(targetLayers.get(b.id)||1)>1&&(result.graph.get(b.id)||[]).length===0);
    if(orphaned.length){
      showPromotePrompt(orphaned[0],snapshot,'new',orphaned.map(b=>b.id));
      flash('上方没有覆盖方块：✓ 移到第一层，✕ 取消并删除');
    }
  }
  function selection() { return blocks.filter(b=>selectedIds.has(b.id)||b.id===selectedId); }
  function deleteSelection() {
    hidePromotePrompt();
    const ids=new Set(selection().map(b=>b.id));
    blocks=blocks.filter(b=>!ids.has(b.id));
    for(const b of blocks)b.coveredBy=b.coveredBy.filter(id=>!ids.has(id));
    selectedId=null;selectedIds.clear();render();
  }
  function duplicateSelection(source=selection(), options={repeat:true}) {
    if(!source.length)return;
    if(pendingPromote){flash('请先确认或取消当前方块的层级');return;}
    hidePromotePrompt();
    const snapshot=blockSnapshot(), before=new Map(blocks.map(b=>[b.id,displayLayer(b)]));
    const saved=source.map(b=>({...b,layerFloor:b.copyLayer||displayLayer(b),coveredBy:[...b.coveredBy]})), map=new Map();
    let shiftX=options.inPlace?0:16, shiftY=options.inPlace?0:16, turn=0;
    if(options.repeat && repeatDuplicate && saved.length===repeatDuplicate.length &&
      saved.every(b=>repeatDuplicate.some(old=>old.id===b.id))){
      const old=repeatDuplicate.find(b=>b.id===saved[0].id);
      shiftX=saved[0].dx-old.dx;shiftY=saved[0].dy-old.dy;turn=saved[0].baseAngle-old.baseAngle;
    }
    const copies=saved.map(b=>{
      const copy=makeBlock(b.type,b.dx+shiftX,b.dy+shiftY,{tier:b.tier,hp:b.hp,baseAngle:b.baseAngle+turn,layerFloor:1,
        bonus:b.bonus,rewardType:b.rewardType,rewardAmount:b.rewardAmount});
      map.set(b.id,copy.id);return copy;
    });
    copies.forEach((b,i)=>{b.coveredBy=saved[i].coveredBy.filter(id=>map.has(id)).map(id=>map.get(id));});
    repeatDuplicate=copies.map((b,i)=>({id:b.id,dx:saved[i].dx,dy:saved[i].dy,baseAngle:saved[i].baseAngle}));
    blocks.push(...copies);
    commitPlacedBlocks(copies,new Map(copies.map((b,i)=>[b.id,saved[i].layerFloor||1])),before,snapshot);
    selectedIds=new Set(copies.map(b=>b.id));selectedId=copies[0].id;render();
  }

  function moveScreen(b,x,y) {
    const c=Math.cos(-disk.angle),s=Math.sin(-disk.angle);
    b.dx=(x-disk.x)*c-(y-disk.y)*s;b.dy=(x-disk.x)*s+(y-disk.y)*c;updateBlockGeom(b);
  }
  document.querySelectorAll('[data-layout]').forEach(button=>button.addEventListener('click',()=>{
    const items=selection();if(items.length<2)return;
    const layers=new Map(blocks.map(b=>[b.id,displayLayer(b)])),originalOverlap=new Set();
    for(let i=0;i<blocks.length;i++)for(let j=i+1;j<blocks.length;j++)if(BlockGeometry.overlaps(blocks[i],blocks[j]))originalOverlap.add(pairKey(blocks[i].id,blocks[j].id));
    drag={id:selectedId,ids:items.map(b=>b.id),layers,lockedLayer:displayLayer(selectedBlock()),moved:true,originalOverlap,
      graphSnapshot:blocks.map(b=>({id:b.id,dx:b.dx,dy:b.dy,baseAngle:b.baseAngle,layerFloor:b.layerFloor,coveredBy:[...b.coveredBy]}))};
    const kind=button.dataset.layout;
    if(kind==='row'||kind==='column'){
      const value=items.reduce((sum,b)=>sum+(kind==='row'?b.y:b.x),0)/items.length;
      for(const b of items)moveScreen(b,kind==='column'?value:b.x,kind==='row'?value:b.y);
    }else{
      const horizontal=kind==='horizontal',list=items.sort((a,b)=>horizontal?a.x-b.x:a.y-b.y);
      const boxes=list.map(b=>EditorGuides.bounds([b])),lo=horizontal?'left':'top',hi=horizontal?'right':'bottom';
      const total=boxes.reduce((sum,b)=>sum+b[hi]-b[lo],0),gap=(boxes.at(-1)[hi]-boxes[0][lo]-total)/(items.length-1);
      let cursor=boxes[0][lo];
      list.forEach((b,i)=>{const delta=cursor-boxes[i][lo];moveScreen(b,b.x+(horizontal?delta:0),b.y+(horizontal?0:delta));cursor+=boxes[i][hi]-boxes[i][lo]+gap;});
    }
    const graph=resolvedLayout().graph;for(const b of blocks)b.coveredBy=[...graph.get(b.id)];drag=null;render();
  }));

  function nudgeLayer(delta) {
    const b = selectedBlock(); if (!b) return;
    const before = new Map(blocks.map(x => [x.id, displayLayer(x)]));
    if (delta < 0) {
      // ▲ Pop a cover: pick the topmost cover (lowest layer) and reverse the edge.
      if (!b.coveredBy.length) { flash('上面没有遮挡它的方块'); return; }
      const targets = b.coveredBy.map(id => blocks.find(x => x.id === id)).filter(Boolean);
      targets.sort((a, c) => displayLayer(a) - displayLayer(c));
      const target = targets[0];
      b.coveredBy = b.coveredBy.filter(id => id !== target.id);
      if (!target.coveredBy.includes(b.id)) target.coveredBy.push(b.id);
    } else {
      // ▼ Dive under: find a block that b covers (b in its coveredBy) and reverse.
      const covered = blocks.filter(o => o.coveredBy.includes(b.id));
      if (!covered.length) { flash('下面没有可交换的方块'); return; }
      covered.sort((a, c) => displayLayer(c) - displayLayer(a));
      const target = covered[0];
      target.coveredBy = target.coveredBy.filter(id => id !== b.id);
      if (!b.coveredBy.includes(target.id)) b.coveredBy.push(target.id);
    }
    const changes = [];
    for (const x of blocks) {
      const bl = displayLayer(x);
      if (bl !== before.get(x.id)) changes.push({ from: before.get(x.id), to: bl });
    }
    if (changes.length) recordDeltas(changes);
    render();
  }

  // ---- Canvas interaction ----
  function toCanvas(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * W / rect.width,
      y: (ev.clientY - rect.top) * H / rect.height,
    };
  }

  function hitTest(p) {
    // Topmost layer first (lowest layer number, newest within).
    const order = [...blocks].sort((a, b) => displayLayer(a) - displayLayer(b) || b.id - a.id);
    for (const b of order) {
      if (!isVisible(b)) continue;
      if (Math.hypot(b.x - p.x, b.y - p.y) <= b.r + 2) return b;
    }
    return null;
  }

  function rotationHandle(b) {
    const a = b.angle - Math.PI / 2;
    return { x: b.x + Math.cos(a) * (b.r + 22), y: b.y + Math.sin(a) * (b.r + 22) };
  }
  function rotationTarget(p) {
    const b = selectedBlock();
    if (!b || !isVisible(b)) return null;
    const h = rotationHandle(b), distance = Math.hypot(p.x-b.x,p.y-b.y);
    return Math.hypot(p.x-h.x,p.y-h.y) <= 11 || (distance >= b.r+10 && distance <= b.r+23) ? b : null;
  }
  const canvasWrap = document.querySelector('.canvas-wrap');
  function diskScreenCenter() {
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width * disk.x / W,
      y: rect.top + rect.height * disk.y / H,
    };
  }

  canvasWrap.addEventListener('pointerdown', ev => {
    // Let any control (buttons/inputs/side panels) handle its own events.
    if (ev.target.closest('button, input, select, label, textarea, .canvas-side, .canvas-left, .canvas-tools')) return;
    if (ev.button !== 0) return;
    if (document.querySelector('[data-tab="bumpers"]').classList.contains('active') && ev.target === canvas) {
      return;
    }
    hidePromotePrompt();
    const insideCanvas = ev.target === canvas;
    const p = insideCanvas ? toCanvas(ev) : null;
    const rotating = insideCanvas ? rotationTarget(p) : null;
    const hit = rotating || (insideCanvas ? hitTest(p) : null);
    if (ev.shiftKey && hit && !rotating) {
      if (selectedIds.has(hit.id)) selectedIds.delete(hit.id); else selectedIds.add(hit.id);
      selectedId = [...selectedIds][0] ?? null; render(); return;
    }
    if (!hit && angleLocked) {
      selectedId = null; selectedIds.clear();
      drag = { kind: 'marquee', start: toCanvas(ev), current: toCanvas(ev) };
      canvasWrap.setPointerCapture(ev.pointerId); render(); return;
    }
    if (!hit) {
      // Rotate the disk by dragging anywhere in the stage area; works outside the canvas too.
      resetAnim = null;
      angularVelocity = 0;
      const center = diskScreenCenter();
      drag = {
        kind: 'disk', startX: ev.clientX, startY: ev.clientY, moved: false,
        startAngle: Math.atan2(ev.clientY - center.y, ev.clientX - center.x),
        startDiskAngle: disk.angle,
        lastPointerAngle: Math.atan2(ev.clientY - center.y, ev.clientX - center.x),
        lastTime: ev.timeStamp,
        motionTime: ev.timeStamp,
      };
      canvasWrap.setPointerCapture(ev.pointerId);
      return;
    }
    if (hit) {
      if (!selectedIds.has(hit.id)) selectedIds = new Set([hit.id]);
      selectedId = hit.id;
      const lockedLayer = displayLayer(hit);
      // Snapshot current overlap set and full cover graph (for cancel).
      const originalOverlap = new Set();
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
          if (window.BlockGeometry.overlaps(blocks[i], blocks[j])) {
            originalOverlap.add(pairKey(blocks[i].id, blocks[j].id));
          }
        }
      }
      const graphSnapshot = blocks.map(b => ({ id: b.id, dx: b.dx, dy: b.dy, baseAngle: b.baseAngle, layerFloor: b.layerFloor, coveredBy: [...b.coveredBy] }));
      drag = {
        kind: rotating ? 'rotate' : 'move', lastRotationAngle: Math.atan2(p.y-hit.y,p.x-hit.x),
        ids: rotating ? [hit.id] : [...selectedIds], layers: new Map(blocks.map(b => [b.id, displayLayer(b)])),
        id: hit.id, offsetX: p.x - hit.x, offsetY: p.y - hit.y,
        lockedLayer, moved: false,
        originalOverlap, graphSnapshot,
        initial: { dx: hit.dx, dy: hit.dy, coveredBy: [...hit.coveredBy] },
      };
      canvasWrap.setPointerCapture(ev.pointerId);
    }
    render();
  });

  canvasWrap.addEventListener('pointermove', ev => {
    if (!drag) {
      if (ev.target === canvas) canvas.style.cursor = rotationTarget(toCanvas(ev)) ? 'grab' : 'crosshair';
      return;
    }
    if (drag.kind === 'rotate') {
      const b = blocks.find(b=>b.id===drag.id); if (!b) return;
      const p = toCanvas(ev), a = Math.atan2(p.y-b.y,p.x-b.x);
      const delta = Math.atan2(Math.sin(a-drag.lastRotationAngle),Math.cos(a-drag.lastRotationAngle));
      b.baseAngle += delta; drag.lastRotationAngle = a;
      if (Math.abs(delta) > .0001) drag.moved = true;
      updateBlockGeom(b); canvas.style.cursor='grabbing'; render(); return;
    }
    if (drag.kind === 'marquee') { drag.current = toCanvas(ev); render(); return; }
    if (drag.kind === 'disk') {
      if (!drag.moved && Math.hypot(ev.clientX-drag.startX,ev.clientY-drag.startY)<5) return;
      drag.moved=true;
      const center = diskScreenCenter();
      const a = Math.atan2(ev.clientY - center.y, ev.clientX - center.x);
      const delta = Math.atan2(Math.sin(a - drag.lastPointerAngle), Math.cos(a - drag.lastPointerAngle));
      const elapsed = Math.max(1 / 240, (ev.timeStamp - drag.lastTime) / 1000);
      const measured = Math.max(-22, Math.min(22, delta / elapsed));
      angularVelocity = angularVelocity * 0.3 + measured * 0.7;
      disk.angle += delta;
      drag.lastPointerAngle = a;
      drag.lastTime = ev.timeStamp;
      if (Math.abs(delta) > 0.0001) drag.motionTime = ev.timeStamp;
      refreshAllGeom();
      render();
      return;
    }
    const p = toCanvas(ev);
    const b = blocks.find(x => x.id === drag.id);
    if (!b) return;
    // Pointer motion is in canvas coords; convert the target position to disk-local.
    let targetX = p.x - drag.offsetX, targetY = p.y - drag.offsetY;
    snapGuides=[];
    if (!ev.altKey) {
      const moving=(drag.ids||[drag.id]).map(id=>{
        const member=blocks.find(b=>b.id===id),initial=drag.graphSnapshot.find(b=>b.id===id);
        const c=Math.cos(disk.angle),s=Math.sin(disk.angle);
        const initialX=disk.x+initial.dx*c-initial.dy*s,initialY=disk.y+initial.dx*s+initial.dy*c;
        const anchor=drag.graphSnapshot.find(b=>b.id===drag.id);
        const anchorX=disk.x+anchor.dx*c-anchor.dy*s,anchorY=disk.y+anchor.dx*s+anchor.dy*c;
        return {...member,x:initialX+targetX-anchorX,y:initialY+targetY-anchorY};
      });
      const result=EditorGuides.snap(EditorGuides.bounds(moving),blocks.filter(o=>!(drag.ids||[drag.id]).includes(o.id)&&drag.layers.get(o.id)===drag.lockedLayer));
      targetX+=result.dx;targetY+=result.dy;snapGuides=result.guides;
    }
    const c = Math.cos(-disk.angle), s = Math.sin(-disk.angle);
    const ldx = (targetX - disk.x) * c - (targetY - disk.y) * s;
    const ldy = (targetX - disk.x) * s + (targetY - disk.y) * c;
    const ndx = snapGuides.length ? ldx : Math.round(ldx), ndy = snapGuides.length ? ldy : Math.round(ldy);
    if (ndx !== drag.initial.dx || ndy !== drag.initial.dy) drag.moved = true;
    const shiftX = ndx - drag.initial.dx, shiftY = ndy - drag.initial.dy;
    for (const id of drag.ids || [drag.id]) {
      const member = blocks.find(x => x.id === id), initial = drag.graphSnapshot.find(x => x.id === id);
      if (member && initial) { member.dx = initial.dx + shiftX; member.dy = initial.dy + shiftY; updateBlockGeom(member); }
    }
    render();
  });

  function endDrag(ev) {
    snapGuides=[];
    if (!drag) return;
    if (canvasWrap.hasPointerCapture?.(ev.pointerId)) canvasWrap.releasePointerCapture(ev.pointerId);
    if (drag.kind === 'marquee') {
      if (ev.type !== 'pointercancel') {
        const a = drag.start, b = drag.current;
        const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
        if (right - left > 3 || bottom - top > 3) {
          selectedIds = new Set(blocks.filter(b => displayLayer(b) === focusLayer && b.x + b.r >= left && b.x - b.r <= right &&
            b.y + b.r >= top && b.y - b.r <= bottom).map(b => b.id));
          selectedId = [...selectedIds][0] ?? null;
        }
      }
      drag = null; render(); return;
    }
    if (drag.kind === 'disk') {
      if (!drag.moved && ev.type !== 'pointercancel') { selectedId=null;selectedIds.clear(); }
      // Game-style release: if the pointer went quiet before release, no fling; else coast.
      if (ev.type === 'pointercancel' || ev.timeStamp - drag.motionTime > 90) angularVelocity = 0;
      drag = null;
      if (angularVelocity) ensureAnim();
      render(); return;
    }
    const b = blocks.find(x => x.id === drag.id);
    const moved = drag.moved;
    const snapshot = drag.graphSnapshot;
    const wasLayer = drag.lockedLayer;
    if (ev.type === 'pointercancel') {
      for (const initial of snapshot) {
        const member = blocks.find(x => x.id === initial.id);
        if (member) { member.dx = initial.dx; member.dy = initial.dy; member.baseAngle = initial.baseAngle ?? member.baseAngle; member.coveredBy = [...initial.coveredBy]; updateBlockGeom(member); }
      }
      drag = null; render(); return;
    }
    if (!b || !moved) {
      // Pure click: switch focus to the clicked block's layer; no graph change.
      if (b && !moved) {
        const layer = displayLayer(b);
        if (layer !== focusLayer) focusLayer = layer;
      }
      drag = null;
      render();
      return;
    }
    // Snapshot pre-commit layers so we can compute deltas later.
    const layersBefore = new Map(blocks.map(x => [x.id, snapshotLayer(x, snapshot)]));
    // Commit virtual graph: write each block's virtualCoveredBy back to coveredBy.
    const newGraph = new Map();
    for (const x of blocks) newGraph.set(x.id, virtualCoveredBy(x).slice());
    // Clear drag so displayLayer reflects the committed graph.
    drag = null;
    for (const x of blocks) x.coveredBy = newGraph.get(x.id);
    // Prompt only if the dragged block itself lost all its covers (went from layer >1 to layer 1).
    const newLayer = displayLayer(b);
    if (wasLayer > 1 && newLayer === 1 && b.coveredBy.length === 0) {
      // Give user a yes/no — if cancel, revert everything.
      showPromotePrompt(b, snapshot);
      diffAndShow(layersBefore);
      render();
      return;
    }
    diffAndShow(layersBefore);
    render();
  }

  // Compute a block's layer using a fallback snapshot (if provided) for pre-drag state.
  function snapshotLayer(b, snapshot) {
    return window.LayerLayout.layers(snapshot.map(s => s.id),
      new Map(snapshot.map(s => [s.id, s.coveredBy])), new Map(), new Map(snapshot.map(s=>[s.id,s.layerFloor||1]))).get(b.id) || 1;
  }

  function diffAndShow(layersBefore) {
    const changes = [];
    for (const b of blocks) {
      const before = layersBefore.get(b.id);
      const after = displayLayer(b);
      if (before !== after) changes.push({ from: before, to: after });
    }
    if (changes.length) recordDeltas(changes);
  }
  canvasWrap.addEventListener('pointerup', endDrag);
  canvasWrap.addEventListener('pointercancel', endDrag);

  // ---- Saves: two separate stores ----
  const KEYS = {
    settings: { store: 'ballz-editor-settings', current: 'ballz-editor-current-settings' },
    level:    { store: 'ballz-editor-levels',   current: 'ballz-editor-current-level' },
  };

  function loadStore(kind) {
    if (kind === 'level') return LevelCatalog.editorLevels();
    try { return JSON.parse(localStorage.getItem(KEYS[kind].store) || '{}'); }
    catch { return {}; }
  }
  function writeStore(kind, data) { localStorage.setItem(KEYS[kind].store, JSON.stringify(data)); }

  function settingsData() {
    return {
      version: 1,
      palette: window.BallzPalette.anchors.map(([hp, rgb]) => [hp, [...rgb]]),
      tiers: JSON.parse(JSON.stringify(window.BlockGeometry.tiers)),
      layerBrightness: { ...LAYER_BRIGHTNESS },
    };
  }
  function levelData() {
    return {
      version: 3,
      bumpers: [...bumpers],
      initialAttempts: readInitialAttempts(),
      ballCounts: ballCounts.map(row => [...row]),
      blocks: blocks.map(b => ({
        id: b.id, type: b.type, tier: b.tier, layerFloor: b.layerFloor || 1,
        dx: +b.dx.toFixed(2), dy: +b.dy.toFixed(2),
        hp: b.hp, baseAngle: +b.baseAngle.toFixed(4),
        bonus: !!b.bonus, rewardType: RewardRules.type(b), rewardAmount: RewardRules.amount(b),
        choiceGroup: b.choiceGroup, choiceGate: b.choiceGate,
        coveredBy: [...b.coveredBy],
      })),
    };
  }

  function applySettings(data) {
    if (Array.isArray(data.palette) && data.palette.length >= 2) {
      window.BallzPalette.anchors.length = 0;
      for (const [hp, rgb] of data.palette) window.BallzPalette.anchors.push([hp, [...rgb]]);
      buildAnchorList();
    }
    if (data.tiers) {
      for (const [name, sizes] of Object.entries(data.tiers)) {
        window.BlockGeometry.tiers[name] = { ...window.BlockGeometry.tiers[name], ...sizes };
      }
      buildTierSizes();
      refreshAllGeom();
      buildPalette();
    }
    if (data.layerBrightness) {
      for (const [k, v] of Object.entries(data.layerBrightness)) LAYER_BRIGHTNESS[+k] = +v;
      syncBrightnessInputs();
    }
    refreshColors();
  }

  function syncBrightnessInputs() {
    document.querySelectorAll('.brightness-input').forEach(el => {
      const layer = +el.dataset.layer;
      el.value = LAYER_BRIGHTNESS[layer];
    });
  }

  function readInitialAttempts() {
    const el = document.querySelector('#initial-attempts');
    const n = Math.max(1, Math.min(999, Math.floor(Number(el.value) || 5)));
    return n;
  }

  function applyLevel(data) {
    hidePromotePrompt();
    bumpers = DiskBumpers.normalize(data.bumpers); bumperDraft = null;
    const attemptsInput = document.querySelector('#initial-attempts');
    attemptsInput.value = Math.max(1, Math.min(999, Math.floor(Number(data.initialAttempts) || 5)));
    if (Array.isArray(data.ballCounts) && data.ballCounts.length === BALL_TYPES.length) {
      ballCounts = data.ballCounts.map(row => {
        const next = [0, 0, 0];
        for (let i = 0; i < BALL_SIZES.length; i++) next[i] = Math.max(0, Math.min(10000, Math.floor(Number(row?.[i]) || 0)));
        return next;
      });
      buildBallRoster();
    }
    blocks = []; nextId = 0;
    const items = data.blocks || [];
    // First pass: create blocks (ids re-assigned by makeBlock).
    const idMap = new Map();
    items.forEach((b, i) => {
      const nb = makeBlock(b.type, b.dx, b.dy, {
        tier: b.tier || 'medium', layerFloor: 1,
        hp: b.hp, baseAngle: b.baseAngle || 0,
        bonus: !!b.bonus, rewardType: RewardRules.type(b), rewardAmount: RewardRules.amount(b),
        choiceGroup: b.choiceGroup, choiceGate: b.choiceGate,
      });
      blocks.push(nb);
      idMap.set(b.id ?? i, nb.id);
    });
    // Second pass: restore coveredBy via idMap, or infer from overlap if absent.
    const anyCovers = items.some(b => Array.isArray(b.coveredBy));
    if (anyCovers) {
      items.forEach((b, i) => {
        const nb = blocks[i];
        nb.coveredBy = (b.coveredBy || [])
          .map(oid => idMap.get(oid))
          .filter(id => id != null && id !== nb.id);
      });
    } else {
      // Legacy fallback: later-created covers earlier.
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
          if (window.BlockGeometry.overlaps(blocks[i], blocks[j])) {
            blocks[i].coveredBy.push(blocks[j].id);
          }
        }
      }
    }
    focusLayer = 1;
    selectedId = null;
    render();
    if(historyEnabled)resetEditHistory();
  }

  function saveKind(kind) {
    if(kind==='level'&&pendingPromote){flash('请先确认或取消当前方块的层级');return;}
    const nameInput = document.querySelector(kind === 'settings' ? '#settings-name' : '#level-name');
    let name = nameInput.value.trim();
    if (!name) {
      name = kind === 'settings' ? '未命名设置' : '未命名关卡';
      nameInput.value = name;
    }
    const store = loadStore(kind);
    const exists = !!store[name];
    const data = kind === 'settings' ? settingsData() : levelData();
    store[name] = { ...data, savedAt: Date.now() };
    writeStore(kind, store);
    localStorage.setItem(KEYS[kind].current, name);
    const label = kind === 'settings' ? '设置' : '关卡';
    flash(exists ? `已覆盖「${name}」${label}` : `已保存「${name}」${label}`);
  }

  function flash(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:#1b4a1f;color:#d9f5db;padding:8px 16px;border-radius:6px;z-index:100;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.4);';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  let savesModalKind = 'level';
  function openSaves(kind) {
    savesModalKind = kind;
    document.querySelector('#saves-title').textContent =
      kind === 'settings' ? '我的游戏设置' : '我的关卡';
    document.querySelector('#saves-modal').classList.remove('hidden');
    document.querySelector('#json-view').classList.add('hidden');
    renderSavesList();
  }
  function closeSaves() { document.querySelector('#saves-modal').classList.add('hidden'); }

  function renderSavesList() {
    const kind = savesModalKind;
    const store = loadStore(kind);
    const names = Object.keys(store).sort((a, b) => (store[b].savedAt || 0) - (store[a].savedAt || 0));
    const list = document.querySelector('#saves-list');
    const empty = document.querySelector('#saves-empty');
    list.innerHTML = '';
    empty.style.display = names.length ? 'none' : '';
    empty.textContent = `还没有${kind === 'settings' ? '设置' : '关卡'}存档。`;
    for (const name of names) {
      const data = store[name];
      const li = document.createElement('li');
      const when = data.savedAt ? new Date(data.savedAt).toLocaleString() : '';
      const summary = kind === 'settings'
        ? `${data.palette?.length ?? 0} 个颜色锚点`
        : `${data.blocks?.length ?? 0} 个方块`;
      li.innerHTML = `
        <div class="meta">
          <div class="name"></div>
          <div class="sub">${summary} · ${when}</div>
        </div>
        <div class="actions">
          <button data-act="load">加载</button>
          <button data-act="view">查看</button>
          <button data-act="export">导出</button>
          <button data-act="delete" class="danger">删除</button>
        </div>`;
      li.querySelector('.name').textContent = name;
      li.querySelector('[data-act="load"]').onclick = () => {
        if (kind === 'settings') { applySettings(data); document.querySelector('#settings-name').value = name; }
        else { applyLevel(data); document.querySelector('#level-name').value = name; }
        localStorage.setItem(KEYS[kind].current, name);
        closeSaves(); flash(`已加载：${name}`);
      };
      li.querySelector('[data-act="view"]').onclick = () => {
        document.querySelector('#json-view-name').textContent = name;
        document.querySelector('#json-view-text').value = JSON.stringify(data, null, 2);
        document.querySelector('#json-view').classList.remove('hidden');
      };
      li.querySelector('[data-act="export"]').onclick = () => downloadJson(name, data);
      li.querySelector('[data-act="delete"]').onclick = () => {
        if (!confirm(`删除「${name}」？`)) return;
        const s = loadStore(kind); delete s[name]; writeStore(kind, s);
        renderSavesList();
      };
      list.appendChild(li);
    }
  }

  function downloadJson(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${name || 'ballz'}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Wire up buttons ----
  document.querySelector('#save-settings').addEventListener('click', () => saveKind('settings'));
  document.querySelector('#save-level').addEventListener('click', () => saveKind('level'));
  document.querySelector('#open-settings-saves').addEventListener('click', () => openSaves('settings'));
  document.querySelector('#open-level-saves').addEventListener('click', () => openSaves('level'));
  document.querySelectorAll('#saves-modal [data-close]').forEach(el =>
    el.addEventListener('click', closeSaves));
  document.querySelector('#json-view-close').addEventListener('click', () =>
    document.querySelector('#json-view').classList.add('hidden'));
  document.addEventListener('keydown', e => {
    const command=e.metaKey||e.ctrlKey,key=e.key.toLowerCase();
    const editable=e.target.closest('input,textarea,select,[contenteditable="true"]');
    if(command && (key==='z'||key==='y') && (!editable || editable.closest('#inspector'))){
      e.preventDefault();undoBlockEdit(key==='y'||e.shiftKey);return;
    }
    if (editable) return;
    if (e.key === 'Escape') { selectedId=null;selectedIds.clear();closeSaves();render(); }
    if(command&&key==='a'){e.preventDefault();selectedIds=new Set(blocks.filter(b=>displayLayer(b)===focusLayer).map(b=>b.id));selectedId=[...selectedIds][0]??null;render();return;}
    if(command&&key==='d'){e.preventDefault();duplicateSelection();return;}
    if(command&&key==='c'&&selection().length){e.preventDefault();copiedBlocks=selection().map(b=>({...b,copyLayer:displayLayer(b),coveredBy:[...b.coveredBy]}));return;}
    if(command&&key==='v'&&copiedBlocks.length){e.preventDefault();duplicateSelection(copiedBlocks,{repeat:false});return;}
    if(command&&key==='f'){e.preventDefault();if(copiedBlocks.length)duplicateSelection(copiedBlocks,{inPlace:true});return;}
    if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelection();return;}
    if ((e.key === 's' || e.key === 'S') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault(); saveKind('level');
    }
  });

  document.querySelector('#new-level').addEventListener('click', () => {
    hidePromotePrompt();
    bumpers = []; bumperDraft = null; blocks = []; nextId = 0; selectedId = null; focusLayer = 1; render(); resetEditHistory();
  });
  document.querySelector('#load-default').addEventListener('click', loadDefault);
  document.querySelector('#lock-angle').addEventListener('click', e => {
    angleLocked = !angleLocked; angularVelocity = 0; resetAnim = null;
    e.currentTarget.textContent = angleLocked ? '解锁角度' : '锁定角度';
    e.currentTarget.setAttribute('aria-pressed', String(angleLocked));
    document.querySelector('#selection-hint').textContent = angleLocked ? '拖动空白处框选，拖动选中方块一起移动' : '';
    render();
  });
  document.querySelector('#reset-angle').addEventListener('click', () => {
    const normalized = ((disk.angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    disk.angle = normalized;
    angularVelocity = 0;
    resetAnim = { from: normalized, start: performance.now(), duration: 450 };
    ensureAnim();
  });
  document.querySelector('#clear-all').addEventListener('click', () => {
    hidePromotePrompt();
    if (!blocks.length) return;
    if (!confirm('确认清除所有方块？')) return;
    blocks = []; selectedId = null; render();
    flash('已清除所有方块');
  });
  document.querySelector('#clear-layer').addEventListener('click', () => {
    const victims = blocks.filter(b => displayLayer(b) === focusLayer);
    if (!victims.length) { flash(`第 ${focusLayer} 层没有方块`); return; }
    if (!confirm(`确认清除第 ${focusLayer} 层的 ${victims.length} 个方块？`)) return;
    const removed = new Set(victims.map(b => b.id));
    blocks = blocks.filter(b => !removed.has(b.id));
    for (const b of blocks) b.coveredBy = b.coveredBy.filter(id => !removed.has(id));
    if (removed.has(selectedId)) selectedId = null;
    render();
    flash(`已清除第 ${focusLayer} 层 ${victims.length} 个方块`);
  });

  document.querySelector('#layer-up').addEventListener('click', () => nudgeLayer(-1));
  document.querySelector('#layer-down').addEventListener('click', () => nudgeLayer(+1));
  document.querySelector('#promote-yes').addEventListener('click', acceptPromote);
  document.querySelector('#promote-no').addEventListener('click', cancelPromote);
  document.querySelector('#playtest-start').addEventListener('click', () => startPlaytest(false));
  document.querySelector('#playtest-start-unlimited').addEventListener('click', () => startPlaytest(true));
  document.querySelector('#playtest-stop').addEventListener('click', stopPlaytest);
  document.querySelector('#test-1').addEventListener('click', () => startTest(1));
  document.querySelector('#test-10').addEventListener('click', () => startTest(10));
  document.querySelector('#test-stop').addEventListener('click', stopTest);

  document.querySelectorAll('.brightness-input').forEach(el => {
    el.addEventListener('input', () => {
      const layer = +el.dataset.layer;
      const v = Math.max(0, Math.min(1, +el.value || 0));
      LAYER_BRIGHTNESS[layer] = v;
      refreshColors();
    });
  });
  document.querySelector('#add-anchor').addEventListener('click', () => {
    const anchors = window.BallzPalette.anchors;
    const last = anchors.at(-1);
    anchors.push([last[0] + 5, [...last[1]]]);
    buildAnchorList(); refreshColors();
  });

  function drawBumperPicker() {
    const picker = document.querySelector('#bumper-picker');
    const c = picker.getContext('2d');
    c.clearRect(0, 0, 280, 280);
    const values = bumperDraft || bumpers;
    for (let i = 0; i < DiskBumpers.slotCount; i++) {
      const angle = i * DiskBumpers.step - Math.PI / 2;
      c.lineWidth = 13;
      c.strokeStyle = i === 0 ? '#653b36' : values.includes(i) ? '#f1f5f4' : '#343d3e';
      c.beginPath(); c.arc(140, 140, 112, angle - DiskBumpers.step / 2 + .013,
        angle + DiskBumpers.step / 2 - .013); c.stroke();
      if (i % 9 === 0) {
        c.fillStyle = '#afb9b5'; c.font = '12px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(`${i * 10}°`, 140 + Math.cos(angle) * 88, 140 + Math.sin(angle) * 88);
      }
    }
    c.fillStyle = '#afb9b5'; c.font = '13px sans-serif'; c.textAlign = 'center';
    c.fillText('顶部入口不可封闭', 140, 136);
    c.fillText('拖动圆环选中 / 取消', 140, 158);
    document.querySelector('#bumper-info').textContent = `已选 ${values.length} 段 · ${Math.round(values.length * 180 / Math.PI * DiskBumpers.step)}°${bumperDraft ? '（待确定）' : ''}`;
  }
  // A stroke keeps its initial paint/erase mode, even when crossing the same slot again.
  function bindBumperPainting(surface, getPoint, getCenter, enabled = () => true) {
    surface.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !enabled()) return;
      e.preventDefault(); e.stopPropagation();
      angularVelocity = 0; resetAnim = null;
      const snapshot = bumperDraft ? [...bumperDraft] : null;
      let mode = null, previous = getPoint(e);
      const paint = point => {
        const center = getCenter();
        if (Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - center.r) > 18) return false;
        const angle = Math.atan2(point.x - center.x, center.y - point.y) - (center.angle || 0);
        const index = ((Math.round(angle / DiskBumpers.step) % DiskBumpers.slotCount) + DiskBumpers.slotCount) % DiskBumpers.slotCount;
        if (index === 0) return false;
        const values = bumperDraft || bumpers;
        mode ??= !values.includes(index);
        if (values.includes(index) === mode) return false;
        bumperDraft = mode ? [...values, index] : values.filter(n => n !== index);
        return true;
      };
      if (paint(previous)) render();
      surface.setPointerCapture(e.pointerId);
      const move = event => {
        if (event.pointerId !== e.pointerId) return;
        let changed = false;
        for (const sample of event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event]) {
          const point = getPoint(sample);
          const steps = Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.y - previous.y) / 3));
          for (let i = 1; i <= steps; i++) changed = paint({
            x: previous.x + (point.x - previous.x) * i / steps,
            y: previous.y + (point.y - previous.y) * i / steps,
          }) || changed;
          previous = point;
        }
        if (changed) render();
      };
      const finish = event => {
        if (event.pointerId !== e.pointerId) return;
        if (event.type === 'pointerup') move(event);
        else { bumperDraft = snapshot; render(); }
        surface.removeEventListener('pointermove', move);
        surface.removeEventListener('pointerup', finish);
        surface.removeEventListener('pointercancel', finish);
        if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
      };
      surface.addEventListener('pointermove', move);
      surface.addEventListener('pointerup', finish);
      surface.addEventListener('pointercancel', finish);
    });
  }
  bindBumperPainting(document.querySelector('#bumper-picker'), e => {
    const rect = document.querySelector('#bumper-picker').getBoundingClientRect();
    return { x: (e.clientX - rect.left) * 280 / rect.width, y: (e.clientY - rect.top) * 280 / rect.height };
  }, () => ({ x: 140, y: 140, r: 112 }));
  bindBumperPainting(canvas, toCanvas, () => disk,
    () => document.querySelector('[data-tab="bumpers"]').classList.contains('active'));
  function commitBumpers() { bumpers = DiskBumpers.normalize(bumperDraft || bumpers); bumperDraft = null; }
  document.querySelector('#bumper-confirm').addEventListener('click', () => {
    commitBumpers();
    render(); flash('弹力板已确定');
  });
  document.querySelector('#bumper-clear').addEventListener('click', () => { bumperDraft = []; render(); });

  // Tabs
  document.querySelectorAll('.tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      hidePromotePrompt();
      document.querySelectorAll('.tabs .tab').forEach(b => b.classList.toggle('active', b === btn));
      const name = btn.dataset.tab;
      bumperDraft = name === 'bumpers' ? [...bumpers] : null;
      render();
      document.querySelectorAll('.tab-panel').forEach(p =>
        p.classList.toggle('hidden', p.dataset.panel !== name));
    });
  });

  function ballSpecs() {
    return BALL_TYPES.flatMap((type, row) => BALL_SIZES.flatMap((size, col) =>
      Array.from({ length: ballCounts[row][col] }, () => ({ type: type.type, color: type.color, ...size }))));
  }
  function updateBallRoster() {
    stopPlaytest(); stopTest();
    idlePhysics = new BallPhysics(ballSpecs());
    document.querySelector('#ball-total').textContent = `共 ${idlePhysics.count} 球`;
    render();
  }
  function buildBallRoster() {
    const tbody = document.querySelector('#ball-roster tbody');
    tbody.innerHTML = '';
    BALL_TYPES.forEach((type, row) => {
      const tr = document.createElement('tr');
      const label = document.createElement('th');
      label.innerHTML = `<span class="ball-swatch" style="background:${type.color}"></span>${type.label}`;
      tr.appendChild(label);
      BALL_SIZES.forEach((size, col) => {
        const td = document.createElement('td'), input = document.createElement('input');
        input.type = 'number'; input.min = 0; input.max = 10000; input.step = 1; input.value = ballCounts[row][col];
        input.dataset.ballType = type.type; input.dataset.ballSize = size.size;
        input.setAttribute('aria-label', `${type.label}球 ${['小', '中', '大'][col]} 数量`);
        input.addEventListener('input', () => {
          ballCounts[row][col] = Math.max(0, Math.min(10000, Math.floor(Number(input.value) || 0)));
          updateBallRoster();
        });
        input.addEventListener('change', () => { input.value = ballCounts[row][col]; });
        td.appendChild(input); tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }
  document.querySelector('#reset-balls').addEventListener('click', () => {
    ballCounts = BALL_TYPES.map((_, i) => [i === 0 ? 10 : 0, 0, 0]);
    buildBallRoster(); updateBallRoster();
  });

  // A click edits text; crossing a small horizontal threshold starts numeric scrubbing.
  document.addEventListener('pointerdown', e => {
    const input=e.target.closest('input[type="number"]');
    if (!input || input.disabled || input.readOnly || e.button!==0) return;
    const startX=e.clientX, original=input.value, initial=Number(input.value)||0;
    const step=Number(input.step)>0?Number(input.step):1;
    let active=false, last=initial;
    const move=event=>{
      if (event.pointerId!==e.pointerId) return;
      const dx=event.clientX-startX;
      if (!active && Math.abs(dx)<4) return;
      active=true;event.preventDefault();document.body.classList.add('number-scrubbing');
      const min=input.min!==''?Number(input.min):-Infinity,max=input.max!==''?Number(input.max):Infinity;
      const value=+Math.max(min,Math.min(max,initial+Math.round(dx/5)*step)).toFixed(6);
      if (value===last) return;last=value;input.value=value;
      input.dispatchEvent(new Event('input',{bubbles:true}));
    };
    const finish=event=>{
      if(event.pointerId!==e.pointerId)return;
      document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',finish);document.removeEventListener('pointercancel',finish);
      document.body.classList.remove('number-scrubbing');
      if(active){
        if(event.type==='pointercancel'){input.value=original;input.dispatchEvent(new Event('input',{bubbles:true}));}
        input.dispatchEvent(new Event('change',{bubbles:true}));
      }
    };
    document.addEventListener('pointermove',move,{passive:false});document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);
  });

  // ---- Init ----
  const lastSettingsName = GameSettings.saved() ? GameSettings.defaultName : localStorage.getItem(KEYS.settings.current);
  const lastLevelName = localStorage.getItem(KEYS.level.current);
  if (lastSettingsName) {
    document.querySelector('#settings-name').value = lastSettingsName;
    const saved = loadStore('settings')[lastSettingsName];
    if (saved) applySettings(saved);
  }
  let savedLevel = null;
  if (lastLevelName) {
    document.querySelector('#level-name').value = lastLevelName;
    savedLevel = loadStore('level')[lastLevelName];
  }

  buildPalette();
  buildAnchorList();
  buildTierSizes();
  syncBrightnessInputs();
  buildLayerPreviews();
  bindInspector();
  if (savedLevel) applyLevel(savedLevel); else loadDefault();
  buildBallRoster(); updateBallRoster();
  historyEnabled = true; resetEditHistory();
})();
