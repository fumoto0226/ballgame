(() => {
  class RewardFeed {
    constructor() { this.items = []; this.time = 0; this.serial = 0; }
    add(kind, amount = 1) {
      if (!(amount > 0)) return;
      this.advance(0);
      const existing = this.items.find(item => item.kind === kind);
      if (existing) {
        existing.amount += amount;
        existing.expiresAt = this.time + 3;
        return;
      }
      // Fill from the bottom; only occupied adjacent slots move upward.
      // Expiring a lower row never pulls a surviving upper row down.
      for (let slot = 0; slot < 3; slot++) {
        const occupant = this.items.find(item => item.slot === slot);
        if (!occupant) break;
        occupant.slot = -slot - 1;
      }
      for (const item of this.items) if (item.slot < 0) item.slot = -item.slot;
      this.items = this.items.filter(item => item.slot < 3);
      this.items.push({ kind, amount, serial: ++this.serial, slot: 0, expiresAt: this.time + 3 });
    }
    advance(dt) {
      this.time += Math.max(0, dt);
      this.items = this.items.filter(item => item.expiresAt > this.time + 1e-9);
      return this.items;
    }
  }
  window.RewardFeed = RewardFeed;
})();
