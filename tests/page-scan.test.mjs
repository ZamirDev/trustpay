// TrustPay pageScan regression harness — runs extension/pageScan.js in jsdom
// against the real demo pages + a verdict matrix. Node-only, not shipped.
// Run: cd tests && npm install && npm test
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'extension', 'pageScan.js'), 'utf8');
const PUB = join(ROOT, 'client', 'public') + '/';

function scanHtml(html, url, setup) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  if (setup) dom.window.eval(setup); // pre-populate iframes etc. before the scan
  dom.window.eval(SRC);
  const r = dom.window.__tpPageScanResult;
  if (!r) throw new Error('no report produced');
  dom.window.__tpPageScanWatch?.stop(); // one-shot tests: don't leave a live watcher
  return r;
}

function scanFile(file, url) {
  return scanHtml(readFileSync(PUB + file, 'utf8'), url);
}

const results = [];
function expect(name, r, want) {
  const got = {
    score: r.score, action: r.action, pageKind: r.pageKind,
    hostedBy: r.hostedBy ?? null, fatal: !!r.fatal,
  };
  const factors = (r.factors || []).map((f) => `${f.id}+${f.impact}`).join(' ');
  const notes = (r.notes || []).join(' | ');
  const fails = [];
  for (const k of Object.keys(want)) {
    if (k === '_factor') {
      if (!factors.includes(want[k])) fails.push(`factor ${want[k]} missing (have: ${factors || 'none'})`);
      continue;
    }
    if (k === '_noFactor') {
      if (factors.includes(want[k])) fails.push(`factor ${want[k]} must be absent (have: ${factors})`);
      continue;
    }
    if (k === '_note') {
      if (!notes.includes(want[k])) fails.push(`note "${want[k]}" missing (have: ${notes || 'none'})`);
      continue;
    }
    if (got[k] !== want[k]) fails.push(`${k}: want ${JSON.stringify(want[k])} got ${JSON.stringify(got[k])}`);
  }
  results.push({ name, ok: fails.length === 0, fails, got, factors });
}

// ---------- real demo pages (served from localhost by vite) ----------
expect('demo-checkout → 0/allow (payment)',
  scanFile('demo-checkout.html', 'http://localhost:5173/demo-checkout.html'),
  { score: 0, action: 'allow', pageKind: 'payment' });

expect('demo-phish → 70/challenge (payment, DECK-LOCKED 70)',
  scanFile('demo-phish.html', 'http://localhost:5173/demo-phish.html'),
  { score: 70, action: 'challenge', pageKind: 'payment' });

expect('demo-login → 75/challenge (login)',
  scanFile('demo-login.html', 'http://localhost:5173/demo-login.html'),
  { score: 75, action: 'challenge', pageKind: 'login' });

