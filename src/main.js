import { createGame, CONFIG } from "./simulation.mjs";

const game = createGame();
const $ = id => document.getElementById(id);
const canvas = $("view"), ctx = canvas.getContext("2d", { alpha: false });
const arena = $("arena"), overlay = $("overlay"), content = $("overlayContent");
const scoreEl = $("score"), bestEl = $("best"), lifeEl = $("life"), chargesEl = $("charges");
const statusEl = $("statusLine"), waveEl = $("waveCounter"), pulseBtn = $("pulseButton");
const footerEl = $("footerLabel");
const storageKey = "radius-pulse-best-v1";
let best = 0;
try { best = Number(localStorage.getItem(storageKey)) || 0; } catch { /* private browser */ }
let width = 1, height = 1, dpr = 1, scale = 1, cx = 0, cy = 0;
let lastFrame = 0, clock = 0, hotUntil = 0, shake = 0, lastScore = -1;
let sparks = [], labels = [], idlePulse = 0;
const stars = Array.from({ length: 90 }, (_, i) => ({
  x: (Math.sin(i * 47.2 + 4) * 43758.5 % 1 + 1) % 1,
  y: (Math.sin(i * 68.41 + 2) * 12764.2 % 1 + 1) % 1,
  alpha: 0.12 + ((i * 7) % 11) * .019,
  size: i % 9 === 0 ? 1.3 : .65,
}));

function fit() {
  const box = arena.getBoundingClientRect();
  width = Math.max(1, box.width);
  height = Math.max(1, box.height);
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  scale = Math.min(width / 252, height / 270);
  cx = width / 2;
  cy = height * 0.51;
}
new ResizeObserver(fit).observe(arena);
window.addEventListener("resize", fit, { passive: true });
fit();

const pad = n => String(Math.floor(n)).padStart(6, "0");
bestEl.textContent = pad(best);
function setStatus(message, tone = "", duration = 1.15) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-hot", tone === "hot");
  statusEl.classList.toggle("is-danger", tone === "danger");
  hotUntil = clock + duration;
}
function updateHud() {
  const s = game.state;
  if (s.score !== lastScore) { scoreEl.textContent = pad(s.score); lastScore = s.score; }
  bestEl.textContent = pad(best);
  waveEl.textContent = "WAVE " + String(s.round).padStart(2, "0");
  [...lifeEl.children].forEach((el, i) => el.classList.toggle("is-lost", i >= s.life));
  lifeEl.setAttribute("aria-label", "残り耐久" + s.life);
  [...chargesEl.children].forEach((el, i) => {
    const fill = el.firstElementChild;
    const fraction = i < s.charges ? 1 : i === s.charges ? s.recharge / CONFIG.rechargeSeconds : 0;
    fill.style.height = (Math.max(0, Math.min(1, fraction)) * 100) + "%";
    el.classList.toggle("is-full", i < s.charges);
  });
  chargesEl.setAttribute("aria-label", "残りエネルギー" + s.charges + "発");
  pulseBtn.classList.toggle("is-empty", s.charges === 0);
  $("pulseLabel").textContent = s.phase === "playing" && s.charges === 0 ? "WAIT" : "PULSE";
}
function syncBest() {
  const s = game.state;
  if (s.score > best) {
    best = s.score;
    try { localStorage.setItem(storageKey, String(best)); } catch { /* private browser */ }
  }
}
function start() {
  if (document.activeElement?.tagName === "BUTTON") document.activeElement.blur();
  sparks = []; labels = []; shake = 0; lastScore = -1;
  game.start();
  overlay.classList.remove("is-visible");
  footerEl.textContent = "TAP ANYWHERE";
  setStatus("DEFEND THE CORE", "", 1.1);
  updateHud();
}
function showGameOver() {
  syncBest();
  content.innerHTML = [
    '<span class="eyebrow">CORE LOST · GAME OVER</span>',
    '<div class="over-score">' + game.state.score.toLocaleString("ja-JP") + '</div>',
    '<div class="over-best">BEST <em>' + best.toLocaleString("ja-JP") + '</em>　/　WAVE ' + game.state.round + '</div>',
    '<div class="over-actions"><button class="start-button" id="restartButton" type="button">RETRY <span>→</span></button><button class="share-button" id="shareButton" type="button">SHARE</button></div>',
    '<small>画面タップ / SPACE でもリトライ</small>',
  ].join("");
  $("restartButton").addEventListener("click", start);
  $("shareButton").addEventListener("click", share);
  overlay.classList.add("is-visible");
  footerEl.textContent = "TRY AGAIN";
  setStatus("SIGNAL LOST", "danger", 3);
}
async function share() {
  const message = "RADIUS で " + game.state.score.toLocaleString("ja-JP") + " 点！ WAVE " + game.state.round + " に到達。\n" + location.href;
  try {
    if (navigator.share) await navigator.share({ title: "RADIUS", text: message });
    else if (navigator.clipboard) {
      await navigator.clipboard.writeText(message);
      const btn = $("shareButton"); if (btn) btn.textContent = "COPIED!";
    }
  } catch { /* canceled share */ }
}
function trigger() {
  if (game.state.phase !== "playing") { start(); return; }
  if (!game.fire()) {
    if (!game.state.charges) setStatus("RECHARGING", "", .35);
  }
}
arena.addEventListener("pointerdown", e => {
  if (e.target.closest("button")) return;
  if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
  e.preventDefault();
  trigger();
}, { passive: false });
arena.addEventListener("contextmenu", e => e.preventDefault());
arena.addEventListener("dragstart", e => e.preventDefault());
pulseBtn.addEventListener("pointerdown", e => { if (e.pointerType !== "mouse") e.preventDefault(); });
pulseBtn.addEventListener("click", trigger);
$("startButton").addEventListener("click", start);
document.addEventListener("keydown", e => {
  if (!["Space", "Enter"].includes(e.code) || e.repeat) return;
  // Focused buttons already receive a native click on Space/Enter.
  if (e.target?.closest?.("button")) return;
  e.preventDefault();
  trigger();
});
document.addEventListener("visibilitychange", () => { lastFrame = 0; });

