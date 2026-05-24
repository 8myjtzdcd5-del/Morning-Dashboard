# Morning Dashboard

A personal morning briefing page — plain HTML/CSS/JS, no framework, no build step.

**Live site:** https://8myjtzdcd5-del.github.io/Morning-Dashboard/  
**GitHub repo:** https://github.com/8myjtzdcd5-del/morning-dashboard  
**Deploy:** push to `main` → GitHub Actions auto-deploys to GitHub Pages (see `.github/workflows/deploy.yml`)

---

## Files

| File | Purpose |
|------|-------|
| `index.html` | All markup — header, market bar, dashboard rows, settings modal, chart modal |
| `app.js` | All logic — fetching, rendering, settings, caching, queue, sync |
| `style.css` | All styles — layout, cards, responsive |
| `gmail-script.js` | Paste into script.google.com to enable Gmail unread emails section |

No dependencies, no npm, no bundler. Edit and push — it's live.

---

## Sections on the dashboard

- **Header** — greeting, date/time, next refresh time, weather (inline in the blue header), Settings button
- **Market bar** — S&P 500, DOW, NASDAQ, VIX, 10Y Yield (dark strip below header)
- **Stock Prices** — full-width row, colored tiles per ticker, click for TradingView chart
- **Quote + Special Dates** — side-by-side row
- **News Topics** — full-width horizontal card grid
- **People of Interest / Topics of Interest / F1** — 3-column row; F1 shows next race + news digest
- **Client News / Prospect News** — side-by-side, each contact gets its own card with tabs
- **Unread Emails** — Gmail section via Google Apps Script web app URL
- **Wish List** — items with store search links

---

## Settings & persistence

Settings are stored in `localStorage` under the key `morningDashboard`. Shape:

```js
{
  weatherCity: "Wilmington DE",
  tickers: ["AAPL", "MSFT"],
  newsTopics: ["Technology", "Health"],
  people: ["Elon Musk"],
  topics: ["Electric vehicles"],
  clients: [{ name: "Jane Smith", company: "Acme Corp" }],
  prospects: [{ name: "Bob Jones", company: "Globex" }],
  milestones: [{ title: "Mom's Birthday", month: 6, day: 15, year: 1950 }],
  wishlist: ["Sony WH-1000XM5"],
  calendarUrls: ["https://calendar.google.com/calendar/ical/..."],
  gmailScriptUrl: "https://script.google.com/macros/s/.../exec",
  refreshTimes: ["5:16 AM", "11:30 AM", "3 PM"],
}
```

`persistSettingsLocal()` — writes to localStorage only.  
`persistSettings()` — writes localStorage + debounced push to GitHub Gist (cloud sync).  
**Always call `persistSettings()` after any settings mutation.**

Cloud sync: user connects a GitHub PAT with `gist` scope; settings are saved as a private Gist. Token stored in `localStorage` as `mdGistToken`, gist ID as `mdGistId`.

---

## Caching

Every section caches to localStorage so content shows instantly on reload even if fetches fail.

| Cache key | Content |
|-----------|-------|
| `mdWeatherCache` | Weather data |
| `mdQuoteCache` | Quote of the day |
| `mdF1Cache` | F1 news items |
| `mdF1Race` | Next F1 race details |
| `mdIndexCache` | Market index prices |
| `mdStockCache` | Stock prices |
| `mdNC_<slug>` | News articles per topic/person/topic query |
| `mdHist_<slug>` | Article history per client/prospect (kept 30 days) |
| `mdCalCache` | Google Calendar ICS events |
| `mdGmailCache` | Gmail unread emails |

Helpers: `saveCache(key, data)` / `loadCache(key)` for simple objects.  
`saveNewsCache(query, items)` / `loadNewsCache(query)` for news topic caches.

---

## News fetching

All news comes from Google News RSS. Two parallel paths race with `Promise.any`:
1. `rss2json.com` — CORS-native, 7s timeout
2. `proxyFetch()` — races 4 CORS proxies (allorigins, corsproxy.io, codetabs, thingproxy), 8s timeout

```js
fetchNews(query, limit)        // single attempt, Promise.any both paths
fetchNewsQueued(query, limit)  // queued + 1 retry with 1.5s wait
```

**News queue** (`newsQueue`) — processes one item at a time with a 700ms gap between items to avoid proxy rate-limiting. All news sections go through this queue. Each contact uses one queue slot (name + company fetched sequentially inside that slot).

---

## Key rendering functions

```js
loadSection(containerId, items, prefix)
// Renders news cards for topics/people/topics. Shows cache immediately, fetches fresh in background.

loadContactSection(containerId, entities, prefix, emptyHint)
// Renders client/prospect cards. One queue slot per contact fetches both name news and company news.
// Hides contacts that have no news at all (no cache, no fresh results).

renderGmail()
// Fetches from Google Apps Script URL, displays unread emails sorted starred→important→newest.

loadAllFeeds(staggerMs)
// Calls all section renderers. Pass staggerMs>0 (e.g. 15*60*1000) on scheduled refresh
// to spread fetches over 15 minutes instead of firing all at once.
```

---

## Weather

Fetches from Open-Meteo (CORS-native, free, no key needed). City name is geocoded via the Open-Meteo geocoding API. Weather card lives **inside the header** (`#weather-content` is a flex child of `.header-inner`), styled to blend into the dark gradient.

---

## Auto-refresh

User sets times like `"5:16 AM, 11:30 AM, 3 PM"` in Settings. Scheduler uses `setTimeout` to the next target time. On `visibilitychange` it checks if a scheduled refresh was missed while the tab was hidden and fires immediately if so.

---

## Stocks & market bar

Uses Yahoo Finance (query1/query2 direct + proxy fallback, racing with `Promise.any`). Click any stock tile or market index to open a TradingView chart in a modal.

---

## Special Dates

Shows only dates within the next **14 days**. Merges: personal milestones + US holidays (computed) + Google Calendar ICS events. Calculates years elapsed if a start year was provided.

---

## Layout (CSS grid)

```css
.dash-row--full           /* 1 column — stocks, news topics, gmail, wish list */
.dash-row--brief          /* 2fr 1fr — quote + special dates */
.dash-row--news-wide      /* 1fr — news topics full width */
.dash-row--news-sub       /* 1fr 1fr 1.4fr — people / topics / F1 */
.dash-row--contacts-wide  /* 1fr 1fr — clients / prospects */
```

---

## Common tasks

**Add a new dashboard section:**
1. Add HTML in `index.html` (new `<div class="dash-row ...">` with a section and feed div)
2. Add a render function in `app.js`
3. Call it from `loadAllFeeds()`
4. Style in `style.css`

**Change what's shown in the header:**
The `.header-inner` flex row contains: `.header-left` (greeting/date) → `#weather-content` → `.settings-btn`. Add elements between these.

**Add a new setting:**
1. Add field to the settings object default in `app.js`
2. Add input UI in the settings modal in `index.html`
3. Wire up the input in `syncSettingsUI()` and the save handler
4. Call `persistSettings()` on change
