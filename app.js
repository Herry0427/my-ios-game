const homePage = document.getElementById("homePage");
const weatherPage = document.getElementById("weatherPage");
const footballPage = document.getElementById("footballPage");
const leagueDetailPage = document.getElementById("leagueDetailPage");
const birthdayPage = document.getElementById("birthdayPage");
const locationText = document.getElementById("locationText");
const weatherStatus = document.getElementById("weatherStatus");
const weatherList = document.getElementById("weatherList");
const footballStatus = document.getElementById("footballStatus");
const footballRefreshAllBtn = document.getElementById("footballRefreshAllBtn");
const leagueList = document.getElementById("leagueList");
const leagueDetailTitle = document.getElementById("leagueDetailTitle");
const leagueDetailStatus = document.getElementById("leagueDetailStatus");
const leagueUpcomingList = document.getElementById("leagueUpcomingList");
const leagueFinishedList = document.getElementById("leagueFinishedList");
const birthdayStatus = document.getElementById("birthdayStatus");
const birthdayUpcomingList = document.getElementById("birthdayUpcomingList");
const birthdayPeopleList = document.getElementById("birthdayPeopleList");
const birthdayNameInput = document.getElementById("birthdayNameInput");
const birthdayDateInput = document.getElementById("birthdayDateInput");
const birthdayCalendarType = document.getElementById("birthdayCalendarType");
const birthdayCalendarHint = document.getElementById("birthdayCalendarHint");
const toast = document.getElementById("toast");

const LEAGUES = [
  { key: "worldcup", name: "世界杯", priority: 1 },
  { key: "epl", name: "英超", priority: 2 },
  { key: "laliga", name: "西甲", priority: 3 },
  { key: "bundesliga", name: "德甲", priority: 4 },
  { key: "seriea", name: "意甲", priority: 5 },
  { key: "ligue1", name: "法甲", priority: 6 },
  { key: "ucl", name: "欧冠", priority: 7 }
];

const leagueMap = new Map(LEAGUES.map((x) => [x.key, x]));
let currentLeagueKey = null;
let footballListRequestId = 0;
let leagueDetailRequestId = 0;
let footballBundleLoadPromise = null;
/** @type {'skip'|'ok'|'fail'|null} */
let lastFootballRemoteStatus = null;

const MATCH_LIMIT = 10;
const FOOTBALL_BUNDLE_URL = "./data/football_bundle.json";
/** 本地赛程包与远程包请求超时（毫秒），避免弱网/跨境下 fetch 一直挂起导致页面卡在「正在加载赛程数据」 */
const FOOTBALL_BUNDLE_FETCH_TIMEOUT_MS = 15000;
const FOOTBALL_REMOTE_FETCH_TIMEOUT_MS = 8000;
/** 可选兜底（一般改根目录 config.js 即可）。须 HTTPS。调试：?footballApi= */
const FOOTBALL_REMOTE_BUNDLE_URL = "";
const CACHE_PREFIX = "football_cache_v4_";
const FOOTBALL_WORKER_BASE = String(window.__IOS_GAME_FOOTBALL_WORKER__ || "").replace(/\/+$/, "");
const FOOTBALL_DATA_PREFETCH_GAP_MS = 250;
const FOOTBALL_LIVE_CACHE_KEY = `${CACHE_PREFIX}live_leagues_v1`;
const WEATHER_CACHE_KEY = `${CACHE_PREFIX}weather`;
const BIRTHDAY_CACHE_KEY = `${CACHE_PREFIX}birthday_people`;
const FORCE_REFRESH_ON_THIS_BOOT = new URLSearchParams(location.search).has("refresh");
const BIRTHDAY_WINDOW_DAYS = 60;
let birthdayPeople = [];
let footballRefreshAllRequestId = 0;
const footballLiveLeagueMap = new Map();
let footballLiveCacheMeta = { savedAt: 0 };

const lunarFormatter = new Intl.DateTimeFormat("zh-Hans-u-ca-chinese", {
  month: "long",
  day: "numeric"
});

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

