const homePage = document.getElementById("homePage");
const weatherPage = document.getElementById("weatherPage");
const footballPage = document.getElementById("footballPage");
const leagueDetailPage = document.getElementById("leagueDetailPage");
const locationText = document.getElementById("locationText");
const weatherStatus = document.getElementById("weatherStatus");
const weatherList = document.getElementById("weatherList");
const footballStatus = document.getElementById("footballStatus");
const leagueList = document.getElementById("leagueList");
const leagueDetailTitle = document.getElementById("leagueDetailTitle");
const leagueDetailStatus = document.getElementById("leagueDetailStatus");
const leagueUpcomingList = document.getElementById("leagueUpcomingList");
const leagueFinishedList = document.getElementById("leagueFinishedList");
const toast = document.getElementById("toast");

const LEAGUES = [
  { key: "worldcup", name: "世界杯", espnCode: "fifa.world", priority: 1 },
  { key: "epl", name: "英超", espnCode: "eng.1", priority: 2 },
  { key: "laliga", name: "西甲", espnCode: "esp.1", priority: 3 },
  { key: "bundesliga", name: "德甲", espnCode: "ger.1", priority: 4 },
  { key: "seriea", name: "意甲", espnCode: "ita.1", priority: 5 },
  { key: "ligue1", name: "法甲", espnCode: "fra.1", priority: 6 },
  { key: "ucl", name: "欧冠", espnCode: "uefa.champions", priority: 7 }
];

const leagueMap = new Map(LEAGUES.map((x) => [x.key, x]));
let currentLeagueKey = null;
let footballListRequestId = 0;
let leagueDetailRequestId = 0;
let footballPrefetchPromise = null;

const MATCH_LIMIT = 10;
const CACHE_PREFIX = "football_cache_v2_";
const WEATHER_CACHE_KEY = `${CACHE_PREFIX}weather`;
const FORCE_REFRESH_ON_THIS_BOOT = new URLSearchParams(location.search).has("refresh");

const weatherCodeMap = {
  0: "晴",
  1: "大部晴朗",
  2: "多云",
  3: "阴",
  45: "有雾",
  48: "霜雾",
  51: "小毛毛雨",
  53: "毛毛雨",
  55: "强毛毛雨",
  56: "冻毛毛雨",
  57: "强冻毛毛雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "冻雨",
  67: "强冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "冰粒",
  80: "小阵雨",
  81: "阵雨",
  82: "强阵雨",
  85: "小阵雪",
  86: "阵雪",
  95: "雷暴",
  96: "雷暴伴小冰雹",
  99: "雷暴伴冰雹"
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 1400);
}

function leagueCacheKey(leagueKey) {
  return `${CACHE_PREFIX}league_${leagueKey}`;
}

function getCachedJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    return payload?.data || null;
  } catch (_err) {
    return null;
  }
}

function setCachedJson(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (_err) {
    // Ignore quota/private mode errors.
  }
}

function getWeatherCache() {
  return getCachedJson(WEATHER_CACHE_KEY);
}

function setWeatherCache(data) {
  setCachedJson(WEATHER_CACHE_KEY, data);
}

function getLeagueCache(leagueKey) {
  return getCachedJson(leagueCacheKey(leagueKey));
}

function setLeagueCache(leagueKey, data) {
  setCachedJson(leagueCacheKey(leagueKey), data);
}

function parseMatchDate(dateStr) {
  const dt = new Date(dateStr || 0);
  return Number.isNaN(dt.getTime()) ? new Date(0) : dt;
}

function formatDate(rawDate) {
  const d = new Date(rawDate);
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getMonth() + 1}/${d.getDate()} ${week[d.getDay()]}`;
}

function formatDateTime(dateISO) {
  if (!dateISO) return "时间未知";
  const d = new Date(dateISO);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${formatDate(d.toISOString())} ${time}`;
}

