// Angles are clockwise from the top. Slot 0 is the reserved ±5° inlet.
(() => {
  const STEP = Math.PI / 18, TAU = Math.PI * 2;  // 36 slots × 10°, slot 0 reserved for top inlet
  const SLOT_COUNT = 36;
  const normalize = values => [...new Set((Array.isArray(values) ? values : [])
    .filter(n => Number.isInteger(n) && n > 0 && n < SLOT_COUNT))].sort((a, b) => a - b);
  function arcs(values, rotation = 0) {
    const result = [];
    for (const i of normalize(values)) {
      const center = ((i * STEP + rotation) % TAU + TAU) % TAU;
      for (const shift of [-TAU, 0, TAU]) {
        const a = Math.max(STEP / 2, center - STEP / 2 + shift);
        const b = Math.min(TAU - STEP / 2, center + STEP / 2 + shift);
        if (b > a + 1e-8) result.push([a, b]);
      }
    }
    return result;
  }
  function draw(ctx, disk, values) {
    ctx.save(); ctx.strokeStyle = '#f1f5f4'; ctx.lineWidth = 2; ctx.lineCap = 'butt';
    for (const [a, b] of arcs(values, disk.angle)) {
      ctx.beginPath(); ctx.arc(disk.x, disk.y, disk.r, a - Math.PI / 2, b - Math.PI / 2); ctx.stroke();
    }
    ctx.restore();
  }
  function chooseFree(values, random = Math.random, rotation = 0) {
    const taken = new Set(normalize(values));
    const free = Array.from({length:SLOT_COUNT-1},(_,i)=>i+1).filter(i=>!taken.has(i) && arcs([i],rotation).reduce((sum,[a,b])=>sum+b-a,0) >= STEP-1e-8);
    return free.length ? free[Math.min(free.length-1,Math.floor(random()*free.length))] : null;
  }
  window.DiskBumpers = { chooseFree, normalize, arcs, draw, step: STEP, slotCount: SLOT_COUNT };
})();
