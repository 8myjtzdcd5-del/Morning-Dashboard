'use strict';

const RECENT_DAYS = 14;
const HISTORY_DAYS = 730;
const HIST_PREFIX = 'mdHist_';
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const WMO = {
  0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
  45:'Fog',48:'Icy fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',
  61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Heavy freezing rain',
  71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',
  80:'Light showers',81:'Showers',82:'Heavy showers',
  85:'Snow showers',86:'Heavy snow showers',
  95:'Thunderstorm',96:'Thunderstorm w/ hail',99:'Severe thunderstorm',
};
const wmoDesc = code => WMO[code] ?? 'Unknown';

// ── Settings ──────────────────────────────────────────────────────────────────

const DEFAULTS = {
  weatherCity: 'New York',
  newsTopics: ['Technology','Science','Business'],
  people: [], topics: [], clients: [], prospects: [],
  tickers: [], wishlist: [],
  milestones: [],
  calendarUrls: [],
  refreshTimes: ['5:16 AM','11:30 AM','3:00 PM','7:30 PM'],
};

let settings = loadSettings();
function loadSettings() {
  try { const r = localStorage.getItem('morningDashboard'); return r ? {...DEFAULTS,...JSON.parse(r)} : {...DEFAULTS}; }
  catch { return {...DEFAULTS}; }
}
function persistSettingsLocal() {
  try { localStorage.setItem('morningDashboard', JSON.stringify(settings)); } catch {}
}
function persistSettings() {
  persistSettingsLocal();
  debouncedSyncToGist();
}

// ── Gist sync ─────────────────────────────────────────────────────────────────

let _gistToken = localStorage.getItem('mdGistToken') || '';
let _gistId    = localStorage.getItem('mdGistId')    || '';
let _syncTimer = null;

function setSyncStatus(state, extra) {
  const el = document.getElementById('sync-status'); if (!el) return;
  const map = {
    connecting: ['sync-pending', '↻ Connecting…'],
    syncing:    ['sync-pending', '↻ Syncing…'],
    ok:         ['sync-ok',     '✓ Synced'],
    loaded:     ['sync-ok',     '✓ Connected — settings loaded from cloud'],
    created:    ['sync-ok',     '✓ Connected — settings saved to cloud'],
    error:      ['sync-error',  '⚠ ' + (extra || 'Check your token and try again.')],
  };
  const [cls, text] = map[state] || ['', state];
  el.className = 'sync-status ' + cls; el.textContent = text;
}

async function gistApi(path, method='GET', body=null) {
  const opts = {method, headers:{'Authorization':`token ${_gistToken}`,'Accept':'application/vnd.github.v3+json'}, signal:sig(10000)};
  if (body) { opts.body=JSON.stringify(body); opts.headers['Content-Type']='application/json'; }
  const r = await fetch(`https://api.github.com${path}`, opts);
  if (!r.ok) throw new Error(`GitHub API error ${r.status}`);
  return r.json();
}

async function connectGist(token) {
  _gistToken = token; localStorage.setItem('mdGistToken', token);
  _gistId = ''; localStorage.removeItem('mdGistId');
  setSyncStatus('connecting');
  try {
    const list = await gistApi('/gists?per_page=100');
    const found = list.find(g => g.description === 'Morning Dashboard Settings');
    if (found) {
      _gistId = found.id; localStorage.setItem('mdGistId', _gistId);
      const g = await gistApi(`/gists/${_gistId}`);
      const raw = g.files?.['settings.json']?.content;
      if (raw) {
        settings = {...DEFAULTS, ...JSON.parse(raw)};
        persistSettingsLocal(); syncSettingsUI(); loadAllFeeds(); scheduleAutoRefresh();
        setSyncStatus('loaded'); return;
      }
    }
    // No existing gist — create one with current settings
    const created = await gistApi('/gists', 'POST', {
      description: 'Morning Dashboard Settings', public: false,
      files: {'settings.json': {content: JSON.stringify(settings, null, 2)}},
    });
    _gistId = created.id; localStorage.setItem('mdGistId', _gistId);
    setSyncStatus('created');
  } catch(e) { setSyncStatus('error', e.message); }
}

async function syncFromGist() {
  if (!_gistToken || !_gistId) return false;
  try {
    const g = await gistApi(`/gists/${_gistId}`);
    const raw = g.files?.['settings.json']?.content; if (!raw) return false;
    const before = JSON.stringify(settings);
    settings = {...DEFAULTS, ...JSON.parse(raw)};
    persistSettingsLocal();
    return JSON.stringify(settings) !== before;
  } catch { return false; }
}

async function syncToGist() {
  if (!_gistToken) return;
  const content = JSON.stringify(settings, null, 2);
  setSyncStatus('syncing');
  try {
    if (_gistId) {
      await gistApi(`/gists/${_gistId}`, 'PATCH', {files: {'settings.json': {content}}});
    } else {
      const created = await gistApi('/gists', 'POST', {
        description: 'Morning Dashboard Settings', public: false,
        files: {'settings.json': {content}},
      });
      _gistId = created.id; localStorage.setItem('mdGistId', _gistId);
    }
    setSyncStatus('ok');
  } catch(e) { setSyncStatus('error', e.message); }
}

function debouncedSyncToGist() {
  if (!_gistToken) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncToGist, 1500);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toCardId(prefix, label) { return `card-${prefix}-${label.replace(/[^a-z0-9]/gi,'-').toLowerCase()}`; }
function sig(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const ac = new AbortController(); setTimeout(() => ac.abort(), ms); return ac.signal;
}
function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr), n = new Date();
  return d.getFullYear()===n.getFullYear() && d.getMonth()===n.getMonth() && d.getDate()===n.getDate();
}
function articleRow(item, showYear=false) {
  const opts = showYear ? {month:'short',day:'numeric',year:'numeric'} : {month:'short',day:'numeric'};
  const date = item.date ? new Date(item.date).toLocaleDateString('en-US',opts) : '';
  return `<li class="news-item">
    <a class="news-link" href="${escHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escHtml(item.title)}</a>
    <div class="news-meta">${item.source?`<span>${escHtml(item.source)}</span>`:''} ${date?`<span>${date}</span>`:''}</div>
  </li>`;
}
function buildEmptyState(msg, hint) { return `<div class="feed-empty"><strong>${msg}</strong> ${hint}</div>`; }

// ── Date / time ───────────────────────────────────────────────────────────────

function updateDateTime() {
  const now = new Date(), h = now.getHours();
  document.getElementById('greeting').textContent = h<12?'Good Morning, Bill':h<17?'Good Afternoon, Bill':'Good Evening, Bill';
  document.getElementById('datetime').textContent =
    now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) +
    ' · ' + now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
}

// ── CORS proxy (single fast attempt) ─────────────────────────────────────────

async function proxyFetch(url, ms=15000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  const s = ac.signal;
  const allorigins = fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,{signal:s})
    .then(r=>r.json()).then(d=>{if(!d?.contents)throw new Error('empty');return d.contents;});
  const corsproxy = fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`,{signal:s})
    .then(r=>{if(!r.ok)throw new Error(r.status);return r.text();});
  const codetabs  = fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,{signal:s})
    .then(r=>{if(!r.ok)throw new Error(r.status);return r.text();});
  const thingproxy = fetch(`https://thingproxy.freeboard.io/fetch/${url}`,{signal:s})
    .then(r=>{if(!r.ok)throw new Error(r.status);return r.text();});
  try {
    const result = await Promise.any([allorigins, corsproxy, codetabs, thingproxy]);
    clearTimeout(timer); ac.abort();
    return result;
  } catch { clearTimeout(timer); throw new Error('all proxies failed'); }
}