function parseDateInputToNoon(dateText) {
  if (!dateText) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!m) return null;
  const y = Number(m[1]);
  const mm = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mm, d, 12, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function diffDays(target, base) {
  const ms = startOfDay(target).getTime() - startOfDay(base).getTime();
  return Math.round(ms / 86400000);
}

function getLunarMonthDay(date) {
  const parts = lunarFormatter.formatToParts(date);
  const month = (parts.find((p) => p.type === "month")?.value || "").replace(/\s+/g, "");
  const day = (parts.find((p) => p.type === "day")?.value || "").replace(/\s+/g, "");
  return { month, day, text: `${month}${day}` };
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

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getFootballApiLeagueCache(leagueKey) {
  return footballLiveLeagueMap.get(leagueKey) || null;
}

function setFootballApiLeagueCache(leagueKey, data) {
  footballLiveLeagueMap.set(leagueKey, data);
  persistFootballLiveCache();
}

function persistFootballLiveCache() {
  try {
    const leagues = {};
    for (const league of LEAGUES) {
      const grouped = footballLiveLeagueMap.get(league.key);
      if (!grouped) continue;
      leagues[league.key] = {
        upcoming: Array.isArray(grouped.upcoming) ? grouped.upcoming : [],
        finished: Array.isArray(grouped.finished) ? grouped.finished : []
      };
    }
    footballLiveCacheMeta.savedAt = Date.now();
    localStorage.setItem(
      FOOTBALL_LIVE_CACHE_KEY,
      JSON.stringify({
        savedAt: footballLiveCacheMeta.savedAt,
        leagues
      })
    );
  } catch (_err) {
    // ignore
  }
}

function loadFootballLiveCacheFromStorage() {
  try {
    const raw = localStorage.getItem(FOOTBALL_LIVE_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const leagues = parsed?.leagues || {};
    for (const league of LEAGUES) {
      const grouped = leagues[league.key];
      if (!grouped) continue;
      footballLiveLeagueMap.set(league.key, {
        upcoming: Array.isArray(grouped.upcoming) ? grouped.upcoming.map((m) => normalizeBundleMatch(m)) : [],
        finished: Array.isArray(grouped.finished) ? grouped.finished.map((m) => normalizeBundleMatch(m)) : []
      });
    }
    footballLiveCacheMeta.savedAt = Number(parsed?.savedAt || 0);
  } catch (_err) {
    // ignore
  }
}

function footballCacheSavedAtText() {
  if (!footballLiveCacheMeta.savedAt) return "";
  try {
    return new Date(footballLiveCacheMeta.savedAt).toLocaleString();
  } catch (_err) {
    return "";
  }
}

function footballLiveTotalCount() {
  let total = 0;
  for (const league of LEAGUES) {
    const g = footballLiveLeagueMap.get(league.key);
    total += footballGroupedTotal(g);
  }
  return total;
}

async function seedFootballFromLocalBundleIfEmpty() {
  if (footballLiveTotalCount() > 0) return;
  try {
    for (const league of LEAGUES) {
      const grouped = await getLeagueGroupedMatches(league);
      if (footballGroupedTotal(grouped) > 0) {
        footballLiveLeagueMap.set(league.key, grouped);
      }
    }
    if (footballLiveTotalCount() > 0) {
      persistFootballLiveCache();
    }
  } catch (_err) {
    // ignore seed errors, keep empty state if local bundle unavailable
  }
}

function footballGroupedTotal(grouped) {
  return (grouped?.upcoming?.length || 0) + (grouped?.finished?.length || 0);
}

function isMeaningfulFootballGrouped(grouped) {
  return footballGroupedTotal(grouped) > 0;
}

function normalizeFootballDataMatch(m) {
  return normalizeBundleMatch({
    id: String(m.id || ""),
    dateISO: m.utcDate || "",
    home: m.homeTeam?.shortName || m.homeTeam?.name || "主队",
    away: m.awayTeam?.shortName || m.awayTeam?.name || "客队",
    homeScore: m.score?.fullTime?.home ?? "",
    awayScore: m.score?.fullTime?.away ?? "",
    isFinished: m.status === "FINISHED",
    isUpcoming: m.status === "SCHEDULED" || m.status === "TIMED"
  });
}

async function fetchLeagueMatchesFromFootballData(leagueKey) {
  if (!FOOTBALL_WORKER_BASE) {
    throw new Error("缺少 Worker 地址，请在 config.js 设置 __IOS_GAME_FOOTBALL_WORKER__");
  }
  const url = `${FOOTBALL_WORKER_BASE}/league/${encodeURIComponent(leagueKey)}`;

  const res = await fetchWithTimeout(
    url,
    {
      cache: "no-store"
    },
    FOOTBALL_REMOTE_FETCH_TIMEOUT_MS
  );
  if (!res.ok) {
    throw new Error(`Worker 请求失败: ${res.status}`);
  }
  const fromCache = String(res.headers.get("X-Cache-Status") || "").toUpperCase();
  if (fromCache === "HIT") {
    // 仅提示，不打扰
  }
  const payload = await res.json();
  if (!payload || !Array.isArray(payload.upcoming) || !Array.isArray(payload.finished)) {
    throw new Error("Worker 返回数据格式异常");
  }
  return {
    upcoming: payload.upcoming.map((m) => normalizeBundleMatch(m)),
    finished: payload.finished.map((m) => normalizeBundleMatch(m))
  };
}

function renderFootballLeagueCards(summaries) {
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
}

function getFootballSummariesFromCache() {
  return LEAGUES.slice().sort((a, b) => a.priority - b.priority).map((league) => {
    const cached = getFootballApiLeagueCache(league.key);
    return {
      ...league,
      upcomingCount: cached?.upcoming?.length || 0,
      finishedCount: cached?.finished?.length || 0
    };
  });
}

async function prefetchAllLeaguesFromFootballData() {
  const reqId = ++footballRefreshAllRequestId;
  const result = { ok: 0, fail: 0, updated: 0 };
  for (const league of LEAGUES.slice().sort((a, b) => a.priority - b.priority)) {
    if (reqId !== footballRefreshAllRequestId) break;
    try {
      const latest = await fetchLeagueMatchesFromFootballData(league.key);
      if (isMeaningfulFootballGrouped(latest)) {
        setFootballApiLeagueCache(league.key, latest);
        result.updated += 1;
      }
      result.ok += 1;
    } catch (_err) {
      result.fail += 1;
    }
    if (reqId !== footballRefreshAllRequestId) break;
    renderFootballLeagueCards(getFootballSummariesFromCache());
    footballStatus.textContent = `刷新中：成功 ${result.ok}，失败 ${result.fail}（正在拉取下一个联赛）`;
    await new Promise((resolve) => setTimeout(resolve, FOOTBALL_DATA_PREFETCH_GAP_MS));
  }
  return result;
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

function loadBirthdayPeople() {
  const data = getCachedJson(BIRTHDAY_CACHE_KEY);
  birthdayPeople = Array.isArray(data) ? data : [];
}

function saveBirthdayPeople() {
  setCachedJson(BIRTHDAY_CACHE_KEY, birthdayPeople);
}

function updateBirthdayHint() {
  const type = birthdayCalendarType.value;
  const dt = parseDateInputToNoon(birthdayDateInput.value);
  if (type === "solar") {
    birthdayCalendarHint.textContent = "国历：按公历日期计算倒计时。";
    return;
  }
  if (!dt) {
    birthdayCalendarHint.textContent = "农历：先选择出生日期，系统自动换算对应农历月日。";
    return;
  }
  const lunar = getLunarMonthDay(dt);
  birthdayCalendarHint.textContent = `农历：将按 ${lunar.text} 计算每年的生日倒计时。`;
}

function computeSolarCountdown(person, now) {
  const birth = parseDateInputToNoon(person.birthDate);
  if (!birth) return null;
  const today = startOfDay(now);
  let target = new Date(today.getFullYear(), birth.getMonth(), birth.getDate(), 12, 0, 0);
  if (startOfDay(target) < today) {
    target = new Date(today.getFullYear() + 1, birth.getMonth(), birth.getDate(), 12, 0, 0);
  }
  const days = diffDays(target, today);
  if (days < 0 || days > BIRTHDAY_WINDOW_DAYS) return null;
  return { targetDate: target, days };
}

function computeLunarCountdown(person, now) {
  if (!person.lunarMonth || !person.lunarDay) return null;
  const today = startOfDay(now);
  for (let i = 0; i <= BIRTHDAY_WINDOW_DAYS; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
    const lunar = getLunarMonthDay(noon);
    if (lunar.month === person.lunarMonth && lunar.day === person.lunarDay) {
      return { targetDate: noon, days: i };
    }
  }
  return null;
}

function getUpcomingBirthdays() {
  const now = new Date();
  const rows = [];
  birthdayPeople.forEach((p) => {
    const countdown = p.calendarType === "lunar"
      ? computeLunarCountdown(p, now)
      : computeSolarCountdown(p, now);
    if (!countdown) return;
    rows.push({
      ...p,
      days: countdown.days,
      targetDate: countdown.targetDate
    });
  });
  rows.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name, "zh-Hans-CN"));
  return rows;
}

function renderBirthdayPeople() {
  birthdayPeopleList.innerHTML = "";
  if (!birthdayPeople.length) {
    birthdayPeopleList.innerHTML = '<div class="status-card">暂无人员，请先添加。</div>';
    return;
  }
  birthdayPeople.forEach((p) => {
    const row = document.createElement("div");
    row.className = "birthday-person-row";
    const typeText = p.calendarType === "lunar" ? `农历 ${p.lunarMonth || ""}${p.lunarDay || ""}` : "国历";
    row.innerHTML = `<div>${p.name} · ${typeText}</div>`;
    const delBtn = document.createElement("button");
    delBtn.className = "danger-btn";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => {
      birthdayPeople = birthdayPeople.filter((x) => x.id !== p.id);
      saveBirthdayPeople();
      renderBirthdayModule();
      showToast("已删除");
    });
    row.appendChild(delBtn);
    birthdayPeopleList.appendChild(row);
  });
}

