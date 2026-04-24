/**
 * Cloudflare Worker：请求百度搜索页，解析嵌入的 "result":[...] 竞彩卡片，合并为
 * 与 ios_game/data/football_bundle.json 相同结构的 JSON。
 *
 * --- 你需要什么 ---
 * 1) Cloudflare 免费账号 https://dash.cloudflare.com
 * 2) 安装 Wrangler CLI：npm i -g wrangler
 * 3) 登录：wrangler login
 * 4) 在本目录执行：wrangler deploy
 * 5) 部署成功后得到 https://<你的worker>.<子域>.workers.dev/football-bundle.json
 * 6) 在仓库根目录 config.js 里填写：window.__IOS_GAME_FOOTBALL_REMOTE__ = 'https://.../football-bundle.json';
 *    （亦可用 localStorage「ios_game_football_remote」或 app.js 常量 FOOTBALL_REMOTE_BUNDLE_URL）
 *
 * 若百度返回验证页，执行：wrangler secret put BAIDU_COOKIE（粘贴浏览器里百度的 Cookie）
 *
 * CORS：默认对任意 Origin 返回 Access-Control-Allow-Origin: *（仅赛程 JSON，无 Cookie）。
 */

const LEAGUES_SPEC = [
  ["worldcup", "世界杯赛程"],
  ["epl", "英超赛程"],
  ["laliga", "西甲赛程"],
  ["bundesliga", "德甲赛程"],
  ["seriea", "意甲赛程"],
  ["ligue1", "法甲赛程"],
  ["ucl", "欧冠赛程"]
];

const TITLE_FILTERS = {
  worldcup: ["世界杯"],
  epl: ["英超"],
  laliga: ["西甲"],
  bundesliga: ["德甲"],
  seriea: ["意甲"],
  ligue1: ["法甲", "法国甲级"],
  ucl: ["欧冠", "欧洲冠军"]
};

function titleBelongsLeague(leagueKey, title) {
  const tokens = TITLE_FILTERS[leagueKey] || [];
  if (leagueKey === "epl" && title.includes("英冠")) return false;
  return tokens.some((t) => title.includes(t));
}

function inferDatetimeCn(month, day, hour, minute) {
  const today = new Date();
  const y0 = today.getFullYear();
  let bestY = y0;
  let bestDiff = Infinity;
  for (let y = y0 - 1; y <= y0 + 1; y++) {
    const d0 = new Date(y, month - 1, day, 12, 0, 0);
    if (d0.getFullYear() !== y || d0.getMonth() !== month - 1 || d0.getDate() !== day) continue;
    const diff = Math.abs(d0.getTime() - today.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      bestY = y;
    }
  }
  const pad = (n) => String(n).padStart(2, "0");
  return `${bestY}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+08:00`;
}