// ── Market indices bar ────────────────────────────────────────────────────────

const INDEX_META = [
  {symbol:'^GSPC',label:'S&P 500',fmt:'price'},
  {symbol:'^DJI', label:'Dow',    fmt:'price'},
  {symbol:'^IXIC',label:'Nasdaq', fmt:'price'},
  {symbol:'^VIX', label:'VIX',    fmt:'decimal'},
  {symbol:'^TNX', label:'10Y Yield',fmt:'yield'},
];

function fmtIndexPrice(fmt, price) {
  if (fmt==='yield')   return `${price.toFixed(2)}%`;
  if (fmt==='decimal') return price.toFixed(2);
  return price>=1000 ? price.toLocaleString('en-US',{maximumFractionDigits:0}) : price.toFixed(2);
}

async function fetchYahooQuotes(symbols) {
  const syms = symbols.join(',');
  const parse = contents => {
    const r = JSON.parse(contents)?.quoteResponse?.result;
    if (!r?.length) throw new Error('empty');
    return r;
  };
  // Try direct browser fetch first (no proxy — fastest if Yahoo allows it)
  const direct = ['https://query1.finance.yahoo.com','https://query2.finance.yahoo.com'].map(base =>
    fetch(`${base}/v7/finance/quote?symbols=${syms}&formatted=false`, {signal:sig(5000)})
      .then(r=>r.text()).then(parse)
  );
  // Also race through proxies simultaneously
  const viaProxy = proxyFetch(
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${syms}&formatted=false`, 8000
  ).then(parse);
  return Promise.any([...direct, viaProxy]);
}

function saveCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({data, ts: Date.now()})); } catch {}
}
function loadCache(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key)||'null');
    if (!raw) return null;
    const ago = new Date(raw.ts).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    return {data: raw.data, ago};
  } catch { return null; }
}

function renderIndexBar(results, cached) {
  const bar = document.getElementById('market-bar');
  const suffix = cached ? `<span class="market-cached"> &mdash; as of ${cached}</span>` : '';
  bar.innerHTML = results.map(q => {
    const meta = INDEX_META.find(m=>m.symbol===q.symbol); if (!meta) return '';
    const up = q.change >= 0;
    return `<div class="market-item market-clickable" data-symbol="${escHtml(q.symbol)}" data-name="${escHtml(meta.label)}" title="Click for chart">
      <span class="market-label">${meta.label}</span>
      <span class="market-price">${fmtIndexPrice(meta.fmt, q.price)}</span>
      <span class="market-chg ${up?'up':'down'}">${up?'▲':'▼'} ${up?'+':''}${q.changePct.toFixed(2)}%</span>
    </div>`;
  }).join('') + suffix;
  bar.querySelectorAll('.market-clickable').forEach(el =>
    el.addEventListener('click', () => openChart(el.dataset.symbol, el.dataset.name))
  );
}

async function renderMarketBar() {
  const bar = document.getElementById('market-bar');
  try {
    const raw = await fetchYahooQuotes(INDEX_META.map(i=>i.symbol));
    const results = raw.map(q=>({
      symbol: q.symbol, price: q.regularMarketPrice,
      change: q.regularMarketChange, changePct: q.regularMarketChangePercent,
    }));
    saveCache('mdIndexCache', results);
    renderIndexBar(results, null);
  } catch {
    const cached = loadCache('mdIndexCache');
    if (cached) { renderIndexBar(cached.data, cached.ago); return; }
    bar.innerHTML = INDEX_META.map(m => {
      const yurl = `https://finance.yahoo.com/quote/${encodeURIComponent(m.symbol)}/`;
      return `<a class="market-item market-item-link" href="${yurl}" target="_blank" rel="noopener">
        <span class="market-label">${m.label}</span>
        <span class="market-price market-tap">tap for quote ↗</span>
      </a>`;
    }).join('');
  }
}

// ── Weather (Open-Meteo, CORS-native) ─────────────────────────────────────────

async function fetchWeather(location) {
  const geoResp = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`,
    {signal: sig(8000)}
  );
  const geoData = await geoResp.json();
  const geo = geoData.results?.[0];
  if (!geo) throw new Error('Location not found');

  const params = new URLSearchParams({
    latitude: geo.latitude, longitude: geo.longitude,
    current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,apparent_temperature,weather_code',
    hourly: 'precipitation_probability',
    daily: 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph',
    timezone: 'auto', forecast_days: '5',
  });
  const wxResp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {signal: sig(8000)});
  const wx = await wxResp.json();
  return {wx, displayName: [geo.name,geo.admin1,geo.country_code].filter(Boolean).join(', ')};
}

function fmtHour(h) {
  if (h===0||h===24) return '12 AM'; if (h<12) return `${h} AM`;
  if (h===12) return '12 PM'; return `${h-12} PM`;
}

function buildRainHtml(hourly) {
  const todayStr = new Date().toISOString().slice(0,10);
  const nowHour  = new Date().getHours();
  const slots = hourly.time
    .map((t,i)=>({hour:parseInt(t.slice(11,13),10),prob:hourly.precipitation_probability[i],date:t.slice(0,10)}))
    .filter(s=>s.date===todayStr && s.hour>=nowHour);
  const groups=[]; let cur=null;
  slots.forEach(s=>{
    if (s.prob>=30) {
      if (cur && cur.endH===s.hour) { cur.endH=s.hour+1; cur.maxProb=Math.max(cur.maxProb,s.prob); }
      else { cur={startH:s.hour,endH:s.hour+1,maxProb:s.prob}; groups.push(cur); }
    } else { cur=null; }
  });
  if (!groups.length) return `<div class="weather-rain weather-no-rain">&#9728;&#xFE0F; No rain expected today</div>`;
  return `<div class="weather-rain">&#x1F327;&#xFE0F; Rain today: ${groups.map(g=>`<span class="rain-period">${fmtHour(g.startH)}&ndash;${fmtHour(g.endH)} <em>(${g.maxProb}%)</em></span>`).join(' &amp; ')}</div>`;
}

function buildForecastStrip(daily) {
  return `<div class="forecast-strip">${daily.time.slice(0,5).map((ds,i)=>{
    const d=new Date(ds+'T12:00:00');
    const rain=daily.precipitation_probability_max[i]||0;
    return `<div class="forecast-day">
      <div class="forecast-day-name">${i===0?'Today':DAY_NAMES[d.getDay()]}</div>
      <div class="forecast-day-desc">${wmoDesc(daily.weather_code[i])}</div>
      <div class="forecast-day-temps">${Math.round(daily.temperature_2m_max[i])}&deg;<span class="lo">${Math.round(daily.temperature_2m_min[i])}&deg;</span></div>
      ${rain>=20?`<div class="forecast-day-rain">&#x1F327; ${rain}%</div>`:''}
    </div>`;
  }).join('')}</div>`;
}

