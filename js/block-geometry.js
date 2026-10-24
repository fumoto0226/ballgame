// One visual mass for every shape; collision and overlap tests use these exact outlines.
(() => {
  const AREA = Math.PI * 20 ** 2;
  function radius(type) {
    return type === 'circle' ? 20 : type === 'square' ? Math.sqrt(AREA) / 2 : Math.sqrt(4 * AREA / (3 * Math.sqrt(3)));
  }
  function vertices(b) {
    const n = b.type === 'triangle' ? 3 : 4;
    return Array.from({ length: n }, (_, i) => {
      const angle = b.angle + (n === 3 ? -Math.PI / 2 : Math.PI / 4) + i * Math.PI * 2 / n;
      const r = n === 4 ? b.r * Math.SQRT2 : b.r;
      return { x: b.x + Math.cos(angle) * r, y: b.y + Math.sin(angle) * r };
    });
  }
  function circlePolygon(circle, polygon) {
    const points = vertices(polygon);
    let inside = true;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx * (circle.y - a.y) - dy * (circle.x - a.x) < 0) inside = false;
      const t = Math.max(0, Math.min(1, ((circle.x - a.x) * dx + (circle.y - a.y) * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(circle.x - a.x - t * dx, circle.y - a.y - t * dy) < circle.r) return true;
    }
    return inside;
  }
  function overlaps(a, b) {
    if (a.type === 'circle' && b.type === 'circle') return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r;
    if (a.type === 'circle') return circlePolygon(a, b);
    if (b.type === 'circle') return circlePolygon(b, a);
    const av = vertices(a), bv = vertices(b);
    for (const points of [av, bv]) {
      for (let i = 0; i < points.length; i++) {
        const p = points[i], q = points[(i + 1) % points.length];
        const axis = { x: q.y - p.y, y: p.x - q.x };
        const aa = av.map(v => v.x * axis.x + v.y * axis.y);
        const bb = bv.map(v => v.x * axis.x + v.y * axis.y);
        if (Math.max(...aa) <= Math.min(...bb) || Math.max(...bb) <= Math.min(...aa)) return false;
      }
    }
    return true;
  }
  window.BlockGeometry = { area: AREA, radius, vertices, overlaps };
})();
