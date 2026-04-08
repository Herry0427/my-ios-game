const SUPABASE_URL = "https://qfplpzosjcvvyhcotodz.supabase.co";
const SUPABASE_KEY = "sb_publishable_CxJNsIAs4JRcaPugv2fn1Q_TAKzFmQB";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const canvas = document.getElementById("farmCanvas");
const ctx = canvas.getContext("2d");
const state = { students: [], selectedId: null, bgmOn: false, moodTick: 0 };

const pages = ["adoptPage", "managePage", "hallPage", "dexPage"].map((id) => document.getElementById(id));
const petPanel = document.getElementById("petPanel");
const toast = document.getElementById("toast");

const notes = { click: [880, 0.05], feed: [660, 0.11], level: [220, 0.35] };
let audioCtx;
let bgmNode;

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
function beep([freq, dur], type = "triangle", gain = 0.07) {
  ensureAudio();
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain;
  o.connect(g).connect(audioCtx.destination);
  o.start();
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  o.stop(audioCtx.currentTime + dur);
}
function playClick() { beep(notes.click, "square", 0.05); }
function playFeed() { beep(notes.feed, "sine", 0.08); }
function playLevelUp() { beep(notes.level, "sawtooth", 0.12); }
function toggleBgm() {
  ensureAudio();
  if (state.bgmOn && bgmNode) {
    bgmNode.stop();
    bgmNode = null;
    state.bgmOn = false;
    showToast("BGM 已关闭");
    return;
  }
  const o = audioCtx.createOscillator();
  const lfo = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  const g = audioCtx.createGain();
  o.type = "sine";
  o.frequency.value = 120;
  lfo.frequency.value = 0.18;
  lfoGain.gain.value = 18;
  lfo.connect(lfoGain).connect(o.frequency);
  g.gain.value = 0.015;
  o.connect(g).connect(audioCtx.destination);
  o.start();
  lfo.start();
  bgmNode = o;
  state.bgmOn = true;
  showToast("BGM 已开启");
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

function nowISO() { return new Date().toISOString(); }
function levelByXp(xp) { return Math.floor((xp || 0) / 100); }
function stageByLevel(level) {
  if (level === 0) return 0;
  if (level <= 4) return 1;
  if (level <= 9) return 2;
  if (level <= 14) return 3;
  return 4;
}
function stageLabel(stage) {
  return ["Mystery Egg", "Baby", "Juvenile", "Adult", "King/Legendary"][stage] || "Unknown";
}
function rand(min, max) { return Math.random() * (max - min) + min; }
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 1300);
}
function hideAllPages() { pages.forEach((p) => p.classList.add("hidden")); }
function openPage(id) { hideAllPages(); document.getElementById(id).classList.remove("hidden"); playClick(); }

function createPet(name) {
  return {
    id: crypto.randomUUID(),
    student_name: name,
    xp: 0,
    level: 0,
    medals: 0,
    stage: 0,
    mood: "🙂",
    x: rand(60, window.innerWidth - 60),
    y: rand(120, window.innerHeight - 60),
    vx: rand(-0.6, 0.6),
    vy: rand(-0.6, 0.6),
    created_at: nowISO(),
    updated_at: nowISO()
  };
}