function emitBurst(x, y, gold = false, n = 11) {
  const color = gold ? "#e5f9a4" : "#9ff9ee";
  for (let i = 0; i < n; i++) {
    const a = i * 2.399 + clock * 13;
    const velocity = 12 + (i * 19 % 34);
    sparks.push({
      x, y, vx: Math.cos(a) * velocity, vy: Math.sin(a) * velocity,
      age: 0, life: .3 + (i % 5) * .06, color, size: i % 3 === 0 ? 1.8 : 1,
    });
  }
}
function handleEvents() {
  for (const e of game.consumeEvents()) {
    switch (e.type) {
      case "fire": shake = Math.max(shake, .6); break;
      case "hit": {
        const x = Math.cos(e.angle) * e.r, y = Math.sin(e.angle) * e.r;
        emitBurst(x, y, e.gold);
        labels.push({ x, y, text: "+" + e.points, life: .72, age: 0, color: e.risk === 2 ? "#f5f6b3" : "#c8fff8" });
        break;
      }
      case "chain":
        setStatus("SYNC ×3  ·  +" + e.bonus + "  ·  CHARGE +1", "hot", 1.6);
        shake = Math.max(shake, 2.5);
        break;
      case "extra": if (e.count >= 4) setStatus("SYNC ×" + e.count + "  ·  CHARGE +1", "hot", 1.25); break;
      case "damage": shake = 8; setStatus("CORE HIT  ·  " + e.life + " LEFT", "danger", 1.3); break;
      case "gameover": showGameOver(); break;
      case "blank": if (game.state.phase === "playing") setStatus(e.reason, "", .65); break;
    }
  }
  if (labels.length > 30) labels.splice(0, labels.length - 30);
  if (sparks.length > 280) sparks.splice(0, sparks.length - 280);
}
function updateParticles(dt) {
  sparks = sparks.filter(p => {
    p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= Math.pow(.95, dt * 60); p.vy *= Math.pow(.95, dt * 60);
    return p.age < p.life;
  });
  labels = labels.filter(p => { p.age += dt; p.y -= dt * 17; return p.age < p.life; });
}

