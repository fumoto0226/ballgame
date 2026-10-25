// Matter.js owns integration, contact impulses, friction and angular motion.
// The loading mechanism alone guides one prepared ball into the vertical outlet.
(() => {
  const { Engine, Bodies, Body, Composite, Events, Sleeping, Vertices } = Matter;
  const WIDTH = 420, HEIGHT = 820, RADIUS = 5, DEFAULT_COUNT = 24;
  const OUTLET = { x: 210, y: 144 };
  const STEP = 1 / 120;
  const CEILING = { y: 150, gapLeft: 194, gapRight: 226 };
  const RAILS = { left: 6, right: WIDTH - 6, top: 96, bottom: 596 };
  const floorY = x => 629 + 26 * ((x - 210) / 210) ** 2 + .006 * (x - 210);

  const abilities = spec => [...new Set([...(spec.abilities || []), ...(['lightning','vitality','explosive'].includes(spec.type) ? [spec.type] : [])])];
  const has = (spec, ability) => abilities(spec).includes(ability);

  function makeBall(id, x, y, stored, spec = {}) {
    const radius = spec.radius || RADIUS;
    // More polygon sides keep small balls round even at shallow contact angles.
    const body = Bodies.polygon(x, y, 24, radius, {
      label: stored ? 'stored-ball' : 'ball',
      // Flight category4 ignores its own category; stored balls retain mutual contacts.
      collisionFilter: { category: stored ? 1 : 4, mask: stored ? -1 : ~4 },
      restitution: stored ? .05 : .76,
      friction: stored ? .12 : .14,
      frictionStatic: stored ? .25 : .28,
      frictionAir: stored ? .012 : .0005,
      slop: .008,
      sleepThreshold: 70,
    });
    body.plugin.ballId = id;
    if (!stored && has(spec, 'vitality')) { body.restitution = 1.35; body.frictionAir = 0; }
    body.plugin.abilities = abilities(spec);
    body.plugin.radius = radius; body.plugin.type = spec.type || 'normal';
    body.plugin.color = spec.color || '#ffffff'; body.plugin.size = spec.size || 'small';
    return body;
  }

  function segment(a, b) {
    return Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2,
      Math.hypot(b.x - a.x, b.y - a.y) + 1, 2, {
        isStatic: true, angle: Math.atan2(b.y - a.y, b.x - a.x),
        friction: .12, frictionStatic: .2, restitution: 0, slop: .008,
      });
  }

  function funnelPoints() {
    const left = [{ x: RAILS.left, y: -10000 }, { x: RAILS.left, y: 80 }, { x: 43, y: 79 }, { x: 185, y: 121 }];
    for (let i = 1; i <= 12; i++) {
      const t = i / 12, u = 1 - t;
      left.push({ x: u * u * 185 + 2 * u * t * 195 + t * t * 195,
        y: u * u * 121 + 2 * u * t * 125 + t * t * 138 });
    }
    return [left, left.map(p => ({ x: WIDTH - p.x, y: p.y }))];
  }

  class BallPhysics {
    constructor(count = DEFAULT_COUNT) {
      this.specs = Array.isArray(count) ? count.map(s => ({ ...s })) : [];
      this.count = Array.isArray(count) ? count.length : count; this.reset();
    }
    ballInfo(id) {
      const info = { radius: 5, type: 'normal', color: '#ffffff', size: 'small', ...this.specs[id] };
      return { ...info, abilities: abilities(info) };
    }

    // Size belongs only to the attacking ball; an exhausted upgrade is discarded.
    // Other abilities retain their existing fallback to an eligible ball.
    applyBuff(preferredId, effect) {
      if (this.upgradeBall(preferredId, effect)) return preferredId;
      if (effect === 'size') return null;
      const eligible = [], plain = [];
      for (let i = 0; i < this.count; i++) {
        if (i === preferredId) continue;
        const info = this.ballInfo(i);
        if (has(info, effect)) continue;
        eligible.push(i);
        if (info.abilities.length === 0) plain.push(i);
      }
      const pool = plain.length ? plain : eligible;
      if (!pool.length) return null;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      return this.upgradeBall(pick, effect) ? pick : null;
    }

    upgradeBall(id, effect) {
      if (!Number.isInteger(id) || id < 0 || id >= this.count) return false;
      const spec = this.ballInfo(id), next = { ...spec, abilities: [...spec.abilities] };
      if (effect === 'size') {
        if (spec.size === 'large') return false;
        next.size = spec.size === 'medium' ? 'large' : 'medium';
        next.radius = next.size === 'large' ? 9 : 7;
      } else {
        if (!['lightning','vitality','explosive'].includes(effect) || has(spec,effect)) return false;
        next.abilities.push(effect);
        next.type = next.abilities[0];
        next.color = { lightning:'#42a5ff', vitality:'#b86aff', explosive:'#ff5656' }[next.type];
      }
      this.specs[id] = next;
      const body = [...this.flying,...this.stored].find(b=>b.plugin.ballId===id);
      if (body) {
        Sleeping.set(body,false);
        Body.scale(body,next.radius/(body.plugin.radius||5),next.radius/(body.plugin.radius||5));
        Object.assign(body.plugin,{ radius:next.radius, size:next.size, type:next.type, color:next.color, abilities:[...next.abilities] });
        if (body.label === 'ball' && has(next,'vitality')) {
          body.restitution=1.35;body.frictionAir=0;
          const length=Math.hypot(body.velocity.x,body.velocity.y)||1;
          const speed=Math.max(length,520/60);
          Body.setVelocity(body,{x:body.velocity.x/length*speed,y:Math.hypot(body.velocity.x,body.velocity.y) ? body.velocity.y/length*speed : speed});
        }
      }
      return true;
    }

    reset() {
      for (const engine of [this.storeEngine, this.fieldEngine]) {
        if (engine) { Events.off(engine); Composite.clear(engine.world, false); Engine.clear(engine); }
      }
      this.storeEngine = Engine.create({ enableSleeping: true, positionIterations: 12, velocityIterations: 10 });
      this.fieldEngine = Engine.create({ enableSleeping: false, positionIterations: 10, velocityIterations: 10 });
      this.storeEngine.gravity.y = .55;
      this.fieldEngine.gravity.y = .42;
      this.stored = []; this.reserve = new Map(); this.storeAreaBudget = .72 * (WIDTH - 2 * RAILS.left) * 140; this.flying = []; this.blockBodies = new Map(); this.bumperBodies = []; this.bumperKey = null; this.bumperArcs = [];
      this.hits = []; this.returns = []; this.hitTimes = new Map(); this.exited = 0;
      this.phase = 'ready'; this.feeder = null; this.ready = null;
      this.wave = 0; this.pending = new Set();
      this.recallAge = 0; this.settleTime = 0; this.time = 0;
      this.stats = { ballContacts: 0, floorContacts: 0, hitsAfterBounce: 0 };
      const walls = [];
      for (const points of funnelPoints()) {
        for (let i = 1; i < points.length; i++) walls.push(segment(points[i - 1], points[i]));
      }
      // Closed magazine gate: the single prepared ball sits below it.
      walls.push(segment({ x: 194, y: 135 }, { x: 226, y: 135 }));
      // Tall side walls retain a deep pile even when it extends above the viewport.
      for (const x of [RAILS.left, RAILS.right]) walls.push(Bodies.rectangle(x, -5000, 2, 10160, { isStatic: true }));
      Composite.add(this.storeEngine.world, walls);

      // One convex collider, avoiding seams that used to catch rolling balls.
      const points = [];
      for (let x = -30; x <= WIDTH + 30; x += 4) points.push({ x, y: floorY(x) });
      points.push({ x: WIDTH + 30, y: HEIGHT + 60 }, { x: -30, y: HEIGHT + 60 });
      const centre = Vertices.centre(points);
      this.floor = Bodies.fromVertices(centre.x, centre.y, [points], {
        isStatic: true, isSensor: true, label: 'floor', restitution: .68,
        friction: .001, frictionStatic: .02, slop: .008,
      }, false, .00001, 0, .00001);
      // Matter normalizes friction/restitution when making a body static; set the material afterwards.
      this.floor.friction = .001;
      this.floor.frictionStatic = .02;
      this.floor.restitution = .68;
      Composite.add(this.fieldEngine.world, this.floor);
      this.rails = [RAILS.left, RAILS.right].map(x => {
        const rail = Bodies.rectangle(x, (RAILS.top + RAILS.bottom) / 2, 2,
          RAILS.bottom - RAILS.top, { isStatic: true, label: 'rail', slop: .008 });
        rail.restitution = .86;
        rail.friction = .01;
        return rail;
      });
      Composite.add(this.fieldEngine.world, this.rails);
      this.ceiling = Bodies.rectangle(WIDTH / 2, CEILING.y, RAILS.right - RAILS.left, 2,
        { isStatic: true, label: 'ceiling', collisionFilter: { category: 2 }, slop: .008 });
      this.ceiling.restitution = .86;
      this.ceiling.friction = .01;
      Composite.add(this.fieldEngine.world, this.ceiling);
      Events.on(this.fieldEngine, 'collisionStart', event => this.contacts(event.pairs));
      this.fillStore();
      // Simulate the initial drop before showing the first frame; there are no slot coordinates.
      for (let i = 0; i < 600; i++) Engine.update(this.storeEngine, STEP * 1000);
      const first = this.takeStored();
      this.ready = first ? { id: first.plugin.ballId, lastShot: 0, ...OUTLET } : null;
      for (let i = 0; i < 120; i++) Engine.update(this.storeEngine, STEP * 1000);
    }

    fillStore() {
      // Seeded scatter starts above the viewport; the visible pile is entirely simulated.
      let seed = 2181;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const positions = [];
      let area = 0;
      for (let id = 0; id < this.count; id++) {
        const ballArea = Math.PI * this.ballInfo(id).radius ** 2;
        if (area + ballArea > this.storeAreaBudget) { this.reserve.set(id, 0); continue; }
        area += ballArea;
        let point;
        if (this.count > 24) point = { x: 30 + (id % 18) * 20, y: -20 - Math.floor(id / 18) * 20 };
        else if (this.specs.length) point = { x: 160 + (id % 6) * 20, y: -20 - Math.floor(id / 6) * 20 };
        else do { point = { x: 170 + random() * 80, y: -18 - random() * 95 }; }
        while (positions.some(p => Math.hypot(p.x - point.x, p.y - point.y) < 11));
        positions.push(point);
        const body = makeBall(id, point.x, point.y, true, this.ballInfo(id));
        this.stored.push(body);
        Composite.add(this.storeEngine.world, body);
      }
    }

    get storeArea() {
      // The prepared/feeding ball is outside the hopper, so it consumes no pile area.
      return this.stored.reduce((sum, b) => sum + Math.PI * (b.plugin.radius || 5) ** 2, 0);
    }
    hasStoreSpace(id) { return this.storeArea + Math.PI * this.ballInfo(id).radius ** 2 <= this.storeAreaBudget; }

    reserveEntry(eligibleOnly = false) {
      for (const entry of this.reserve) if (!eligibleOnly || this.pending.has(entry[0])) return entry;
      return null;
    }

    takeStored(eligibleOnly = false) {
      this.stored.sort((a, b) => b.position.y - a.position.y);
      const index = eligibleOnly ? this.stored.findIndex(b => this.pending.has(b.plugin.ballId)) : 0;
      if (index < 0 || !this.stored.length) {
        const entry = this.reserveEntry(eligibleOnly);
        if (!entry) return null;
        const [id, lastShot] = entry; this.reserve.delete(id);
        const body = makeBall(id, OUTLET.x, 135, true, this.ballInfo(id));
        body.plugin.lastShot = lastShot; return body;
      }
      const [body] = this.stored.splice(index, 1);
      Composite.remove(this.storeEngine.world, body);
      for (const other of this.stored) Sleeping.set(other, false);
      return body;
    }

    start() {
      if (!this.canStart) return false;
      this.wave++;
      this.pending = new Set(Array.from({ length: this.count }, (_, id) => id));
      this.phase = 'shooting'; this.exited = 0;
      this.stats = { ballContacts: 0, floorContacts: 0, hitsAfterBounce: 0 };
      return true;
    }

    emit(prepared) {
      // Keep the launch point exact so the ball doesn't wobble against the outlet funnel.
      // Scatter happens via a wider random sideways kick AFTER it leaves — up to ~±60u/s,
      // which fans the volley over ~15–20px by the time it reaches disk height.
      const body = makeBall(prepared.id, OUTLET.x, OUTLET.y, false, this.ballInfo(prepared.id));
      body.collisionFilter.mask &= ~2;
      body.plugin.floorBounces = 0;
      body.plugin.shot = this.wave;
      body.plugin.lastBlockHit = this.time;
      body.plugin.pendingKickX = (Math.random() - 0.5) * 0.6;
      body.plugin.pendingKickFrames = 4;
      this.pending.delete(prepared.id);
      Body.setVelocity(body, { x: 0, y: (has(body.plugin, 'vitality') ? 520 : 230) / 60 });
      this.flying.push(body);
      Composite.add(this.fieldEngine.world, body);
    }

    applyPendingKick(ball) {
      if (!ball.plugin.pendingKickFrames) return;
      ball.plugin.pendingKickFrames--;
      if (ball.plugin.pendingKickFrames > 0) return;
      Body.setVelocity(ball, { x: ball.velocity.x + ball.plugin.pendingKickX, y: ball.velocity.y });
      ball.plugin.pendingKickX = 0;
    }

    addBalls(amount) {
      const extra = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
      const firstId = this.count;
      this.count += extra;
      const active = this.wave > 0 && this.phase !== 'ready';
      for (let id = firstId; id < this.count; id++) {
        this.returnBall({ plugin: { ballId: id, shot: this.wave } });
        if (active) this.pending.add(id);
      }
      if (active && extra) this.phase = 'shooting';
      return extra;
    }

    contacts(pairs) {
      for (const pair of pairs) {
        const a = pair.bodyA.parent, b = pair.bodyB.parent;
        if (a.label === 'ball' && b.label === 'ball') this.stats.ballContacts++;
        const ball = a.label === 'ball' ? a : b.label === 'ball' ? b : null;
        if (!ball || ball.plugin.collecting) continue;
        const obstacle = ball === a ? b : a;
        if (obstacle.label !== 'block') continue;
        const speed = Math.hypot(ball.velocity.x - obstacle.velocity.x, ball.velocity.y - obstacle.velocity.y) * 60;
        const key = `${ball.id}:${obstacle.id}`;
        // A resting contact is not a new hit on every solver iteration.
        if (speed < 18 || this.time - (this.hitTimes.get(key) ?? -1) < .075) continue;
        this.hitTimes.set(key, this.time);
        ball.plugin.lastBlockHit = this.time;
        const point = pair.collision.supports.find(p => p) || ball.position;
        this.hits.push({ ballId: ball.plugin.ballId, wave: ball.plugin.shot, blockId: obstacle.plugin.blockId,
          ball: this.ballInfo(ball.plugin.ballId), ballX: ball.position.x, ballY: ball.position.y, x: point.x, y: point.y, dx: ball.velocity.x, dy: ball.velocity.y, speed });
        if (ball.plugin.floorBounces) this.stats.hitsAfterBounce++;
      }
    }

    repelVitality(ball) {
      if (!has(ball.plugin, 'vitality') || ball.plugin.collecting) return;
      for (const pair of this.fieldEngine.pairs.list) {
        if (!pair.isActive) continue;
        const a = pair.bodyA.parent, b = pair.bodyB.parent;
        const obstacle = a === ball ? b : b === ball ? a : null;
        if (!obstacle || !['rail','ceiling','disk-bumper','block'].includes(obstacle.label)) continue;
        let { x: nx, y: ny } = pair.collision.normal;
        if (nx * (ball.position.x-obstacle.position.x) + ny * (ball.position.y-obstacle.position.y) < 0) { nx = -nx; ny = -ny; }
        const v = ball.velocity, outward = v.x * nx + v.y * ny;
        const minimum = Math.max(230 / 60, Math.hypot(v.x,v.y) * .6);
        if (outward < minimum) Body.setVelocity(ball, { x: v.x + nx * (minimum-outward), y: v.y + ny * (minimum-outward) });
      }
    }

    resolveFloor(ball, dt) {
      const RADIUS = ball.plugin.radius || 5;
      const p = ball.position;
      if (p.x < -RADIUS || p.x > WIDTH + RADIUS || p.y + RADIUS < floorY(p.x) - 1) {
        ball.plugin.floorContact = false;
        return;
      }
      // Exact circle/curve contact avoids polygon flat spots at low rolling speeds.
      // Newton projection finds the nearest point on the quadratic surface.
      let x = p.x;
      for (let i = 0; i < 5; i++) {
        const slope = 52 * (x - 210) / 44100 + .006;
        const height = floorY(x) - p.y;
        x -= (x - p.x + height * slope) / (1 + slope * slope + height * 52 / 44100);
      }
      const slope = 52 * (x - 210) / 44100 + .006;
      const length = Math.hypot(1, slope);
      const nx = slope / length, ny = -1 / length;
      const tx = 1 / length, ty = slope / length;
      const distance = (p.x - x) * nx + (p.y - floorY(x)) * ny;
      if (distance > RADIUS + .015) { ball.plugin.floorContact = false; return; }
      if (distance < RADIUS) Body.setPosition(ball, {
        x: p.x + nx * (RADIUS - distance), y: p.y + ny * (RADIUS - distance),
      });
      let vx = ball.velocity.x, vy = ball.velocity.y;
      const normalVelocity = vx * nx + vy * ny;
      if (normalVelocity < 0) {
        const bounce = normalVelocity < -70 / 60 ? (has(ball.plugin, 'vitality') ? .85 * .72 ** ball.plugin.floorBounces : .3 * .6 ** ball.plugin.floorBounces) : 0;
        const impulse = -(1 + bounce) * normalVelocity * ball.mass;
        vx += nx * impulse / ball.mass; vy += ny * impulse / ball.mass;
        // Contact friction transfers sliding momentum into rotation, without setting a roll speed.
        const slip = vx * tx + vy * ty - ball.angularVelocity * RADIUS;
        const desired = -slip / (ball.inverseMass + RADIUS * RADIUS * ball.inverseInertia);
        const tangentImpulse = Math.max(-.18 * impulse, Math.min(.18 * impulse, desired));
        vx += tx * tangentImpulse / ball.mass; vy += ty * tangentImpulse / ball.mass;
        Body.setVelocity(ball, { x: vx, y: vy });
        Body.setAngularVelocity(ball, ball.angularVelocity - tangentImpulse * RADIUS * ball.inverseInertia);
        if (!ball.plugin.floorContact && normalVelocity < -1 / 60) {
          ball.plugin.floorBounces++;
          this.stats.floorContacts++;
        }
      }
      ball.plugin.floorContact = true;
      ball.plugin.floorRestTime = (ball.plugin.floorRestTime || 0) + dt;
      // Once a low-energy ball commits to returning, gameplay physics must not hold up the next shot.
      const outgoingNormalSpeed = ball.velocity.x * nx + ball.velocity.y * ny;
      if (outgoingNormalSpeed <= 25 / 60) {
        const tangentSpeed = (ball.velocity.x * tx + ball.velocity.y * ty) * 60;
        const direction = Math.abs(ball.velocity.x * 60) > 30 ? Math.sign(ball.velocity.x)
          : (p.x < WIDTH / 2 ? -1 : 1);
        ball.plugin.collecting = true;
        ball.plugin.collectionDirection = direction;
        ball.plugin.collectionSpeed = tangentSpeed * direction;
        ball.plugin.collectionAge = 0;
        Body.setStatic(ball, true);
        ball.isSensor = true;
        ball.collisionFilter.mask = 0;
        this.advanceCollection(ball, dt);
      }
    }

    advanceCollection(ball, dt) {
      const RADIUS = ball.plugin.radius || 5;
      ball.plugin.collectionAge += dt;
      const direction = ball.plugin.collectionDirection;
      const target = ball.plugin.collectionAge > .9 ? 600 : 420;
      ball.plugin.collectionSpeed = Math.min(target, ball.plugin.collectionSpeed + 1000 * dt);
      const slope = 52 * (ball.position.x - 210) / 44100 + .006;
      const length = Math.hypot(1, slope);
      const distance = ball.plugin.collectionSpeed * dt;
      const x = ball.position.x + direction * distance / length;
      const nextSlope = 52 * (x - 210) / 44100 + .006;
      const y = floorY(x) - RADIUS * Math.hypot(1, nextSlope);
      Body.setPosition(ball, { x, y });
      Body.setAngle(ball, ball.angle + direction * distance / RADIUS);
      Body.setVelocity(ball, { x: direction * ball.plugin.collectionSpeed / length / 60,
        y: nextSlope * direction * ball.plugin.collectionSpeed / length / 60 });
    }

    syncBumpers(values, disk) {
      const key = JSON.stringify([DiskBumpers.normalize(values), disk.x, disk.y, disk.r, disk.angle]);
      if (key === this.bumperKey) return;
      this.bumperKey = key;
      this.bumperDisk = { ...disk };
      this.bumperArcs = DiskBumpers.arcs(values, disk.angle);
      const pieces = [];
      for (const [a, b] of this.bumperArcs) {
        const count = Math.ceil((b - a) / (Math.PI / 180 * 2));
        for (let j = 0; j < count; j++) {
          const start = a + (b - a) * j / count, end = a + (b - a) * (j + 1) / count;
          const mid = (start + end) / 2;
          pieces.push({ x: disk.x + disk.r * Math.sin(mid), y: disk.y - disk.r * Math.cos(mid),
            angle: mid, width: 2 * disk.r * Math.sin((end - start) / 2) + .25 });
        }
      }
      while (this.bumperBodies.length > pieces.length) Composite.remove(this.fieldEngine.world, this.bumperBodies.pop());
      pieces.forEach((p, i) => {
        let body = this.bumperBodies[i];
        if (!body) {
          body = Bodies.rectangle(p.x, p.y, p.width, 2, { isStatic: true, label: 'disk-bumper',
            angle: p.angle, restitution: .95, friction: .015, slop: .008 });
          body.plugin.width = p.width;
          this.bumperBodies.push(body); Composite.add(this.fieldEngine.world, body);
        } else {
          Body.setAngle(body, 0);
          Body.scale(body, p.width / body.plugin.width, 1);
          body.plugin.width = p.width;
          Body.setPosition(body, p); Body.setAngle(body, p.angle);
        }
      });
    }

    kickBumper(ball, nx, ny) {
      const velocity = ball.velocity, normal = velocity.x * nx + velocity.y * ny;
      const minimum = (has(ball.plugin, 'vitality') ? 820 : 650) / 60;
      const outgoing = Math.max(minimum, Math.abs(normal) * 1.15);
      Body.setVelocity(ball, { x: velocity.x + (outgoing - normal) * nx, y: velocity.y + (outgoing - normal) * ny });
      ball.plugin.idleTime = 0;
    }

    resolveBumperSweep(ball, previous) {
      const RADIUS = ball.plugin.radius || 5;
      if (!this.bumperArcs?.length || ball.plugin.collecting) return;
      const d = this.bumperDisk, end = ball.position;
      const sx = previous.x - d.x, sy = previous.y - d.y;
      const dx = end.x - previous.x, dy = end.y - previous.y;
      const inside = Math.hypot(sx, sy) < d.r;
      const radius = d.r + (inside ? -1 : 1) * (RADIUS + 1);
      // Matter can resolve a low-speed contact before a sweep ever crosses the arc.
      // Handle those real contacts too, including stationary balls and grazing impacts.
      const ex = end.x - d.x, ey = end.y - d.y, distance = Math.hypot(ex, ey);
      const contactAngle = (Math.atan2(ex, -ey) + Math.PI * 2) % (Math.PI * 2);
      if (distance > 0 && Math.abs(distance - d.r) <= RADIUS + 1.5 &&
          this.bumperArcs.some(([a, b]) => contactAngle >= a && contactAngle <= b)) {
        const sign = inside ? -1 : 1, nx = ex / distance * sign, ny = ey / distance * sign;
        const outward = ball.velocity.x * nx + ball.velocity.y * ny;
        if (outward < (has(ball.plugin, 'vitality') ? 820 : 650) / 60) {
          Body.setPosition(ball, { x: d.x + ex / distance * radius + nx * .1, y: d.y + ey / distance * radius + ny * .1 });
          this.kickBumper(ball, nx, ny); return;
        }
      }
      const aa = dx * dx + dy * dy;
      if (aa < 1e-12) return;
      const bb = 2 * (sx * dx + sy * dy), cc = sx * sx + sy * sy - radius * radius;
      const discriminant = bb * bb - 4 * aa * cc;
      if (discriminant < 0) return;
      const roots = [(-bb - Math.sqrt(discriminant)) / (2 * aa), (-bb + Math.sqrt(discriminant)) / (2 * aa)];
      for (const t of roots) {
        if (t < 0 || t > 1) continue;
        const x = sx + dx * t, y = sy + dy * t;
        const angle = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2);
        if (!this.bumperArcs.some(([a, b]) => angle >= a && angle <= b)) continue;
        const sign = inside ? -1 : 1, nx = x / radius * sign, ny = y / radius * sign;
        const speed = ball.velocity.x * nx + ball.velocity.y * ny;
        if (speed >= 0) continue;
        Body.setPosition(ball, { x: d.x + x + nx * .03, y: d.y + y + ny * .03 });
        this.kickBumper(ball, nx, ny);
        return;
      }
    }

    // Search the union of every exposed obstacle, never just the brick that appeared.
    // Polar shells choose the nearest usable pocket (within two logical pixels).
    escapeRevealedBlocks(blocks, activated) {
      const geometry = blocks.map(b => ({ ...b, vertices: b.type === 'circle' ? null : BlockGeometry.vertices(b) }));
      const intersects = (x, y, radius, b) => {
        if (Math.abs(x-b.x)>b.r*1.5+radius || Math.abs(y-b.y)>b.r*1.5+radius) return false;
        if (!b.vertices) return Math.hypot(x-b.x,y-b.y)<b.r+radius;
        let inside = false, distance = Infinity;
        const v=b.vertices;
        for(let i=0,j=v.length-1;i<v.length;j=i++) {
          const a=v[j],c=v[i],dx=c.x-a.x,dy=c.y-a.y;
          if ((a.y>y)!==(c.y>y) && x<(c.x-a.x)*(y-a.y)/(c.y-a.y)+a.x) inside=!inside;
          const t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy)));
          distance=Math.min(distance,Math.hypot(x-a.x-t*dx,y-a.y-t*dy));
        }
        return inside || distance<radius;
      };
      const newIds=new Set(activated.map(b=>b.id));
      for(const ball of this.flying) {
        if(ball.plugin.collecting) continue;
        const origin={...ball.position},r=ball.plugin.radius||RADIUS;
        if(!geometry.some(b=>newIds.has(b.id)&&intersects(origin.x,origin.y,r-.5,b))) continue;
        const free=(x,y)=>x>=RAILS.left+r+2&&x<=RAILS.right-r-2&&y>=CEILING.y+r+2&&y<HEIGHT-r &&
          !geometry.some(b=>intersects(x,y,r+1,b)) && !(this.bumperDisk && Math.abs(Math.hypot(x-this.bumperDisk.x,y-this.bumperDisk.y)-this.bumperDisk.r)<r+2 && this.bumperArcs.some(([a,b])=>{const t=(Math.atan2(x-this.bumperDisk.x,this.bumperDisk.y-y)+Math.PI*2)%(Math.PI*2);return t>=a&&t<=b;}));
        let target=null;
        search: for(let distance=2;distance<=WIDTH*2;distance+=2) {
          const count=Math.max(16,Math.ceil(2*Math.PI*distance/2));
          // Sample around the incoming direction first for deterministic tie-breaking.
          const phase=Math.atan2(ball.velocity.y,ball.velocity.x);
          for(let i=0;i<count;i++) {
            const angle=phase+i/count*Math.PI*2,x=origin.x+Math.cos(angle)*distance,y=origin.y+Math.sin(angle)*distance;
            if(free(x,y)){target={x,y};break search;}
          }
        }
        if(!target) continue;
        const distance=Math.hypot(target.x-origin.x,target.y-origin.y);
        const speed=Math.max(has(ball.plugin,'vitality')?650:360,Math.hypot(ball.velocity.x,ball.velocity.y)*60);
        Body.setPosition(ball,target);
        Body.setVelocity(ball,{x:(target.x-origin.x)/distance*speed/60,y:(target.y-origin.y)/distance*speed/60});
        Sleeping.set(ball,false);
        ball.plugin.escapeCount=(ball.plugin.escapeCount||0)+1;
      }
    }

    syncBlocks(blocks, dt = STEP) {
      const activated = blocks.filter(b => !this.blockBodies.has(b.id));
      const ids = new Set(blocks.map(b => b.id));
      for (const [id, body] of this.blockBodies) {
        if (!ids.has(id)) { Composite.remove(this.fieldEngine.world, body); this.blockBodies.delete(id); }
      }
      for (const block of blocks) {
        let body = this.blockBodies.get(block.id);
        if (!body) {
          const options = { isStatic: true, label: 'block', restitution: .88, friction: .035, slop: .008 };
          if (block.type === 'circle') body = Bodies.polygon(block.x, block.y, 40, block.r, options);
          else body = Bodies.fromVertices(block.x, block.y, [BlockGeometry.vertices(block)], options);
          body.friction = .035;
          body.restitution = .88;
          body.plugin.blockId = block.id;
          body.plugin.lastAngle = block.angle;
          this.blockBodies.set(block.id, body);
          Composite.add(this.fieldEngine.world, body);
        } else {
          const vx = (block.x - body.position.x) / dt / 60;
          const vy = (block.y - body.position.y) / dt / 60;
          const delta = block.angle - body.plugin.lastAngle;
          Body.setPosition(body, { x: block.x, y: block.y });
          Body.rotate(body, delta);
          Body.setVelocity(body, { x: vx, y: vy });
          Body.setAngularVelocity(body, delta / dt / 60);
          body.plugin.lastAngle = block.angle;
        }
      }
      if (activated.length) this.escapeRevealedBlocks(blocks, activated);
    }

    returnBall(ball) {
      const id = ball.plugin.ballId;
      // A repeated return event must not create a second copy of the same owned ball.
      if (this.reserve.has(id) || this.ready?.id === id || this.feeder?.id === id ||
          this.stored.some(b => b.plugin.ballId === id)) return;
      this.returns.push({ ballId: id, wave: ball.plugin.shot ?? this.wave });
      if (!this.hasStoreSpace(id)) {
        this.reserve.set(id, ball.plugin.shot ?? this.wave); return;
      }
      this.spawnStored(id, ball.plugin.shot ?? this.wave);
    }

    spawnStored(id, lastShot) {
      const radius = this.ballInfo(id).radius;
      // Natural scatter: pick a few candidate random x's and go with the one that stacks lowest,
      // so new balls don't tower up (which would delay them becoming eligible to feed).
      const minX = this.count > 24 ? 65 : 160;
      const maxX = this.count > 24 ? 355 : 260;
      const stackY = x => {
        const neighbours = this.stored.filter(b => Math.abs(b.position.x - x) < (b.plugin.radius || 5) + radius + 2);
        return neighbours.length
          ? Math.min(...neighbours.map(b => b.position.y - (b.plugin.radius || 5) - radius - .5))
          : -radius + (Math.random() * 6 - 3);
      };
      let best = { x: minX + Math.random() * (maxX - minX), y: 0 };
      best.y = stackY(best.x);
      for (let i = 0; i < 4; i++) {
        const cx = minX + Math.random() * (maxX - minX);
        const cy = stackY(cx);
        if (cy > best.y) best = { x: cx, y: cy };
      }
      let { x, y } = best;
      while (this.stored.some(b => Math.hypot(b.position.x - x, b.position.y - y) < (b.plugin.radius || 5) + radius + 1)) y -= 10 + Math.random() * 4;
      const body = makeBall(id, x, y, true, this.ballInfo(id));
      body.plugin.lastShot = lastShot;
      this.stored.push(body);
      Composite.add(this.storeEngine.world, body);
    }

    recoverInvalidFlights() {
      this.flying = this.flying.filter(ball => {
        const valid = Number.isFinite(ball.position.x) && Number.isFinite(ball.position.y) &&
          Number.isFinite(ball.positionPrev.x) && Number.isFinite(ball.positionPrev.y) &&
          Number.isFinite(ball.velocity.x) && Number.isFinite(ball.velocity.y) &&
          Number.isFinite(ball.angle) && Number.isFinite(ball.angularVelocity);
        if (valid) return true;
        Composite.remove(this.fieldEngine.world, ball);
        if ((ball.plugin.shot ?? this.wave) === this.wave) this.exited++;
        this.returnBall(ball);
        this.stats.recoveredNonFinite = (this.stats.recoveredNonFinite || 0) + 1;
        return false;
      });
    }

    step(dt) {
      this.time += dt;
      // Reserve IDs are real owned balls, but do not create an unbounded rigid-body pile.
      while (this.reserve.size) {
        const entry = this.reserveEntry(this.phase === 'shooting');
        if (!entry || !this.hasStoreSpace(entry[0])) break;
        this.reserve.delete(entry[0]); this.spawnStored(entry[0], entry[1]);
      }
      Engine.update(this.storeEngine, dt * 1000);
      for (const ball of this.stored) {
        const r = ball.plugin.radius || 5;
        // The rounded lip is nearly horizontal: gently carry edge returns toward the slope.
        if (ball.position.y > 35 && (ball.position.x < 60 || ball.position.x > WIDTH - 60)) {
          const direction = ball.position.x < WIDTH / 2 ? 1 : -1;
          Sleeping.set(ball, false);
          const inward = ball.velocity.x * direction;
          if (inward < 45 / 60) Body.setVelocity(ball, {
            x: direction * Math.min(45 / 60, inward + 180 / 60 * dt), y: ball.velocity.y,
          });
        }
        if (ball.position.x < RAILS.left + r + 1 || ball.position.x > RAILS.right - r - 1) {
          Body.setPosition(ball, { x: Math.max(RAILS.left + r + 1, Math.min(RAILS.right - r - 1, ball.position.x)), y: Math.min(ball.position.y, 72 - r) });
          Body.setVelocity(ball, { x: 0, y: 0 });
        }
      }
      if (this.feeder) {
        this.feeder.t += dt / .1;
        if (this.feeder.t >= 1) {
          if (this.phase === 'shooting' && this.pending.has(this.feeder.id)) this.emit(this.feeder);
          else this.ready = { id: this.feeder.id, lastShot: this.feeder.lastShot, ...OUTLET };
          this.feeder = null;
        }
      }
      if (this.phase === 'shooting') {
        // A returned ball may already occupy the nozzle when a reward adds pending balls.
        // Park that already-fired ID so it cannot block the rest of this volley.
        if (this.ready && !this.pending.has(this.ready.id)) {
          this.reserve.set(this.ready.id, this.ready.lastShot || 0); this.ready = null;
        }
        if (this.ready && this.pending.has(this.ready.id)) { this.emit(this.ready); this.ready = null; }
        if (!this.feeder && !this.ready) {
          const body = this.takeStored(true);
          if (body) this.feeder = { id: body.plugin.ballId, lastShot: body.plugin.lastShot || 0,
            x: body.position.x, y: body.position.y, t: 0 };
        }
      }
      // Small fixed substeps prevent a fast ball from traversing a thin shape in one update.
      for (let i = 0; i < 2; i++) {
        this.recoverInvalidFlights();
        const previous = new Map(this.flying.map(ball => [ball, { ...ball.position }]));
        Engine.update(this.fieldEngine, dt * 500);
        this.recoverInvalidFlights();
        for (const ball of this.flying) {
          if (ball.plugin.collecting) { this.advanceCollection(ball, dt / 2); continue; }
          const RADIUS = ball.plugin.radius || 5;
          this.applyPendingKick(ball);
          if (ball.position.y > CEILING.y + RADIUS + 2) ball.collisionFilter.mask |= 2;
          // Even a fresh ball knocked upward inside the outlet cannot escape through its loading exemption.
          if (ball.velocity.y < 0 && ball.position.y < CEILING.y + RADIUS + 1) {
            Body.setPosition(ball, { x: ball.position.x, y: CEILING.y + RADIUS + 1 });
            Body.setVelocity(ball, { x: ball.velocity.x, y: -ball.velocity.y * .86 });
            ball.collisionFilter.mask |= 2;
          }
          this.repelVitality(ball);
          this.resolveBumperSweep(ball, previous.get(ball));
          this.resolveFloor(ball, dt / 2);
          const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
          const maxSpeed = has(ball.plugin, 'vitality') ? 1250 : 700;
          if (speed > maxSpeed / 60) Body.setVelocity(ball, { x: ball.velocity.x * maxSpeed / 60 / speed, y: ball.velocity.y * maxSpeed / 60 / speed });
          // A ball that stops dead eventually gets recalled. 3s silent grace lets rolling balls
          // settle without a visible countdown, then a visible 3·2·1 ticker before removal at 6s.
          const idleSpeedFrame = 15 / 60; // treat < 15 u/s as "stuck"
          if (speed < idleSpeedFrame && ball.position.y > CEILING.y + RADIUS + 30) {
            ball.plugin.idleTime = (ball.plugin.idleTime || 0) + dt / 2;
          } else {
            ball.plugin.idleTime = 0;
          }
        }
        this.flying = this.flying.filter(ball => {
          const p = ball.position, RADIUS = ball.plugin.radius || 5;
          if (p.x < -RADIUS || p.x > WIDTH + RADIUS || p.y < -RADIUS || p.y > HEIGHT + RADIUS) {
            Composite.remove(this.fieldEngine.world, ball);
            if ((ball.plugin.shot ?? this.wave) === this.wave) this.exited++;
            this.returnBall(ball); return false;
          }
          const oldQueuedFlight = this.phase === 'shooting' && this.pending.has(ball.plugin.ballId) &&
            (ball.plugin.shot ?? this.wave) < this.wave;
          const inactiveOldFlight = oldQueuedFlight && this.time - (ball.plugin.lastBlockHit ?? this.time) >= 6;
          if ((ball.plugin.idleTime || 0) >= 6 || inactiveOldFlight) {
            Composite.remove(this.fieldEngine.world, ball);
            if ((ball.plugin.shot ?? this.wave) === this.wave) this.exited++;
            this.returnBall(ball); return false;
          }
          return true;
        });
      }
      if (this.phase === 'shooting' && !this.pending.size) {
        this.phase = 'recalling'; this.recallAge = 0;
        this.pendingStuckTime = 0;
      }
      if (this.phase === 'recalling') {
        this.recallAge += dt;
        if (!this.feeder && !this.ready) {
          const body = this.takeStored();
          if (body) this.feeder = { id: body.plugin.ballId, lastShot: body.plugin.lastShot || 0, ...body.position, t: 0 };
        }
        if (!this.pending.size && !this.flying.length && this.arrivedCount === this.count) this.phase = 'ready';
      }
    }

    get arrivedCount() {
      // Arrival is an ownership state, independent of settling height or visual animation.
      const ids = new Set([...this.reserve.keys(), ...this.stored.map(b => b.plugin.ballId)]);
      if (this.ready) ids.add(this.ready.id);
      if (this.feeder) ids.add(this.feeder.id);
      return ids.size;
    }
    get canStart() {
      return this.count > 0 && this.pending.size === 0 && this.arrivedCount >= Math.ceil(this.count / 2);
    }
    consumeReturns() { const returns = this.returns; this.returns = []; return returns; }
    consumeHits() { const hits = this.hits; this.hits = []; return hits; }
    get queued() { return this.pending.size; }
    get storeBalls() {
      const result = this.stored.map(b => ({ id: b.plugin.ballId, ...this.ballInfo(b.plugin.ballId), ...b.position, angle: b.angle, speed: b.speed * 60 }));
      if (this.ready) result.push({ ...this.ballInfo(this.ready.id), ...this.ready, prepared: true });
      if (this.feeder) {
        const t = Math.min(1, this.feeder.t), eased = t * t * (3 - 2 * t);
        result.push({ id: this.feeder.id, ...this.ballInfo(this.feeder.id), x: this.feeder.x + (OUTLET.x - this.feeder.x) * eased,
          y: this.feeder.y + (OUTLET.y - this.feeder.y) * eased, prepared: true });
      }
      return result;
    }
    get activeBalls() {
      return this.flying.map(b => ({ id: b.plugin.ballId, wave: b.plugin.shot, ...this.ballInfo(b.plugin.ballId), ...b.position, vx: b.velocity.x * 60, vy: b.velocity.y * 60,
        collecting: !!b.plugin.collecting, collectionAge: b.plugin.collectionAge || 0, spin: b.angle, bounces: b.plugin.floorBounces, floorRestTime: b.plugin.floorRestTime || 0,
        idleTime: b.plugin.idleTime || 0 }));
    }
  }
  window.BallPhysics = BallPhysics;
  window.BallPhysics.floorY = floorY;
  window.BallPhysics.rails = RAILS;
  window.BallPhysics.ceiling = CEILING;
  window.BallPhysics.config = { width: WIDTH, height: HEIGHT, radius: RADIUS, count: DEFAULT_COUNT };
})();
