'use strict';

const RECENT_DAYS = 14;
const HISTORY_DAYS = 730;
const HIST_PREFIX = 'mdHist_';
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const DEFAULT_BOARD = [
  {name:'Warren Buffett',      title:'Chairman & CEO, Berkshire Hathaway'},
  {name:'Oprah Winfrey',       title:'Media Executive & Philanthropist'},
  {name:'Steve Jobs',          title:'Co-founder & CEO, Apple (1976–2011)'},
  {name:'Marcus Aurelius',     title:'Roman Emperor & Stoic Philosopher (121–180 AD)'},
  {name:'Maya Angelou',        title:'Poet, Author & Civil Rights Activist'},
  {name:'Elon Musk',           title:'CEO, Tesla & SpaceX'},
  {name:'Jeff Bezos',          title:'Founder & Executive Chairman, Amazon'},
  {name:'Michelle Obama',      title:'Former First Lady of the United States'},
  {name:'Winston Churchill',   title:'Prime Minister of the United Kingdom (1940–45, 1951–55)'},
  {name:'Marie Curie',         title:'Physicist & Chemist, Two-time Nobel Laureate'},
  {name:'Abraham Lincoln',     title:'16th President of the United States'},
  {name:'Brené Brown',         title:'Research Professor; Author on Vulnerability & Leadership'},
  {name:'Peter Drucker',       title:'Author & Educator; Father of Modern Management'},
  {name:'Sheryl Sandberg',     title:'Former COO, Meta; Author of Lean In'},
  {name:'Benjamin Franklin',   title:'Founding Father, Inventor & Statesman'},
  {name:'Nelson Mandela',      title:'Former President of South Africa & Anti-Apartheid Leader'},
  {name:'Bill Gates',          title:'Co-founder, Microsoft; Co-chair, Gates Foundation'},
  {name:'Indra Nooyi',         title:'Former CEO, PepsiCo (2006–2018)'},
  {name:'Naval Ravikant',      title:'Co-founder, AngelList; Angel Investor & Philosopher'},
  {name:'Ruth Bader Ginsburg', title:'Associate Justice, U.S. Supreme Court (1993–2020)'},
];

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
  inspirationBoard: DEFAULT_BOARD.map(m => ({...m})),
  blindSpotBoard: [],
  claudeApiKey: '',
  boardModel: 'claude-haiku-4-5-20251001',
};

let settings = loadSettings();
function loadSettings() {
  try {
    const r = localStorage.getItem('morningDashboard');
    if (!r) return {...DEFAULTS};
    const parsed = JSON.parse(r);
    if (parsed.boardMembers && !parsed.inspirationBoard) {
      parsed.inspirationBoard = parsed.boardMembers;
      delete parsed.boardMembers;
    }
    return {...DEFAULTS, ...parsed};
  }
  catch { return {...DEFAULTS}; }
}
function persistSettings() { localStorage.setItem('morningDashboard', JSON.stringify(settings)); }

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
  document.getElementById('greeting').textContent = h<12?'Good Morning':h<17?'Good Afternoon':'Good Evening';
  document.getElementById('datetime').textContent =
    now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) +
    ' · ' + now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
}

// ── CORS proxy (single fast attempt) ─────────────────────────────────────────

async function proxyFetch(url, ms=8000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  const s = ac.signal;
  const allorigins = fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,{signal:s})
    .then(r=>r.json()).then(d=>{if(!d?.contents)throw new Error('empty');return d.contents;});
  const corsproxy = fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`,{signal:s})
    .then(r=>{if(!r.ok)throw new Error(r.status);return r.text();});
  const codetabs  = fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,{signal:s})
    .then(r=>{if(!r.ok)throw new Error(r.status);return r.text();});
  try {
    const result = await Promise.any([allorigins, corsproxy, codetabs]);
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

async function renderMarketBar() {
  const bar = document.getElementById('market-bar');
  const fallback = () => {
    bar.innerHTML = INDEX_META.map(m => {
      const yurl = `https://finance.yahoo.com/quote/${encodeURIComponent(m.symbol)}/`;
      return `<a class="market-item market-item-link" href="${yurl}" target="_blank" rel="noopener">
        <span class="market-label">${m.label}</span>
        <span class="market-price market-tap">tap for quote ↗</span>
      </a>`;
    }).join('');
  };
  try {
    const results = await fetchYahooQuotes(INDEX_META.map(i=>i.symbol));
    bar.innerHTML = results.map(q => {
      const meta = INDEX_META.find(m=>m.symbol===q.symbol); if (!meta) return '';
      const up = q.regularMarketChange >= 0;
      return `<div class="market-item">
        <span class="market-label">${meta.label}</span>
        <span class="market-price">${fmtIndexPrice(meta.fmt, q.regularMarketPrice)}</span>
        <span class="market-chg ${up?'up':'down'}">${up?'▲':'▼'} ${up?'+':''}${q.regularMarketChangePercent.toFixed(2)}%</span>
      </div>`;
    }).join('');
  } catch { fallback(); }
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