function renderWeather(daily) {
  weatherList.innerHTML = "";
  for (let i = 0; i < daily.time.length; i++) {
    const code = daily.weathercode[i];
    const item = document.createElement("article");
    item.className = "weather-item";
    item.innerHTML = `
      <div>
        <div class="weather-date">${formatDate(daily.time[i])}</div>
        <div class="weather-desc">${weatherCodeMap[code] || "未知天气"} · 降水概率 ${daily.precipitation_probability_max[i] ?? 0}%</div>
      </div>
      <div class="weather-temp">${Math.round(daily.temperature_2m_max[i])}° / ${Math.round(daily.temperature_2m_min[i])}°</div>
    `;
    weatherList.appendChild(item);
  }
}

function renderLeagueMatches(upcoming, finished) {
  leagueUpcomingList.innerHTML = "";
  leagueFinishedList.innerHTML = "";

  if (!upcoming.length) {
    leagueUpcomingList.innerHTML = '<div class="status-card">暂无未开赛赛程</div>';
  } else {
    upcoming.forEach((m) => {
      const el = document.createElement("article");
      el.className = "wc-item";
      el.innerHTML = `
        <div class="wc-teams">${m.home} vs ${m.away}</div>
        <div class="wc-meta">${formatDateTime(m.dateISO)}</div>
      `;
      leagueUpcomingList.appendChild(el);
    });
  }

  if (!finished.length) {
    leagueFinishedList.innerHTML = '<div class="status-card">暂无已完赛数据</div>';
  } else {
    finished.forEach((m) => {
      const el = document.createElement("article");
      el.className = "wc-item";
      el.innerHTML = `
        <div class="wc-teams">${m.home} vs ${m.away}</div>
        <div class="wc-meta">${formatDateTime(m.dateISO)}</div>
        <div class="wc-score">${m.homeScore} : ${m.awayScore}</div>
      `;
      leagueFinishedList.appendChild(el);
    });
  }
}

function openHome() {
  weatherPage.classList.add("hidden");
  footballPage.classList.add("hidden");
  leagueDetailPage.classList.add("hidden");
  homePage.classList.remove("hidden");
}

function openWeather() {
  homePage.classList.add("hidden");
  footballPage.classList.add("hidden");
  leagueDetailPage.classList.add("hidden");
  weatherPage.classList.remove("hidden");
}

function openFootball() {
  homePage.classList.add("hidden");
  weatherPage.classList.add("hidden");
  leagueDetailPage.classList.add("hidden");
  footballPage.classList.remove("hidden");
}

function openLeagueDetail(leagueKey) {
  currentLeagueKey = leagueKey;
  footballPage.classList.add("hidden");
  leagueDetailPage.classList.remove("hidden");
}

async function clearCacheAndReload() {
  try {
    showToast("正在清除缓存...");
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }

    if ("serviceWorker" in navigator) {
      if (navigator.serviceWorker.controller) {
        const channel = new MessageChannel();
        const responsePromise = new Promise((resolve) => {
          channel.port1.onmessage = () => resolve();
          setTimeout(resolve, 1200);
        });
        navigator.serviceWorker.controller.postMessage({ type: "CLEAR_APP_CACHE" }, [channel.port2]);
        await responsePromise;
      }
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }

    localStorage.clear();
    sessionStorage.clear();
    location.replace(`${location.origin}${location.pathname}?refresh=${Date.now()}`);
  } catch (err) {
    showToast(err.message || "清除缓存失败");
  }
}

async function fetchSevenDayWeather(lat, lon) {
  const api = new URL("https://api.open-meteo.com/v1/forecast");
  api.searchParams.set("latitude", String(lat));
  api.searchParams.set("longitude", String(lon));
  api.searchParams.set("daily", "weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  api.searchParams.set("timezone", "auto");
  api.searchParams.set("forecast_days", "7");
  const res = await fetch(api.toString());
  if (!res.ok) throw new Error(`天气接口请求失败: ${res.status}`);
  return res.json();
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("当前设备不支持定位"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      (error) => reject(error),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 }
    );
  });
}

