'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const RECENT_DAYS = 14;
const HISTORY_DAYS = 730;
const HIST_PREFIX = 'mdHist_';
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// WMO weather codes → descriptions
const WMO = {
  0:'Clear sky', 1:'Mainly clear', 2:'Partly cloudy', 3:'Overcast',
  45:'Fog', 48:'Icy fog',
  51:'Light drizzle', 53:'Drizzle', 55:'Heavy drizzle',
  61:'Light rain', 63:'Rain', 65:'Heavy rain',
  66:'Freezing rain', 67:'Heavy freezing rain',
  71:'Light snow', 73:'Snow', 75:'Heavy snow', 77:'Snow grains',
  80:'Light showers', 81:'Showers', 82:'Heavy showers',
  85:'Snow showers', 86:'Heavy snow showers',
  95:'Thunderstorm', 96:'Thunderstorm w/ hail', 99:'Severe thunderstorm',
};
const wmoDesc = code => WMO[code] ?? 'Unknown';

// ── Default settings ─────────────────────────────────────────────────────────

const DEFAULTS = {
  weatherCity: 'New York',
  newsTopics: ['Technology', 'Science', 'Business'],
  people: [],
  topics: [],
  clients: [],
  prospects: [],
  tickers: [],
  wishlist: [],
};

// ── State ────────────────────────────────────────────────────────────────────

let settings = loadSettings();

