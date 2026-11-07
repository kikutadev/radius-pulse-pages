// RADIUS: deterministic, DOM-independent game rules.
// All positions use a radial world where the danger ring has radius 100.
export const CONFIG = Object.freeze({
  maxCharges: 2,
  rechargeSeconds: 1.72,
  pulseSpeed: 175,
  targetRadius: 63,
  targetHalfWidth: 17,
  pulseCost: 1,
  coreRadius: 12,
  dangerRadius: 100,
});

export function createGame({ random = Math.random } = {}) {
  const rand = (a, b) => a + random() * (b - a);
  let state;
  let events = [];
  let nextId = 0;

  function reset() {
    nextId = 0;
    events = [];
    state = {
      phase: "ready", time: 0, score: 0, life: 3, charges: 2,
      recharge: 0, cooldown: 0, round: 0, spawnCountdown: 0.75,
      shards: [], pulses: [], streak: 0, bestChain: 0, totalDestroyed: 0,
      impactFlash: 0, pulseFlash: 0,
    };
    return state;
  }

  function start() {
    reset();
    state.phase = "playing";
    events.push({ type: "start" });
    return state;
  }

  function fire() {
    if (state.phase !== "playing" || state.charges < CONFIG.pulseCost || state.cooldown > 0) return false;
    state.charges -= CONFIG.pulseCost;
    state.cooldown = 0.22;
    const pulse = { id: ++nextId, r: 49, previous: 49, hits: 0, refunded: false };
    // Only shards inside the illuminated intercept band can be struck.
    // An expanding visual ring does not keep killing approaching shards;
    // timing a shot is the entire game.
    const survivors = [];
    for (const shard of state.shards) {
      if (Math.abs(shard.r - CONFIG.targetRadius) <= CONFIG.targetHalfWidth) strike(shard, pulse);
      else survivors.push(shard);
    }
    state.shards = survivors;
    state.pulses.push(pulse);
    state.pulseFlash = 0.15;
    events.push({ type: "fire" });
    if (pulse.hits === 0) {
      state.streak = 0;
      const before = state.shards.some(s => s.r > CONFIG.targetRadius + CONFIG.targetHalfWidth);
      const after = state.shards.some(s => s.r < CONFIG.targetRadius - CONFIG.targetHalfWidth);
      events.push({ type: "blank", reason: before && !after ? "EARLY" : after && !before ? "LATE" : "MISSED" });
    }
    return true;
  }

  function spawnGroup() {
    state.round++;
    const tier = Math.floor(state.time / 24);
    const n = Math.min(6, 2 + (state.round >= 3 ? 1 : 0) + (state.round >= 8 ? 1 : 0) + (tier >= 2 ? 1 : 0));
    const offset = rand(-Math.PI, Math.PI);
    // Mixed radii create a decision: shoot early for safety or late for bigger chain.
    for (let i = 0; i < n; i++) {
      const arc = (Math.PI * 2 / n) * i + rand(-0.24, 0.24);
      const speed = 18.5 + Math.min(22, state.time * 0.29) + rand(-1.8, 3.0);
      const r = 112 + rand(-5, 9) + (state.round > 4 && i % 3 === 0 ? 9 : 0);
      state.shards.push({
        id: ++nextId, angle: offset + arc, r,
        speed, spin: rand(-2, 2), phase: rand(0, Math.PI * 2),
        value: random() < 0.13 ? "gold" : "normal",
      });
    }
    const base = Math.max(1.09, 2.23 - state.time * 0.012);
    state.spawnCountdown += base + rand(-0.16, 0.2);
    events.push({ type: "spawn", round: state.round });
  }

  function strike(shard, pulse) {
    pulse.hits++;
    state.totalDestroyed++;
    const offset = Math.abs(shard.r - CONFIG.targetRadius);
    const risk = offset <= 5 ? 2 : offset <= 11 ? 1.5 : 1;
    const reward = Math.round(100 * risk * (shard.value === "gold" ? 2 : 1));
    state.score += reward;
    events.push({
      type: "hit", angle: shard.angle, r: shard.r, points: reward,
      hitCount: pulse.hits, risk, gold: shard.value === "gold",
    });
    if (pulse.hits === 3 && !pulse.refunded) {
      pulse.refunded = true;
      state.charges = Math.min(CONFIG.maxCharges, state.charges + 1);
      state.recharge = 0;
      state.streak++;
      state.bestChain = Math.max(state.bestChain, state.streak);
      const bonus = 200 * Math.min(state.streak, 8);
      state.score += bonus;
      events.push({ type: "chain", count: 3, streak: state.streak, bonus });
    }
    if (pulse.hits > 3) {
      state.score += 125;
      events.push({ type: "extra", count: pulse.hits });
    }
  }

  function update(rawDt) {
    if (state.phase !== "playing") return;
    const dt = Math.min(0.05, Math.max(0, rawDt));
    state.time += dt;
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.impactFlash = Math.max(0, state.impactFlash - dt);
    state.pulseFlash = Math.max(0, state.pulseFlash - dt);
    if (state.charges < CONFIG.maxCharges) {
      state.recharge += dt;
      if (state.recharge >= CONFIG.rechargeSeconds) {
        state.charges++;
        state.recharge -= CONFIG.rechargeSeconds;
        if (state.charges === CONFIG.maxCharges) state.recharge = 0;
        events.push({ type: "recharge" });
      }
    } else {
      state.recharge = 0;
    }

    state.spawnCountdown -= dt;
    if (state.spawnCountdown <= 0) spawnGroup();

    for (const s of state.shards) s.r -= s.speed * dt;
    for (const p of state.pulses) {
      p.previous = p.r;
      p.r += CONFIG.pulseSpeed * dt;
    }

    const survivors = [];
    for (const shard of state.shards) {
      if (shard.r <= CONFIG.coreRadius) {
        state.life--;
        state.impactFlash = 0.45;
        state.streak = 0;
        events.push({ type: "damage", life: state.life, angle: shard.angle });
        if (state.life <= 0) {
          state.phase = "over";
          events.push({ type: "gameover", score: state.score });
          break;
        }
      } else survivors.push(shard);
    }
    state.shards = survivors;
    state.pulses = state.pulses.filter(p => p.r <= 123);
  }

  function consumeEvents() {
    const pending = events;
    events = [];
    return pending;
  }

  reset();
  return { get state() { return state; }, start, reset, fire, update, consumeEvents };
}