// ---------- login matrix ----------
const login = (title, body, extra = '') =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}${extra}</body></html>`;

expect('https legit google.com login → 0/allow (exact brand confirmed)',
  scanHtml(login('Sign in - Google Accounts',
    `<form action="/signin" method="POST">
       <input type="email"><input type="password" autocomplete="current-password">
       <button type="submit">Next</button></form>
     <a href="#">Privacy</a>`),
    'https://accounts.google.com/signin'),
  { score: 0, action: 'allow', pageKind: 'login' });

expect('typosquat paypa1.com login → 45/review (homo l→1 matches paypal)',
  scanHtml(login('Sign in',
    `<form action="/login" method="POST">
       <input type="password"><button type="submit">Login</button></form>
     <a href="#">Privacy</a>`),
    'https://paypa1.com/login'),
  { score: 45, action: 'review', pageKind: 'login' });

expect('chatgpt.com login → CLEAN (gpt vs gpay trap must stay dead)',
  scanHtml(login('ChatGPT',
    `<form action="/auth" method="POST">
       <input type="email"><input type="password"><button type="submit">Log in</button></form>
     <a href="#">Privacy</a>`),
    'https://chatgpt.com/auth'),
  { score: 0, action: 'allow', pageKind: 'login' });

expect('password + date of birth → +30 overreach (allow: 30 < 35 threshold)',
  scanHtml(login('Sign in',
    `<form action="/login" method="POST">
       <input type="password"><label for="d">Date of birth</label><input id="d" name="dob">
       <button type="submit">Login</button></form>
     <a href="#">Privacy</a>`),
    'https://accounts.example.com/login'),
  { score: 30, action: 'allow', pageKind: 'login' });

expect('http (non-local) login claiming Google → 65 challenge (25+40)',
  scanHtml(login('Sign in with Google',
    `<form action="/login" method="POST">
       <input type="password"><button type="submit">Login</button></form>
     <a href="#">Privacy</a>`),
    'http://plainpage.example/login'),
  { score: 65, action: 'challenge', pageKind: 'login' });

expect('login with no trust links → +5 only, allow stays 0+5=5',
  scanHtml(login('Sign in',
    `<form action="/login" method="POST"><input type="password">
     <button type="submit">Login</button></form>`),
    'https://accounts.example.com/login'),
  { score: 5, action: 'allow', pageKind: 'login' });

expect('signup (two password fields) → pageKind signup',
  scanHtml(login('Create your account',
    `<form action="/signup" method="POST">
       <input type="password" autocomplete="new-password">
       <input type="password" autocomplete="new-password">
       <button type="submit">Create account</button></form>
     <a href="#">Privacy</a>`),
    'https://accounts.example.com/signup'),
  { pageKind: 'signup' });

expect('stray password field outside any <form> → scored, no crash',
  scanHtml(login('Sign in', `<input type="password" id="pw">
     <button type="submit">Login</button><a href="#">Privacy</a>`),
    'https://accounts.example.com/whatever'),
  { action: 'allow', pageKind: 'login' });

expect('plain page, no forms → action none / pageKind none',
  scanHtml(`<!doctype html><html><head><title>Blog</title></head><body><p>hi</p></body></html>`,
    'https://example.com/'),
  { score: 0, action: 'none', pageKind: 'none' });

// ---------- payment regressions (must not move) ----------
expect('Stripe iframe checkout → allow + hostedBy Stripe',
  scanHtml(`<!doctype html><html><head><title>Checkout</title></head><body>
     <form><input autocomplete="cc-number"></form>
     <iframe src="https://js.stripe.com/v3/"></iframe>
     <a href="#">Privacy</a></body></html>`, 'https://shop.example.com/checkout'),
  { action: 'allow', pageKind: 'payment', hostedBy: 'Stripe' });

expect('payment overreach (ATM PIN) + cross-origin → 65 challenge (35+30)',
  scanHtml(`<!doctype html><html><head><title>Pay</title></head><body>
     <form action="https://evil.example.net/pay" method="POST">
       <input autocomplete="cc-number"><label>ATM PIN</label><input name="pin">
       <button type="submit" class="pay">Pay</button></form>
     <a href="#">Privacy</a></body></html>`, 'https://shop.example.com/pay'),
  { score: 65, action: 'challenge', pageKind: 'payment' });

expect('fatal path: broken DOM → readable error report, never throws',
  (() => {
    const dom = new JSDOM(`<!doctype html><html><head><title>x</title></head><body></body></html>`,
      { url: 'https://example.com/', runScripts: 'outside-only' });
    // sabotage querySelectorAll so runScan throws → catch must produce report
    dom.window.Document.prototype.querySelectorAll = () => { throw new Error('boom'); };
    try { dom.window.eval(SRC); } catch (e) { return { fatal: false, score: -1, action: 'THREW: ' + e.message, pageKind: '?' }; }
    return dom.window.__tpPageScanResult;
  })(),
  { fatal: true, action: 'error' });

// ---------- payment popup / gateway recognition (watch feature) ----------
const POPUP = readFileSync(PUB + 'demo-popup.html', 'utf8');
const POPUP_URL = 'http://localhost:5173/demo-popup.html';
const OPEN_MODAL = `
  const ov = document.createElement('div');
  ov.className = 'pay-overlay'; ov.id = 'payOverlay';
  ov.innerHTML = '<div class="pay-dialog" role="dialog"><iframe id="gwFrame" src="./demo-easebuzz-frame.html"></iframe></div>';
  document.body.appendChild(ov);
  const gd = document.getElementById('gwFrame').contentDocument;
  if (!gd.documentElement) { // jsdom's fresh about:blank doc is bare
    const html = gd.createElement('html');
    gd.appendChild(html);
    html.appendChild(gd.createElement('body'));
  } else if (!gd.body) {
    gd.documentElement.appendChild(gd.createElement('body'));
  }
  gd.body.innerHTML = '<form action="https://pay.easebuzz.in/pay/" method="POST">'
    + '<input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">'
    + '<button type="submit">Pay</button></form><a href="#">Terms</a>';