function loadSettings() {
  try {
    const raw = localStorage.getItem('morningDashboard');
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function persistSettings() {
  localStorage.setItem('morningDashboard', JSON.stringify(settings));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toCardId(prefix, label) {
  return `card-${prefix}-${label.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
}

function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function articleRow(item, showYear = false) {
  const opts = showYear
    ? { month: 'short', day: 'numeric', year: 'numeric' }
    : { month: 'short', day: 'numeric' };
  const date = item.date ? new Date(item.date).toLocaleDateString('en-US', opts) : '';
  return `
    <li class="news-item">
      <a class="news-link" href="${escHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escHtml(item.title)}</a>
      <div class="news-meta">
        ${item.source ? `<span>${escHtml(item.source)}</span>` : ''}
        ${date ? `<span>${date}</span>` : ''}
      </div>
    </li>`;
}

// ── Date / time greeting ─────────────────────────────────────────────────────

function updateDateTime() {
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
  document.getElementById('greeting').textContent = greeting;
  document.getElementById('datetime').textContent =
    now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) +
    ' · ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// ── Weather (Open-Meteo — free, no API key) ───────────────────────────────────

async function fetchWeather(location) {
  // 1. Geocode the location name
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
  const geoResp = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
  if (!geoResp.ok) throw new Error('Geocoding failed');
  const geoData = await geoResp.json();
  const geo = geoData.results?.[0];
  if (!geo) throw new Error(`Location not found`);

  // 2. Fetch weather for those coordinates
  const params = new URLSearchParams({
    latitude: geo.latitude,
    longitude: geo.longitude,
    current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,apparent_temperature,weather_code',
    hourly: 'precipitation_probability',
    daily: 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    forecast_days: '5',
  });
  const wxResp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!wxResp.ok) throw new Error('Weather fetch failed');
  const wx = await wxResp.json();

  const displayName = [geo.name, geo.admin1, geo.country_code].filter(Boolean).join(', ');
  return { wx, displayName };
}

function fmtHour(h) {
  if (h === 0 || h === 24) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function buildRainHtml(hourly) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const nowHour = new Date().getHours();
  const THRESHOLD = 30;

  const slots = hourly.time
    .map((t, i) => ({
      hour: parseInt(t.slice(11, 13), 10),
      prob: hourly.precipitation_probability[i],
      date: t.slice(0, 10),
    }))
    .filter(s => s.date === todayStr && s.hour >= nowHour);

  const groups = [];
  let cur = null;
  slots.forEach(s => {
    if (s.prob >= THRESHOLD) {
      if (cur && cur.endH === s.hour) {
        cur.endH = s.hour + 1;
        cur.maxProb = Math.max(cur.maxProb, s.prob);
      } else {
        cur = { startH: s.hour, endH: s.hour + 1, maxProb: s.prob };
        groups.push(cur);
      }
    } else {
      cur = null;
    }
  });

  if (!groups.length) return `<div class="weather-rain weather-no-rain">&#9728;&#xFE0F; No rain expected today</div>`;
  const spans = groups.map(g =>
    `<span class="rain-period">${fmtHour(g.startH)}&ndash;${fmtHour(g.endH)} <em>(${g.maxProb}%)</em></span>`
  ).join(' &amp; ');
  return `<div class="weather-rain">&#x1F327;&#xFE0F; Rain today: ${spans}</div>`;
}

function buildForecastStrip(daily) {
  return `<div class="forecast-strip">${daily.time.slice(0, 5).map((dateStr, i) => {
    const d = new Date(dateStr + 'T12:00:00');
    const name = i === 0 ? 'Today' : DAY_NAMES[d.getDay()];
    const maxRain = daily.precipitation_probability_max[i] || 0;
    return `
      <div class="forecast-day">
        <div class="forecast-day-name">${name}</div>
        <div class="forecast-day-desc">${wmoDesc(daily.weather_code[i])}</div>
        <div class="forecast-day-temps">${Math.round(daily.temperature_2m_max[i])}&deg;<span class="lo">${Math.round(daily.temperature_2m_min[i])}&deg;</span></div>
        ${maxRain >= 20 ? `<div class="forecast-day-rain">&#x1F327; ${maxRain}%</div>` : ''}
      </div>`;
  }).join('')}</div>`;
}

function renderWeather(location) {
  const el = document.getElementById('weather-content');
  el.innerHTML = '<span class="weather-loading">Loading weather&hellip;</span>';
  fetchWeather(location).then(({ wx, displayName }) => {
    const cur = wx.current;
    const tempC = Math.round((cur.temperature_2m - 32) * 5 / 9);
    el.innerHTML = `
      <div class="weather-card">
        <div class="weather-temp-block">
          <div class="weather-temp">${Math.round(cur.temperature_2m)}&deg;F</div>
          <div class="weather-temp-alt">${tempC}&deg;C</div>
        </div>
        <div class="weather-info">
          <div class="weather-desc">${wmoDesc(cur.weather_code)}</div>
          <div class="weather-location">${escHtml(displayName)}</div>
          <div class="weather-details">
            <span>&#128167; ${cur.relative_humidity_2m}% humidity</span>
            <span>&#128168; ${Math.round(cur.wind_speed_10m)} mph wind</span>
            <span>Feels like ${Math.round(cur.apparent_temperature)}&deg;F</span>
          </div>
          ${buildRainHtml(wx.hourly)}
          ${buildForecastStrip(wx.daily)}
        </div>
      </div>`;
  }).catch(() => {
    el.innerHTML = `<span class="weather-error">Could not find &ldquo;${escHtml(location)}&rdquo;. Try a city name like &ldquo;Wilmington DE&rdquo; or &ldquo;Wilmington, Delaware&rdquo;.</span>`;
  });
}

// ── History storage ───────────────────────────────────────────────────────────

function histKey(name, company) {
  return HIST_PREFIX + [name, company].filter(Boolean).join('_')
    .toLowerCase().replace(/[^a-z0-9]/g, '-');
}

function getHistory(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}

function mergeHistory(key, freshArticles) {
  const existing = getHistory(key);
  const seenLinks = new Set(existing.map(a => a.link));
  const merged = [
    ...freshArticles
      .filter(a => a.link && !seenLinks.has(a.link))
      .map(a => ({ ...a, _saved: Date.now() })),
    ...existing,
  ];
  const cutoffMs = Date.now() - HISTORY_DAYS * 86400000;
  const pruned = merged.filter(a => {
    const t = a.date ? new Date(a.date).getTime() : (a._saved || 0);
    return t > cutoffMs;
  });
  pruned.sort((a, b) =>
    new Date(b.date || b._saved || 0) - new Date(a.date || a._saved || 0)
  );
  localStorage.setItem(key, JSON.stringify(pruned));
  return pruned;
}

function filterRecent(articles) {
  const cutoff = Date.now() - RECENT_DAYS * 86400000;
  return articles.filter(a => a.date && new Date(a.date).getTime() > cutoff);
}

// ── News fetching ─────────────────────────────────────────────────────────────

async function fetchNews(query, limit = 8) {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;
  const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const { contents } = await resp.json();
  const doc = new DOMParser().parseFromString(contents, 'text/xml');
  return Array.from(doc.querySelectorAll('item')).slice(0, limit).map(item => ({
    title: item.querySelector('title')?.textContent ?? '',
    link:  item.querySelector('link')?.textContent?.trim() ?? '#',
    date:  item.querySelector('pubDate')?.textContent ?? '',
    source: item.querySelector('source')?.textContent ?? '',
  }));
}

// ── Generic feed cards ────────────────────────────────────────────────────────

function buildEmptyState(message, hint) {
  return `<div class="feed-empty"><strong>${message}</strong> ${hint}</div>`;
}

function buildNewsCard(label, items) {
  const todayItems = (items || []).filter(i => isToday(i.date));
  const body = todayItems.length === 0
    ? `<p class="feed-loading">No articles today yet &mdash; check back later.</p>`
    : `<ul class="news-list">${todayItems.map(i => articleRow(i)).join('')}</ul>`;
  return `
    <div class="feed-card">
      <div class="feed-card-label"><span class="label-dot"></span>${escHtml(label)}</div>
      ${body}
    </div>`;
}

function loadSection(containerId, items, prefix) {
  const container = document.getElementById(containerId);
  if (items.length === 0) {
    container.innerHTML = buildEmptyState('Nothing here yet.', 'Open Settings to add some entries.');
    return;
  }
  container.innerHTML = items.map(item => `
    <div class="feed-card is-loading" id="${toCardId(prefix, item)}">
      <div class="feed-card-label"><span class="label-dot"></span>${escHtml(item)}</div>
      <p class="feed-loading">Loading&hellip;</p>
    </div>`).join('');

  items.forEach(async item => {
    const cardId = toCardId(prefix, item);
    let newsItems = null;
    try { newsItems = await fetchNews(item); } catch {}
    const placeholder = document.getElementById(cardId);
    if (placeholder) {
      placeholder.outerHTML = newsItems === null
        ? `<div class="feed-card">
             <div class="feed-card-label"><span class="label-dot"></span>${escHtml(item)}</div>
             <p class="feed-loading">Failed to load. Check your connection.</p>
           </div>`
        : buildNewsCard(item, newsItems);
    }
  });
}

// ── Contact cards (clients & prospects) ──────────────────────────────────────

function contactLabel(entity) {
  return [entity.name, entity.company].filter(Boolean).join(' · ');
}

function buildContactCard(entity, allArticles) {
  const recent = filterRecent(allArticles);

  const recentBody = recent.length > 0
    ? `<ul class="news-list">${recent.map(a => articleRow(a, false)).join('')}</ul>`
    : `<p class="feed-loading">No news in the last ${RECENT_DAYS} days.</p>`;

  const historyBody = allArticles.length > 0
    ? `<ul class="news-list">${allArticles.map(a => articleRow(a, true)).join('')}</ul>`
    : `<p class="feed-loading">History will build each time you open the dashboard.</p>`;

  return `
    <div class="feed-card contact-card">
      <div class="feed-card-label">
        <span class="label-dot"></span>
        <span class="contact-name">${escHtml(entity.name || entity.company)}</span>
        ${entity.name && entity.company
          ? `<span class="contact-company">${escHtml(entity.company)}</span>` : ''}
      </div>
      <div class="card-tabs">
        <button class="card-tab active" data-panel="recent">
          Recent&nbsp;<span class="tab-count">${recent.length}</span>
        </button>
        <button class="card-tab" data-panel="history">
          History&nbsp;<span class="tab-count">${allArticles.length}</span>
        </button>
      </div>
      <div class="tab-panel" data-panel="recent">${recentBody}</div>
      <div class="tab-panel hidden" data-panel="history">${historyBody}</div>
    </div>`;
}

function wireTabSwitching(container) {
  container.addEventListener('click', e => {
    const tab = e.target.closest('.card-tab');
    if (!tab) return;
    const card = tab.closest('.contact-card');
    if (!card) return;
    const panel = tab.dataset.panel;
    card.querySelectorAll('.card-tab').forEach(t => t.classList.remove('active'));
    card.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    tab.classList.add('active');
    card.querySelector(`.tab-panel[data-panel="${panel}"]`).classList.remove('hidden');
  });
}

function loadContactSection(containerId, entities, prefix, emptyHint) {
  const container = document.getElementById(containerId);
  if (entities.length === 0) {
    container.innerHTML = buildEmptyState('Nobody added yet.', emptyHint);
    return;
  }
  container.innerHTML = entities.map(entity => {
    const id = toCardId(prefix, entity.name + entity.company);
    return `
      <div class="feed-card contact-card is-loading" id="${id}">
        <div class="feed-card-label"><span class="label-dot"></span>${escHtml(contactLabel(entity))}</div>
        <p class="feed-loading">Loading&hellip;</p>
      </div>`;
  }).join('');
  wireTabSwitching(container);

  entities.forEach(async entity => {
    const key = histKey(entity.name, entity.company);
    const cardId = toCardId(prefix, entity.name + entity.company);
    const query = [entity.name, entity.company].filter(Boolean).map(s => `"${s}"`).join(' OR ');
    let fresh = [];
    try { fresh = await fetchNews(query, 20); } catch {}
    const allArticles = mergeHistory(key, fresh);
    const placeholder = document.getElementById(cardId);
    if (placeholder) {
      const tmp = document.createElement('div');
      tmp.innerHTML = buildContactCard(entity, allArticles);
      placeholder.replaceWith(tmp.firstElementChild);
    }
  });
}

// ── Stocks ────────────────────────────────────────────────────────────────────

async function fetchStocks(symbols) {
  if (!symbols.length) return [];
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}`;
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const { contents } = await resp.json();
  const data = JSON.parse(contents);
  return (data?.quoteResponse?.result || []).map(q => ({
    symbol: q.symbol,
    name: q.shortName || q.longName || q.symbol,
    price: q.regularMarketPrice,
    change: q.regularMarketChange,
    changePct: q.regularMarketChangePercent,
    time: q.regularMarketTime
      ? new Date(q.regularMarketTime * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      : '',
  }));
}

function renderStocks(tickers) {
  const container = document.getElementById('stocks-feed');
  if (!tickers.length) {
    container.innerHTML = buildEmptyState('No tickers added.', 'Open Settings to add stock symbols.');
    return;
  }
  container.innerHTML = `<div class="stock-card"><p class="feed-loading">Loading&hellip;</p></div>`;
  fetchStocks(tickers).then(stocks => {
    if (!stocks.length) {
      container.innerHTML = buildEmptyState('No data returned.', 'Check your ticker symbols in Settings.');
      return;
    }
    container.innerHTML = stocks.map(s => {
      const up = s.change >= 0;
      const sign = up ? '+' : '';
      const fmt = n => n != null ? n.toFixed(2) : '—';
      return `
        <div class="stock-card ${up ? 'up' : 'down'}">
          <div class="stock-symbol">${escHtml(s.symbol)}</div>
          <div class="stock-name">${escHtml(s.name)}</div>
          <div class="stock-price">$${fmt(s.price)}</div>
          <div class="stock-change">${sign}${fmt(s.change)} (${sign}${fmt(s.changePct)}%)</div>
          ${s.time ? `<div class="stock-time">As of ${s.time}</div>` : ''}
        </div>`;
    }).join('');
  }).catch(() => {
    container.innerHTML = buildEmptyState('Could not load stock data.', 'Check your connection and try again.');
  });
}

// ── Wish List ─────────────────────────────────────────────────────────────────

function buildWishlistCard(item) {
  const q = encodeURIComponent(item);
  return `
    <div class="wishlist-card">
      <div class="wishlist-item-name">${escHtml(item)}</div>
      <div class="wishlist-links">
        <a class="shop-link amazon"  href="https://www.amazon.com/s?k=${q}" target="_blank" rel="noopener">Amazon</a>
        <a class="shop-link google"  href="https://shopping.google.com/search?q=${q}" target="_blank" rel="noopener">Google</a>
        <a class="shop-link ebay"    href="https://www.ebay.com/sch/i.html?_nkw=${q}" target="_blank" rel="noopener">eBay</a>
        <a class="shop-link bestbuy" href="https://www.bestbuy.com/site/searchpage.jsp?st=${q}" target="_blank" rel="noopener">Best Buy</a>
      </div>
    </div>`;
}

function renderWishlist(items) {
  const container = document.getElementById('wishlist-feed');
  if (!items.length) {
    container.innerHTML = buildEmptyState('No items yet.', 'Open Settings to add something to your wish list.');
    return;
  }
  container.innerHTML = items.map(buildWishlistCard).join('');
}

// ── Load everything ───────────────────────────────────────────────────────────

function loadAllFeeds() {
  loadSection('news-feed', settings.newsTopics, 'news');
  loadSection('people-feed', settings.people, 'person');
  loadSection('topics-feed', settings.topics, 'topic');
  loadContactSection('clients-feed', settings.clients, 'client', 'Open Settings to add your clients.');
  loadContactSection('prospects-feed', settings.prospects, 'prospect', 'Open Settings to add your prospects.');
  renderStocks(settings.tickers);
  renderWishlist(settings.wishlist);
}

// ── Settings modal ────────────────────────────────────────────────────────────

function openSettings() {
  syncSettingsUI();
  document.getElementById('overlay').classList.remove('hidden');
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('settings-modal').classList.add('hidden');
}

function syncSettingsUI() {
  document.getElementById('weather-city-input').value = settings.weatherCity;
  renderTags('news-topics-tags', settings.newsTopics, 'newsTopics');
  renderTags('people-tags', settings.people, 'people');
  renderTags('topics-tags', settings.topics, 'topics');
  renderContactTags('clients-tags', settings.clients, 'clients');
  renderContactTags('prospects-tags', settings.prospects, 'prospects');
  renderTags('stocks-tags', settings.tickers, 'tickers');
  renderTags('wishlist-tags', settings.wishlist, 'wishlist');
}

function renderTags(containerId, list, key) {
  const container = document.getElementById(containerId);
  container.innerHTML = list.map((item, i) => `
    <span class="tag">
      ${escHtml(item)}
      <span class="tag-remove" data-key="${key}" data-index="${i}" title="Remove">&#x2715;</span>
    </span>`).join('');
  container.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      settings[btn.dataset.key].splice(parseInt(btn.dataset.index, 10), 1);
      renderTags(containerId, settings[btn.dataset.key], btn.dataset.key);
    });
  });
}

function renderContactTags(containerId, list, key) {
  const container = document.getElementById(containerId);
  container.innerHTML = list.map((item, i) => `
    <span class="tag">
      ${escHtml([item.name, item.company].filter(Boolean).join(' · '))}
      <span class="tag-remove" data-key="${key}" data-index="${i}" title="Remove">&#x2715;</span>
    </span>`).join('');
  container.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      settings[btn.dataset.key].splice(parseInt(btn.dataset.index, 10), 1);
      renderContactTags(containerId, settings[btn.dataset.key], btn.dataset.key);
    });
  });
}

function addItem(key, inputId, tagsId) {
  const input = document.getElementById(inputId);
  let val = input.value.trim();
  if (key === 'tickers') val = val.toUpperCase();
  if (!val) return;
  if (!settings[key].includes(val)) settings[key].push(val);
  input.value = '';
  renderTags(tagsId, settings[key], key);
  input.focus();
}

function addContact(key, nameId, companyId, tagsId) {
  const name = document.getElementById(nameId).value.trim();
  const company = document.getElementById(companyId).value.trim();
  if (!name && !company) return;
  const isDupe = settings[key].some(e => e.name === name && e.company === company);
  if (!isDupe) settings[key].push({ name, company });
  document.getElementById(nameId).value = '';
  document.getElementById(companyId).value = '';
  renderContactTags(tagsId, settings[key], key);
  document.getElementById(nameId).focus();
}

function wireAddButton(btnId, inputId, tagsId, key) {
  document.getElementById(btnId).addEventListener('click', () => addItem(key, inputId, tagsId));
  document.getElementById(inputId).addEventListener('keydown', e => {
    if (e.key === 'Enter') addItem(key, inputId, tagsId);
  });
}

function wireContactAdd(btnId, nameId, companyId, tagsId, key) {
  document.getElementById(btnId).addEventListener('click', () =>
    addContact(key, nameId, companyId, tagsId));
  [nameId, companyId].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') addContact(key, nameId, companyId, tagsId);
    });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  updateDateTime();
  setInterval(updateDateTime, 30000);

  renderWeather(settings.weatherCity);
  loadAllFeeds();

  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('close-settings').addEventListener('click', closeSettings);
  document.getElementById('overlay').addEventListener('click', closeSettings);

  document.getElementById('save-city-btn').addEventListener('click', () => {
    const val = document.getElementById('weather-city-input').value.trim();
    if (val) settings.weatherCity = val;
  });

  wireAddButton('add-news-topic-btn', 'news-topic-input', 'news-topics-tags', 'newsTopics');
  wireAddButton('add-person-btn', 'person-input', 'people-tags', 'people');
  wireAddButton('add-topic-btn', 'topic-input', 'topics-tags', 'topics');
  wireAddButton('add-stock-btn', 'stock-input', 'stocks-tags', 'tickers');
  wireAddButton('add-wishlist-btn', 'wishlist-input', 'wishlist-tags', 'wishlist');
  wireContactAdd('add-client-btn', 'client-name-input', 'client-company-input', 'clients-tags', 'clients');
  wireContactAdd('add-prospect-btn', 'prospect-name-input', 'prospect-company-input', 'prospects-tags', 'prospects');

  document.getElementById('apply-btn').addEventListener('click', () => {
    const cityVal = document.getElementById('weather-city-input').value.trim();
    if (cityVal) settings.weatherCity = cityVal;
    persistSettings();
    closeSettings();
    renderWeather(settings.weatherCity);
    loadAllFeeds();
  });
}

init();
