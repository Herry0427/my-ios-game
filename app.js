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
  { id: "4429", key: "worldcup", name: "世界杯", priority: 1 },
  { id: "4328", key: "epl", name: "英超", priority: 2 },
  { id: "4335", key: "laliga", name: "西甲", priority: 3 },
  { id: "4331", key: "bundesliga", name: "德甲", priority: 4 },
  { id: "4332", key: "seriea", name: "意甲", priority: 5 },
  { id: "4334", key: "ligue1", name: "法甲", priority: 6 },
  { id: "4480", key: "ucl", name: "欧冠", priority: 7 }
];
const leagueMap = new Map(LEAGUES.map((x) => [x.key, x]));
let currentLeagueKey = null;

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
  showToast.timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 1400);
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

function formatDate(rawDate) {
  const d = new Date(rawDate);
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getMonth() + 1}/${d.getDate()} ${week[d.getDay()]}`;
}

function formatDateTime(dateText, timeText) {
  if (!dateText) return "时间未知";
  const cleanTime = (timeText || "00:00:00").slice(0, 5);
  return `${formatDate(dateText)} ${cleanTime}`;
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
  weatherStatus.textContent = "正在获取定位...";
  weatherList.innerHTML = "";
  try {
    const pos = await getCurrentPosition();
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    locationText.textContent = `当前位置：${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    weatherStatus.textContent = "正在获取 7 日天气...";

    const data = await fetchSevenDayWeather(lat, lon);
    if (!data.daily || !Array.isArray(data.daily.time) || data.daily.time.length === 0) {
      throw new Error("天气数据为空");
    }

    weatherStatus.textContent = `已更新：${new Date().toLocaleString()}`;
    renderWeather(data.daily);
  } catch (err) {
    locationText.textContent = "定位失败";
    weatherStatus.textContent = "获取天气失败，请检查定位权限和网络。";
    showToast(err.message || "获取天气失败");
  }
}

async function fetchLeagueEvents(endpoint, leagueId) {
  const api = new URL(`https://www.thesportsdb.com/api/v1/json/123/${endpoint}.php`);
  api.searchParams.set("id", String(leagueId));
  const res = await fetch(api.toString());
  if (!res.ok) throw new Error(`赛事接口请求失败: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.events) ? data.events : [];
}

function parseMatchTime(event) {
  if (event.strTimestamp) return new Date(event.strTimestamp);
  if (event.dateEvent) return new Date(`${event.dateEvent}T${event.strTime || "00:00:00"}`);
  return new Date(0);
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
        <div class="wc-meta">${formatDateTime(m.dateEvent, m.strTime)}</div>
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
        <div class="wc-meta">${formatDateTime(m.dateEvent, m.strTime)}</div>
        <div class="wc-score">${m.homeScore} : ${m.awayScore}</div>
      `;
      leagueFinishedList.appendChild(el);
    });
  }
}

async function fetchLeagueGroupedMatches(leagueId) {
  const [upcomingRaw, finishedRaw] = await Promise.all([
    fetchLeagueEvents("eventsnextleague", leagueId),
    fetchLeagueEvents("eventspastleague", leagueId)
  ]);
  const now = new Date();
  const upcoming = [];
  const finished = [];
  upcomingRaw.forEach((e) => {
    const item = {
      home: e.strHomeTeam || "主队",
      away: e.strAwayTeam || "客队",
      dateEvent: e.dateEvent,
      strTime: e.strTime || "",
      homeScore: e.intHomeScore,
      awayScore: e.intAwayScore,
      matchTime: parseMatchTime(e)
    };
    if (item.matchTime > now) upcoming.push(item);
  });
  finishedRaw.forEach((e) => {
    const hs = e.intHomeScore;
    const as = e.intAwayScore;
    const hasScore = hs !== null && hs !== undefined && hs !== "" && as !== null && as !== undefined && as !== "";
    if (!hasScore) return;
    finished.push({
      home: e.strHomeTeam || "主队",
      away: e.strAwayTeam || "客队",
      dateEvent: e.dateEvent,
      strTime: e.strTime || "",
      homeScore: hs,
      awayScore: as,
      matchTime: parseMatchTime(e)
    });
  });
  upcoming.sort((a, b) => a.matchTime - b.matchTime);
  finished.sort((a, b) => b.matchTime - a.matchTime);
  return { upcoming, finished };
}

async function loadFootballLeagueList() {
  footballStatus.textContent = "正在获取赛事列表...";
  leagueList.innerHTML = "";
  try {
    const summaries = await Promise.all(LEAGUES.map(async (league) => {
      try {
        const { upcoming, finished } = await fetchLeagueGroupedMatches(league.id);
        return { ...league, upcomingCount: upcoming.length, finishedCount: finished.length, hasData: (upcoming.length + finished.length) > 0 };
      } catch (_err) {
        return { ...league, upcomingCount: 0, finishedCount: 0, hasData: false };
      }
    }));
    summaries.sort((a, b) => {
      if (a.key === "worldcup" || b.key === "worldcup") {
        if (a.key === "worldcup" && b.key !== "worldcup") return a.hasData ? -1 : 1;
        if (b.key === "worldcup" && a.key !== "worldcup") return b.hasData ? 1 : -1;
      }
      return a.priority - b.priority;
    });
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
    footballStatus.textContent = `已更新：${new Date().toLocaleString()}（共 ${summaries.length} 个赛事）`;
  } catch (err) {
    footballStatus.textContent = "获取足球赛事列表失败，请检查网络。";
    showToast(err.message || "获取足球赛事列表失败");
  }
}

async function loadLeagueDetail() {
  const league = leagueMap.get(currentLeagueKey);
  if (!league) return;
  leagueDetailTitle.textContent = `${league.name} 赛程`;
  leagueDetailStatus.textContent = `正在获取 ${league.name} 数据...`;
  leagueUpcomingList.innerHTML = "";
  leagueFinishedList.innerHTML = "";
  try {
    const { upcoming, finished } = await fetchLeagueGroupedMatches(league.id);
    renderLeagueMatches(upcoming, finished);
    leagueDetailStatus.textContent = `已更新：${new Date().toLocaleString()}（未开赛 ${upcoming.length} 场，已完赛 ${finished.length} 场）`;
  } catch (err) {
    leagueDetailStatus.textContent = `获取${league.name}数据失败，请检查网络。`;
    showToast(err.message || "获取赛事详情失败");
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
});
document.getElementById("refreshWeather").addEventListener("click", loadWeatherByLocation);
document.getElementById("refreshFootballLeagues").addEventListener("click", loadFootballLeagueList);
document.getElementById("refreshLeagueDetail").addEventListener("click", loadLeagueDetail);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => null);
}
