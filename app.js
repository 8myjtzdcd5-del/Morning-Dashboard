'use strict';

// ── Default settings ────────────────────────────────────────────────────────

const DEFAULTS = {
  weatherCity: 'New York',
  newsTopics: ['Technology', 'Science', 'Business'],
  people: [],
  topics: [],
};

// ── State ───────────────────────────────────────────────────────────────────

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

// ── Date / time greeting ────────────────────────────────────────────────────

function updateDateTime() {
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
  document.getElementById('greeting').textContent = greeting;
  document.getElementById('datetime').textContent = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }) + ' · ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// ── Weather (wttr.in — free, no API key, CORS-enabled) ─────────────────────

async function fetchWeather(city) {
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function renderWeather(city) {
  const el = document.getElementById('weather-content');
  el.innerHTML = '<span class="weather-loading">Loading weather&hellip;</span>';

  fetchWeather(city).then(data => {
    const cur = data.current_condition[0];
    const area = data.nearest_area[0];
    const cityName = area.areaName[0].value;
    const country = area.country[0].value;

    el.innerHTML = `
      <div class="weather-card">
        <div class="weather-temp-block">
          <div class="weather-temp">${cur.temp_F}&deg;F</div>
          <div class="weather-temp-alt">${cur.temp_C}&deg;C</div>
        </div>
        <div class="weather-info">
          <div class="weather-desc">${cur.weatherDesc[0].value}</div>
          <div class="weather-location">${cityName}, ${country}</div>
          <div class="weather-details">
            <span>&#128167; ${cur.humidity}% humidity</span>
            <span>&#128168; ${cur.windspeedMiles} mph wind</span>
            <span>Feels like ${cur.FeelsLikeF}&deg;F</span>
          </div>
        </div>
      </div>`;
  }).catch(() => {
    el.innerHTML = `<span class="weather-error">Could not load weather for &ldquo;${escHtml(city)}&rdquo;. Check the city name in Settings.</span>`;
  });
}

// ── News feed (Google News RSS via allorigins CORS proxy) ───────────────────

async function fetchNews(query) {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;

  const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const { contents } = await resp.json();

  const doc = new DOMParser().parseFromString(contents, 'text/xml');
  return Array.from(doc.querySelectorAll('item')).slice(0, 6).map(item => ({
    title: item.querySelector('title')?.textContent ?? '',
    link: item.querySelector('link')?.textContent?.trim() ?? '#',
    date: item.querySelector('pubDate')?.textContent ?? '',
    source: item.querySelector('source')?.textContent ?? '',
  }));
}

// ── Card rendering ──────────────────────────────────────────────────────────

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toCardId(prefix, label) {
  return `card-${prefix}-${label.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
}

function buildLoadingCard(label) {
  return `
    <div class="feed-card is-loading" id="${escHtml(toCardId('_', label))}">
      <div class="feed-card-label"><span class="label-dot"></span>${escHtml(label)}</div>
      <p class="feed-loading">Loading&hellip;</p>
    </div>`;
}

function buildNewsCard(label, items) {
  if (!items || items.length === 0) {
    return `
      <div class="feed-card">
        <div class="feed-card-label"><span class="label-dot"></span>${escHtml(label)}</div>
        <p class="feed-loading">No articles found.</p>
      </div>`;
  }

  const rows = items.map(item => {
    const date = item.date
      ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';
    return `
      <li class="news-item">
        <a class="news-link" href="${escHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escHtml(item.title)}</a>
        <div class="news-meta">
          ${item.source ? `<span>${escHtml(item.source)}</span>` : ''}
          ${date ? `<span>${date}</span>` : ''}
        </div>
      </li>`;
  }).join('');

  return `
    <div class="feed-card">
      <div class="feed-card-label"><span class="label-dot"></span>${escHtml(label)}</div>
      <ul class="news-list">${rows}</ul>
    </div>`;
}

function buildEmptyState(message, hint) {
  return `
    <div class="feed-empty">
      <strong>${message}</strong>
      ${hint}
    </div>`;
}

// ── Feed loading ────────────────────────────────────────────────────────────

function loadSection(containerId, items, prefix) {
  const container = document.getElementById(containerId);

  if (items.length === 0) {
    container.innerHTML = buildEmptyState(
      'Nothing here yet.',
      'Open Settings to add some entries.'
    );
    return;
  }

  container.innerHTML = items.map(item => buildLoadingCard(item)).join('');

  items.forEach(async item => {
    const cardId = toCardId(prefix, item);
    let newsItems = null;
    try {
      newsItems = await fetchNews(item);
    } catch {
      /* leave null — card shows error state */
    }
    const placeholder = document.getElementById(cardId);
    if (placeholder) {
      const html = newsItems === null
        ? `<div class="feed-card">
             <div class="feed-card-label"><span class="label-dot"></span>${escHtml(item)}</div>
             <p class="feed-loading">Failed to load. Check your connection.</p>
           </div>`
        : buildNewsCard(item, newsItems);
      placeholder.outerHTML = html;
    }
  });
}

function loadAllFeeds() {
  loadSection('news-feed', settings.newsTopics, 'news');
  loadSection('people-feed', settings.people, 'person');
  loadSection('topics-feed', settings.topics, 'topic');
}

// ── Settings modal ──────────────────────────────────────────────────────────

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
}

function renderTags(containerId, list, key) {
  const container = document.getElementById(containerId);
  if (list.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = list.map((item, i) => `
    <span class="tag">
      ${escHtml(item)}
      <span class="tag-remove" data-key="${key}" data-index="${i}" title="Remove">&#x2715;</span>
    </span>`).join('');

  container.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.key;
      const idx = parseInt(btn.dataset.index, 10);
      settings[k].splice(idx, 1);
      renderTags(containerId, settings[k], k);
    });
  });
}

function addItem(key, inputId, tagsId) {
  const input = document.getElementById(inputId);
  const val = input.value.trim();
  if (!val) return;
  if (!settings[key].includes(val)) settings[key].push(val);
  input.value = '';
  renderTags(tagsId, settings[key], key);
  input.focus();
}

function wireAddButton(btnId, inputId, tagsId, key) {
  const btn = document.getElementById(btnId);
  const input = document.getElementById(inputId);
  btn.addEventListener('click', () => addItem(key, inputId, tagsId));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') addItem(key, inputId, tagsId); });
}

// ── Init ────────────────────────────────────────────────────────────────────

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
