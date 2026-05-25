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
};

let settings = loadSettings();
function loadSettings() {
  try { const r = localStorage.getItem('morningDashboard'); return r ? {...DEFAULTS,...JSON.parse(r)} : {...DEFAULTS}; }
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
  const direct = ['https://query1.finance.yahoo.com','https://query2.finance.yahoo.com'].map(base =>
    fetch(`${base}/v7/finance/quote?symbols=${syms}&formatted=false`, {signal:sig(5000)})
      .then(r=>r.text()).then(parse)
  );
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

// ── Quote of the day ──────────────────────────────────────────────────────────
// Refreshes at page load, then again at noon (12:00), 6 PM (18:00), midnight (0:00)

function getQuoteSlot() {
  // Returns 0, 1, 2, or 3 depending on which 6-hour block we're in
  const h = new Date().getHours();
  if (h < 6)  return 0; // midnight–6am
  if (h < 12) return 1; // 6am–noon
  if (h < 18) return 2; // noon–6pm
  return 3;             // 6pm–midnight
}

function scheduleNextQuoteRefresh() {
  const now = new Date();
  const next = new Date(now);
  const h = now.getHours();

  // Find the next refresh boundary: midnight, noon, or 6pm
  if (h < 12)       { next.setHours(12, 0, 0, 0); }
  else if (h < 18)  { next.setHours(18, 0, 0, 0); }
  else              { next.setDate(next.getDate() + 1); next.setHours(0, 0, 0, 0); }

  const msUntilNext = next.getTime() - now.getTime();
  setTimeout(() => {
    renderQuote();
    scheduleNextQuoteRefresh(); // schedule the one after that
  }, msUntilNext);
}

async function renderQuote() {
  const el = document.getElementById('quote-feed');
  el.innerHTML = '<p class="feed-loading">Loading quote&hellip;</p>';

  // Use the random endpoint so each slot gets a fresh quote
  const endpoint = 'https://zenquotes.io/api/random';

  try {
    const resp = await fetch(endpoint, {signal:sig(6000)});
    const [q] = await resp.json();
    el.innerHTML = buildQuoteHtml(q.q, q.a);
  } catch {
    try {
      const contents = await proxyFetch(endpoint, 6000);
      const [q] = JSON.parse(contents);
      el.innerHTML = buildQuoteHtml(q.q, q.a);
    } catch {
      el.innerHTML = '<p class="feed-loading">Quote unavailable.</p>';
    }
  }
}

function buildQuoteHtml(quote, author) {
  return `<div class="quote-card">
    <div class="quote-mark">&ldquo;</div>
    <blockquote class="quote-text">${escHtml(quote)}</blockquote>
    <div class="quote-author">&mdash; ${escHtml(author)}</div>
  </div>`;
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
      const up=s.change>=0,sign=up?'+':'',fmt=n=>n!=null?n.toFixed(2):'--';
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

// ── Section title colors ──────────────────────────────────────────────────────
// Colorizes each section's title underline using existing feed IDs --
// no changes to index.html required.

function applySectionColors() {
  const map = [
    { feedId: 'stocks-feed',     color: '#10b981' }, // emerald
    { feedId: 'quote-feed',      color: '#8b5cf6' }, // violet
    { feedId: 'milestones-feed', color: '#f59e0b' }, // amber
    { feedId: 'news-feed',       color: '#3b82f6' }, // blue
    { feedId: 'people-feed',     color: '#ec4899' }, // pink
    { feedId: 'topics-feed',     color: '#14b8a6' }, // teal
    { feedId: 'clients-feed',    color: '#f97316' }, // orange
    { feedId: 'prospects-feed',  color: '#6366f1' }, // indigo
    { feedId: 'wishlist-feed',   color: '#84cc16' }, // lime
    { feedId: 'f1-feed',         color: '#e10600' }, // F1 red
  ];
  map.forEach(({feedId, color}) => {
    const feed = document.getElementById(feedId);
    if (!feed) return;
    const section = feed.closest('section') || feed.parentElement;
    const title = section && section.querySelector('.section-title');
    if (title) title.style.borderBottomColor = color;
  });
}

function init() {
  updateDateTime(); setInterval(updateDateTime,30000);
  loadAllFeeds();
  applySectionColors();
  scheduleNextQuoteRefresh(); // auto-refresh quote at noon, 6pm, midnight

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
}

init();