function drawAmbient() {
  const bg = ctx.createRadialGradient(cx, cy, 5, cx, cy, Math.max(width, height) * .7);
  bg.addColorStop(0, "#12243b");
  bg.addColorStop(.62, "#081628");
  bg.addColorStop(1, "#050b16");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  for (const star of stars) {
    ctx.globalAlpha = star.alpha * (.8 + .2 * Math.sin(clock * .7 + star.x * 20));
    ctx.fillStyle = "#c6ffff";
    ctx.fillRect(star.x * width, star.y * height, star.size, star.size);
  }
  ctx.globalAlpha = 1;
}
function ring(r, color, lineWidth = .6) {
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.stroke();
}
function drawRadar() {
  const t = clock;
  // Restrained rings and bearing ticks make the intercept distances readable.
  ring(25, "#4c84903e");
  ring(46, "#45809a4b");
  ring(80, "#45809a35");
  ctx.save();
  ctx.beginPath(); ctx.arc(0,0,80,0,Math.PI*2);
  ctx.arc(0,0,46,0,Math.PI*2,true);
  ctx.fillStyle="#8dfff309";ctx.fill();
  ctx.restore();
  ctx.shadowColor="#6ee7df";ctx.shadowBlur=7;
  ring(63, "#88eee1c9", 1.1);
  ctx.shadowBlur=0;
  ctx.setLineDash([1.5, 7]); ring(100, "#7cb6bc7d", .8); ctx.setLineDash([]);
  ring(112, "#315a6e2d");
  ctx.strokeStyle = "#8ad0d12a"; ctx.lineWidth = .6;
  ctx.beginPath();ctx.moveTo(-122,0);ctx.lineTo(122,0);ctx.moveTo(0,-122);ctx.lineTo(0,122);ctx.stroke();
  for(let i=0;i<48;i++){
    const a=i*Math.PI/24, major=i%4===0;
    const v=major ? 104 : 107;
    ctx.beginPath();ctx.moveTo(Math.cos(a)*v,Math.sin(a)*v);
    ctx.lineTo(Math.cos(a)*(major?110:109),Math.sin(a)*(major?110:109));
    ctx.strokeStyle=major?"#7cc5c57b":"#56809640";ctx.lineWidth=major?1:.6;ctx.stroke();
  }
  ctx.save();
  ctx.rotate(t * .23);
  const grad = ctx.createRadialGradient(0,0,10,0,0,100);
  grad.addColorStop(0,"#77e4e500");grad.addColorStop(1,"#72dded0e");
  ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,100,-.18,.18);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
  ctx.restore();
  // Tiny luminous readout ticks moving around the perimeter.
  const track = t * .39;
  ctx.fillStyle="#80d8dc";
  ctx.beginPath();ctx.arc(Math.cos(track)*100,Math.sin(track)*100,1.3,0,Math.PI*2);ctx.fill();
}
function drawCore() {
  const s = game.state;
  const pulse = 1 + .05 * Math.sin(clock * 3.4);
  const impact = s.impactFlash / .45;
  const glow = ctx.createRadialGradient(0,0,1,0,0,31);
  glow.addColorStop(0, impact ? "#ff9e846d" : "#8affef65");
  glow.addColorStop(.5,impact?"#ff93722a":"#62d9e71e");glow.addColorStop(1,"#5beadd00");
  ctx.fillStyle=glow;ctx.beginPath();ctx.arc(0,0,31,0,Math.PI*2);ctx.fill();
  ring(18,impact?"#ffb3a0cc":"#72d7d9a1",.85);
  ctx.save();ctx.rotate(clock * .27);
  ctx.strokeStyle=impact?"#ffa18d":"#9ef7e9";ctx.lineWidth=1.5;
  for(let i=0;i<4;i++){
    const a=i*Math.PI/2;
    ctx.beginPath();ctx.arc(0,0,14,a+.18,a+1.04);ctx.stroke();
  }
  ctx.restore();
  ctx.save();ctx.scale(pulse,pulse);ctx.rotate(Math.PI/4+clock*.15);
  ctx.fillStyle=impact?"#ffa28c":"#a9fff0";
  ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=13;
  ctx.fillRect(-5.6,-5.6,11.2,11.2);
  ctx.restore();
  ctx.fillStyle="#09232b";ctx.beginPath();ctx.arc(0,0,2.5,0,Math.PI*2);ctx.fill();
}
function drawShard(s) {
  const x=Math.cos(s.angle)*s.r, y=Math.sin(s.angle)*s.r;
  ctx.save();ctx.translate(x,y);ctx.rotate(s.angle + Math.PI/2);
  const gold=s.value==="gold", color=gold?"#e9f5a3":"#ff9b85";
  const flicker = .8 + .2 * Math.sin(clock * 6 + s.phase);
  ctx.globalAlpha=flicker;
  ctx.strokeStyle=gold?"#cadb8e77":"#d970645e";ctx.lineWidth=.9;
  ctx.beginPath();ctx.moveTo(0,-4);ctx.lineTo(0,-17);ctx.stroke();
  ctx.fillStyle=color;ctx.shadowColor=gold?"#d8eb83":"#ff6d63";ctx.shadowBlur=12;
  ctx.beginPath();ctx.moveTo(0,6);ctx.lineTo(-3.4,-2.8);ctx.lineTo(0,-6);ctx.lineTo(3.4,-2.8);ctx.closePath();ctx.fill();
  ctx.shadowBlur=0;ctx.fillStyle="#1d2630";ctx.fillRect(-.9,-2.5,1.8,3);
  ctx.restore();
}
function drawWave(p) {
  const opacity=Math.min(1,(126-p.r)/22);
  ctx.save();ctx.globalAlpha=Math.max(.05,opacity);
  ctx.shadowColor="#77fff4";ctx.shadowBlur=12;ctx.lineWidth=1.9;
  ring(p.r,"#9efdf1",1.9);
  ctx.shadowBlur=0;
  ring(p.r-4,"#69eee64a",.9);
  ring(p.r+2.6,"#cfffff47",.5);
  ctx.restore();
}
function drawReadyScene(){
  const t=clock;
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3+.26;
    const r=77+9*Math.sin(t*.36+i);
    drawShard({angle:a,r,phase:i,value:i===3?"gold":"normal"});
  }
  const r=(t*54)%123;
  ctx.globalAlpha=.2;ring(r,"#7de8df",1);ctx.globalAlpha=1;
}
function render() {
  ctx.setTransform(dpr,0,0,dpr,0,0);
  drawAmbient();
  ctx.save();
  const j=shake>0 ? shake*(Math.sin(clock*129)*.43) : 0;
  ctx.translate(cx+j,cy+j*.5);
  ctx.scale(scale,scale);
  drawRadar();
  if(game.state.phase==="ready") drawReadyScene();
  else {
    for(const p of game.state.pulses) drawWave(p);
    for(const s of game.state.shards) drawShard(s);
  }
  drawCore();
  for(const p of sparks){
    ctx.globalAlpha=Math.max(0,1-p.age/p.life);
    ctx.fillStyle=p.color;ctx.shadowColor=p.color;ctx.shadowBlur=6;
    ctx.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size);
  }
  ctx.globalAlpha=1;ctx.shadowBlur=0;
  for(const p of labels){
    ctx.globalAlpha=Math.max(0,1-p.age/p.life);
    ctx.font="700 9px 'IBM Plex Mono',monospace";ctx.textAlign="center";
    ctx.fillStyle=p.color;ctx.fillText(p.text,p.x,p.y-9);
  }
  ctx.globalAlpha=1;
  ctx.restore();
  if(game.state.impactFlash>0){
    ctx.fillStyle="rgba(255,65,70,"+(game.state.impactFlash*.18)+")";
    ctx.fillRect(0,0,width,height);
  }
}

function loop(now) {
  const dt=lastFrame ? Math.min(.05,Math.max(0,(now-lastFrame)/1000)) : 0;
  lastFrame=now;
  if(document.hidden){requestAnimationFrame(loop);return;}
  clock+=dt;
  if(game.state.phase==="playing"){
    game.update(dt);
    handleEvents();
    syncBest();
  }
  updateParticles(dt);
  shake=Math.max(0,shake-dt*15);
  if(clock>hotUntil && game.state.phase==="playing" && statusEl.textContent!=="HIT THE RING"){
    statusEl.textContent="HIT THE RING";
    statusEl.className="status-line";
  }
  updateHud();
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__radius = { game, start, trigger }; // Read-only QA access to gameplay state.
