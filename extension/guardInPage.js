// guardInPage.js — TrustPay Guard core (content-script / isolated world).
// Auto-attached on localhost pages AND injected on demand via "Scan this page".
// Finds a checkout form, feeds live behavioral signals to the TrustPay engine
// through the background bridge, and blocks high-risk submits with an
// explainable, clay-styled MFA overlay.

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
      .tp-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(61,44,46,.45);
        display:flex;align-items:center;justify-content:center;font-family:system-ui,'Segoe UI',sans-serif}
      .tp-modal{background:#fefbf4;color:#3d2c2e;border:3px solid #3d2c2e;border-radius:16px;
        box-shadow:0 12px 0 rgba(61,44,46,.18);padding:22px;width:min(380px,92vw);max-height:92vh;overflow:auto}
      .tp-modal h2{margin:0 0 6px;font-size:18px}
      .tp-note{font-size:12px;color:rgba(61,44,46,.6);margin:0 0 12px}
      .tp-row{display:flex;align-items:center;gap:12px;margin-bottom:12px}
      .tp-ball{width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;
        font-size:21px;font-weight:800;color:#fff;border:3px solid #3d2c2e;flex-shrink:0;background:#b3261e}
      .tp-level{font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:.5px;color:#b3261e}
      .tp-sub{font-size:12px;color:rgba(61,44,46,.6);margin:2px 0 0}
      .tp-factors{list-style:none;margin:0 0 14px;padding:0;display:grid;gap:6px}
      .tp-factors li{display:flex;justify-content:space-between;gap:10px;background:#f7efe1;border:2px solid #e6d9c3;
        border-radius:10px;padding:7px 10px;font-size:13px;font-weight:600}
      .tp-factors .impact{color:#b3261e;font-weight:800;white-space:nowrap}
      .tp-sms{background:#8fc1ff;border:2px solid #3d2c2e;border-radius:10px;padding:9px 12px;font-size:13px;font-weight:600}
      .tp-sms code{background:#fff;border:2px solid #3d2c2e;padding:1px 8px;border-radius:6px;font-size:15px}
      .tp-field{margin:12px 0}
      .tp-field label{font-size:12px;font-weight:700;display:block;margin-bottom:4px}
      .tp-field input{width:100%;border:2px solid #3d2c2e;border-radius:10px;padding:9px 10px;font:inherit;background:#fff}
      .tp-actions{display:flex;gap:10px}
      .tp-btn{border:2px solid #3d2c2e;background:#f7efe1;color:#3d2c2e;font:inherit;font-weight:700;padding:9px 16px;border-radius:999px;cursor:pointer}
      .tp-btn:hover{filter:brightness(.97)}
      .tp-btn-primary{background:#3d2c2e;color:#fefbf4}
      .tp-btn-green{background:#9fe6a0;color:#3d2c2e}
      .tp-err{color:#b3261e;font-weight:700;font-size:13px;min-height:1em}
      .tp-toast{position:fixed;right:14px;top:14px;z-index:2147483001;background:#9fe6a0;color:#3d2c2e;border:2px solid #3d2c2e;
        border-radius:999px;padding:8px 14px;font-weight:700;font-size:13px;box-shadow:0 4px 0 rgba(61,44,46,.15)}
      .tp-toast.amber{background:#f5c86b}
      .tp-toast.red{background:#ff9f9f}
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
    overlay.querySelector('.tp-ball').style.background = '#b3261e';
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

  // ---- main loop ----
  async function boot() {
    if (document.querySelector('.risk-widget')) return; // our hosted app — skip
    const checkout = findCheckout();
    if (!checkout) return;
    const { form } = checkout;
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();