function buildWeatherHtml({wx, displayName}) {
  const cur = wx.current;
  return `<div class="weather-card">
    <div class="weather-temp-block">
      <div class="weather-temp">${Math.round(cur.temperature_2m)}&deg;F</div>
      <div class="weather-temp-alt">${Math.round((cur.temperature_2m-32)*5/9)}&deg;C</div>
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
}

function renderWeather(location) {
  const el = document.getElementById('weather-content');
  const cached = loadCache('mdWeatherCache');
  if (cached) el.innerHTML = buildWeatherHtml(cached.data);
  else el.innerHTML = '<span class="weather-loading">Loading weather&hellip;</span>';
  fetchWeather(location).then(data=>{
    saveCache('mdWeatherCache', data);
    el.innerHTML = buildWeatherHtml(data);
  }).catch(()=>{
    if (!cached) el.innerHTML = `<span class="weather-error">Could not load weather for &ldquo;${escHtml(location)}&rdquo;. Check Settings or try refreshing.</span>`;
  });
}

// ── Quote of the day (ZenQuotes, CORS-native) ─────────────────────────────────

function buildQuoteHtml(q) {
  return `<div class="quote-card">
    <div class="quote-mark">&ldquo;</div>
    <blockquote class="quote-text">${escHtml(q.q)}</blockquote>
    <div class="quote-author">&mdash; ${escHtml(q.a)}</div>
  </div>`;
}

async function renderQuote() {
  const el = document.getElementById('quote-feed');
  const cached = loadCache('mdQuoteCache');
  if (cached) el.innerHTML = buildQuoteHtml(cached.data);
  else el.innerHTML = '<p class="feed-loading">Loading quote&hellip;</p>';
  try {
    let q;
    try { const resp = await fetch('https://zenquotes.io/api/today',{signal:sig(6000)}); [q]=await resp.json(); }
    catch { const c=await proxyFetch('https://zenquotes.io/api/today',6000); [q]=JSON.parse(c); }
    saveCache('mdQuoteCache', q);
    el.innerHTML = buildQuoteHtml(q);
  } catch { if (!cached) el.innerHTML='<p class="feed-loading">Quote unavailable today.</p>'; }
}

// ── Google Calendar ICS ───────────────────────────────────────────────────────

function parseIcs(text) {
  // Unfold continuation lines (ICS wraps long lines with \r\n + space)
  const unfolded = text.replace(/\r\n[ \t]/g,'').replace(/\r\n/g,'\n').replace(/\n[ \t]/g,'');
  const events = [];
  const blocks = unfolded.split('BEGIN:VEVENT').slice(1);
  for (const block of blocks) {
    const get = key => block.match(new RegExp(`${key}[^:\\n]*:([^\\n]+)`))?.[1]?.trim() ?? null;
    const summary  = get('SUMMARY');
    const dtstartRaw = get('DTSTART');
    if (!summary || !dtstartRaw) continue;
    const dateOnly = dtstartRaw.replace(/T.*/, '');
    if (dateOnly.length < 8) continue;
    const isAllDay = !dtstartRaw.includes('T');
    if (!isAllDay) continue; // skip timed appointments — only all-day events are special dates
    const month = parseInt(dateOnly.slice(4,6), 10);
    const day   = parseInt(dateOnly.slice(6,8), 10);
    if (!month || !day) continue;
    events.push({ title: summary, month, day, isCalendar: true });
  }
  return events;
}

async function fetchCalendarEvents(url) {
  try {
    const text = await proxyFetch(url, 12000);
    return parseIcs(text);
  } catch { return []; }
}

async function loadAllCalendarEvents() {
  const urls = settings.calendarUrls || [];
  if (!urls.length) return loadCache('mdCalCache')?.data || [];
  const cached = loadCache('mdCalCache');
  // Use cache immediately while fetching fresh in background
  const results = await Promise.all(urls.map(u => fetchCalendarEvents(u)));
  const all = results.flat();
  if (all.length) saveCache('mdCalCache', all);
  return all.length ? all : (cached?.data || []);
}

// ── Special Dates ─────────────────────────────────────────────────────────────

function daysUntil(month, day) {
  const today = new Date(); today.setHours(0,0,0,0);
  let target = new Date(today.getFullYear(), month-1, day);
  if (target < today) target.setFullYear(today.getFullYear()+1);
  return Math.round((target-today)/86400000);
}

function nthWeekday(year, month, weekday, n) {
  // n=1 first, n=-1 last. weekday: 0=Sun,1=Mon,...
  if (n > 0) {
    const d = new Date(year, month-1, 1);
    const diff = (weekday - d.getDay() + 7) % 7;
    return new Date(year, month-1, 1 + diff + (n-1)*7);
  } else {
    const d = new Date(year, month, 0); // last day of month
    const diff = (d.getDay() - weekday + 7) % 7;
    return new Date(year, month-1, d.getDate() - diff);
  }
}

function getHolidays(year) {
  const h = (title, emoji, m, d) => ({ title: `${emoji} ${title}`, month: m, day: d, isHoliday: true });
  const hd = (title, emoji, date) => h(title, emoji, date.getMonth()+1, date.getDate());
  return [
    h("New Year's Day",        '🎆', 1,  1),
    h("Valentine's Day",       '❤️',  2, 14),
    h("St. Patrick's Day",     '🍀', 3, 17),
    h("Independence Day",      '🇺🇸', 7,  4),
    h("Halloween",             '🎃', 10, 31),
    h("Veterans Day",          '🎖️', 11, 11),
    h("Christmas Eve",         '🎄', 12, 24),
    h("Christmas Day",         '🎁', 12, 25),
    h("New Year's Eve",        '🥂', 12, 31),
    hd("Martin Luther King Jr. Day", '✊', nthWeekday(year, 1, 1, 3)),
    hd("Presidents' Day",      '🏛️',  nthWeekday(year, 2, 1, 3)),
    hd("Mother's Day",         '💐',  nthWeekday(year, 5, 0, 2)),
    hd("Memorial Day",         '🕊️',  nthWeekday(year, 5, 1, -1)),
    hd("Father's Day",         '👔',  nthWeekday(year, 6, 0, 3)),
    hd("Labor Day",            '⚒️',  nthWeekday(year, 9, 1, 1)),
    hd("Columbus Day",         '⚓',  nthWeekday(year, 10, 1, 2)),
    hd("Thanksgiving",         '🦃',  nthWeekday(year, 11, 4, 4)),
  ];
}

function buildMilestonesHtml(calEvents) {
  const el = document.getElementById('milestones-feed');
  const thisYear = new Date().getFullYear();
  const holidays = getHolidays(thisYear).map(h=>({...h, days:daysUntil(h.month,h.day)}));
  const personal = settings.milestones.map(m=>({...m, days:daysUntil(m.month,m.day)}));
  const calendar = (calEvents||[]).map(e=>({...e, days:daysUntil(e.month,e.day)}));
  const all = [...personal, ...calendar, ...holidays].sort((a,b)=>a.days-b.days);
  const toShow = all.filter(m=>m.days<=14);
  if (!toShow.length) {
    el.innerHTML = '<p class="milestone-empty">No special dates in the next 2 weeks.</p>';
    return;
  }
  el.innerHTML = `<div class="milestone-list">${toShow.map(m=>{
    const today2=m.days===0, soon=m.days<=7&&m.days>1;
    const when = today2?'&#x1F382; Today!':m.days===1?'Tomorrow':`In ${m.days} days`;
    const yrs = !m.isHoliday&&!m.isCalendar&&m.year&&(thisYear-m.year)>0 ? `${thisYear-m.year} year${thisYear-m.year>1?'s':''}` : null;
    return `<div class="milestone-item ${today2?'is-today':soon?'is-soon':''} ${m.isHoliday?'is-holiday':''} ${m.isCalendar?'is-calendar':''}">
      <div><div class="milestone-title">${escHtml(m.title)}</div>${yrs?`<div class="milestone-years">${yrs}</div>`:''}</div>
      <div class="milestone-when">${when}<br><span style="opacity:0.7">${MONTH_SHORT[m.month-1]} ${m.day}</span></div>
    </div>`;
  }).join('')}</div>`;
}

async function renderMilestones() {
  const cached = loadCache('mdCalCache');
  buildMilestonesHtml(cached?.data || []);
  if (settings.calendarUrls?.length) {
    const fresh = await loadAllCalendarEvents();
    buildMilestonesHtml(fresh);
  }
}

// ── History storage ───────────────────────────────────────────────────────────

function histKey(name,company) { return HIST_PREFIX+[name,company].filter(Boolean).join('_').toLowerCase().replace(/[^a-z0-9]/g,'-'); }
function getHistory(key) { try { return JSON.parse(localStorage.getItem(key)||'[]'); } catch { return []; } }
function mergeHistory(key, fresh) {
  const existing = getHistory(key);
  const seen = new Set(existing.map(a=>a.link));
  const merged = [...fresh.filter(a=>a.link&&!seen.has(a.link)).map(a=>({...a,_saved:Date.now()})),...existing];
  const cutoff = Date.now()-HISTORY_DAYS*86400000;
  const pruned = merged.filter(a=>(a.date?new Date(a.date).getTime():(a._saved||0))>cutoff);
  pruned.sort((a,b)=>new Date(b.date||b._saved||0)-new Date(a.date||a._saved||0));
  localStorage.setItem(key, JSON.stringify(pruned));
  return pruned;
}
function filterRecent(articles) {
  const cutoff = Date.now()-RECENT_DAYS*86400000;
  return articles.filter(a=>a.date&&new Date(a.date).getTime()>cutoff);
}

// ── News cache ────────────────────────────────────────────────────────────────

function newsKey(q) { return 'mdNC_'+q.toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,60); }
function saveNewsCache(query, items) {
  try { localStorage.setItem(newsKey(query), JSON.stringify({items, ts: Date.now()})); } catch {}
}
function loadNewsCache(query) {
  try { return JSON.parse(localStorage.getItem(newsKey(query))||'null'); } catch { return null; }
}

// ── News fetching ─────────────────────────────────────────────────────────────

function stripHtml(s) { return (s||'').replace(/<[^>]*>/g,'').replace(/&[a-z]+;/gi,' ').replace(/\s+/g,' ').trim(); }

function parseXmlItems(xml, limit) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const items = Array.from(doc.querySelectorAll('item')).slice(0, limit);
  if (!items.length) throw new Error('no items');
  return items.map(item=>({
    title: item.querySelector('title')?.textContent??'',
    link:  item.querySelector('link')?.textContent?.trim()??'#',
    date:  item.querySelector('pubDate')?.textContent??'',
    source:item.querySelector('source')?.textContent??'',
    description: stripHtml(item.querySelector('description')?.textContent??''),
  }));
}

async function fetchNews(query, limit=8) {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const viaRss2json = fetch(
    `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&count=${limit}`,
    {signal: sig(7000)}
  ).then(r=>r.json()).then(data=>{
    if (data.status!=='ok'||!data.items?.length) throw new Error('rss2json empty');
    return data.items.map(i=>({title:i.title||'',link:i.link||'#',date:i.pubDate||'',source:i.author||'',description:stripHtml(i.description||'')}));
  });
  const viaProxy = proxyFetch(rssUrl, 8000).then(xml=>parseXmlItems(xml, limit));
  return Promise.any([viaRss2json, viaProxy]);
}

// ── Feed rendering ────────────────────────────────────────────────────────────

function buildNewsCard(label, items, id='') {
  const todayItems = (items||[]).filter(i=>isToday(i.date));
  const body = todayItems.length===0
    ? `<p class="feed-loading">No articles today yet &mdash; check back later.</p>`
    : `<ul class="news-list">${todayItems.map(i=>articleRow(i)).join('')}</ul>`;
  return `<div class="feed-card"${id?` id="${escHtml(id)}"`:''}>` +
    `<div class="feed-card-label"><span class="label-dot"></span>${escHtml(label)}</div>${body}</div>`;
}

// One request at a time with a cooldown gap between items to let proxies recover.
const newsQueue = (() => {
  let running = false;
  let lastDone = 0;
  const GAP = 700; // ms between requests — prevents back-to-back proxy hammering
  const queue = [];
  function run() {
    if (running || !queue.length) return;
    const wait = Math.max(0, lastDone + GAP - Date.now());
    setTimeout(()=>{
      if (!queue.length) return;
      running = true;
      const {fn, resolve, reject} = queue.shift();
      fn().then(resolve, reject).finally(()=>{ lastDone=Date.now(); running=false; run(); });
    }, wait);
  }
  return { add(fn) { return new Promise((res,rej)=>{ queue.push({fn,resolve:res,reject:rej}); run(); }); } };
})();

async function fetchNewsQueued(query, limit=8) {
  return newsQueue.add(async ()=>{
    for (let attempt=0; attempt<2; attempt++) {
      try { return await fetchNews(query, limit); } catch {}
      if (attempt < 1) await new Promise(r=>setTimeout(r, 1500));
    }
    throw new Error('all attempts failed');
  });
}

function loadSection(containerId, items, prefix) {
  const container = document.getElementById(containerId);
  if (!items.length) { container.innerHTML = buildEmptyState('Nothing here yet.','Open Settings to add some entries.'); return; }
  // Render immediately: cached content where available, loading placeholder otherwise
  container.innerHTML = items.map(item=>{
    const cardId = toCardId(prefix, item);
    const cached = loadNewsCache(item);
    return cached
      ? buildNewsCard(item, cached.items, cardId)
      : `<div class="feed-card is-loading" id="${cardId}"><div class="feed-card-label"><span class="label-dot"></span>${escHtml(item)}</div><p class="feed-loading">Loading&hellip;</p></div>`;
  }).join('');
  // Fetch fresh data in background — update card on success, keep cache on failure
  items.forEach(async item=>{
    const cardId = toCardId(prefix, item);
    let fresh = null;
    try { fresh = await fetchNewsQueued(item); } catch {}
    if (fresh) {
      saveNewsCache(item, fresh);
      const el = document.getElementById(cardId);
      if (el) el.outerHTML = buildNewsCard(item, fresh, cardId);
    } else {
      const el = document.getElementById(cardId);
      if (el && el.classList.contains('is-loading')) {
        el.classList.remove('is-loading');
        const retryId = `retry-${cardId}`;
        el.innerHTML = `<div class="feed-card-label"><span class="label-dot"></span>${escHtml(item)}</div><p class="feed-loading">Could not load. <button class="retry-btn" id="${retryId}">↻ Retry</button></p>`;
        document.getElementById(retryId)?.addEventListener('click', ()=>{
          el.classList.add('is-loading');
          el.innerHTML = `<div class="feed-card-label"><span class="label-dot"></span>${escHtml(item)}</div><p class="feed-loading">Loading&hellip;</p>`;
          fetchNewsQueued(item).then(fresh=>{ if(fresh){saveNewsCache(item,fresh); el.outerHTML=buildNewsCard(item,fresh,cardId);} })
            .catch(()=>{ el.classList.remove('is-loading'); el.innerHTML=`<div class="feed-card-label"><span class="label-dot"></span>${escHtml(item)}</div><p class="feed-loading">Still unavailable. Try again later.</p>`; });
        });
      }
      // If card was showing cached content, leave it as-is
    }
  });
}

// ── Contact cards ─────────────────────────────────────────────────────────────

function contactLabel(e) { return [e.name,e.company].filter(Boolean).join(' · '); }

function buildContactCard(entity, allArticles, id='') {
  const recent=filterRecent(allArticles);
  const recentBody=recent.length>0
    ? `<ul class="news-list">${recent.map(a=>articleRow(a,false)).join('')}</ul>`
    : `<p class="feed-loading">No news in the last ${RECENT_DAYS} days.</p>`;
  const histBody=allArticles.length>0
    ? `<ul class="news-list">${allArticles.map(a=>articleRow(a,true)).join('')}</ul>`
    : `<p class="feed-loading">History will build each time you open the dashboard.</p>`;
  return `<div class="feed-card contact-card"${id?` id="${escHtml(id)}"`:''}
    <div class="feed-card-label"><span class="label-dot"></span>
      <span class="contact-name">${escHtml(entity.name||entity.company)}</span>
      ${entity.name&&entity.company?`<span class="contact-company">${escHtml(entity.company)}</span>`:''}
    </div>
    <div class="card-tabs">
      <button class="card-tab active" data-panel="recent">Recent&nbsp;<span class="tab-count">${recent.length}</span></button>
      <button class="card-tab" data-panel="history">History&nbsp;<span class="tab-count">${allArticles.length}</span></button>
    </div>
    <div class="tab-panel" data-panel="recent">${recentBody}</div>
    <div class="tab-panel hidden" data-panel="history">${histBody}</div>
  </div>`;
}

function wireTabSwitching(container) {
  container.addEventListener('click',e=>{
    const tab=e.target.closest('.card-tab'); if (!tab) return;
    const card=tab.closest('.contact-card'); if (!card) return;
    card.querySelectorAll('.card-tab').forEach(t=>t.classList.remove('active'));
    card.querySelectorAll('.tab-panel').forEach(p=>p.classList.add('hidden'));
    tab.classList.add('active');
    card.querySelector(`.tab-panel[data-panel="${tab.dataset.panel}"]`).classList.remove('hidden');
  });
}

function loadContactSection(containerId, entities, prefix, emptyHint) {
  const container=document.getElementById(containerId);
  if (!entities.length) { container.innerHTML=buildEmptyState('Nobody added yet.',emptyHint); return; }
  // Show cached cards immediately; use invisible placeholder for contacts with no history yet
  container.innerHTML=entities.map(entity=>{
    const cardId=toCardId(prefix,entity.name+entity.company);
    const history=getHistory(histKey(entity.name,entity.company));
    return history.length
      ? buildContactCard(entity, history, cardId)
      : `<div id="${cardId}" data-placeholder></div>`;
  }).join('');
  wireTabSwitching(container);
  entities.forEach(async entity=>{
    const key=histKey(entity.name,entity.company);
    const cardId=toCardId(prefix,entity.name+entity.company);
    let fresh=[];
    try {
      // Single queue slot: fetch name then company sequentially inside one item
      fresh = await newsQueue.add(async ()=>{
        const nameNews    = entity.name    ? await fetchNews(`"${entity.name}"`,    12).catch(()=>[]) : [];
        const companyNews = entity.company ? await fetchNews(`"${entity.company}"`, 12).catch(()=>[]) : [];
        const seen = new Set(nameNews.map(a=>a.link));
        return [...nameNews, ...companyNews.filter(a=>!seen.has(a.link))]
          .sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
      });
    } catch {}
    const allArticles=mergeHistory(key,fresh);
    const ph=document.getElementById(cardId);
    if (!ph) return;
    if (allArticles.length) {
      const tmp=document.createElement('div');
      tmp.innerHTML=buildContactCard(entity,allArticles,cardId);
      ph.replaceWith(tmp.firstElementChild);
      wireTabSwitching(container);
    } else {
      ph.remove(); // no news found — hide this contact entirely
    }
  });
}

// ── Stocks ────────────────────────────────────────────────────────────────────

async function fetchStocks(symbols) {
  if (!symbols.length) return [];
  const results = await fetchYahooQuotes(symbols);
  return (results||[]).map(q=>({
    symbol: q.symbol,
    name: q.shortName||q.longName||q.symbol,
    price: q.regularMarketPrice,
    change: q.regularMarketChange,
    changePct: q.regularMarketChangePercent,
    marketState: q.marketState||'REGULAR',
    lastTradeDate: q.regularMarketTime ? new Date(q.regularMarketTime*1000) : null,
    prePrice: q.preMarketPrice||null,
    preChangePct: q.preMarketChangePercent||null,
    postPrice: q.postMarketPrice||null,
    postChangePct: q.postMarketChangePercent||null,
  }));
}

function paintStocks(stocks, cached) {
  const container=document.getElementById('stocks-feed');
  const cacheNote = cached ? `<p class="stocks-cached">Showing last known prices &mdash; as of ${cached}</p>` : '';
  container.innerHTML = cacheNote + stocks.map(s=>{
      const up=s.change>=0, sign=up?'+':'', fmt=n=>n!=null?n.toFixed(2):'—';
      const closed = s.marketState==='CLOSED' || s.marketState==='PREPRE' || s.marketState==='POSTPOST';
      const pre    = s.marketState==='PRE'  && s.prePrice!=null;
      const post   = s.marketState==='POST' && s.postPrice!=null;
      const dateStr = s.lastTradeDate
        ? s.lastTradeDate.toLocaleDateString('en-US',{month:'short',day:'numeric'})
        : '';
      const extPrice = pre ? s.prePrice : post ? s.postPrice : null;
      const extPct   = pre ? s.preChangePct : post ? s.postChangePct : null;
      const extLabel = pre ? 'Pre-mkt' : 'After-hrs';
      return `<div class="stock-card ${up?'up':'down'} stock-clickable" data-symbol="${escHtml(s.symbol)}" data-name="${escHtml(s.name)}" title="Click for chart">
        <div class="stock-symbol">${escHtml(s.symbol)}</div>
        <div class="stock-name">${escHtml(s.name)}</div>
        <div class="stock-price">$${fmt(s.price)}</div>
        <div class="stock-change">${sign}${fmt(s.change)} (${sign}${fmt(s.changePct)}%)</div>
        ${closed&&dateStr ? `<div class="stock-time stock-closed">&#x25CF; Closed &mdash; last ${dateStr}</div>` : ''}
        ${extPrice!=null ? `<div class="stock-ext">${extLabel}: $${fmt(extPrice)} (${extPct>=0?'+':''}${fmt(extPct)}%)</div>` : ''}
        <div class="stock-chart-hint">&#x1F4C8; View chart</div>
      </div>`;
    }).join('');
  container.querySelectorAll('.stock-clickable').forEach(el =>
    el.addEventListener('click', () => openChart(el.dataset.symbol, el.dataset.name))
  );
}

function renderStocks(tickers) {
  const container=document.getElementById('stocks-feed');
  if (!tickers.length) { container.innerHTML=buildEmptyState('No tickers added.','Open Settings to add stock symbols.'); return; }
  container.innerHTML=`<div class="stock-card"><p class="feed-loading">Loading&hellip;</p></div>`;
  fetchStocks(tickers).then(stocks=>{
    if (!stocks.length) throw new Error('empty');
    saveCache('mdStockCache', stocks);
    paintStocks(stocks, null);
  }).catch(()=>{
    const cached = loadCache('mdStockCache');
    if (cached) { paintStocks(cached.data, cached.ago); return; }
    container.innerHTML=buildEmptyState('Stock data unavailable.','Prices will appear once a connection is established.');
  });
}

// ── F-1 ───────────────────────────────────────────────────────────────────────

async function fetchNextF1Race() {
  try {
    const r = await fetch('https://api.jolpi.ca/ergast/f1/current/next.json', {signal: sig(8000)});
    const data = await r.json();
    const race = data?.MRData?.RaceTable?.Races?.[0];
    if (!race) return null;
    return {
      name: race.raceName,
      circuit: race.Circuit?.circuitName || '',
      locality: race.Circuit?.Location?.locality || '',
      country: race.Circuit?.Location?.country || '',
      date: race.date,
      time: race.time || null,
    };
  } catch { return null; }
}

function buildF1RaceHtml(race) {
  if (!race) return '';
  const dt = race.time
    ? new Date(`${race.date}T${race.time}`)
    : new Date(`${race.date}T12:00:00`);
  const dateStr = dt.toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric', year:'numeric'});
  const timeStr = race.time
    ? dt.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit', timeZoneName:'short'})
    : '';
  return `<div class="f1-next-race">
    <div class="f1-next-label">&#x1F3C1; Next Race</div>
    <div class="f1-next-name">${escHtml(race.name)}</div>
    <div class="f1-next-loc">${escHtml([race.circuit, race.locality, race.country].filter(Boolean).join(' &middot; '))}</div>
    <div class="f1-next-dt">${escHtml(dateStr)}${timeStr ? ` &middot; ${escHtml(timeStr)}` : ''}</div>
  </div>`;
}

function buildF1Html(items, race) {
  const now=Date.now();
  const fresh=items.filter(i=>i.date&&(now-new Date(i.date).getTime())<86400000);
  const stories=(fresh.length>=2?fresh:items).slice(0,2);
  const hasFresh=fresh.length>0;
  const storiesHtml=stories.map(a=>{
    const date=a.date?new Date(a.date).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
    const meta=[a.source?escHtml(a.source):'',date].filter(Boolean).join(' &bull; ');
    let desc=(a.description||'').replace(/<[^>]*>/g,'').trim();
    if (desc.toLowerCase().startsWith(a.title.toLowerCase().slice(0,30))) desc='';
    if (desc.length>180) desc=desc.slice(0,177)+'&hellip;';
    return `<div class="f1-story">
      <a class="f1-headline" href="${escHtml(a.link)}" target="_blank" rel="noopener noreferrer">${escHtml(a.title)}</a>
      ${desc?`<p class="f1-desc">${escHtml(desc)}</p>`:''}
      ${meta?`<div class="f1-meta">${meta}</div>`:''}
    </div>`;
  }).join('');
  const newsSection = stories.length
    ? `${storiesHtml}${!hasFresh?'<p class="f1-stale">No updates in 24h &mdash; showing latest</p>':''}`
    : `<p class="f1-stale">No recent news found.</p>`;
  return `<div class="f1-card">
    <div class="f1-eyebrow"><span class="f1-dot"></span>Formula 1 ${hasFresh?'<span class="f1-fresh">&#x25CF; TODAY</span>':''}</div>
    ${buildF1RaceHtml(race)}
    ${newsSection}
  </div>`;
}

async function renderF1() {
  const container=document.getElementById('f1-feed');
  const cachedNews=loadCache('mdF1Cache');
  const cachedRace=loadCache('mdF1Race');
  if (cachedNews||cachedRace) container.innerHTML=buildF1Html(cachedNews?.data||[], cachedRace?.data||null);
  else container.innerHTML=`<div class="f1-card"><div class="f1-eyebrow"><span class="f1-dot"></span>Formula 1</div><p class="feed-loading">Loading&hellip;</p></div>`;

  // Fetch race schedule and news in parallel
  const [race, newsItems] = await Promise.all([
    fetchNextF1Race(),
    fetchNewsQueued('"Formula 1" OR "Formula One" OR "F1" Grand Prix',15).catch(()=>[]),
  ]);

  if (race) saveCache('mdF1Race', race);
  if (newsItems.length) saveCache('mdF1Cache', newsItems);

  const finalRace = race || cachedRace?.data || null;
  const finalNews = newsItems.length ? newsItems : (cachedNews?.data || []);
  container.innerHTML = buildF1Html(finalNews, finalRace);
}

// ── Wish List ─────────────────────────────────────────────────────────────────

function renderWishlist(items) {
  const container=document.getElementById('wishlist-feed');
  if (!items.length) { container.innerHTML=buildEmptyState('No items yet.','Open Settings to add something to your wish list.'); return; }
  const q=item=>encodeURIComponent(item);
  container.innerHTML=items.map(item=>`<div class="wishlist-card">
    <div class="wishlist-item-name">${escHtml(item)}</div>
    <div class="wishlist-links">
      <a class="shop-link amazon"  href="https://www.amazon.com/s?k=${q(item)}" target="_blank" rel="noopener">Amazon</a>
      <a class="shop-link google"  href="https://shopping.google.com/search?q=${q(item)}" target="_blank" rel="noopener">Google</a>
      <a class="shop-link ebay"    href="https://www.ebay.com/sch/i.html?_nkw=${q(item)}" target="_blank" rel="noopener">eBay</a>
      <a class="shop-link bestbuy" href="https://www.bestbuy.com/site/searchpage.jsp?st=${q(item)}" target="_blank" rel="noopener">Best Buy</a>
    </div>
  </div>`).join('');
}

// ── Load all ──────────────────────────────────────────────────────────────────

function loadAllFeeds(staggerMs=0) {
  // Fast, non-rate-limited sections always load immediately
  renderStocks(settings.tickers);
  renderWishlist(settings.wishlist);
  renderMilestones();
  renderQuote();
  renderMarketBar();
  renderWeather(settings.weatherCity);

  // News sections — stagger over staggerMs if set (e.g. scheduled refresh)
  const groups = [
    ()=>loadSection('news-feed', settings.newsTopics, 'news'),
    ()=>loadSection('people-feed', settings.people, 'person'),
    ()=>loadSection('topics-feed', settings.topics, 'topic'),
    ()=>loadContactSection('clients-feed', settings.clients, 'client', 'Open Settings to add your clients.'),
    ()=>loadContactSection('prospects-feed', settings.prospects, 'prospect', 'Open Settings to add your prospects.'),
    ()=>renderF1(),
  ];
  const n = groups.length;
  groups.forEach((fn, i) => {
    const delay = (staggerMs > 0 && n > 1) ? Math.round((i / (n - 1)) * staggerMs) : 0;
    delay > 0 ? setTimeout(fn, delay) : fn();
  });
}

// ── Auto-refresh scheduler ────────────────────────────────────────────────────

let _refreshTimer = null;
let _lastRefreshTs = 0;

function parseRefreshTimes(list) {
  return (list||[]).map(t=>{
    const m = String(t).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!m) return null;
    let h=parseInt(m[1],10), min=m[2]?parseInt(m[2],10):0;
    const ap=(m[3]||'').toLowerCase();
    if (ap==='pm'&&h!==12) h+=12;
    if (ap==='am'&&h===12) h=0;
    if (h<0||h>23||min<0||min>59) return null;
    return {h,min};
  }).filter(Boolean);
}

function nextRefreshDate(times) {
  if (!times.length) return null;
  const now = new Date();
  return times.map(({h,min})=>{
    const d = new Date(now); d.setHours(h,min,0,0);
    if (d <= now) d.setDate(d.getDate()+1);
    return d;
  }).sort((a,b)=>a-b)[0];
}

function updateNextRefreshLabel(date) {
  const el = document.getElementById('next-refresh');
  if (!el) return;
  if (!date) { el.textContent=''; return; }
  const timeStr = date.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
  const sameDay = date.toDateString() === new Date().toDateString();
  el.textContent = sameDay ? `Next refresh: ${timeStr}` : `Next refresh: ${timeStr} tomorrow`;
}

function scheduleAutoRefresh() {
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer=null; }
  const times = parseRefreshTimes(settings.refreshTimes||[]);
  const next = nextRefreshDate(times);
  updateNextRefreshLabel(next);
  if (!next) return;
  _refreshTimer = setTimeout(()=>{
    if (Date.now()-_lastRefreshTs > 5*60*1000) {
      _lastRefreshTs = Date.now();
      loadAllFeeds(15*60*1000);
    }
    scheduleAutoRefresh();
  }, next-Date.now());
}

// ── Settings modal ────────────────────────────────────────────────────────────

function openSettings()  { syncSettingsUI(); document.getElementById('overlay').classList.remove('hidden'); document.getElementById('settings-modal').classList.remove('hidden'); }
function closeSettings() { document.getElementById('overlay').classList.add('hidden'); document.getElementById('settings-modal').classList.add('hidden'); }

function syncSettingsUI() {
  document.getElementById('weather-city-input').value = settings.weatherCity;
  document.getElementById('refresh-times-input').value = (settings.refreshTimes||[]).join(', ');
  document.getElementById('gist-token-input').value = _gistToken;
  setSyncStatus(_gistToken && _gistId ? 'ok' : '');
  renderTags('news-topics-tags', settings.newsTopics, 'newsTopics');
  renderTags('people-tags', settings.people, 'people');
  renderTags('topics-tags', settings.topics, 'topics');
  renderContactTags('clients-tags', settings.clients, 'clients');
  renderContactTags('prospects-tags', settings.prospects, 'prospects');
  renderTags('stocks-tags', settings.tickers, 'tickers');
  renderTags('wishlist-tags', settings.wishlist, 'wishlist');
  renderMilestoneTags();
  renderTags('calendar-url-tags', settings.calendarUrls, 'calendarUrls');
}

function renderTags(containerId, list, key) {
  const c=document.getElementById(containerId);
  c.innerHTML=list.map((item,i)=>`<span class="tag">${escHtml(item)}<span class="tag-remove" data-key="${key}" data-index="${i}" title="Remove">&#x2715;</span></span>`).join('');
  c.querySelectorAll('.tag-remove').forEach(btn=>btn.addEventListener('click',()=>{ settings[btn.dataset.key].splice(parseInt(btn.dataset.index,10),1); persistSettings(); renderTags(containerId,settings[btn.dataset.key],btn.dataset.key); }));
}