function petRadius(p) { return 16 + p.stage * 8; }
function drawPet(p) {
  const r = petRadius(p);
  const g = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.4, 3, p.x, p.y, r * 1.4);
  g.addColorStop(0, "#e9fff5");
  g.addColorStop(0.35, "#8af5c6");
  g.addColorStop(1, "#1c5b43");
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.stage >= 4) ctx.filter = "drop-shadow(0 0 10px #ffcc00) drop-shadow(0 0 18px #00ff88)";
  ctx.beginPath();
  if (p.stage === 0) {
    ctx.scale(0.9, 1.2);
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  } else {
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  if (p.stage >= 3) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#b7fff2";
    ctx.beginPath(); ctx.ellipse(p.x - r * 0.95, p.y - 2, r * 0.7, r * 0.35, -0.7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(p.x + r * 0.95, p.y - 2, r * 0.7, r * 0.35, 0.7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  if (p.stage >= 4) {
    const t = performance.now() * 0.004;
    for (let i = 0; i < 4; i++) {
      const a = t + i * 1.57;
      const px = p.x + Math.cos(a) * (r + 8);
      const py = p.y + Math.sin(a) * (r + 8);
      ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? "#ffcc00" : "#00ff88";
      ctx.fill();
    }
  }
  if (Math.random() < 0.005) p.mood = ["😄", "🧠", "✨", "🔥", "🌟"][Math.floor(rand(0, 5))];
  ctx.fillStyle = "rgba(0,0,0,.4)";
  ctx.fillRect(p.x - 16, p.y - petRadius(p) - 28, 34, 18);
  ctx.fillStyle = "#fff";
  ctx.font = "12px sans-serif";
  ctx.fillText(p.mood, p.x - 12, p.y - petRadius(p) - 14);
}

function renderFarmBackground() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0a1f2d");
  bg.addColorStop(0.25, "#0f2d27");
  bg.addColorStop(1, "#17391f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const x = (i * 79 + state.moodTick * 4) % (w + 30);
    const y = (i * 47) % h;
    ctx.fillStyle = "rgba(0,255,136,.04)";
    ctx.beginPath();
    ctx.arc(x, y, 26 + (i % 5) * 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function stepPets() {
  const minX = 18, maxX = window.innerWidth - 18;
  const minY = 92, maxY = window.innerHeight - 18;
  for (const p of state.students) {
    p.x += p.vx;
    p.y += p.vy;
    p.vx += rand(-0.03, 0.03);
    p.vy += rand(-0.03, 0.03);
    const speed = Math.hypot(p.vx, p.vy);
    const limit = 1.2 + p.stage * 0.15;
    if (speed > limit) { p.vx = (p.vx / speed) * limit; p.vy = (p.vy / speed) * limit; }
    if (p.x < minX || p.x > maxX) p.vx *= -1;
    if (p.y < minY || p.y > maxY) p.vy *= -1;
  }
  for (let i = 0; i < state.students.length; i++) {
    for (let j = i + 1; j < state.students.length; j++) {
      const a = state.students[i], b = state.students[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const need = petRadius(a) + petRadius(b);
      if (dist < need) {
        const nx = dx / dist, ny = dy / dist;
        const overlap = (need - dist) * 0.5;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;
        const tvx = a.vx; const tvy = a.vy;
        a.vx = b.vx; a.vy = b.vy; b.vx = tvx; b.vy = tvy;
      }
    }
  }
}

function animate() {
  state.moodTick += 1;
  renderFarmBackground();
  stepPets();
  for (const p of state.students) drawPet(p);
  requestAnimationFrame(animate);
}

function renderManageList() {
  const box = document.getElementById("manageList");
  box.innerHTML = "";
  state.students.forEach((s) => {
    const li = document.createElement("li");
    li.innerHTML = `<b>${s.student_name}</b> | Lv.${s.level} ${stageLabel(s.stage)} | XP ${s.xp} | 勋章 ${s.medals}`;
    box.appendChild(li);
  });
}
function renderHall() {
  const list = document.getElementById("hallList");
  list.innerHTML = "";
  [...state.students]
    .sort((a, b) => (b.level - a.level) || (b.medals - a.medals) || (b.xp - a.xp))
    .forEach((s, i) => {
      const li = document.createElement("li");
      li.textContent = `#${i + 1} ${s.student_name} | Lv.${s.level} | 勋章 ${s.medals} | ${stageLabel(s.stage)}`;
      list.appendChild(li);
    });
}

async function syncUpsert(student) {
  const { error } = await supabaseClient.from("students").upsert(student, { onConflict: "id" });
  if (error) showToast(`云端同步失败: ${error.message}`);
}
async function syncFetch() {
  const { data, error } = await supabaseClient.from("students").select("*").order("created_at", { ascending: true });
  if (error) { showToast("云端读取失败，使用本地状态"); return; }
  if (Array.isArray(data) && data.length) state.students = data.map((d) => ({ ...d }));
}

function adopt(studentName) {
  const name = (studentName || "").trim();
  if (!name) return showToast("请输入学生姓名");
  const pet = createPet(name);
  state.students.push(pet);
  renderManageList(); renderHall();
  document.getElementById("adoptResult").textContent = `已领养：${name} 的神秘蛋`;
  showToast("领养成功（已本地生效）");
  syncUpsert(pet);
}

function openPetPanel(studentId) {
  state.selectedId = studentId;
  const s = state.students.find((x) => x.id === studentId);
  if (!s) return;
  document.getElementById("petTitle").textContent = `${s.student_name} 的 ${stageLabel(s.stage)}`;
  document.getElementById("petStats").textContent = `Lv.${s.level} | XP ${s.xp} | 勋章 ${s.medals}`;
  petPanel.classList.remove("hidden");
}
function mutateXp(addXp, addMedal = 0) {
  const s = state.students.find((x) => x.id === state.selectedId);
  if (!s) return;
  const oldLv = s.level;
  s.xp += addXp;
  s.medals += addMedal;
  s.level = levelByXp(s.xp);
  s.stage = stageByLevel(s.level);
  s.updated_at = nowISO();
  document.getElementById("petStats").textContent = `Lv.${s.level} | XP ${s.xp} | 勋章 ${s.medals}`;
  renderManageList(); renderHall();
  playFeed();
  if (s.level > oldLv) { playLevelUp(); showToast(`${s.student_name} 升级到 Lv.${s.level}`); }
  else showToast("喂食成功（已本地生效）");
  syncUpsert(s);
}

canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  for (let i = state.students.length - 1; i >= 0; i--) {
    const s = state.students[i];
    if (Math.hypot(s.x - x, s.y - y) <= petRadius(s)) { playClick(); openPetPanel(s.id); return; }
  }
});
canvas.addEventListener("touchstart", (ev) => {
  const t = ev.touches[0];
  canvas.dispatchEvent(new MouseEvent("click", { clientX: t.clientX, clientY: t.clientY }));
}, { passive: true });

document.getElementById("openAdopt").onclick = () => openPage("adoptPage");
document.getElementById("openManage").onclick = () => { renderManageList(); openPage("managePage"); };
document.getElementById("openHall").onclick = () => { renderHall(); openPage("hallPage"); };
document.getElementById("openDex").onclick = () => openPage("dexPage");
document.getElementById("toggleBgm").onclick = toggleBgm;
document.querySelectorAll(".back-btn").forEach((btn) => btn.onclick = () => { hideAllPages(); playClick(); });
document.getElementById("adoptNow").onclick = () => adopt(document.getElementById("studentNameInput").value);
document.getElementById("closePetPanel").onclick = () => petPanel.classList.add("hidden");
document.getElementById("feedSnack").onclick = () => mutateXp(20, 0);
document.getElementById("feedTrophy").onclick = () => mutateXp(100, 1);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => null);

(async function boot() {
  await syncFetch();
  renderManageList();
  renderHall();
  animate();
})();
