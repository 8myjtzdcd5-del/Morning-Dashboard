// ─────────────────────────────────────────────────────────────
// Morning Dashboard — Gmail Summary
// Paste this entire file into script.google.com, then deploy
// as a Web App (instructions below the code).
// ─────────────────────────────────────────────────────────────

function doGet() {
  try {
    const emails = fetchUnreadEmails();
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        count: emails.length,
        emails: emails,
        fetched: new Date().toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function fetchUnreadEmails() {
  const emails = [];

  // Fetch up to 40 unread inbox threads from the last 2 days
  const threads = GmailApp.search('is:unread in:inbox newer_than:2d', 0, 40);

  for (const thread of threads) {
    const unreadMsgs = thread.getMessages().filter(m => m.isUnread());
    for (const msg of unreadMsgs) {

      // Clean up sender name
      const raw  = msg.getFrom();
      const name = raw.replace(/<[^>]+>/, '').replace(/^"|"$/g, '').trim() || raw;
      const emailAddr = (raw.match(/<([^>]+)>/) || ['', raw])[1];

      // Get a short plain-text snippet (strip URLs and extra whitespace)
      const snippet = msg.getPlainBody()
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 280);

      emails.push({
        id:        msg.getId(),
        from:      name,
        email:     emailAddr,
        subject:   msg.getSubject() || '(no subject)',
        snippet:   snippet,
        date:      msg.getDate().toISOString(),
        starred:   msg.isStarred(),
        important: thread.isImportant(),
      });
    }
  }

  // Sort: starred first → important → newest
  emails.sort((a, b) => {
    if (a.starred   !== b.starred)   return a.starred   ? -1 : 1;
    if (a.important !== b.important) return a.important ? -1 : 1;
    return new Date(b.date) - new Date(a.date);
  });

  return emails.slice(0, 25); // cap at 25 emails
}

// ─────────────────────────────────────────────────────────────
// HOW TO DEPLOY
// ─────────────────────────────────────────────────────────────
// 1. Go to https://script.google.com
// 2. Click "New project"
// 3. Delete any existing code and paste this entire file
// 4. Click the floppy-disk icon to save (name it "Morning Dashboard Gmail")
// 5. Click "Deploy" → "New deployment"
// 6. Click the gear icon next to "Type" → select "Web app"
// 7. Set "Execute as" → Me (your Google account)
// 8. Set "Who has access" → Anyone
// 9. Click "Deploy"
// 10. Click "Authorize access" and follow the Google login prompts
// 11. Copy the Web app URL — it looks like:
//     https://script.google.com/macros/s/AKfycb.../exec
// 12. Paste that URL into Morning Dashboard → Settings → Gmail URL
// ─────────────────────────────────────────────────────────────
