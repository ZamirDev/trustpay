// popup.js — TrustPay Guard popup: live risk verdict + page trust scan.

const LAST_KEY = 'tpLastVerdict';

function el(id) { return document.getElementById(id); }

function reportCard(v) {
  const cls = v.score >= 65 ? 'v-bad' : v.score >= 35 ? 'v-mid' : 'v-ok';
  return `
    <div class="v-row ${cls}">
      <div class="v-ball">${v.score}</div>
      <div>
        <div class="v-level">${v.level}</div>
        <div class="v-page">${v.page || ''}${v.source === 'offline' ? '<span class="off-tag">offline engine</span>' : ''}</div>
      </div>
    </div>
    ${v.factors && v.factors.length
      ? `<ul class="v-factors">${v.factors
          .map((f) => `<li><span>${f.label}</span><span class="impact">+${f.impact}</span></li>`)
          .join('')}</ul>`
      : ''}`;
}

function scanCard(s) {
  if (s.fatal) {
    return `
      <div class="v-row v-bad">
        <div class="v-ball">!</div>
        <div>
          <div class="v-level">Scan error</div>
          <div class="v-page">${s.domain}</div>
        </div>
      </div>
      <p class="scan-notes">${s.error || 'Something went wrong while scanning this page.'}</p>
      <p class="scan-notes">Tip: reload the page, re-open the popup, and scan again. If it persists, reload the extension in chrome://extensions.</p>`;
  }
  const isLogin = s.pageKind === 'login' || s.pageKind === 'signup';
  const scored = s.pageKind === 'payment' || isLogin;
  const cls = s.score >= 65 ? 'v-bad' : s.score >= 35 ? 'v-mid' : 'v-ok';
  const lead = !scored ? 'Nothing to scan'
    : isLogin
      ? s.action === 'allow' ? 'Login looks safe ✓'
      : s.action === 'review' ? 'Be cautious'
      : 'Likely phishing — don\u2019t enter your password'
      : s.action === 'allow' ? 'Looks safe ✓'
      : s.action === 'review' ? 'Be cautious'
      : 'Likely fake — don\u2019t enter your card';
  const kindLine = s.pageKind === 'payment' ? ' · card form found'
    : isLogin ? ` · ${s.pageKind} form found` : '';
  if (!scored) {
    return `
      <div class="v-row v-ok">
        <div class="v-ball">—</div>
        <div>
          <div class="v-level">${lead}</div>
          <div class="v-page">${s.domain}</div>
        </div>
      </div>
      <p class="scan-ok">No login or card form on this page.</p>`;
  }
  return `
    <div class="v-row ${cls}">
      <div class="v-ball">${s.score}</div>
      <div>
        <div class="v-level">${lead}</div>
        <div class="v-page">${s.domain}${kindLine}</div>
      </div>
    </div>
    ${s.factors && s.factors.length
      ? `<ul class="v-factors">${s.factors
          .map((f) => `<li><span>${f.label}</span><span class="impact">+${f.impact}</span></li>`)
          .join('')}</ul>`
      : `<p class="scan-ok">${isLogin ? 'No risk factors — fine to enter your password.' : 'No risk factors — fine to enter your card.'}</p>`}
    ${s.notes && s.notes.length ? `<div class="scan-notes">${s.notes.map((n) => `<div>· ${n}</div>`).join('')}</div>` : ''}
    ${scored && s.action === 'challenge'
      ? `<p class="scan-cta">🔒 Guard attached — the form is blocked.</p>`
      : ''}`;
}

// Page trust scan (payment · login · signup)
el('scanBtn').addEventListener('click', async () => {
  const box = el('scanResult');
  const btn = el('scanBtn');
  btn.disabled = true;
  box.innerHTML = '<div class="empty">Scanning this page…</div>';
  const res = await chrome.runtime.sendMessage({ type: 'pagescan' }).catch(() => null);
  btn.disabled = false;
  if (!res || !res.ok) {
    box.innerHTML = `<div class="empty">${(res && res.error) || 'Could not reach the tab.'}</div>`;
    return;
  }
  if (res.scan.fatal) {
    box.innerHTML = scanCard(res.scan);
    return;
  }
  const kind = res.scan.pageKind;
  if (kind !== 'payment' && kind !== 'login' && kind !== 'signup') {
    box.innerHTML = `<div class="empty">No login or card form on this page — nothing to scan.</div>`;
    return;
  }
  box.innerHTML = scanCard(res.scan);
});

// Attach the blocking guard to the current tab
el('attachBtn').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'scanpage' }).catch(() => null);
  el('attachBtn').textContent = res && res.ok ? '✅ Guard attached' : '⚠ Could not attach';
  setTimeout(() => window.close(), 1000);
});

// Last live risk verdict (from a guard-checked submit)
async function renderVerdict() {
  const { [LAST_KEY]: v } = await chrome.storage.local.get(LAST_KEY);
  if (!v) return;
  el('verdict').innerHTML = reportCard({ ...v, level: v.level });
}
renderVerdict();

// Fresh result from the popup watch — if the page was scanned within the last
// 90s and the modal changed the verdict, show it instead of a blank popup.
async function renderFreshScan() {
  const { tpLastPageScan: s } = await chrome.storage.local.get('tpLastPageScan');
  if (!s || !s.ts || Date.now() - s.ts > 90000) return;
  const kind = s.pageKind;
  if (kind !== 'payment' && kind !== 'login' && kind !== 'signup') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  if (!tab || s.tabId !== tab.id) return;
  el('scanResult').innerHTML =
    scanCard(s) + '<p class="scan-ok">· Live result from the page watch — click scan to re-arm it.</p>';
}
renderFreshScan();