async function loadWeatherByLocation() {
  const cached = getWeatherCache();
  if (cached) {
    locationText.textContent = cached.locationText || "已加载缓存位置";
    weatherStatus.textContent = `缓存数据：${cached.savedAtText || "未知时间"}`;
    renderWeather(cached.daily);
    return;
  }

  weatherStatus.textContent = "正在获取定位...";
  weatherList.innerHTML = "";
  try {
    const pos = await getCurrentPosition();
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const data = await fetchSevenDayWeather(lat, lon);
    if (!data.daily || !Array.isArray(data.daily.time) || data.daily.time.length === 0) {
      throw new Error("天气数据为空");
    }
    const loc = `当前位置：${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    locationText.textContent = loc;
    weatherStatus.textContent = `已更新：${new Date().toLocaleString()}`;
    renderWeather(data.daily);
    setWeatherCache({
      daily: data.daily,
      locationText: loc,
      savedAtText: new Date().toLocaleString()
    });
  } catch (err) {
    locationText.textContent = "定位失败";
    weatherStatus.textContent = "获取天气失败，请检查定位权限和网络。";
    showToast(err.message || "获取天气失败");
  }
}

function dateRangeParam(daysPast = 180, daysFuture = 240) {
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - daysPast);
  const to = new Date(now);
  to.setDate(now.getDate() + daysFuture);
  const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${fmt(from)}-${fmt(to)}`;
}

async function fetchLeagueFromEspn(league) {
  const url = new URL(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league.espnCode}/scoreboard`);
  url.searchParams.set("dates", dateRangeParam());
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`足球接口请求失败: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.events) ? data.events : [];
}

function normalizeEspnEvent(event) {
  const comp = event?.competitions?.[0];
  const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  const statusType = comp?.status?.type || event?.status?.type || {};
  return {
    id: event?.id || `${home?.team?.displayName || "home"}-${away?.team?.displayName || "away"}-${event?.date || ""}`,
    dateISO: event?.date || "",
    matchTime: parseMatchDate(event?.date),
    home: home?.team?.displayName || "主队",
    away: away?.team?.displayName || "客队",
    homeScore: home?.score ?? "",
    awayScore: away?.score ?? "",
    isFinished: Boolean(statusType.completed) || statusType.state === "post",
    isUpcoming: statusType.state === "pre"
  };
}

function splitAndLimitEspnMatches(matches) {
  const now = new Date();
  const upcoming = [];
  const finished = [];
  matches.forEach((m) => {
    if (m.isFinished) {
      finished.push(m);
      return;
    }
    if (m.isUpcoming || m.matchTime > now) {
      upcoming.push(m);
    }
  });
  upcoming.sort((a, b) => a.matchTime - b.matchTime);
  finished.sort((a, b) => b.matchTime - a.matchTime);
  return {
    upcoming: upcoming.slice(0, MATCH_LIMIT),
    finished: finished.slice(0, MATCH_LIMIT)
  };
}

async function pullLeagueAndCache(league) {
  const events = await fetchLeagueFromEspn(league);
  const map = new Map();
  events.forEach((event) => {
    const match = normalizeEspnEvent(event);
    map.set(match.id, match);
  });
  const grouped = splitAndLimitEspnMatches([...map.values()]);
  const finalData = { ...grouped, source: "espn" };
  setLeagueCache(league.key, finalData);
  return finalData;
}

async function getLeagueGroupedMatches(league) {
  const cached = getLeagueCache(league.key);
  if (cached) return { ...cached, source: "cache" };
  return pullLeagueAndCache(league);
}