`;

expect('demo-popup (popup closed) → none/0',
  scanHtml(POPUP, POPUP_URL),
  { score: 0, action: 'none', pageKind: 'none' });

expect('demo-popup with modal open (one-shot) → payment/allow, hostedBy Easebuzz',
  scanHtml(POPUP, POPUP_URL, OPEN_MODAL),
  { score: 0, action: 'allow', pageKind: 'payment', hostedBy: 'Easebuzz',
    _noFactor: 'cross_origin_post', _note: 'known payment processor' });

expect('static cross-origin pay.easebuzz.in iframe → payment/allow, hostedBy Easebuzz',
  scanHtml(`<!doctype html><html><head><title>Upgrade</title></head><body>
     <iframe src="https://pay.easebuzz.in/payment/checkout"></iframe>
     <a href="#">Privacy</a></body></html>`, 'https://shop.example.com/upgrade'),
  { score: 0, action: 'allow', pageKind: 'payment', hostedBy: 'Easebuzz' });

expect('easebuzz-verify.shop login → 45/review (gateway lookalike caught)',
  scanHtml(login('Sign in',
    `<form action="/login" method="POST">
       <input type="password"><button type="submit">Login</button></form>
     <a href="#">Privacy</a>`),
    'https://easebuzz-verify.shop/login'),
  { score: 45, action: 'review', pageKind: 'login', _factor: 'typosquat+45' });

expect('card form POSTs straight to pay.easebuzz.in → note, NOT cross_origin factor',
  scanHtml(`<!doctype html><html><head><title>Pay</title></head><body>
     <form action="https://pay.easebuzz.in/pay/" method="POST">
       <input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">
       <button type="submit" class="pay">Pay</button></form>
     <a href="#">Privacy</a></body></html>`, 'https://shop.example.com/pay'),
  { score: 0, action: 'allow', pageKind: 'payment',
    _noFactor: 'cross_origin_post', _note: 'known payment processor' });

// re-injection must re-arm the SAME watcher (never a double observer) and the
// banner must advertise watch mode.
{
  const dom = new JSDOM(POPUP, { url: POPUP_URL, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.eval(SRC);
  const w1 = dom.window.__tpPageScanWatch;
  dom.window.eval(SRC);
  const w2 = dom.window.__tpPageScanWatch;
  const banner = dom.window.document.getElementById('tp-scan-banner');
  const fails = [];
  if (!w1) fails.push('no watcher after first injection');
  else if (w1 !== w2) fails.push('watcher object replaced on re-injection (double observer)');
  if (!banner) fails.push('no banner');
  else if (!banner.innerHTML.includes('watching for payment popups')) fails.push('banner watch line missing');
  results.push({
    name: 're-injection re-arms the same watcher + banner shows watching line',
    ok: fails.length === 0, fails,
    got: { score: 0, action: 'none', pageKind: 'none', hostedBy: null, fatal: false },
    factors: '',
  });
  w2?.stop();
}

// ---------- live watch: a payment modal that opens AFTER the scan ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
{
  const dom = new JSDOM(POPUP, { url: POPUP_URL, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.eval(SRC);
  expect('watch: before modal → none/0',
    dom.window.__tpPageScanResult,
    { pageKind: 'none', action: 'none', score: 0 });

  dom.window.eval(OPEN_MODAL); // user clicks Subscribe while watch is armed
  await sleep(900);            // MutationObserver microtask + 300ms debounce + slack
  expect('watch: modal opens late → live flip to payment/allow, Easebuzz',
    dom.window.__tpPageScanResult,
    { pageKind: 'payment', action: 'allow', score: 0, hostedBy: 'Easebuzz' });

  const banner = dom.window.document.getElementById('tp-scan-banner');
  const bFails = [];
  if (!banner) bFails.push('no banner after update');
  else {
    if (banner.className !== 'tb-allow') bFails.push(`banner class ${banner.className}, want tb-allow`);
    if (!banner.innerHTML.includes('payment form detected')) bFails.push('banner missing payment line');
    if (!banner.innerHTML.includes('watching for payment popups')) bFails.push('banner missing watch line');
  }
  results.push({
    name: 'watch: banner updates in place (allow + payment + watching line)',
    ok: bFails.length === 0, fails: bFails,
    got: { score: 0, action: 'allow', pageKind: 'payment', hostedBy: null, fatal: false },
    factors: '',
  });
  dom.window.__tpPageScanWatch?.stop();
}

// ---------- report ----------
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log(`  PASS  ${r.name}`); }
  else { fail++; console.log(`  FAIL  ${r.name}\n        ${r.fails.join('\n        ')}`); }
  console.log(`        got: score=${r.got.score} action=${r.got.action} kind=${r.got.pageKind}` +
    (r.got.hostedBy ? ` hostedBy=${r.got.hostedBy}` : '') + (r.factors ? `  [${r.factors}]` : ''));
}
console.log(`\n${pass}/${results.length} passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
