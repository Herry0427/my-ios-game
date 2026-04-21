const homePage = document.getElementById("homePage");
const weatherPage = document.getElementById("weatherPage");
const locationText = document.getElementById("locationText");
const weatherStatus = document.getElementById("weatherStatus");
const weatherList = document.getElementById("weatherList");
const toast = document.getElementById("toast");

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
  homePage.classList.remove("hidden");
}

function openWeather() {
  homePage.classList.add("hidden");
  weatherPage.classList.remove("hidden");
}

function formatDate(rawDate) {
  const d = new Date(rawDate);
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getMonth() + 1}/${d.getDate()} ${week[d.getDay()]}`;
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

function onModuleClick(moduleName) {
  if (moduleName === "weather") {
    openWeather();
    loadWeatherByLocation();
    return;
  }
  showToast("该模块暂未开发，先做天气预报");
}

document.querySelectorAll(".module-card").forEach((btn) => {
  btn.addEventListener("click", () => onModuleClick(btn.dataset.module));
});
document.getElementById("backHome").addEventListener("click", openHome);
document.getElementById("refreshWeather").addEventListener("click", loadWeatherByLocation);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => null);
}