function renderContactTags(containerId, list, key) {
  const c=document.getElementById(containerId);
  c.innerHTML=list.map((item,i)=>`<span class="tag">${escHtml([item.name,item.company].filter(Boolean).join(' · '))}<span class="tag-remove" data-key="${key}" data-index="${i}" title="Remove">&#x2715;</span></span>`).join('');
  c.querySelectorAll('.tag-remove').forEach(btn=>btn.addEventListener('click',()=>{ settings[btn.dataset.key].splice(parseInt(btn.dataset.index,10),1); persistSettings(); renderContactTags(containerId,settings[btn.dataset.key],btn.dataset.key); }));
}

function renderMilestoneTags() {
  const c=document.getElementById('milestones-tags');
  c.innerHTML=settings.milestones.map((m,i)=>{
    const label=`${m.title} · ${MONTH_SHORT[m.month-1]} ${m.day}${m.year?` (since ${m.year})`:''}`;
    return `<span class="tag">${escHtml(label)}<span class="tag-remove" data-type="ms" data-index="${i}" title="Remove">&#x2715;</span></span>`;
  }).join('');
  c.querySelectorAll('.tag-remove[data-type="ms"]').forEach(btn=>btn.addEventListener('click',()=>{ settings.milestones.splice(parseInt(btn.dataset.index,10),1); persistSettings(); renderMilestoneTags(); }));
}

