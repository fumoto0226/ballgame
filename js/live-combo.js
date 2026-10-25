// Tracks direct block contacts for each independent flight, separate from damage scores.
(() => {
  class LiveCombo {
    constructor() { this.time = 0; this.flights = new Map(); this.selected = null; this.endedAt = null; }
    key(ballId, wave) { return `${wave}:${ballId}`; }
    hit(ballId, wave) {
      if (!Number.isInteger(ballId)) return;
      const key = this.key(ballId, wave);
      const record = this.flights.get(key) || { key, ballId, wave, count: 0, eligibleAt: null };
      record.count++;
      if (record.count === 8) record.eligibleAt = this.time;
      this.flights.set(key, record);
    }
    update(dt, balls) {
      this.time += dt;
      const active = new Map(balls.filter(b => !b.collecting).map(b => [this.key(b.id, b.wave), b]));
      for (const key of this.flights.keys()) if (!active.has(key)) this.flights.delete(key);
      if (this.selected && !this.flights.has(this.selected)) {
        this.selected = null; this.endedAt = this.time;
      }
      const candidates = [...this.flights.values()].filter(r => r.count >= 8)
        .sort((a, b) => b.count - a.count || (a.key === this.selected ? -1 : b.key === this.selected ? 1 : a.eligibleAt - b.eligibleAt));
      if (this.selected) this.selected = candidates[0]?.key || null;
      else {
        const candidate = candidates.find(r => this.endedAt === null || this.time - Math.max(this.endedAt, r.eligibleAt) >= 2 - 1e-9);
        if (candidate) this.selected = candidate.key;
      }
      const record = this.flights.get(this.selected);
      return record ? { ...record, ball: active.get(record.key) } : null;
    }
  }
  window.LiveCombo = LiveCombo;
})();