function renderWeather(location, attempt=1) {
  const el = document.getElementById('weather-content');
  if (attempt===1) el.innerHTML = '<span class="weather-loading">Loading weather&hellip;</span>';
  fetchWeather(location).then(({wx,displayName})=>{
    const cur = wx.current;
    el.innerHTML = `<div class="weather-card">
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
  }).catch(()=>{
    if (attempt<3) { setTimeout(()=>renderWeather(location,attempt+1), 3000); return; }
    el.innerHTML = `<span class="weather-error">Could not load weather for &ldquo;${escHtml(location)}&rdquo;. Check Settings or try refreshing.</span>`;
  });
}

// ── Quote of the day (ZenQuotes, CORS-native) ─────────────────────────────────

async function renderQuote() {
  const el = document.getElementById('quote-feed');
  el.innerHTML = '<p class="feed-loading">Loading quote&hellip;</p>';
  try {
    const resp = await fetch('https://zenquotes.io/api/today', {signal:sig(6000)});
    const [q] = await resp.json();
    el.innerHTML = `<div class="quote-card">
      <div class="quote-mark">&ldquo;</div>
      <blockquote class="quote-text">${escHtml(q.q)}</blockquote>
      <div class="quote-author">&mdash; ${escHtml(q.a)}</div>
    </div>`;
  } catch {
    try {
      const contents = await proxyFetch('https://zenquotes.io/api/today', 6000);
      const [q] = JSON.parse(contents);
      el.innerHTML = `<div class="quote-card">
        <div class="quote-mark">&ldquo;</div>
        <blockquote class="quote-text">${escHtml(q.q)}</blockquote>
        <div class="quote-author">&mdash; ${escHtml(q.a)}</div>
      </div>`;
    } catch {
      el.innerHTML = '<p class="feed-loading">Quote unavailable today.</p>';
    }
  }
}

// ── Special Dates ─────────────────────────────────────────────────────────────

function daysUntil(month, day) {
  const today = new Date(); today.setHours(0,0,0,0);
  let target = new Date(today.getFullYear(), month-1, day);
  if (target < today) target.setFullYear(today.getFullYear()+1);
  return Math.round((target-today)/86400000);
}

function renderMilestones() {
  const el = document.getElementById('milestones-feed');
  const {milestones} = settings;
  if (!milestones.length) {
    el.innerHTML = '<p class="milestone-empty">No special dates added yet. Open Settings to add birthdays, anniversaries, and more.</p>';
    return;
  }
  const thisYear = new Date().getFullYear();
  const enriched = milestones.map(m=>({...m,days:daysUntil(m.month,m.day)})).sort((a,b)=>a.days-b.days);
  const toShow = enriched.filter(m=>m.days<=30).length > 0 ? enriched : enriched.slice(0,5);
  el.innerHTML = `<div class="milestone-list">${toShow.map(m=>{
    const today2=m.days===0, soon=m.days<=7&&m.days>1;
    const when = today2?'&#x1F382; Today!':m.days===1?'Tomorrow':m.days<=30?`In ${m.days} days`:`${MONTH_SHORT[m.month-1]} ${m.day}`;
    const yrs = m.year&&(thisYear-m.year)>0 ? `${thisYear-m.year} year${thisYear-m.year>1?'s':''}` : null;
    return `<div class="milestone-item ${today2?'is-today':soon?'is-soon':''}">
      <div><div class="milestone-title">${escHtml(m.title)}</div>${yrs?`<div class="milestone-years">${yrs}</div>`:''}</div>
      <div class="milestone-when">${when}<br><span style="opacity:0.7">${MONTH_SHORT[m.month-1]} ${m.day}</span></div>
    </div>`;
  }).join('')}</div>`;
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

// ── News fetching ─────────────────────────────────────────────────────────────

function parseXmlItems(xml, limit) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const items = Array.from(doc.querySelectorAll('item')).slice(0, limit);
  if (!items.length) throw new Error('no items');
  return items.map(item=>({
    title: item.querySelector('title')?.textContent??'',
    link:  item.querySelector('link')?.textContent?.trim()??'#',
    date:  item.querySelector('pubDate')?.textContent??'',
    source:item.querySelector('source')?.textContent??'',
  }));
}

async function fetchNews(query, limit=8) {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  // Race rss2json (no proxy) vs. parallel proxy race — first winner is used
  const viaRss2json = fetch(
    `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&count=${limit}`,
    {signal: sig(8000)}
  ).then(r=>r.json()).then(data=>{
    if (data.status!=='ok'||!data.items?.length) throw new Error('rss2json empty');
    return data.items.map(i=>({title:i.title||'',link:i.link||'#',date:i.pubDate||'',source:i.author||''}));
  });
  const viaProxy = proxyFetch(rssUrl, 8000).then(xml=>parseXmlItems(xml, limit));
  return Promise.any([viaRss2json, viaProxy]);
}

// ── Feed rendering ────────────────────────────────────────────────────────────

function buildNewsCard(label, items) {
  const todayItems = (items||[]).filter(i=>isToday(i.date));
  const body = todayItems.length===0
    ? `<p class="feed-loading">No articles today yet &mdash; check back later.</p>`
    : `<ul class="news-list">${todayItems.map(i=>articleRow(i)).join('')}</ul>`;
  return `<div class="feed-card"><div class="feed-card-label"><span class="label-dot"></span>${escHtml(label)}</div>${body}</div>`;
}

function loadSection(containerId, items, prefix) {
  const container = document.getElementById(containerId);
  if (!items.length) { container.innerHTML = buildEmptyState('Nothing here yet.','Open Settings to add some entries.'); return; }
  container.innerHTML = items.map(item=>`
    <div class="feed-card is-loading" id="${toCardId(prefix,item)}">
      <div class="feed-card-label"><span class="label-dot"></span>${escHtml(item)}</div>
      <p class="feed-loading">Loading&hellip;</p>
    </div>`).join('');
  items.forEach(async item=>{
    const cardId = toCardId(prefix,item);
    let newsItems=null;
    try { newsItems=await fetchNews(item); } catch {}
    const ph=document.getElementById(cardId);
    if (ph) ph.outerHTML=newsItems===null
      ? `<div class="feed-card"><div class="feed-card-label"><span class="label-dot"></span>${escHtml(item)}</div><p class="feed-loading">Could not load &mdash; try refreshing.</p></div>`
      : buildNewsCard(item,newsItems);
  });
}

// ── Contact cards ─────────────────────────────────────────────────────────────

function contactLabel(e) { return [e.name,e.company].filter(Boolean).join(' · '); }

function buildContactCard(entity, allArticles) {
  const recent=filterRecent(allArticles);
  const recentBody=recent.length>0
    ? `<ul class="news-list">${recent.map(a=>articleRow(a,false)).join('')}</ul>`
    : `<p class="feed-loading">No news in the last ${RECENT_DAYS} days.</p>`;
  const histBody=allArticles.length>0
    ? `<ul class="news-list">${allArticles.map(a=>articleRow(a,true)).join('')}</ul>`
    : `<p class="feed-loading">History will build each time you open the dashboard.</p>`;
  return `<div class="feed-card contact-card">
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
  container.innerHTML=entities.map(entity=>`
    <div class="feed-card contact-card is-loading" id="${toCardId(prefix,entity.name+entity.company)}">
      <div class="feed-card-label"><span class="label-dot"></span>${escHtml(contactLabel(entity))}</div>
      <p class="feed-loading">Loading&hellip;</p>
    </div>`).join('');
  wireTabSwitching(container);
  entities.forEach(async entity=>{
    const key=histKey(entity.name,entity.company);
    const cardId=toCardId(prefix,entity.name+entity.company);
    const query=[entity.name,entity.company].filter(Boolean).map(s=>`"${s}"`).join(' OR ');
    let fresh=[];
    try { fresh=await fetchNews(query,20); } catch {}
    const allArticles=mergeHistory(key,fresh);
    const ph=document.getElementById(cardId);
    if (ph) { const tmp=document.createElement('div'); tmp.innerHTML=buildContactCard(entity,allArticles); ph.replaceWith(tmp.firstElementChild); }
  });
}

// ── Stocks ────────────────────────────────────────────────────────────────────

async function fetchStocks(symbols) {
  if (!symbols.length) return [];
  const results = await fetchYahooQuotes(symbols);
  return (results||[]).map(q=>({
    symbol:q.symbol, name:q.shortName||q.longName||q.symbol,
    price:q.regularMarketPrice, change:q.regularMarketChange,
    changePct:q.regularMarketChangePercent,
    time:q.regularMarketTime?new Date(q.regularMarketTime*1000).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}):'',
  }));
}