function renderBirthdayUpcoming() {
  const rows = getUpcomingBirthdays();
  birthdayUpcomingList.innerHTML = "";
  if (!rows.length) {
    birthdayStatus.textContent = `未来${BIRTHDAY_WINDOW_DAYS}天内暂无生日。`;
    birthdayUpcomingList.innerHTML = '<div class="status-card">没有符合条件的生日提醒。</div>';
    return;
  }
  birthdayStatus.textContent = `未来${BIRTHDAY_WINDOW_DAYS}天共有 ${rows.length} 位即将生日。`;
  rows.forEach((r) => {
    const card = document.createElement("article");
    card.className = "birthday-item";
    const typeText = r.calendarType === "lunar"
      ? `农历 ${r.lunarMonth}${r.lunarDay}`
      : "国历";
    const countdownText = r.days === 0 ? "今天生日" : `还有 ${r.days} 天`;
    card.innerHTML = `
      <div class="birthday-item-name">${r.name}</div>
      <div class="birthday-item-meta">${typeText} · 下次生日 ${formatDateTime(r.targetDate.toISOString())}</div>
      <div class="birthday-item-countdown">${countdownText}</div>
    `;
    birthdayUpcomingList.appendChild(card);
  });
}

function renderBirthdayModule() {
  renderBirthdayUpcoming();
  renderBirthdayPeople();
}