function addItem(key, inputId, tagsId) {
  const input=document.getElementById(inputId); let val=input.value.trim();
  if (key==='tickers') val=val.toUpperCase(); if (!val) return;
  if (!settings[key].includes(val)) settings[key].push(val);
  persistSettings(); input.value=''; renderTags(tagsId,settings[key],key); input.focus();
}

function addContact(key, nameId, companyId, tagsId) {
  const name=document.getElementById(nameId).value.trim(), company=document.getElementById(companyId).value.trim();
  if (!name&&!company) return;
  if (!settings[key].some(e=>e.name===name&&e.company===company)) settings[key].push({name,company});
  persistSettings(); document.getElementById(nameId).value=''; document.getElementById(companyId).value='';
  renderContactTags(tagsId,settings[key],key); document.getElementById(nameId).focus();
}

function addMilestone() {
  const title=document.getElementById('ms-title').value.trim();
  const month=parseInt(document.getElementById('ms-month').value,10);
  const day=parseInt(document.getElementById('ms-day').value,10);
  const year=parseInt(document.getElementById('ms-year').value,10)||null;
  if (!title||!month||!day||day<1||day>31) return;
  if (!settings.milestones.some(m=>m.title===title&&m.month===month&&m.day===day)) settings.milestones.push({title,month,day,year});
  persistSettings(); document.getElementById('ms-title').value=''; document.getElementById('ms-month').value='';
  document.getElementById('ms-day').value=''; document.getElementById('ms-year').value='';
  renderMilestoneTags(); document.getElementById('ms-title').focus();
}