function renderStocks(tickers) {
  const container=document.getElementById('stocks-feed');
  if (!tickers.length) { container.innerHTML=buildEmptyState('No tickers added.','Open Settings to add stock symbols.'); return; }
  container.innerHTML=`<div class="stock-card"><p class="feed-loading">Loading&hellip;</p></div>`;
  fetchStocks(tickers).then(stocks=>{
    if (!stocks.length) { container.innerHTML=buildEmptyState('No data returned.','Check your ticker symbols.'); return; }
    container.innerHTML=stocks.map(s=>{
      const up=s.change>=0,sign=up?'+':'',fmt=n=>n!=null?n.toFixed(2):'—';
      return `<div class="stock-card ${up?'up':'down'}">
        <div class="stock-symbol">${escHtml(s.symbol)}</div>
        <div class="stock-name">${escHtml(s.name)}</div>
        <div class="stock-price">$${fmt(s.price)}</div>
        <div class="stock-change">${sign}${fmt(s.change)} (${sign}${fmt(s.changePct)}%)</div>
        ${s.time?`<div class="stock-time">As of ${s.time}</div>`:''}
      </div>`;
    }).join('');
  }).catch(()=>{ container.innerHTML=buildEmptyState('Stock data unavailable.','Markets may be closed or the service is down.'); });
}

// ── F-1 ───────────────────────────────────────────────────────────────────────