function addBirthdayPerson() {
  const name = birthdayNameInput.value.trim();
  const birthDate = birthdayDateInput.value;
  const calendarType = birthdayCalendarType.value;
  if (!name) {
    showToast("请输入姓名");
    return;
  }
  const dt = parseDateInputToNoon(birthDate);
  if (!dt) {
    showToast("请选择正确出生日期");
    return;
  }

  const person = {
    id: crypto.randomUUID(),
    name,
    birthDate,
    calendarType
  };
  if (calendarType === "lunar") {
    const lunar = getLunarMonthDay(dt);
    person.lunarMonth = lunar.month;
    person.lunarDay = lunar.day;
  }
  birthdayPeople.push(person);
  saveBirthdayPeople();
  birthdayNameInput.value = "";
  birthdayDateInput.value = "";
  updateBirthdayHint();
  renderBirthdayModule();
  showToast("生日已保存");
}

function openHome() {
  weatherPage.classList.add("hidden");
  footballPage.classList.add("hidden");
  leagueDetailPage.classList.add("hidden");
  birthdayPage.classList.add("hidden");
  homePage.classList.remove("hidden");
}

function openWeather() {
  homePage.classList.add("hidden");
  footballPage.classList.add("hidden");
  leagueDetailPage.classList.add("hidden");
  birthdayPage.classList.add("hidden");
  weatherPage.classList.remove("hidden");
}