async function prefetchFootballCaches() {
  if (!FORCE_REFRESH_ON_THIS_BOOT) return;
  if (footballPrefetchPromise) return footballPrefetchPromise;
  footballPrefetchPromise = (async () => {
    for (const league of LEAGUES) {
      try {
        await pullLeagueAndCache(league);
      } catch (_err) {
        // Keep trying remaining leagues.
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  })();
  return footballPrefetchPromise;
}

async function loadFootballLeagueList() {
  const reqId = ++footballListRequestId;
  leagueList.innerHTML = "";
  footballStatus.textContent = "已加载缓存数据";

  if (FORCE_REFRESH_ON_THIS_BOOT) {
    footballStatus.textContent = "首次拉取数据中...";
    await prefetchFootballCaches();
  }

  try {
    const summaries = [];
    for (const league of LEAGUES) {
      try {
        const grouped = await getLeagueGroupedMatches(league);
        summaries.push({
          ...league,
          upcomingCount: grouped.upcoming.length,
          finishedCount: grouped.finished.length,
          hasData: grouped.upcoming.length + grouped.finished.length > 0
        });
      } catch (_err) {
        summaries.push({ ...league, upcomingCount: 0, finishedCount: 0, hasData: false });
      }
    }
    summaries.sort((a, b) => {
      if (a.key === "worldcup" || b.key === "worldcup") {
        if (a.key === "worldcup" && b.key !== "worldcup") return a.hasData ? -1 : 1;
        if (b.key === "worldcup" && a.key !== "worldcup") return b.hasData ? 1 : -1;
      }
      return a.priority - b.priority;
    });

    if (reqId !== footballListRequestId) return;
    leagueList.innerHTML = "";
    summaries.forEach((league) => {
      const btn = document.createElement("button");
      btn.className = "league-card";
      btn.innerHTML = `
        <div class="league-card-title">${league.name}</div>
        <div class="league-card-meta">未开赛 ${league.upcomingCount} 场 · 已完赛 ${league.finishedCount} 场</div>
      `;
      btn.addEventListener("click", () => {
        openLeagueDetail(league.key);
        loadLeagueDetail();
      });
      leagueList.appendChild(btn);
    });
    footballStatus.textContent = "已加载赛事数据";
  } catch (err) {
    footballStatus.textContent = "读取足球数据失败。";
    showToast(err.message || "读取足球数据失败");
  }
}

async function loadLeagueDetail() {
  const reqId = ++leagueDetailRequestId;
  const league = leagueMap.get(currentLeagueKey);
  if (!league) return;
  leagueDetailTitle.textContent = `${league.name} 赛程`;
  leagueUpcomingList.innerHTML = "";
  leagueFinishedList.innerHTML = "";
  leagueDetailStatus.textContent = "已加载缓存数据";

  try {
    if (FORCE_REFRESH_ON_THIS_BOOT) await prefetchFootballCaches();
    const grouped = await getLeagueGroupedMatches(league);
    if (reqId !== leagueDetailRequestId) return;
    renderLeagueMatches(grouped.upcoming, grouped.finished);
    leagueDetailStatus.textContent = `缓存数据（未开赛 ${grouped.upcoming.length} 场，已完赛 ${grouped.finished.length} 场）`;
  } catch (err) {
    leagueDetailStatus.textContent = "读取赛事详情失败。";
    showToast(err.message || "读取赛事详情失败");
  }
}

function onModuleClick(moduleName) {
  if (moduleName === "weather") {
    openWeather();
    loadWeatherByLocation();
    return;
  }
  if (moduleName === "football") {
    openFootball();
    loadFootballLeagueList();
    return;
  }
  showToast("该模块暂未开发");
}

document.querySelectorAll(".module-card").forEach((btn) => {
  btn.addEventListener("click", () => onModuleClick(btn.dataset.module));
});
document.getElementById("backHome").addEventListener("click", openHome);
document.getElementById("backHomeFromFootball").addEventListener("click", openHome);
document.getElementById("backToFootball").addEventListener("click", () => {
  leagueDetailPage.classList.add("hidden");
  footballPage.classList.remove("hidden");
  loadFootballLeagueList();
});
document.getElementById("clearCacheReload").addEventListener("click", clearCacheAndReload);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => null);
}