async function renderF1() {
  const container=document.getElementById('f1-feed');
  container.innerHTML=`<div class="f1-card"><div class="f1-eyebrow"><span class="f1-dot"></span>Formula 1</div><p class="feed-loading">Loading&hellip;</p></div>`;
  let items=[];
  try { items=await fetchNews('"Formula 1" OR "Formula One" OR "F1" Grand Prix',15); } catch {}
  const fresh=items.filter(i=>i.date&&(Date.now()-new Date(i.date).getTime())<86400000);
  const article=fresh[0]||items[0];
  if (!article) { container.innerHTML=`<div class="f1-card"><div class="f1-eyebrow"><span class="f1-dot"></span>Formula 1</div><p class="f1-stale">No recent news found.</p></div>`; return; }
  const isFresh=fresh.length>0;
  const date=article.date?new Date(article.date).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
  container.innerHTML=`<div class="f1-card">
    <div class="f1-eyebrow"><span class="f1-dot"></span>Formula 1 ${isFresh?'<span class="f1-fresh">&#x25CF; LIVE</span>':''}</div>
    <a class="f1-headline" href="${escHtml(article.link)}" target="_blank" rel="noopener noreferrer">${escHtml(article.title)}</a>
    <div class="f1-meta">${article.source?escHtml(article.source)+(date?' &bull; ':''):''}${date}${!isFresh?'<br><span class="f1-stale">No updates in 24h &mdash; showing latest</span>':''}</div>
  </div>`;
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

// ── Board of Directors ────────────────────────────────────────────────────────

function memberHue(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return h % 360;
}

function memberInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function rosterChipsHTML(members) {
  return members.map(m => {
    const hue = memberHue(m.name);
    return `<span class="board-roster-chip" style="background:hsl(${hue},45%,20%);border-color:hsl(${hue},45%,40%);color:hsl(${hue},75%,84%)">${escHtml(m.name)}</span>`;
  }).join('');
}

function renderBoardEmptyState(boardType) {
  const panel = document.getElementById(`board-panel-${boardType}`);
  if (!panel) return;
  const isInspiration = boardType === 'inspiration';
  const colorClass = isInspiration ? 'gold' : 'purple';
  const icon = isInspiration ? '&#9733;' : '&#9671;';
  const boardName = isInspiration ? 'My Inspiration Board' : 'My Blind Spot Board';
  const members = (isInspiration ? settings.inspirationBoard : settings.blindSpotBoard) || [];
  const settingsLabel = isInspiration ? 'My Inspiration Board' : 'My Blind Spot Board';
  panel.innerHTML = `<div class="bpe bpe--${colorClass}">
    <div class="bpe-icon">${icon}</div>
    <p class="bpe-title">${boardName}</p>
    ${members.length
      ? `<div class="board-roster board-roster--${colorClass}">${rosterChipsHTML(members)}</div><p class="bpe-hint">Ask a question above to hear from these advisors.</p>`
      : `<p class="bpe-hint">No members yet. Open Settings under &ldquo;${settingsLabel}&rdquo; to add some.</p>`}
  </div>`;
}

function syncBoardEmptyState(boardType) {
  const panel = document.getElementById(`board-panel-${boardType}`);
  if (!panel || !panel.querySelector('.bpe')) return;
  renderBoardEmptyState(boardType);
}

function openBoardRoom() {
  document.getElementById('board-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('board-question-input').focus();
}

function closeBoardRoom() {
  document.getElementById('board-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function switchBoardTab(tab) {
  document.querySelectorAll('.board-tab-btn').forEach(btn =>
    btn.classList.toggle('board-tab-btn--active', btn.dataset.tab === tab)
  );
  document.querySelectorAll('.board-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`board-panel-${tab}`).classList.remove('hidden');
}

async function streamClaudeSSE(apiKey, model, systemPrompt, userPrompt, onChunk, maxTokens = 600) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model, max_tokens: maxTokens, stream: true,
      system: systemPrompt,
      messages: [{role: 'user', content: userPrompt}],
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${resp.status}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const evt = JSON.parse(data);
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') onChunk(evt.delta.text);
      } catch {}
    }
  }
}

function memberSystemPrompt(member) {
  return `You are channeling ${member.name} — ${member.title} — for a personal advisory thought experiment. Based on everything documented about ${member.name}: their writings, speeches, interviews, philosophy, values, decision-making frameworks, and personality, respond exactly as ${member.name} authentically would. Speak in their distinctive voice and style, using their characteristic frameworks and vocabulary. If they would challenge the premise, do so in their way. Do not open with "As ${member.name}..." — speak directly in the first person.`;
}

function buildMemberUserPrompt(question, myAnswer) {
  if (!myAnswer) return question;
  return `I'm considering this question: ${question}\n\nMy current thinking is:\n"${myAnswer}"\n\nPlease respond in 3 paragraphs: (1) What you find wise or insightful in my thinking, (2) What concerns you or seems unwise or incomplete, (3) What important perspective I might be missing — then share your own take on the question.`;
}

function createMemberCard(member) {
  const hue = memberHue(member.name);
  const card = document.createElement('div');
  card.className = 'board-member-card board-member-card--loading';
  card.dataset.memberName = member.name;
  card.innerHTML = `
    <div class="board-member-head">
      <div class="board-member-avatar" style="background:hsl(${hue},52%,40%)">${escHtml(memberInitials(member.name))}</div>
      <div class="board-member-info">
        <div class="board-member-name">${escHtml(member.name)}</div>
        <div class="board-member-title">${escHtml(member.title)}</div>
      </div>
      <div class="board-member-status"></div>
    </div>
    <div class="board-member-response"><span class="board-typing">Thinking…</span></div>`;
  return card;
}

function initBoardPanel(boardType, question, myAnswer, members) {
  const panel = document.getElementById(`board-panel-${boardType}`);
  const isInspiration = boardType === 'inspiration';
  const colorClass = isInspiration ? 'gold' : 'purple';
  const icon = isInspiration ? '&#9733;' : '&#9671;';
  const boardName = isInspiration ? 'My Inspiration Board' : 'My Blind Spot Board';

  if (!members.length) {
    panel.innerHTML = `<div class="bpe bpe--${colorClass}">
      <div class="bpe-icon">${icon}</div>
      <p class="bpe-title">${boardName}</p>
      <p class="bpe-hint">No members yet. Open Settings to add some.</p>
    </div>`;
    return;
  }

  panel.innerHTML = `
    <div class="board-roster board-roster--${colorClass}">${rosterChipsHTML(members)}</div>
    <div class="board-question-echo">&ldquo;${escHtml(question)}&rdquo;</div>
    ${myAnswer ? `<div class="board-my-answer-echo"><strong>Your thinking:</strong> ${escHtml(myAnswer)}</div>` : ''}
    <div class="board-members-grid" id="grid-${boardType}"></div>
    <div class="board-summary-card board-summary-card--${colorClass} board-summary-card--loading" id="summary-${boardType}">
      <div class="board-summary-head">${boardName} — Summary</div>
      <div class="board-summary-body" id="summary-body-${boardType}"><span class="board-typing">Waiting for all advisors…</span></div>
    </div>`;

  const grid = document.getElementById(`grid-${boardType}`);
  members.forEach(member => grid.appendChild(createMemberCard(member)));
}