function openFootball() {
  homePage.classList.add("hidden");
  weatherPage.classList.add("hidden");
  leagueDetailPage.classList.add("hidden");
  birthdayPage.classList.add("hidden");
  footballPage.classList.remove("hidden");
}

function openLeagueDetail(leagueKey) {
  currentLeagueKey = leagueKey;
  footballPage.classList.add("hidden");
  birthdayPage.classList.add("hidden");
  leagueDetailPage.classList.remove("hidden");
}

function openBirthday() {
  homePage.classList.add("hidden");
  weatherPage.classList.add("hidden");
  footballPage.classList.add("hidden");
  leagueDetailPage.classList.add("hidden");
  birthdayPage.classList.remove("hidden");
  renderBirthdayModule();
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

function bundleIsSeedOnlyPlaceholder(bundle) {
  const leagues = bundle?.leagues;
  if (!leagues) return false;
  let total = 0;
  let seeds = 0;
  for (const L of LEAGUES) {
    const arr = leagues[L.key]?.matches || [];
    for (const m of arr) {
      total += 1;
      if (String(m?.id || "").startsWith("seed:")) seeds += 1;
    }
  }
  return total > 0 && seeds === total;
}

function normalizeHttpsRemoteUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s, location.href);
    if (u.protocol !== "https:") return "";
    if (!u.hostname) return "";
    return u.toString();
  } catch (_e) {
    return "";
  }
}

function resolveFootballRemoteUrl() {
  const candidates = [
    new URLSearchParams(location.search).get("footballApi"),
    typeof window.__IOS_GAME_FOOTBALL_REMOTE__ === "string" ? window.__IOS_GAME_FOOTBALL_REMOTE__ : "",
    typeof FOOTBALL_REMOTE_BUNDLE_URL === "string" ? FOOTBALL_REMOTE_BUNDLE_URL : ""
  ];
  for (const c of candidates) {
    const ok = normalizeHttpsRemoteUrl(c);
    if (ok) return ok;
  }
  try {
    return normalizeHttpsRemoteUrl(localStorage.getItem("ios_game_football_remote"));
  } catch (_e) {
    return "";
  }
}

function isValidFootballBundlePayload(obj) {
  return Boolean(obj && typeof obj === "object" && obj.leagues && typeof obj.leagues === "object" && !obj.error);
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("请求超时")), timeoutMs);
  });
  try {
    const requestPromise = fetch(url, ctrl ? { ...init, signal: ctrl.signal } : init);
    const res = await Promise.race([requestPromise, timeoutPromise]);
    return res;
  } catch (err) {
    if (ctrl) ctrl.abort();
    throw err;
  }
}

function mergeFootballBundleDeep(base, overlay) {
  const out = { leagues: {}, generatedAt: overlay?.generatedAt || base?.generatedAt };
  for (const L of LEAGUES) {
    const key = L.key;
    const map = new Map();
    for (const m of base?.leagues?.[key]?.matches || []) {
      map.set(String(m.id), { ...m });
    }
    for (const m of overlay?.leagues?.[key]?.matches || []) {
      const id = String(m.id);
      map.set(id, { ...(map.get(id) || {}), ...m });
    }
    const arr = [...map.values()].sort((a, b) => (a.dateISO || "").localeCompare(b.dateISO || ""));
    out.leagues[key] = { matches: arr };
  }
  return out;
}