function findMatchingJsonArrayEnd(html, startBracket) {
  if (html[startBracket] !== "[") return -1;
  let depth = 0;
  let inStr = false;
  let strEsc = false;
  for (let i = startBracket; i < html.length; i++) {
    const c = html[i];
    if (strEsc) {
      strEsc = false;
      continue;
    }
    if (inStr) {
      if (c === "\\") strEsc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractResultArrays(html) {
  const arrays = [];
  let pos = 0;
  while (true) {
    const i = html.indexOf('"result":', pos);
    const esc = html.indexOf('\\"result\\":', pos);
    let idx = -1;
    if (esc >= 0 && (i < 0 || esc < i)) idx = esc + '\\"result\\":'.length;
    else if (i >= 0) idx = i + '"result":'.length;
    else break;
    while (idx < html.length && " \t\r\n".includes(html[idx])) idx++;
    if (idx >= html.length || html[idx] !== "[") {
      pos = Math.max(i, esc) + 1;
      continue;
    }
    const end = findMatchingJsonArrayEnd(html, idx);
    if (end < 0) {
      pos = idx + 1;
      continue;
    }
    try {
      const arr = JSON.parse(html.slice(idx, end + 1));
      if (Array.isArray(arr)) arrays.push(arr);
    } catch {
      /* skip */
    }
    pos = end + 1;
  }
  return arrays;
}

function matchIdFromCard(leagueKey, title, home, away, card) {
  for (const key of ["recordUrl", "statusUrl", "url"]) {
    const u = String(card[key] || "");
    const m = u.match(/matchId=(\d+)/);
    if (m) return `sina:${m[1]}`;
  }
  return null;
}

async function fallbackMatchId(leagueKey, title, home, away) {
  const raw = `${leagueKey}|${title}|${home}|${away}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 18);
  return `sha:${hex}`;
}

function parseTitleDatetimeStatus(title) {
  const m = title.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return { dateISO: null, finished: false, upcomingGuess: false };
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const hh = Number(m[3]);
  const mm = Number(m[4]);
  const dateISO = inferDatetimeCn(mo, d, hh, mm);
  let finished = title.includes("完场") || title.includes("终") || title.includes("已结束");
  let upcomingGuess = title.includes("未开赛") || title.includes("待定");
  if (!finished && !upcomingGuess && /\d+\s*:\s*\d+/.test(title)) finished = true;
  return { dateISO, finished, upcomingGuess: upcomingGuess || !finished };
}

async function cardToMatch(leagueKey, card) {
  const title = String(card.title || "");
  if (!title || !titleBelongsLeague(leagueKey, title)) return null;
  const host = card.host && typeof card.host === "object" ? card.host : {};
  const guest = card.guest && typeof card.guest === "object" ? card.guest : {};
  const home = String(host.name || "").trim();
  const away = String(guest.name || "").trim();
  if (!home || !away) return null;
  let hs = host.score != null ? String(host.score).trim() : "";
  let gs = guest.score != null ? String(guest.score).trim() : "";

  const { dateISO, finished, upcomingGuess } = parseTitleDatetimeStatus(title);
  if (!dateISO) return null;

  const numeric = /^\d+$/.test(hs) && /^\d+$/.test(gs);
  const isFinished = finished || numeric;
  const kick = new Date(dateISO);
  const isUpcoming = !isFinished && (upcomingGuess || kick > new Date());

  let id = matchIdFromCard(leagueKey, title, home, away, card);
  if (!id) id = await fallbackMatchId(leagueKey, title, home, away);

  return {
    league_key: leagueKey,
    id,
    dateISO,
    home,
    away,
    homeScore: isFinished ? hs : numeric ? hs : "",
    awayScore: isFinished ? gs : numeric ? gs : "",
    isFinished: Boolean(isFinished),
    isUpcoming: Boolean(isUpcoming),
    title: title.slice(0, 200)
  };
}

async function fetchBaiduHtml(wd, cookie) {
  const u = `https://www.baidu.com/s?wd=${encodeURIComponent(wd)}&ie=utf-8`;
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(u, { headers, redirect: "follow" });
  return await res.text();
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

async function buildBundle(env) {
  const merged = new Map();
  const cookie = (env.BAIDU_COOKIE || "").trim();

  for (const [leagueKey, wd] of LEAGUES_SPEC) {
    let html = "";
    try {
      html = await fetchBaiduHtml(wd, cookie);
    } catch {
      continue;
    }
    if (html.includes("百度安全验证") || (html.includes("安全验证") && html.length < 8000)) {
      continue;
    }
    for (const arr of extractResultArrays(html)) {
      for (const card of arr) {
        if (!card || typeof card !== "object") continue;
        const m = await cardToMatch(leagueKey, card);
        if (!m) continue;
        merged.set(`${m.league_key}\t${m.id}`, m);
      }
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  const leaguesOut = {};
  for (const [key] of LEAGUES_SPEC) leaguesOut[key] = { matches: [] };

  for (const m of merged.values()) {
    const lk = m.league_key;
    if (!leaguesOut[lk]) continue;
    const { league_key, title, ...rest } = m;
    leaguesOut[lk].matches.push(rest);
  }
  for (const [lk] of LEAGUES_SPEC) {
    leaguesOut[lk].matches.sort((a, b) => (a.dateISO || "").localeCompare(b.dateISO || ""));
  }

  const now = new Date().toISOString();
  return {
    generatedAt: now,
    source: "cloudflare_worker_baidu_embed",
    leagues: leaguesOut
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders() });
    }

    if (url.pathname !== "/football-bundle.json" && url.pathname !== "/") {
      return new Response("GET /football-bundle.json", { status: 404, headers: corsHeaders() });
    }

    try {
      const payload = await buildBundle(env);
      return new Response(JSON.stringify(payload), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=120",
          ...corsHeaders()
        }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e?.message || e) }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }
  }
};
