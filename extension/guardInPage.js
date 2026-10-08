// guardInPage.js — TrustPay Guard core (content-script / isolated world).
// Auto-attached on localhost pages AND injected on demand via "Attach guard".
// Finds a checkout form (behavioral risk + MFA) or a login form (fresh page
// scan on submit, warn + block), feeds signals to the TrustPay engine through
// the background bridge, and blocks high-risk submits with explainable
// Night-styled overlays.

(() => {
  if (globalThis.__TP_GUARD__) return;
  globalThis.__TP_GUARD__ = true;

  const DEV_KEY = 'tpDevice';
  const LAST_KEY = 'tpLastVerdict';
  const TYPICAL = 119;

  // ---- local helpers (keep the bridge talk thin) ----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function fmt(n) {
    return '₹' + n;
  }

  async function deviceName() {
    const ua = navigator.userAgent || '';
    let b = 'Browser';
    if (/Edg\//i.test(ua)) b = 'Edge';
    else if (/Chrome\//i.test(ua)) b = 'Chrome';
    else if (/Firefox\//i.test(ua)) b = 'Firefox';
    else if (/Safari\//i.test(ua)) b = 'Safari';
    let os = 'Desktop';
    if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Mac/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
    return `${b} on ${os}`;
  }

  async function device() {
    const { [DEV_KEY]: rec } = await chrome.storage.local.get(DEV_KEY);
    if (rec) return { seen: true, name: rec.name };
    const name = await deviceName();
    await chrome.storage.local.set({ [DEV_KEY]: { name, at: Date.now() } });
    return { seen: false, name };
  }

  async function uid() {
    const rec = await chrome.storage.local.get(DEV_KEY);
    const seed = (rec[DEV_KEY] && rec[DEV_KEY].at) || String(Date.now());
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h << 5) - h + seed.charCodeAt(i) | 0;
    return 'ext-' + Math.abs(h).toString(36).slice(0, 6);
  }

  // ---- checkout detection ----
  function findCheckout() {
    const card = document.querySelector('input[autocomplete="cc-number"], input[data-card], input[name*="card"], input[placeholder*="card" i]');
    if (!card) return null;
    const form = card.closest('form') || document;
    return { form, card };
  }

  // ---- login / sign-up detection (only when it's not also a checkout) ----
  function findLoginForm() {
    if (document.querySelector('input[type="password"]') == null) return null;
    if (findCheckout()) return null; // payment pages keep the card flow
    const pw = document.querySelector('input[type="password"]');
    const form = pw.closest('form') || document;
    return { form, pw };
  }

  function readNet() {
    const root = document.body;
    const net = root.getAttribute('data-tp-net');
    const ip = root.getAttribute('data-tp-ip-country') || root.getAttribute('data-tp-net-ip-country');
    const cardC = root.getAttribute('data-tp-card-country') || root.getAttribute('data-tp-net-card-country');
    const cc = cardC || 'IN';
    let countryMismatch = false;
    if (net === 'vpn' && ip && ip !== cc) countryMismatch = true;
    return {
      vpn: net === 'vpn',
      countryMismatch,
      ipCountry: ip || 'IN',
      cardCountry: cc,
    };
  }

  function readTxn() {
    const amountEl = document.querySelector('[data-tp-price]');
    let amount = amountEl ? parseMoney(amountEl.textContent) : guessAmount();
    amount = Number.isFinite(amount) ? amount : 0;
    const typicalEl = document.querySelector('[data-tp-typical]');
    const typical = typicalEl ? parseMoney(typicalEl.textContent) || TYPICAL : TYPICAL;
    return {
      amount,
      amountScale: amount ? +((amount / typical).toFixed(2)) : 1,
      retryCount: 0,
      item: (document.querySelector('[data-tp-item]') || {}).textContent || 'Order',
      merchant: (document.querySelector('[data-tp-merchant]') || {}).textContent || 'Store',
    };
  }

  function parseMoney(s) {
    const m = String(s || '').replace(/[^\d.]/g, '');
    const n = parseFloat(m);
    return Number.isFinite(n) ? n : NaN;
  }

  function guessAmount() {
    let best = NaN;
    document.querySelectorAll('span,div,b,strong,p').forEach((el) => {
      const t = el.textContent || '';
      if (!/₹|\$|(INR|USD)/i.test(t)) return;
      const n = parseMoney(t.match(/[₹$]?\s?[\d.,]+/)?.[0] || '');
      if (Number.isFinite(n) && n > (Number.isFinite(best) ? best : 0)) best = n;
    });
    return best;
  }

  // ---- signal capture ----
  function makeCollector(form) {
    const state = { keys: [], start: null, pasted: false, mouse: { n: 0, mean: 0 } };
    const inputs = form.querySelectorAll('input');

    const kick = (e) => {
      if (!state.start) state.start = performance.now();
      if (e.key && e.key.length === 1) state.keys.push(performance.now());
    };
    const paste = () => { state.pasted = true; };
    const move = (e) => {
      if (!state.mouse.last) { state.mouse.last = { x: e.clientX, y: e.clientY, t: performance.now() }; return; }
      const dt = Math.max(1, performance.now() - state.mouse.last.t);
      const dx = e.clientX - state.mouse.last.x;
      const dy = e.clientY - state.mouse.last.y;
      const v = Math.sqrt(dx * dx + dy * dy) / dt;
      state.mouse.n++;
      state.mouse.mean += (v - state.mouse.mean) / state.mouse.n;
      state.mouse.last = { x: e.clientX, y: e.clientY, t: performance.now() };
    };

    inputs.forEach((i) => i.addEventListener('keydown', kick, true));
    form.querySelectorAll('input[data-card], input[autocomplete="cc-number"]')
      .forEach((i) => i.addEventListener('paste', paste, true));
    document.addEventListener('mousemove', move, true);

    return () => {
      const keys = state.keys;
      let charsPerMin = 0;
      let isErratic = false;
      if (keys.length >= 3) {
        const total = keys[keys.length - 1] - keys[0];
        const gaps = [];
        for (let i = 1; i < keys.length; i++) gaps.push(keys[i] - keys[i - 1]);
        const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        charsPerMin = Math.round(1000 / Math.max(25, mean) * 6 * 0.6);
        const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
        isErratic = mean > 0 && sd / mean > 1.2;
      }
      const jitterHigh = state.mouse.n > 30 && state.mouse.mean > 0.5;

      return {
        device: undefined,    // injected async below
        typing: { isErratic, charsPerMin },
        form: {
          pastedCard: state.pasted,
          fillTimeMs: state.start ? Math.round(performance.now() - state.start) : 0,
          fieldCount: inputs.length,
        },
        mouse: { jitterHigh },
        net: readNet(),
        txn: readTxn(),
        meta: undefined,
      };
    };
  }

  // ---- guard UI ----
  let overlay = null;
  function ensureCss() {
    if (document.getElementById('tp-guard-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-guard-style';
    style.textContent = `
      .tp-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.85);
        display:flex;align-items:center;justify-content:center;font-family:ui-monospace,'Cascadia Mono',Consolas,monospace}
      .tp-modal{background:#000;color:#fff;border:2px solid #fff;border-radius:0;
        box-shadow:none;padding:24px;width:min(380px,92vw);max-height:92vh;overflow:auto}
      .tp-modal h2{margin:0 0 6px;font-size:20px;font-family:Georgia,'Times New Roman',serif;font-weight:400;
        text-transform:uppercase;letter-spacing:-0.02em;color:#cecece}
      .tp-note{font-size:12px;color:#8d8d8d;margin:0 0 12px;line-height:1.5}
      .tp-row{display:flex;align-items:center;gap:12px;margin-bottom:12px}
      .tp-ball{width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;
        font-size:21px;font-weight:400;color:#fff;border:3px solid #fff;flex-shrink:0;background:#000;
        box-shadow:none}
      .tp-level{font-weight:400;font-size:17px;text-transform:uppercase;letter-spacing:-0.01em;color:#fff;
        font-family:Georgia,'Times New Roman',serif}
      .tp-sub{font-size:12px;color:#8d8d8d;margin:2px 0 0}
      .tp-factors{list-style:none;margin:0 0 14px;padding:0;display:grid;gap:6px}
      .tp-factors li{display:flex;justify-content:space-between;gap:10px;background:#0a0a0a;border:1px solid #484848;
        border-left:3px solid #8d8d8d;border-radius:0;padding:7px 10px;font-size:12px;font-weight:400}
      .tp-factors .impact{color:#cecece;font-weight:400;white-space:nowrap}
      .tp-sms{background:#141414;border:1px solid #484848;border-top:1px solid #8d8d8d;border-radius:0;padding:10px 12px;font-size:12px;font-weight:400}
      .tp-sms code{background:#000;border:1px solid #484848;padding:1px 8px;border-radius:0;font-size:16px;letter-spacing:4px;color:#fff}
      .tp-field{margin:12px 0}
      .tp-field label{font-size:10px;font-weight:400;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:2px;color:#8d8d8d}
      .tp-field input{width:100%;border:1px solid #484848;border-radius:0;padding:10px;font:inherit;background:#000;color:#fff}
      .tp-field input:focus{outline:none;border-color:#fff}
      .tp-actions{display:flex;gap:10px}
      .tp-btn{border:2px solid #fff;background:transparent;color:#fff;font:inherit;font-weight:400;padding:9px 16px;
        border-radius:999px;cursor:pointer;text-transform:uppercase;letter-spacing:2px;font-size:11px;
        transition:background-color .1s linear,color .1s linear}
      .tp-btn:hover{background:#fff;color:#000}
      .tp-btn-primary{background:#fff;color:#000}
      .tp-btn-green{background:#03955b;border-color:#03955b;color:#fff}
      .tp-btn-green:hover{background:transparent;color:#0ec37a;border-color:#03955b}
      .tp-err{color:#d98a4f;font-weight:400;font-size:13px;min-height:1em;text-transform:uppercase;letter-spacing:1px}
      .tp-toast{position:fixed;right:14px;top:14px;z-index:2147483001;background:#03955b;color:#fff;border:2px solid #03955b;
        border-radius:0;padding:9px 14px;font-weight:400;font-size:13px;box-shadow:none;
        text-transform:uppercase;letter-spacing:1px}
      .tp-toast.amber{background:#ba6a36;border-color:#ba6a36}
      .tp-toast.red{background:#000;color:#fff;border-color:#fff}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function toast(msg, cls) {
    const el = document.createElement('div');
    el.className = 'tp-toast' + (cls ? ' ' + cls : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  async function showOverlay(verdict, txnId, form) {
    ensureCss();
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'tp-backdrop';
      overlay.innerHTML = `
        <div class="tp-modal">
          <h2>🛡 TrustPay Guard</h2>
          <p class="tp-note">This purchase looks high-risk, so we verify before a card is charged.</p>
          <div class="tp-row">
            <div class="tp-ball"></div>
            <div><div class="tp-level"></div><div class="tp-sub"></div></div>
          </div>
          <ul class="tp-factors"></ul>
          <div class="tp-sms">💬 YourTrustBank — code: <code>····</code> · valid 5 min</div>
          <div class="tp-field"><label>Enter the code</label><input inputmode="numeric" placeholder="000000" autocomplete="one-time-code" /></div>
          <div class="tp-err"></div>
          <div class="tp-actions">
            <button class="tp-btn tp-btn-green" data-act="verify">Verify</button>
            <button class="tp-btn" data-act="cancel">I'll use another card</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
    }
    const state = verdict;
    overlay.querySelector('.tp-ball').textContent = state.score;
    overlay.querySelector('.tp-ball').style.background = '#000';
    overlay.querySelector('.tp-level').textContent = `challenge · ${state.score}`;
    overlay.querySelector('.tp-sub').textContent =
      'Blocked before any charge. Confirm it\u2019s you.';
    const list = overlay.querySelector('.tp-factors');
    list.innerHTML =
      state.factors && state.factors.length
        ? state.factors.map((f) => `<li><span>${esc(f.label)}</span><span class="impact">+${f.impact}</span></li>`).join('')
        : '';
    const input = overlay.querySelector('.tp-field input');
    const err = overlay.querySelector('.tp-err');
    err.textContent = '';
    input.value = '';

    // simulated bank SMS (demo): background returns the OTP
    const sms = await chrome.runtime.sendMessage({ type: 'mfaSend', txnId }).catch(() => null);
    if (sms) overlay.querySelector('.tp-sms code').textContent = sms.code;
    input.focus();

    return new Promise((resolve) => {
      const done = (ok) => {
        overlay.remove();
        overlay = null;
        resolve(ok);
      };
      const onEnter = (e) => { if (e.key === 'Enter') verify(); };
      const verify = async () => {
        const res = await chrome.runtime
          .sendMessage({ type: 'mfaVerify', txnId, code: input.value.trim() })
          .catch(() => null);
        if (res && res.ok) {
          input.removeEventListener('keydown', onEnter);
          done(true);
        } else {
          err.textContent = (res && res.error) || 'Wrong code — try again.';
        }
      };
      overlay.querySelector('[data-act="verify"]').addEventListener('click', verify);
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => done(false));
      input.addEventListener('keydown', onEnter);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    });
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---- login-block overlay: the SITE is the suspect, so warn + leave (no MFA theatre) ----
  function showLoginWarn(scan) {
    ensureCss();
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'tp-backdrop';
      overlay.innerHTML = `
        <div class="tp-modal">
          <h2>🛡 TrustPay Guard</h2>
          <p class="tp-note">This sign-in page failed its trust scan. Sending your password here could hand your account to someone else.</p>
          <div class="tp-row">
            <div class="tp-ball"></div>
            <div><div class="tp-level"></div><div class="tp-sub"></div></div>
          </div>
          <ul class="tp-factors"></ul>
          <div class="tp-actions">
            <button class="tp-btn tp-btn-green" data-act="leave">Leave this page</button>
            <button class="tp-btn" data-act="stay">Continue anyway</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
    }
    overlay.querySelector('.tp-ball').textContent = scan.score;
    overlay.querySelector('.tp-level').textContent = `${scan.action} · ${scan.score}`;
    overlay.querySelector('.tp-sub').textContent = 'Blocked before your password left the browser.';
    const list = overlay.querySelector('.tp-factors');
    list.innerHTML = (scan.factors || [])
      .map((f) => `<li><span>${esc(f.label)}</span><span class="impact">+${f.impact}</span></li>`)
      .join('');

    return new Promise((resolve) => {
      const done = (ok) => {
        overlay.remove();
        overlay = null;
        resolve(ok);
      };
      overlay.querySelector('[data-act="leave"]').addEventListener('click', () => {
        // leave for real when we can, otherwise just close the warning
        if (history.length > 1) history.back();
        else location.replace('about:blank');
        done(false);
      });
      overlay.querySelector('[data-act="stay"]').addEventListener('click', () => done(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    });
  }

  // ---- main loop ----
  async function boot() {
    if (document.querySelector('.risk-widget')) return; // our hosted app — skip
    const checkout = findCheckout();
    if (checkout) return bootCheckout(checkout.form);
    if (findLoginForm()) return bootLogin();
  }

  // checkout flow: behavioral risk engine + MFA challenge (unchanged)
  async function bootCheckout(form) {
    ensureCss();
    const collect = makeCollector(form);
    let approvedPass = false;

    form.addEventListener('submit', async (e) => {
      if (approvedPass) { approvedPass = false; return; } // already verified → pass through
      e.preventDefault();
      e.stopPropagation();

      const dev = await device();
      const user = await uid();
      const signals = collect();
      signals.device = dev;
      signals.meta = { uid: user };
      signals.txn.retryCount = signals.txn.retryCount || 0;

      const verdict = await chrome.runtime
        .sendMessage({ type: 'risk', signals })
        .catch(() => null);
      if (!verdict) { toast('TrustPay Guard: engine unreachable', 'red'); return; }

      if (verdict.action === 'allow') {
        toast('✅ TrustPay: all clear', '');
        approvedPass = true;
        form.requestSubmit();   // let the real store handle it
        return;
      }
      if (verdict.action === 'review') {
        toast('🟡 TrustPay: taking a closer look…', 'amber');
        setTimeout(() => { approvedPass = true; form.requestSubmit(); }, 1400);
        return;
      }

      // challenge → block + verify
      const ok = await showOverlay(verdict, verdict.txnId, form);
      if (ok) {
        toast('✅ Identity verified — order continues', '');
        approvedPass = true;
        form.requestSubmit();
      } else {
        toast('🚫 Purchase blocked — card not charged', 'red');
      }
    });
  }

  // login flow: fresh page-trust scan on submit → warn + leave on a red verdict.
  // Listens on document in the CAPTURE phase so the guard decides BEFORE the
  // page's own submit handler runs (the fake "success" panel must not flash).
  async function bootLogin() {
    ensureCss();
    let approvedPass = false;

    document.addEventListener('submit', async (e) => {
      if (approvedPass) { approvedPass = false; return; }
      // only the form that owns a password field
      const frm = e.target;
      if (!frm || typeof frm !== 'object' || !frm.querySelector) return;
      if (!frm.querySelector('input[type="password"]')) return;
      e.preventDefault();
      e.stopPropagation();
      const src = typeof frm.requestSubmit === 'function' ? frm : null;
      const go = () => { if (src) src.requestSubmit(); };

      const res = await chrome.runtime.sendMessage({ type: 'pagescan' }).catch(() => null);
      const scan = res && res.ok ? res.scan : null;
      if (!scan || scan.action === 'error' || !scan.action) {
        toast('TrustPay Guard: could not verify this page', 'red');
        return;
      }

      if (scan.action === 'allow') {
        toast('✅ TrustPay: sign-in looks safe', '');
        approvedPass = true;
        go();
        return;
      }
      if (scan.action === 'review') {
        toast('🟡 TrustPay: double-check this sign-in', 'amber');
        setTimeout(() => { approvedPass = true; go(); }, 1400);
        return;
      }

      const stay = await showLoginWarn(scan);
      if (stay) {
        toast('⚠ Continuing anyway — you were warned', 'amber');
        approvedPass = true;
        go();
      } else {
        toast('🚫 Sign-in blocked — password never sent', 'red');
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();