function initComparePanel(question, myAnswer) {
  const panel = document.getElementById('board-panel-compare');
  panel.innerHTML = `
    <div class="board-question-echo">&ldquo;${escHtml(question)}&rdquo;</div>
    ${myAnswer ? `<div class="board-my-answer-echo"><strong>Your thinking:</strong> ${escHtml(myAnswer)}</div>` : ''}
    <div class="board-compare-cols">
      <div class="board-compare-col board-compare-col--inspiration">
        <div class="board-compare-col-head"><span class="btab-dot btab-dot--gold"></span>My Inspiration Board</div>
        <div class="board-compare-col-body" id="compare-body-inspiration"><span class="board-typing">Waiting…</span></div>
      </div>
      <div class="board-compare-col board-compare-col--blindspot">
        <div class="board-compare-col-head"><span class="btab-dot btab-dot--purple"></span>My Blind Spot Board</div>
        <div class="board-compare-col-body" id="compare-body-blindspot"><span class="board-typing">Waiting…</span></div>
      </div>
    </div>
    <div class="board-conclusion-card board-conclusion-card--loading" id="board-conclusion-card">
      <div class="board-conclusion-head">&#9889; Cross-Board Conclusion</div>
      <div class="board-conclusion-subhead">Common ground &bull; Key tensions &bull; How to discuss both</div>
      <div class="board-conclusion-body" id="board-conclusion-body"><span class="board-typing">Waiting for both boards…</span></div>
    </div>`;
}

async function streamBoardMembers(boardType, members, question, myAnswer, apiKey, model) {
  const responses = {};
  const grid = document.getElementById(`grid-${boardType}`);
  if (!grid) return responses;

  await Promise.all(members.map(async member => {
    const card = grid.querySelector(`[data-member-name="${CSS.escape(member.name)}"]`);
    if (!card) return;
    const responseEl = card.querySelector('.board-member-response');
    const statusEl   = card.querySelector('.board-member-status');
    let text = '';
    try {
      await streamClaudeSSE(apiKey, model, memberSystemPrompt(member), buildMemberUserPrompt(question, myAnswer), chunk => {
        if (!text) responseEl.innerHTML = '';
        text += chunk;
        responseEl.textContent = text;
      });
      responses[member.name] = text;
      card.classList.remove('board-member-card--loading');
      card.classList.add('board-member-card--done');
      statusEl.classList.add('board-member-status--done');
    } catch (err) {
      card.classList.remove('board-member-card--loading');
      card.classList.add('board-member-card--error');
      statusEl.classList.add('board-member-status--error');
      responseEl.textContent = `Could not reach this advisor: ${err.message}`;
      responses[member.name] = null;
    }
  }));
  return responses;
}

async function generateBoardSummary(boardType, question, myAnswer, responses, apiKey, model) {
  const summaryCardEl = document.getElementById(`summary-${boardType}`);
  const summaryBodyEl = document.getElementById(`summary-body-${boardType}`);
  const compareBodyEl = document.getElementById(`compare-body-${boardType}`);
  if (summaryCardEl) summaryCardEl.classList.remove('board-summary-card--loading');

  const valid = Object.entries(responses).filter(([, t]) => t);
  if (!valid.length) {
    const msg = 'No responses received.';
    if (summaryBodyEl) summaryBodyEl.textContent = msg;
    if (compareBodyEl) compareBodyEl.textContent = msg;
    return '';
  }

  const isInspiration = boardType === 'inspiration';
  const boardName = isInspiration ? 'Inspiration Board' : 'Blind Spot Board';
  const boardDesc = isInspiration ? 'advisors whose views the questioner admires' : 'advisors with different views from the questioner';
  const responseBlock = valid.map(([name, t]) => `${name}:\n${t}`).join('\n\n---\n\n');

  let userPrompt = `Your ${boardName} — ${boardDesc} — responded to: "${question}"\n\n${responseBlock}\n\n`;
  if (myAnswer) userPrompt += `The questioner's current thinking: "${myAnswer}"\n\n`;
  userPrompt += isInspiration
    ? `Write a 3-paragraph synthesis. Cover the key themes, note interesting differences within this board, and distill the most actionable guidance. Speak directly to the questioner ("you").`
    : `Write a 3-paragraph synthesis. These advisors hold different views. Focus on what they see differently, what the questioner may be underestimating or missing, and where they push back most strongly. Be direct, not diplomatic. Speak directly to the questioner ("you").`;

  const sysPrompt = isInspiration
    ? 'You synthesize advice from a personal inspiration board into a clear, actionable summary.'
    : 'You synthesize perspectives from a blind spot advisory board — people with fundamentally different views — into an honest summary of what they see differently.';

  if (summaryBodyEl) summaryBodyEl.innerHTML = '<span class="board-typing">Writing summary…</span>';
  if (compareBodyEl) compareBodyEl.innerHTML = '<span class="board-typing">Writing summary…</span>';
  let text = '';

  try {
    await streamClaudeSSE(apiKey, model, sysPrompt, userPrompt, chunk => {
      if (!text) {
        if (summaryBodyEl) summaryBodyEl.innerHTML = '';
        if (compareBodyEl) compareBodyEl.innerHTML = '';
      }
      text += chunk;
      if (summaryBodyEl) summaryBodyEl.textContent = text;
      if (compareBodyEl) compareBodyEl.textContent = text;
    }, 800);
    if (summaryCardEl) summaryCardEl.classList.add('board-summary-card--done');
    return text;
  } catch (err) {
    const msg = `Summary error: ${err.message}`;
    if (summaryBodyEl) summaryBodyEl.textContent = msg;
    if (compareBodyEl) compareBodyEl.textContent = msg;
    return '';
  }
}