function wireAddButton(btnId, inputId, tagsId, key) {
  document.getElementById(btnId).addEventListener('click',()=>addItem(key,inputId,tagsId));
  document.getElementById(inputId).addEventListener('keydown',e=>{ if (e.key==='Enter') addItem(key,inputId,tagsId); });
}
function wireContactAdd(btnId, nameId, companyId, tagsId, key) {
  document.getElementById(btnId).addEventListener('click',()=>addContact(key,nameId,companyId,tagsId));
  [nameId,companyId].forEach(id=>document.getElementById(id).addEventListener('keydown',e=>{ if (e.key==='Enter') addContact(key,nameId,companyId,tagsId); }));
}

// ── Chart modal (TradingView) ─────────────────────────────────────────────────

const TV_MAP = {
  '^GSPC':'SP:SPX', '^DJI':'DJ:DJI', '^IXIC':'NASDAQ:IXIC',
  '^VIX':'CBOE:VIX', '^TNX':'TVC:US10Y',
};
function toTvSymbol(sym) { return TV_MAP[sym] || sym; }

let tvReady = false;
function loadTvScript(cb) {
  if (tvReady) { cb(); return; }
  if (document.getElementById('tv-script')) {
    document.getElementById('tv-script').addEventListener('load', cb);
    return;
  }
  const s = document.createElement('script');
  s.id = 'tv-script';
  s.src = 'https://s3.tradingview.com/tv.js';
  s.onload = () => { tvReady = true; cb(); };
  document.head.appendChild(s);
}