async function loadFootballBundleOnce() {
  if (footballBundleLoadPromise) return footballBundleLoadPromise;
  footballBundleLoadPromise = (async () => {
    lastFootballRemoteStatus = "skip";
    let base = { leagues: {} };
    try {
      const res = await fetchWithTimeout(
        FOOTBALL_BUNDLE_URL,
        { cache: FORCE_REFRESH_ON_THIS_BOOT ? "no-store" : "default" },
        FOOTBALL_BUNDLE_FETCH_TIMEOUT_MS
      );
      if (res.ok) base = await res.json();
    } catch (_err) {
      base = { leagues: {} };
    }

    const remoteUrl = resolveFootballRemoteUrl();
    if (remoteUrl) {
      try {
        const r2 = await fetchWithTimeout(remoteUrl, { mode: "cors", cache: "no-store" }, FOOTBALL_REMOTE_FETCH_TIMEOUT_MS);
        if (r2.ok) {
          const live = await r2.json();
          if (isValidFootballBundlePayload(live)) {
            base = mergeFootballBundleDeep(base, live);
            lastFootballRemoteStatus = "ok";
          } else {
            lastFootballRemoteStatus = "fail";
          }
        } else {
          lastFootballRemoteStatus = "fail";
        }
      } catch (_err) {
        lastFootballRemoteStatus = "fail";
      }
    }

    return base;
  })();
  return footballBundleLoadPromise;
}

function nzFootballStr(preferred, fallback) {
  const p = preferred != null ? String(preferred).trim() : "";
  if (p !== "") return p;
  return fallback != null ? String(fallback).trim() : "";
}

function normalizeBundleMatch(m) {
  const dateISO = m.dateISO || "";
  const matchTime = parseMatchDate(dateISO);
  let isFinished = Boolean(m.isFinished);
  const hs = m.homeScore != null ? String(m.homeScore).trim() : "";
  const gs = m.awayScore != null ? String(m.awayScore).trim() : "";
  if (/^\d+$/.test(hs) && /^\d+$/.test(gs)) isFinished = true;
  const now = new Date();
  let isUpcoming = Boolean(m.isUpcoming);
  if (isFinished) {
    isUpcoming = false;
  } else if (!isUpcoming) {
    isUpcoming = matchTime > now;
  }
  return {
    id: String(m.id || `${m.home || ""}-${m.away || ""}-${dateISO}`),
    dateISO,
    matchTime,
    home: m.home || "主队",
    away: m.away || "客队",
    homeScore: isFinished ? hs : "",
    awayScore: isFinished ? gs : "",
    isFinished,
    isUpcoming
  };
}

function mergeOneFootballMatch(fromBundle, fromSaved) {
  const home = nzFootballStr(fromSaved.home, fromBundle.home) || fromBundle.home;
  const away = nzFootballStr(fromSaved.away, fromBundle.away) || fromBundle.away;
  const dateISO = nzFootballStr(fromSaved.dateISO, fromBundle.dateISO) || fromBundle.dateISO;
  let homeScore = nzFootballStr(fromSaved.homeScore, fromBundle.homeScore);
  let awayScore = nzFootballStr(fromSaved.awayScore, fromBundle.awayScore);
  let isFinished = Boolean(fromSaved.isFinished || fromBundle.isFinished);
  if (/^\d+$/.test(homeScore) && /^\d+$/.test(awayScore)) isFinished = true;
  const isUpcoming = !isFinished && (fromSaved.isUpcoming || fromBundle.isUpcoming || parseMatchDate(dateISO) > new Date());
  return normalizeBundleMatch({
    id: fromBundle.id,
    dateISO,
    home,
    away,
    homeScore,
    awayScore,
    isFinished,
    isUpcoming
  });
}

function mergeFootballMatches(bundleRows, lsRows) {
  const map = new Map();
  for (const raw of bundleRows) {
    const m = normalizeBundleMatch(raw);
    map.set(m.id, m);
  }
  for (const raw of lsRows) {
    const s = normalizeBundleMatch(raw);
    const b = map.get(s.id);
    if (!b) {
      map.set(s.id, s);
    } else {
      map.set(s.id, mergeOneFootballMatch(b, s));
    }
  }
  return [...map.values()];
}

