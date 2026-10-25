// One combo is the actual damage dealt by one ball during one flight/volley.
(() => {
  class RunStats {
    constructor() { this.flights = new Map(); this.best = null; this.returned = new Map(); this.wave = 0; }
    startWave(wave, info) {
      // Early launching freezes already returned balls before the next round can upgrade them.
      for (const record of this.returned.values()) if (!record.frozen) {
        record.ball = structuredClone(info(record.ballId)); record.frozen = true;
        this.consider(record);
      }
      this.wave = wave;
    }
    consider(record) {
      if (!this.best || record.combo > this.best.combo ||
        (record.ballId === this.best.ballId && record.wave === this.best.wave))
        this.best = structuredClone(record);
    }
    closeWave(wave, info) {
      for (const [key, record] of this.returned) if (record.wave === wave) {
        if (!record.frozen) record.ball = structuredClone(info(record.ballId));
        this.consider(record); this.returned.delete(key);
      }
    }
    hit(ballId, wave, damage) {
      if (!Number.isInteger(ballId) || damage <= 0) return;
      const key = `${wave}:${ballId}`;
      const flight = this.flights.get(key) || { ballId, wave, combo: 0 };
      flight.combo += damage; this.flights.set(key, flight);
    }
    finish(ballId, wave, spec) {
      const key = `${wave}:${ballId}`, flight = this.flights.get(key);
      if (!flight) return;
      const record = { ...flight, ball: structuredClone(spec), frozen: wave < this.wave };
      this.returned.set(key, record); this.consider(record);
      this.flights.delete(key);
    }
  }
  window.RunStats = RunStats;
})();