let currentChartSymbol = null;

function openChart(symbol, name) {
  currentChartSymbol = toTvSymbol(symbol);
  document.getElementById('chart-title').textContent = name;
  document.getElementById('chart-modal').classList.remove('hidden');
  document.getElementById('overlay').classList.remove('hidden');
  document.querySelectorAll('.range-btn').forEach(b => b.classList.toggle('active', b.dataset.range === '12M'));
  renderTvChart(currentChartSymbol, '12M');
}

function closeChart() {
  document.getElementById('chart-modal').classList.add('hidden');
  document.getElementById('overlay').classList.add('hidden');
}

function renderTvChart(symbol, range) {
  const container = document.getElementById('chart-container');
  container.innerHTML = '<div id="tv_widget"></div>';
  loadTvScript(() => {
    new TradingView.widget({
      container_id: 'tv_widget',
      symbol, range,
      width: '100%',
      height: 480,
      theme: 'light',
      style: '1',
      locale: 'en',
      enable_publishing: false,
      hide_top_toolbar: false,
      save_image: false,
      hide_side_toolbar: false,
    });
  });
}

// ── Settings export / import ──────────────────────────────────────────────────

function exportSettings() {
  const blob = new Blob([JSON.stringify(settings, null, 2)], {type:'application/json'});
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'morning-dashboard-settings.json',
  });
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(a.href);
}