async function generateConclusion(question, myAnswer, inspirationSummary, blindspotSummary, apiKey, model) {
  const conclusionCard = document.getElementById('board-conclusion-card');
  const conclusionBody = document.getElementById('board-conclusion-body');
  if (!conclusionBody) return;
  if (conclusionCard) conclusionCard.classList.remove('board-conclusion-card--loading');

  let userPrompt = `Two advisory boards responded to: "${question}"\n\nINSPIRATION BOARD SUMMARY (people the questioner admires):\n${inspirationSummary}\n\nBLIND SPOT BOARD SUMMARY (people with different views):\n${blindspotSummary}\n\n`;
  if (myAnswer) userPrompt += `The questioner's current thinking: "${myAnswer}"\n\n`;
  userPrompt += `Write a 4–5 paragraph cross-board conclusion:\n1. Genuine common ground — what both boards actually agree on despite their differences\n2. The core tension — where the boards fundamentally diverge and why it matters\n3. What the Blind Spot board sees that the Inspiration board underweights or misses\n4. Specific language and framing to discuss both perspectives tactfully with people who hold very different views\n${myAnswer ? '5. How the questioner’s own thinking holds up against the combined wisdom of both boards\n' : ''}Be direct and specific. Avoid vague diplomatic hedging.`;

  const sysPrompt = 'You write cross-board syntheses comparing an Inspiration Board against a Blind Spot Board. Find genuine common ground, articulate real tensions honestly, and give practical advice on bridging the gap.';

  conclusionBody.innerHTML = '<span class="board-typing">Writing conclusion…</span>';
  let text = '';
  try {
    await streamClaudeSSE(apiKey, model, sysPrompt, userPrompt, chunk => {
      if (!text) conclusionBody.innerHTML = '';
      text += chunk;
      conclusionBody.textContent = text;
    }, 1200);
    if (conclusionCard) conclusionCard.classList.add('board-conclusion-card--done');
  } catch (err) {
    conclusionBody.textContent = `Conclusion error: ${err.message}`;
  }
}

async function askBothBoards(question, myAnswer) {
  const apiKey = (settings.claudeApiKey || '').trim();
  const model  = settings.boardModel || 'claude-haiku-4-5-20251001';
  const inspirationMembers = settings.inspirationBoard || [];
  const blindspotMembers   = settings.blindSpotBoard   || [];

  if (!apiKey) { alert('Please add your Anthropic API key in Settings under "Board of Directors."'); return; }
  if (!inspirationMembers.length && !blindspotMembers.length) { alert('No board members found. Open Settings to add some.'); return; }

  const askBtn = document.getElementById('board-ask-btn');
  askBtn.disabled = true;
  askBtn.textContent = 'Asking…';

  initBoardPanel('inspiration', question, myAnswer, inspirationMembers);
  initBoardPanel('blindspot',   question, myAnswer, blindspotMembers);
  initComparePanel(question, myAnswer);

  let inspirationResponses = {}, blindspotResponses = {};
  await Promise.all([
    inspirationMembers.length ? streamBoardMembers('inspiration', inspirationMembers, question, myAnswer, apiKey, model).then(r => { inspirationResponses = r; }) : Promise.resolve(),
    blindspotMembers.length   ? streamBoardMembers('blindspot',   blindspotMembers,   question, myAnswer, apiKey, model).then(r => { blindspotResponses   = r; }) : Promise.resolve(),
  ]);

  let inspirationSummary = '', blindspotSummary = '';
  await Promise.all([
    inspirationMembers.length ? generateBoardSummary('inspiration', question, myAnswer, inspirationResponses, apiKey, model).then(s => { inspirationSummary = s; }) : Promise.resolve(),
    blindspotMembers.length   ? generateBoardSummary('blindspot',   question, myAnswer, blindspotResponses,   apiKey, model).then(s => { blindspotSummary   = s; }) : Promise.resolve(),
  ]);

  if (inspirationSummary && blindspotSummary) {
    await generateConclusion(question, myAnswer, inspirationSummary, blindspotSummary, apiKey, model);
  } else {
    const conclusionBody = document.getElementById('board-conclusion-body');
    const conclusionCard = document.getElementById('board-conclusion-card');
    if (conclusionBody) conclusionBody.textContent = 'Add members to both boards to see a cross-board conclusion.';
    if (conclusionCard) conclusionCard.classList.remove('board-conclusion-card--loading');
  }

  askBtn.disabled = false;
  askBtn.textContent = 'Ask Boards';
}

// ── Board settings UI ─────────────────────────────────────────────────────────

function renderBoardTagsFor(containerId, members, settingsKey, renderFn) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = members.map((m, i) =>
    `<span class="tag">${escHtml(m.name)}<span class="tag-remove" data-key="${settingsKey}" data-index="${i}" title="Remove">&#x2715;</span></span>`
  ).join('');
  c.querySelectorAll('.tag-remove').forEach(btn =>
    btn.addEventListener('click', () => {
      settings[btn.dataset.key].splice(parseInt(btn.dataset.index, 10), 1);
      renderFn();
    })
  );
}

