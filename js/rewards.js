// Shared reward rules for the game and editor playtest.
(() => {
  const defaultAmount = kind => kind === 'attempts' ? 1 : kind === 'balls' ? 4 : kind === 'balls-multiply' ? 1.5 : kind.startsWith('buff-') ? 5 : 1;
  const outlineColor = layer => layer >= 3 ? null : layer === 2 ? '#141414' : '#ffffff';
  const segmentCount = type => type === 'square' ? 4 : type === 'triangle' ? 3 : 2;
  const amount = block => {
    const n = Number(block.rewardAmount);
    const kind = type(block);
    if (kind === 'balls-multiply') return Math.max(1.1, Math.min(10, Math.round((n || 2) * 10) / 10));
    return Math.max(1, Math.min(99, Math.floor(n || 3)));
  };
  const type = block => ['balls', 'balls-multiply', 'bumper', 'buff-size', 'buff-lightning', 'buff-vitality', 'buff-explosive'].includes(block.rewardType) ? block.rewardType : 'attempts';
  function initialize(block) {
    block.rewardType = type(block);
    block.rewardAmount = amount(block);
    block.rewardSegments = block.bonus ? segmentCount(block.type) : 0;
  }
  function updateChoices(blocks, shot, exposed) {
    const gates = new Set(blocks.filter(b=>b.choiceGate && exposed(b)).map(b=>b.choiceGate));
    for(const b of blocks) {
      if(!b.bonus || !b.choiceGroup) continue;
      if(b.choiceStarted == null && (gates.has(b.choiceGroup)||exposed(b))) b.choiceStarted=Math.max(1,shot);
      if(b.choiceStarted == null) continue;
      const remaining=Math.max(0,2-(shot-b.choiceStarted));
      b.rewardSegments=Math.ceil(segmentCount(b.type)*remaining/2);
      if(!remaining) b.bonus=false;
    }
  }
  function claimChoice(blocks, block) {
    if(!block.choiceGroup) return;
    for(const b of blocks) if(b.id!==block.id && b.choiceGroup===block.choiceGroup) {b.bonus=false;b.rewardSegments=0;}
  }
  function advance(blocks) {
    for (const b of blocks) {
      if (!b.bonus || b.choiceGroup) continue;
      b.rewardSegments = Math.max(0, (b.rewardSegments ?? segmentCount(b.type)) - 1);
      if (!b.rewardSegments) b.bonus = false;
    }
  }
  function label(block) {
    const kind = type(block), names = { 'bumper': '弹力板', 'buff-size': '尺寸↑', 'buff-lightning': '闪电', 'buff-vitality': '活力', 'buff-explosive': '爆炸' };
    if (names[kind]) return names[kind];
    if (kind === 'balls-multiply') return `×${amount(block)}球`;
    return `+${amount(block)}${kind === 'balls' ? '球' : '击'}`;
  }
  function outline(ctx, b, stroke = '#fff') {
    if (!b.bonus || stroke === null) return;
    const count = segmentCount(b.type), remaining = b.rewardSegments ?? count;
    ctx.save(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    if (b.type === 'circle') {
      for (let i = 0; i < remaining; i++) {
        const start = (b.angle || 0) - Math.PI / 2 + i * Math.PI;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, start + .035, start + Math.PI - .035); ctx.stroke();
      }
    } else {
      const points = BlockGeometry.vertices(b);
      for (let i = 0; i < remaining; i++) {
        const a = points[i], c = points[(i + 1) % count];
        const gap = .025;
        ctx.beginPath(); ctx.moveTo(a.x + (c.x - a.x) * gap, a.y + (c.y - a.y) * gap);
        ctx.lineTo(c.x + (a.x - c.x) * gap, c.y + (a.y - c.y) * gap); ctx.stroke();
      }
    }
    ctx.restore();
  }
  window.RewardRules = { updateChoices, claimChoice, defaultAmount, outlineColor, segmentCount, amount, type, initialize, advance, label, outline };
})();