function importSettings(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);
      settings = {...DEFAULTS, ...imported};
      persistSettings();
      syncSettingsUI();
      document.getElementById('import-status').textContent = 'Settings imported! Click Apply & Refresh.';
    } catch {
      document.getElementById('import-status').textContent = 'Could not read that file.';
    }
  };
  reader.readAsText(file);
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  updateDateTime(); setInterval(updateDateTime,30000);
  _lastRefreshTs = Date.now();
  loadAllFeeds();
  scheduleAutoRefresh();

  // If tab was hidden during a scheduled time, refresh when it becomes visible again
  document.addEventListener('visibilitychange', ()=>{
    if (document.visibilityState !== 'visible') return;
    const times = parseRefreshTimes(settings.refreshTimes||[]);
    if (!times.length) return;
    const now = new Date();
    const pastTimes = times.map(({h,min})=>{
      const d = new Date(now); d.setHours(h,min,0,0);
      if (d > now) d.setDate(d.getDate()-1);
      return d;
    }).sort((a,b)=>b-a);
    if (pastTimes[0] && _lastRefreshTs < pastTimes[0].getTime() && Date.now()-_lastRefreshTs > 5*60*1000) {
      _lastRefreshTs = Date.now();
      loadAllFeeds(15*60*1000);
      scheduleAutoRefresh();
    }
  });
  document.getElementById('settings-btn').addEventListener('click',openSettings);
  document.getElementById('close-settings').addEventListener('click',closeSettings);
  document.getElementById('close-chart-btn').addEventListener('click',closeChart);
  document.getElementById('overlay').addEventListener('click',()=>{ closeSettings(); closeChart(); });
  document.querySelectorAll('.range-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.range-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    renderTvChart(currentChartSymbol, btn.dataset.range);
  }));
  document.getElementById('save-city-btn').addEventListener('click',()=>{ const v=document.getElementById('weather-city-input').value.trim(); if(v){ settings.weatherCity=v; persistSettings(); } });
  wireAddButton('add-news-topic-btn','news-topic-input','news-topics-tags','newsTopics');
  wireAddButton('add-person-btn','person-input','people-tags','people');
  wireAddButton('add-topic-btn','topic-input','topics-tags','topics');
  wireAddButton('add-stock-btn','stock-input','stocks-tags','tickers');
  wireAddButton('add-wishlist-btn','wishlist-input','wishlist-tags','wishlist');
  wireContactAdd('add-client-btn','client-name-input','client-company-input','clients-tags','clients');
  wireContactAdd('add-prospect-btn','prospect-name-input','prospect-company-input','prospects-tags','prospects');
  document.getElementById('add-ms-btn').addEventListener('click',addMilestone);
  document.getElementById('add-calendar-url-btn').addEventListener('click', () => {
    const input = document.getElementById('calendar-url-input');
    const url = input.value.trim();
    if (url && url.startsWith('http') && !settings.calendarUrls.includes(url)) {
      settings.calendarUrls.push(url);
      persistSettings();
      renderTags('calendar-url-tags', settings.calendarUrls, 'calendarUrls');
      input.value = '';
    }
  });
  ['ms-title','ms-month','ms-day','ms-year'].forEach(id=>document.getElementById(id).addEventListener('keydown',e=>{ if(e.key==='Enter') addMilestone(); }));
  document.getElementById('export-settings-btn').addEventListener('click', exportSettings);
  document.getElementById('import-settings-input').addEventListener('change', e => importSettings(e.target.files[0]));
  document.getElementById('connect-gist-btn').addEventListener('click', () => {
    const token = document.getElementById('gist-token-input').value.trim();
    if (token) connectGist(token);
  });

  // On startup, silently pull latest settings from gist if already connected
  if (_gistToken && _gistId) {
    syncFromGist().then(changed => {
      if (changed) { syncSettingsUI(); loadAllFeeds(); scheduleAutoRefresh(); }
    }).catch(()=>{});
  }

  document.getElementById('apply-btn').addEventListener('click',()=>{
    const v=document.getElementById('weather-city-input').value.trim(); if(v) settings.weatherCity=v;
    const rt=document.getElementById('refresh-times-input').value.trim();
    settings.refreshTimes=rt?rt.split(',').map(s=>s.trim()).filter(Boolean):[];
    persistSettings(); closeSettings(); loadAllFeeds(); scheduleAutoRefresh();
  });
}

init();