function splitAndLimitMatches(matches) {
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

function countGroupedMatches(grouped) {
  return (grouped?.upcoming?.length || 0) + (grouped?.finished?.length || 0);
}

async function getLeagueGroupedMatches(league) {
  const bundle = await loadFootballBundleOnce();
  const bundleMatches = bundle.leagues?.[league.key]?.matches || [];
  const prev = getLeagueCache(league.key);
  const normalizedBundleMatches = bundleMatches.map((m) => normalizeBundleMatch(m));
  const latestGrouped = splitAndLimitMatches(normalizedBundleMatches);
  const latestCount = countGroupedMatches(latestGrouped);
  const cachedCount = countGroupedMatches(prev);

  // 规则：每次先拉最新；仅当“最新数量 > 缓存数量”时覆盖缓存，否则沿用缓存。
  if (latestCount > cachedCount) {
    setLeagueCache(league.key, latestGrouped);
    return latestGrouped;
  }
  if (prev) return prev;
  setLeagueCache(league.key, latestGrouped);
  return latestGrouped;
}

async function loadFootballLeagueList() {
  const reqId = ++footballListRequestId;
  leagueList.innerHTML = "";
  await seedFootballFromLocalBundleIfEmpty();
  const cacheText = footballCacheSavedAtText();
  footballStatus.textContent = cacheText
    ? `已加载本地缓存（更新时间：${cacheText}），点击上方“刷新全部联赛”获取最新数据。`
    : "点击上方“刷新全部联赛”开始请求实时数据。";
  try {
    const cachedSummaries = getFootballSummariesFromCache();
    if (reqId !== footballListRequestId) return;
    renderFootballLeagueCards(cachedSummaries);
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
  leagueDetailStatus.textContent = "正在拉取 football-data.org...";

  try {
    let grouped = getFootballApiLeagueCache(league.key);
    if (!grouped) {
      grouped = await fetchLeagueMatchesFromFootballData(league.key);
      setFootballApiLeagueCache(league.key, grouped);
    }
    if (reqId !== leagueDetailRequestId) return;
    renderLeagueMatches(grouped.upcoming, grouped.finished);
    leagueDetailStatus.textContent = `football-data.org（未开赛 ${grouped.upcoming.length}，已完赛 ${grouped.finished.length}）`;
  } catch (err) {
    leagueDetailStatus.textContent = "读取赛事详情失败。";
    showToast(err.message || "读取赛事详情失败");
  }
}

async function refreshAllFootballLeagues() {
  footballRefreshAllBtn.disabled = true;
  footballStatus.textContent = "开始依次请求全部联赛...";
  const beforeSummaries = getFootballSummariesFromCache();
  try {
    const syncResult = await prefetchAllLeaguesFromFootballData();
    renderFootballLeagueCards(getFootballSummariesFromCache());
    const cacheText = footballCacheSavedAtText();
    footballStatus.textContent = `刷新完成：成功 ${syncResult.ok}，失败 ${syncResult.fail}，更新 ${syncResult.updated}${cacheText ? `（缓存时间：${cacheText}）` : ""}`;
  } catch (err) {
    renderFootballLeagueCards(beforeSummaries);
    footballStatus.textContent = "刷新失败。";
    showToast(err.message || "刷新失败");
  } finally {
    footballRefreshAllBtn.disabled = false;
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
  if (moduleName === "birthday") {
    openBirthday();
    return;
  }
  showToast("该模块暂未开发");
}

document.querySelectorAll(".module-card").forEach((btn) => {
  btn.addEventListener("click", () => onModuleClick(btn.dataset.module));
});
document.getElementById("backHome").addEventListener("click", openHome);
document.getElementById("backHomeFromFootball").addEventListener("click", openHome);
document.getElementById("backHomeFromBirthday").addEventListener("click", openHome);
document.getElementById("backToFootball").addEventListener("click", () => {
  leagueDetailPage.classList.add("hidden");
  footballPage.classList.remove("hidden");
  loadFootballLeagueList();
});
footballRefreshAllBtn.addEventListener("click", refreshAllFootballLeagues);
document.getElementById("clearCacheReload").addEventListener("click", clearCacheAndReload);
birthdayCalendarType.addEventListener("change", updateBirthdayHint);
birthdayDateInput.addEventListener("change", updateBirthdayHint);
document.getElementById("addBirthdayBtn").addEventListener("click", addBirthdayPerson);

loadBirthdayPeople();
loadFootballLiveCacheFromStorage();
updateBirthdayHint();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => null);
}