function renderInspirationTags() {
  renderBoardTagsFor('inspiration-tags', settings.inspirationBoard || [], 'inspirationBoard', renderInspirationTags);
  syncBoardEmptyState('inspiration');
}
function renderBlindspotTags() {
  renderBoardTagsFor('blindspot-tags', settings.blindSpotBoard || [], 'blindSpotBoard', renderBlindspotTags);
  syncBoardEmptyState('blindspot');
}

function addBoardMemberFor(nameId, titleId, settingsKey, renderFn) {
  const nameInput  = document.getElementById(nameId);
  const titleInput = document.getElementById(titleId);
  const name  = nameInput.value.trim();
  const title = titleInput.value.trim();
  if (!name) return;
  if (!settings[settingsKey]) settings[settingsKey] = [];
  if (!settings[settingsKey].some(m => m.name === name)) settings[settingsKey].push({name, title});
  nameInput.value = ''; titleInput.value = '';
  renderFn();
  nameInput.focus();
}

function syncBoardSettingsUI() {
  const keyInput = document.getElementById('claude-api-key-input');
  if (keyInput) keyInput.value = settings.claudeApiKey || '';
  const model = settings.boardModel || 'claude-haiku-4-5-20251001';
  const haiku  = document.getElementById('model-haiku');
  const sonnet = document.getElementById('model-sonnet');
  if (haiku)  haiku.checked  = model === 'claude-haiku-4-5-20251001';
  if (sonnet) sonnet.checked = model === 'claude-sonnet-4-6';
  renderInspirationTags();
  renderBlindspotTags();
}

// ── Load all ──────────────────────────────────────────────────────────────────

function loadAllFeeds() {
  loadSection('news-feed', settings.newsTopics, 'news');
  loadSection('people-feed', settings.people, 'person');
  loadSection('topics-feed', settings.topics, 'topic');
  loadContactSection('clients-feed', settings.clients, 'client', 'Open Settings to add your clients.');
  loadContactSection('prospects-feed', settings.prospects, 'prospect', 'Open Settings to add your prospects.');
  renderStocks(settings.tickers);
  renderWishlist(settings.wishlist);
  renderMilestones();
  renderF1();
  renderQuote();
  renderMarketBar();
  renderWeather(settings.weatherCity);
}

// ── Settings modal ────────────────────────────────────────────────────────────

function openSettings()  { syncSettingsUI(); document.getElementById('overlay').classList.remove('hidden'); document.getElementById('settings-modal').classList.remove('hidden'); }
function closeSettings() { document.getElementById('overlay').classList.add('hidden'); document.getElementById('settings-modal').classList.add('hidden'); }

function syncSettingsUI() {
  document.getElementById('weather-city-input').value = settings.weatherCity;
  renderTags('news-topics-tags', settings.newsTopics, 'newsTopics');
  renderTags('people-tags', settings.people, 'people');
  renderTags('topics-tags', settings.topics, 'topics');
  renderContactTags('clients-tags', settings.clients, 'clients');
  renderContactTags('prospects-tags', settings.prospects, 'prospects');
  renderTags('stocks-tags', settings.tickers, 'tickers');
  renderTags('wishlist-tags', settings.wishlist, 'wishlist');
  renderMilestoneTags();
  syncBoardSettingsUI();
}

function renderTags(containerId, list, key) {
  const c=document.getElementById(containerId);
  c.innerHTML=list.map((item,i)=>`<span class="tag">${escHtml(item)}<span class="tag-remove" data-key="${key}" data-index="${i}" title="Remove">&#x2715;</span></span>`).join('');
  c.querySelectorAll('.tag-remove').forEach(btn=>btn.addEventListener('click',()=>{ settings[btn.dataset.key].splice(parseInt(btn.dataset.index,10),1); renderTags(containerId,settings[btn.dataset.key],btn.dataset.key); }));
}

function renderContactTags(containerId, list, key) {
  const c=document.getElementById(containerId);
  c.innerHTML=list.map((item,i)=>`<span class="tag">${escHtml([item.name,item.company].filter(Boolean).join(' · '))}<span class="tag-remove" data-key="${key}" data-index="${i}" title="Remove">&#x2715;</span></span>`).join('');
  c.querySelectorAll('.tag-remove').forEach(btn=>btn.addEventListener('click',()=>{ settings[btn.dataset.key].splice(parseInt(btn.dataset.index,10),1); renderContactTags(containerId,settings[btn.dataset.key],btn.dataset.key); }));
}

function renderMilestoneTags() {
  const c=document.getElementById('milestones-tags');
  c.innerHTML=settings.milestones.map((m,i)=>{
    const label=`${m.title} · ${MONTH_SHORT[m.month-1]} ${m.day}${m.year?` (since ${m.year})`:''}`;
    return `<span class="tag">${escHtml(label)}<span class="tag-remove" data-type="ms" data-index="${i}" title="Remove">&#x2715;</span></span>`;
  }).join('');
  c.querySelectorAll('.tag-remove[data-type="ms"]').forEach(btn=>btn.addEventListener('click',()=>{ settings.milestones.splice(parseInt(btn.dataset.index,10),1); renderMilestoneTags(); }));
}

function addItem(key, inputId, tagsId) {
  const input=document.getElementById(inputId); let val=input.value.trim();
  if (key==='tickers') val=val.toUpperCase(); if (!val) return;
  if (!settings[key].includes(val)) settings[key].push(val);
  input.value=''; renderTags(tagsId,settings[key],key); input.focus();
}

