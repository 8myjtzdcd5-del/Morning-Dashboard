'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const RECENT_DAYS = 14;
const HISTORY_DAYS = 730; // 2 years
const HIST_PREFIX = 'mdHist_';

// ── Default settings ─────────────────────────────────────────────────────────

const DEFAULTS = {
  weatherCity: 'New York',
  newsTopics: ['Technology', 'Science', 'Business'],
  people: [],
  topics: [],
  clients: [],    // [{name, company}]
  prospects: [],  // [{name, company}]
  tickers: [],
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

// ── Weather ──────────────────────────────────────────────────────────────────

async function fetchWeather(city) {
  const resp = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function fmtHour(h) {
  if (h === 0 || h === 24) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function buildRainHtml(today) {
  const THRESHOLD = 30;
  const groups = [];
  let current = null;

  (today.hourly || []).forEach(h => {
    const chance = parseInt(h.chanceofrain, 10);
    const startH = Math.floor(parseInt(h.time, 10) / 100);
    const endH = startH + 3;
    if (chance >= THRESHOLD) {
      if (current && current.endH === startH) {
        current.endH = endH;
        current.maxChance = Math.max(current.maxChance, chance);
      } else {
        current = { startH, endH, maxChance: chance };
        groups.push(current);
      }
    } else {
      current = null;
    }
  });

  if (groups.length === 0) {
    return `<div class="weather-rain weather-no-rain">&#9728;&#xFE0F; No rain expected today</div>`;
  }
  const spans = groups.map(g =>
    `<span class="rain-period">${fmtHour(g.startH)}&ndash;${fmtHour(g.endH)} <em>(${g.maxChance}%)</em></span>`
  ).join(' &amp; ');
  return `<div class="weather-rain">&#x1F327;&#xFE0F; Rain today: ${spans}</div>`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function buildForecastStrip(days) {
  return `<div class="forecast-strip">${days.map((day, i) => {
    const d = new Date(day.date + 'T12:00:00');
    const name = i === 0 ? 'Today' : DAY_NAMES[d.getDay()];
    const desc = day.weatherDesc[0].value;
    const maxRain = Math.max(...(day.hourly || []).map(h => parseInt(h.chanceofrain, 10) || 0));
    return `
      <div class="forecast-day">
        <div class="forecast-day-name">${name}</div>
        <div class="forecast-day-desc">${desc}</div>
        <div class="forecast-day-temps">${day.maxtempF}&deg;<span class="lo">${day.mintempF}&deg;</span></div>
        ${maxRain >= 20 ? `<div class="forecast-day-rain">&#x1F327; ${maxRain}%</div>` : ''}
      </div>`;
  }).join('')}</div>`;
}

function renderWeather(city) {
  const el = document.getElementById('weather-content');
  el.innerHTML = '<span class="weather-loading">Loading weather&hellip;</span>';
  fetchWeather(city).then(data => {
    const cur = data.current_condition[0];
    const area = data.nearest_area[0];
    el.innerHTML = `
      <div class="weather-card">
        <div class="weather-temp-block">
          <div class="weather-temp">${cur.temp_F}&deg;F</div>
          <div class="weather-temp-alt">${cur.temp_C}&deg;C</div>
        </div>
        <div class="weather-info">
          <div class="weather-desc">${cur.weatherDesc[0].value}</div>
          <div class="weather-location">${area.areaName[0].value}, ${area.country[0].value}</div>
          <div class="weather-details">
            <span>&#128167; ${cur.humidity}% humidity</span>
            <span>&#128168; ${cur.windspeedMiles} mph wind</span>
            <span>Feels like ${cur.FeelsLikeF}&deg;F</span>
          </div>
          ${buildRainHtml(data.weather[0])}
          ${buildForecastStrip(data.weather)}
        </div>
      </div>`;
  }).catch(() => {
    el.innerHTML = `<span class="weather-error">Could not load weather for &ldquo;${escHtml(city)}&rdquo;. Check the city name in Settings.</span>`;
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
    link: item.querySelector('link')?.textContent?.trim() ?? '#',
    date: item.querySelector('pubDate')?.textContent ?? '',
    source: item.querySelector('source')?.textContent ?? '',
  }));
}

// ── Generic feed (topics, people, news) ──────────────────────────────────────

function buildEmptyState(message, hint) {
  return `<div class="feed-empty"><strong>${message}</strong> ${hint}</div>`;
}

function buildNewsCard(label, items) {
  const body = (!items || items.length === 0)
    ? `<p class="feed-loading">No articles found.</p>`
    : `<ul class="news-list">${items.map(i => articleRow(i)).join('')}</ul>`;
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
          ? `<span class="contact-company">${escHtml(entity.company)}</span>`
          : ''}
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
    const query = [entity.name, entity.company]
      .filter(Boolean).map(s => `"${s}"`).join(' OR ');

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

// ── Stocks (Yahoo Finance via CORS proxy) ─────────────────────────────────────

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

function loadAllFeeds() {
  loadSection('news-feed', settings.newsTopics, 'news');
  loadSection('people-feed', settings.people, 'person');
  loadSection('topics-feed', settings.topics, 'topic');
  loadContactSection('clients-feed', settings.clients, 'client',
    'Open Settings to add your clients.');
  loadContactSection('prospects-feed', settings.prospects, 'prospect',
    'Open Settings to add your prospects.');
  renderStocks(settings.tickers);
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
  wireContactAdd('add-client-btn', 'client-name-input', 'client-company-input', 'clients-tags', 'clients');
  wireContactAdd('add-prospect-btn', 'prospect-name-input', 'prospect-company-input', 'prospects-tags', 'prospects');
  wireAddButton('add-stock-btn', 'stock-input', 'stocks-tags', 'tickers');

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
