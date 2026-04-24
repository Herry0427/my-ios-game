/**
 * Cloudflare Worker: football-data.org 代理 + 缓存
 * 路由:
 *   GET /league/:leagueKey
 * leagueKey: worldcup|epl|laliga|bundesliga|seriea|ligue1|ucl
 *
 * 部署前设置密钥:
 *   wrangler secret put FOOTBALL_DATA_TOKEN
 */

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";
const MATCH_LIMIT = 10;
const CACHE_TTL_SECONDS = 300;
const LEAGUE_TO_CODE = {
  worldcup: "WC",
  epl: "PL",
  laliga: "PD",
  bundesliga: "BL1",
  seriea: "SA",
  ligue1: "FL1",
  ucl: "CL"
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function normalizeMatch(m) {
  const isFinished = m?.status === "FINISHED";
  return {
    id: String(m?.id || ""),
    dateISO: String(m?.utcDate || ""),
    home: String(m?.homeTeam?.shortName || m?.homeTeam?.name || "主队"),
    away: String(m?.awayTeam?.shortName || m?.awayTeam?.name || "客队"),
    homeScore: isFinished ? String(m?.score?.fullTime?.home ?? "") : "",
    awayScore: isFinished ? String(m?.score?.fullTime?.away ?? "") : "",
    isFinished,
    isUpcoming: !isFinished
  };
}

function splitAndLimit(matches) {
  const now = Date.now();
  const rows = matches.map(normalizeMatch);
  const upcoming = rows
    .filter((m) => !m.isFinished && new Date(m.dateISO).getTime() >= now)
    .sort((a, b) => new Date(a.dateISO).getTime() - new Date(b.dateISO).getTime())
    .slice(0, MATCH_LIMIT);
  const finished = rows
    .filter((m) => m.isFinished)
    .sort((a, b) => new Date(b.dateISO).getTime() - new Date(a.dateISO).getTime())
    .slice(0, MATCH_LIMIT);
  return { upcoming, finished };
}

function dateYmd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchLeagueData(leagueKey, token) {
  const code = LEAGUE_TO_CODE[leagueKey];
  if (!code) {
    throw new Error(`unknown league key: ${leagueKey}`);
  }
  const now = new Date();
  const dateFrom = new Date(now);
  dateFrom.setUTCDate(now.getUTCDate() - 90);
  const dateTo = new Date(now);
  dateTo.setUTCDate(now.getUTCDate() + 150);

  const url = new URL(`${FOOTBALL_DATA_BASE}/competitions/${code}/matches`);
  url.searchParams.set("dateFrom", dateYmd(dateFrom));
  url.searchParams.set("dateTo", dateYmd(dateTo));

  const res = await fetch(url.toString(), {
    headers: { "X-Auth-Token": token }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`football-data status=${res.status} body=${txt.slice(0, 180)}`);
  }
  const payload = await res.json();
  const grouped = splitAndLimit(Array.isArray(payload?.matches) ? payload.matches : []);
  return {
    leagueKey,
    updatedAt: new Date().toISOString(),
    upcoming: grouped.upcoming,
    finished: grouped.finished
  };
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extraHeaders
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "method not allowed" }, 405);
    }

    if (url.pathname === "/" || url.pathname === "/healthz") {
      return jsonResponse({ ok: true, service: "ios-game-football-worker" }, 200);
    }

    const m = url.pathname.match(/^\/league\/([a-z0-9_-]+)$/i);
    if (!m) {
      return jsonResponse({ error: "use GET /league/:leagueKey" }, 404);
    }

    const leagueKey = String(m[1] || "").toLowerCase();
    if (!LEAGUE_TO_CODE[leagueKey]) {
      return jsonResponse({ error: `invalid leagueKey: ${leagueKey}` }, 400);
    }
    const token = String(env.FOOTBALL_DATA_TOKEN || "").trim();
    if (!token) {
      return jsonResponse({ error: "missing FOOTBALL_DATA_TOKEN secret" }, 500);
    }

    const cache = caches.default;
    const cacheKey = new Request(`${url.origin}/cache/league/${leagueKey}`);
    const forceRefresh = url.searchParams.get("refresh") === "1";

    if (!forceRefresh) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const h = new Headers(cached.headers);
        h.set("X-Cache-Status", "HIT");
        return new Response(cached.body, { status: cached.status, headers: h });
      }
    }

    try {
      const body = await fetchLeagueData(leagueKey, token);
      const upstream = jsonResponse(body, 200, {
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
        "X-Cache-Status": "MISS"
      });
      ctx.waitUntil(cache.put(cacheKey, upstream.clone()));
      return upstream;
    } catch (e) {
      return jsonResponse({ error: String(e?.message || e) }, 502, {
        "X-Cache-Status": "ERROR"
      });
    }
  }
};