function addContact(key, nameId, companyId, tagsId) {
  const name=document.getElementById(nameId).value.trim(), company=document.getElementById(companyId).value.trim();
  if (!name&&!company) return;
  if (!settings[key].some(e=>e.name===name&&e.company===company)) settings[key].push({name,company});
  document.getElementById(nameId).value=''; document.getElementById(companyId).value='';
  renderContactTags(tagsId,settings[key],key); document.getElementById(nameId).focus();
}

function addMilestone() {
  const title=document.getElementById('ms-title').value.trim();
  const month=parseInt(document.getElementById('ms-month').value,10);
  const day=parseInt(document.getElementById('ms-day').value,10);
  const year=parseInt(document.getElementById('ms-year').value,10)||null;
  if (!title||!month||!day||day<1||day>31) return;
  if (!settings.milestones.some(m=>m.title===title&&m.month===month&&m.day===day)) settings.milestones.push({title,month,day,year});
  document.getElementById('ms-title').value=''; document.getElementById('ms-month').value='';
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
  loadAllFeeds();
  document.getElementById('settings-btn').addEventListener('click',openSettings);
  document.getElementById('close-settings').addEventListener('click',closeSettings);
  document.getElementById('overlay').addEventListener('click',closeSettings);
  document.getElementById('save-city-btn').addEventListener('click',()=>{ const v=document.getElementById('weather-city-input').value.trim(); if(v) settings.weatherCity=v; });
  wireAddButton('add-news-topic-btn','news-topic-input','news-topics-tags','newsTopics');
  wireAddButton('add-person-btn','person-input','people-tags','people');
  wireAddButton('add-topic-btn','topic-input','topics-tags','topics');
  wireAddButton('add-stock-btn','stock-input','stocks-tags','tickers');
  wireAddButton('add-wishlist-btn','wishlist-input','wishlist-tags','wishlist');
  wireContactAdd('add-client-btn','client-name-input','client-company-input','clients-tags','clients');
  wireContactAdd('add-prospect-btn','prospect-name-input','prospect-company-input','prospects-tags','prospects');
  document.getElementById('add-ms-btn').addEventListener('click',addMilestone);
  ['ms-title','ms-month','ms-day','ms-year'].forEach(id=>document.getElementById(id).addEventListener('keydown',e=>{ if(e.key==='Enter') addMilestone(); }));
  document.getElementById('export-settings-btn').addEventListener('click', exportSettings);
  document.getElementById('import-settings-input').addEventListener('change', e => importSettings(e.target.files[0]));

  document.getElementById('apply-btn').addEventListener('click',()=>{
    const v=document.getElementById('weather-city-input').value.trim(); if(v) settings.weatherCity=v;
    persistSettings(); closeSettings(); loadAllFeeds();
  });

  // Board Room
  renderBoardEmptyState('inspiration');
  renderBoardEmptyState('blindspot');
  document.getElementById('board-btn').addEventListener('click', openBoardRoom);
  document.getElementById('close-board').addEventListener('click', closeBoardRoom);

  document.getElementById('board-tab-strip').addEventListener('click', e => {
    const btn = e.target.closest('.board-tab-btn');
    if (btn) switchBoardTab(btn.dataset.tab);
  });

  const boardQuestionInput = document.getElementById('board-question-input');
  const boardAskBtn = document.getElementById('board-ask-btn');
  function triggerAskBoards() {
    const q = boardQuestionInput.value.trim();
    const myAnswer = document.getElementById('board-my-answer-input').value.trim();
    if (!q || boardAskBtn.disabled) return;
    askBothBoards(q, myAnswer || null);
  }
  boardAskBtn.addEventListener('click', triggerAskBoards);
  boardQuestionInput.addEventListener('keydown', e => { if (e.key === 'Enter') triggerAskBoards(); });

  document.getElementById('board-my-answer-btn').addEventListener('click', () => {
    const area = document.getElementById('board-my-answer-area');
    const btn  = document.getElementById('board-my-answer-btn');
    const isOpen = !area.classList.contains('hidden');
    area.classList.toggle('hidden', isOpen);
    btn.textContent = isOpen ? '+ Share your thinking first (optional)' : '− Hide your thinking';
    if (!isOpen) document.getElementById('board-my-answer-input').focus();
  });

  document.getElementById('save-api-key-btn').addEventListener('click', () => {
    settings.claudeApiKey = document.getElementById('claude-api-key-input').value.trim();
  });
  document.querySelectorAll('input[name="board-model"]').forEach(radio =>
    radio.addEventListener('change', e => { settings.boardModel = e.target.value; })
  );

  document.getElementById('add-inspiration-btn').addEventListener('click', () =>
    addBoardMemberFor('inspiration-name-input', 'inspiration-title-input', 'inspirationBoard', renderInspirationTags)
  );
  ['inspiration-name-input','inspiration-title-input'].forEach(id =>
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') addBoardMemberFor('inspiration-name-input', 'inspiration-title-input', 'inspirationBoard', renderInspirationTags);
    })
  );
  document.getElementById('add-blindspot-btn').addEventListener('click', () =>
    addBoardMemberFor('blindspot-name-input', 'blindspot-title-input', 'blindSpotBoard', renderBlindspotTags)
  );
  ['blindspot-name-input','blindspot-title-input'].forEach(id =>
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') addBoardMemberFor('blindspot-name-input', 'blindspot-title-input', 'blindSpotBoard', renderBlindspotTags);
    })
  );
}

init();
