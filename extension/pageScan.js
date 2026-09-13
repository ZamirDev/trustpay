// pageScan.js — TrustPay "Is this payment page safe?" trust scan.
// Injected into the ACTIVE tab on demand. Computes an explainable PageTrust
// score from what the page exposes (TLS, form targets, requested fields,
// domain lookalikes, embedded payment iframes), renders an on-page banner,
// and publishes the report to globalThis for the background to collect.
//
// Hardened: never crashes on unusual DOMs (card fields outside a <form>,
// null form, etc.) — any error becomes a readable report, not a silent timeout.

(() => {
  const BRANDS = [
    'amazon', 'paypal', 'visa', 'mastercard', 'amex', 'americanexpress',
    'stripe', 'razorpay', 'flipkart', 'myntra', 'gpay', 'applepay',
    'netflix', 'ebay', 'swiggy', 'zomato', 'paytm', 'phonepe',
  ];
  const PAYMENT_HOSTS = [
    'stripe.com', 'js.stripe.com', 'link.stripe.com', 'checkout.stripe.com',
    'paypal.com', 'paypalobjects.com', 'braintreegateway.com', 'braintreepayments.com',
    'adyen.com', 'adyenpayments.com', 'squareup.com', 'razorpay.com', 'checkout.com',
    'cybersource.com', '2checkout.com', 'payments.worldline.com', 'amazonpay.com',
  ];
  const PROCESSOR_NAMES = {
    'stripe.com': 'Stripe', 'js.stripe.com': 'Stripe', 'link.stripe.com': 'Stripe', 'checkout.stripe.com': 'Stripe',
    'paypal.com': 'PayPal', 'paypalobjects.com': 'PayPal',
    'braintreegateway.com': 'Braintree', 'braintreepayments.com': 'Braintree',
    'adyen.com': 'Adyen', 'adyenpayments.com': 'Adyen', 'squareup.com': 'Square',
    'razorpay.com': 'Razorpay', 'checkout.com': 'Checkout.com', 'cybersource.com': 'Cybersource',
    '2checkout.com': '2Checkout', 'payments.worldline.com': 'Worldline', 'amazonpay.com': 'Amazon Pay',
  };
  const HOMOGLYPHS = { o: '0', 0: 'o', l: '1', i: '1', 1: 'l', s: '5', 5: 's', a: '4', e: '3', t: '7', g: '9' };
  const TRUST_WORDS = /(privacy|terms|secure|help|contact|faq|customer\s*care)/i;
  const OVERREACH =
    /\b(atm\s*pin|pin\s*(number|code)|social\s*security|ssn|bank\s*password|account\s*password|mobile\s*password|otp|one[- ]?time\s*(password|code|pin)|mother'?s?\s*maiden|date\s*of\s*birth|card\s*password|card\s*pin)\b/i;

  const safeHost = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

  // ---------- detection ----------
  function cardInputs() {
    return [...document.querySelectorAll(
      'input[autocomplete="cc-number"], input[data-card], input[name*="card" i], input[id*="cardnumber" i], ' +
      'input[placeholder*="card" i], input[placeholder*="1234" i], input[data-element*="card" i], ' +
      'input[inputmode="numeric"][maxlength="19"]'
    )].filter((i) => i.type !== 'hidden');
  }

  function paymentIframes() {
    const out = [];
    for (const f of document.querySelectorAll('iframe[src]')) {
      let h = '';
      try { h = new URL(f.src, location.href).hostname.toLowerCase(); } catch { continue; }
      const match = PAYMENT_HOSTS.find((p) => h === p || h.endsWith('.' + p));
      if (match) out.push({ host: h, processor: PROCESSOR_NAMES[match] || match });
    }
    return out;
  }

  function paymentForm() {
    const cards = cardInputs();
    if (!cards.length) return null;
    const form = cards[0].closest('form') || null;
    return { form, card: cards[0], inForm: !!form };
  }

  // ---------- string helpers ----------
  const homo = (s) => [...String(s).toLowerCase().replace(/[-_.]/g, '')].map((c) => HOMOGLYPHS[c] || c).join('');

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    const d = Array.from({ length: m + 1 }, (_, i) => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) d[i][0] = i;
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[m][n];
  }

  function typosquat(host) {
    const labels = host.toLowerCase().split('.');
    for (const brand of BRANDS) {
      if (labels.includes(brand)) return { match: brand, exact: true, distance: 0 };
    }
    const parts = host.split('.').filter((p) => !/^(com|net|org|in|io|co|shop|store|xyz|top|info|tech|online|site|cc|app|dev|cash|pay|fit)$/.test(p));
    const tokens = [...parts];
    for (const part of parts) for (let i = 1; i < part.length; i++) tokens.push(part.slice(i));
    for (const brand of BRANDS) {
      const bNorm = homo(brand);
      for (const tok of tokens) {
        const t = homo(tok);
        const d = levenshtein(bNorm, t);
        if (d <= 1 || (d <= 2 && t.length >= 6)) return { match: brand, exact: false, glued: false };
        if (t.startsWith(bNorm) && t.length - bNorm.length >= 1 && t.length - bNorm.length <= 10) {
          return { match: brand, exact: false, glued: true };
        }
      }
    }
    return null;
  }

  function formTarget(form) {
    if (!form) return { same: true, host: location.hostname, url: 'no <form>' };
    const raw = form.getAttribute('action');
    if (!raw || raw === '#') return { same: true, host: location.hostname, url: 'same page' };
    try {
      const u = new URL(raw, location.href);
      return { same: u.hostname === location.hostname, host: u.hostname, url: raw };
    } catch {
      return { same: true, host: location.hostname, url: raw };
    }
  }

  function findOverreach(scope) {
    const hay = [];
    try {
      scope.querySelectorAll('label').forEach((l) => hay.push(l.textContent || ''));
      scope.querySelectorAll('input[placeholder], input[name]').forEach((i) => {
        hay.push((i.getAttribute('placeholder') || '') + ' ' + (i.getAttribute('name') || ''));
      });
    } catch { /* scope may be document or a form — both expose querySelectorAll */ }
    const scanned = hay.join(' ') + ' ' + String(scope.textContent || '').slice(0, 4000);
    const m = scanned.match(OVERREACH);
    return m ? m[0].trim() : null;
  }

  function hasPayButton(scope) {
    return !!scope.querySelector(
      'button[type="submit"], input[type="submit"], button[class*="pay" i], button[class*="checkout" i]'
    );
  }

  // ---------- scan ----------
  function runScan() {
    const host = location.hostname;
    const isLocal = safeHost(host);
    const isHttps = location.protocol === 'https:';
    const cards = cardInputs();
    const frames = paymentIframes();
    const form = cards.length ? cards[0].closest('form') || null : null;
    const scope = form || document;
    const inForm = !!form;
    const title = document.title + ' ' + ((document.querySelector('h1, h2') || {}).textContent || '');
    const strongHint = /(payment|billing|checkout)/i.test(title) || /(pay now|place order|complete purchase)/i.test(title);
    const payBtn = hasPayButton(scope);
    const isPayment = !!cards.length || !!frames.length || (strongHint && payBtn);

    const factors = [];
    const notes = [];

    if (!isPayment) {
      return makeReport({ isPaymentPage: false, score: 0, action: 'none' });
    }

    // 1. transport security
    if (!isHttps && !isLocal) factors.push({ id: 'not_https', label: 'Page is not encrypted (no HTTPS)', impact: 25 });
    else notes.push(isHttps ? '✓ HTTPS encrypted connection' : '✓ Dev/localhost page — TLS check skipped');

    // 2. where are the card fields?
    if (frames.length) {
      notes.push(`✓ Card details are collected inside a ${frames[0].processor} payment iframe — hosted checkout, we score the page around it`);
    }
    if (cards.length && !inForm) notes.push('Card fields detected outside a <form> tag — scanned at document level');

    // 3. standard fields
    let hasExpCvc = false;
    try {
      const hasExp = !!scope.querySelector('[autocomplete="cc-exp"], [name*="exp" i], [placeholder*="exp" i]');
      const hasCvc = !!scope.querySelector('[autocomplete="cc-csc"], [autocomplete="cc-cvc"], [name*="cvc" i], [name*="cvv" i], [placeholder*="cvc"], [placeholder*="cvv"]');
      hasExpCvc = hasExp && hasCvc;
    } catch {}
    if (hasExpCvc) notes.push('✓ Standard card fields (number + expiry + CVC)');

    // 4. where does the page POST?
    const tf = inForm ? formTarget(form) : { same: true, host, url: 'no <form>' };
    if (!tf.same) {
      factors.push({ id: 'cross_origin_post', label: `Card form submits to ${tf.host}, not ${host}`, impact: 35 });
    } else if (inForm && tf.url !== 'same page' && tf.url !== 'no <form>') {
      notes.push(`✓ Card posts to the same domain (${tf.host})`);
    }

    // 5. host weirdness
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) factors.push({ id: 'ip_host', label: `Host is a raw IP (${host})`, impact: 20 });
    const port = location.port;
    if (port && port !== '80' && port !== '443' && !isLocal) factors.push({ id: 'odd_port', label: `Unusual port :${port}`, impact: 15 });

    const sq = typosquat(host);
    if (sq) {
      if (sq.exact) notes.push(`✓ Domain confirmed as ${sq.match}`);
      else factors.push({ id: 'typosquat', label: `Domain looks like ${sq.match} (lookalike)`, impact: 45 });
    }

    // 6. overreach (sensitive extras next to the card)
    const over = findOverreach(scope);
    if (over) factors.push({ id: 'overreach', label: `Form also asks for “${over}” — never ask alongside a card`, impact: 30 });

    // 7. human trust signals
    if (![...document.querySelectorAll('a[href]')].some((a) => TRUST_WORDS.test(a.textContent || ''))) {
      factors.push({ id: 'no_trust', label: 'No privacy / terms / help links found', impact: 5 });
    }

    const score = Math.min(100, factors.reduce((s, f) => s + f.impact, 0));
    const action = score >= 65 ? 'challenge' : score >= 35 ? 'review' : 'allow';

    return makeReport({
      isPaymentPage: true,
      score,
      action,
      factors: factors.sort((a, b) => b.impact - a.impact),
      notes,
      domain: host,
      hasPay: payBtn,
      hostedBy: frames.length ? frames[0].processor : null,
    });
  }

  function makeReport(r) {
    return {
      isPaymentPage: !!r.isPaymentPage,
      score: r.score,
      action: r.isPaymentPage ? r.action : 'none',
      factors: r.factors || [],
      notes: r.notes || [],
      domain: location.hostname,
      url: location.href,
      hasPay: !!r.hasPay,
      hostedBy: r.hostedBy || null,
      nonPayment: !r.isPaymentPage,
    };
  }

  // ---------- banner ----------
  function showBanner(r) {
    document.getElementById('tp-scan-banner')?.remove();
    if (!document.getElementById('tp-scan-style')) {
      const style = document.createElement('style');
      style.id = 'tp-scan-style';
      style.textContent = `
        #tp-scan-banner{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483000;
          max-width:min(520px,94vw);background:#fefbf4;color:#3d2c2e;border:3px solid #3d2c2e;border-radius:14px;
          box-shadow:0 10px 0 rgba(61,44,46,.18);font-family:system-ui,'Segoe UI',sans-serif;font-size:13px}
        #tp-scan-banner .tb-in{padding:12px 14px}
        #tp-scan-banner .tb-top{display:flex;align-items:center;gap:10px}
        #tp-scan-banner .tb-ball{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;
          font-weight:800;color:#fff;border:2px solid #3d2c2e;flex-shrink:0}
        #tp-scan-banner .tb-lead{font-weight:800;text-transform:uppercase;letter-spacing:.4px;font-size:13px}
        #tp-scan-banner .tb-host{font-size:11px;color:rgba(61,44,46,.6);word-break:break-all}
        #tp-scan-banner .tb-x{margin-left:auto;border:2px solid #3d2c2e;background:#f7efe1;border-radius:999px;width:24px;height:24px;
          font-weight:700;cursor:pointer;line-height:1}
        #tp-scan-banner .tb-factors{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:4px}
        #tp-scan-banner .tb-factors li{display:flex;justify-content:space-between;gap:8px;background:#f7efe1;border:2px solid #e6d9c3;
          border-radius:8px;padding:5px 8px;font-weight:600}
        #tp-scan-banner .tb-factors .impact{color:#b3261e;font-weight:800;white-space:nowrap}
        #tp-scan-banner .tb-feet{margin:8px 0 0;padding-left:18px;font-weight:600;display:grid;gap:2px;color:rgba(61,44,46,.75)}
        #tp-scan-banner .tb-cta{margin-top:10px;font-weight:800}
        #tp-scan-banner.tb-allow .tb-ball{background:#2e7d32}
        #tp-scan-banner.tb-allow .tb-lead{color:#2e7d32}
        #tp-scan-banner.tb-review .tb-ball{background:#e0a32e}
        #tp-scan-banner.tb-review .tb-lead{color:#8a6d1f}
        #tp-scan-banner.tb-challenge .tb-ball{background:#b3261e}
        #tp-scan-banner.tb-challenge .tb-lead{color:#b3261e}
        #tp-scan-banner.tb-error .tb-ball{background:#3d2c2e}
        #tp-scan-banner.tb-error .tb-lead{color:#b3261e}`;
      (document.head || document.documentElement).appendChild(style);
    }
    const el = document.createElement('div');
    el.id = 'tp-scan-banner';
    el.className = 'tb-' + (r.action === 'error' ? 'error' : r.action);
    const lead = r.fatal
      ? 'Scan error — retry'
      : r.isPaymentPage
        ? r.action === 'allow' ? 'Looks safe ✓'
        : r.action === 'review' ? 'Be cautious · check before paying'
        : 'Likely fake — don\u2019t enter your card'
        : 'No card form on this page';
    el.innerHTML = `
      <div class="tb-in">
        <div class="tb-top">
          <div class="tb-ball">${r.fatal ? '!' : r.isPaymentPage ? r.score : '—'}</div>
          <div>
            <div class="tb-lead">${lead}</div>
            <div class="tb-host">${r.domain}${r.isPaymentPage ? ' · payment form detected' : ''}</div>
          </div>
          <button class="tb-x" aria-label="Dismiss">×</button>
        </div>
        ${r.fatal
          ? `<p class="tb-feet">${r.error || 'Something went wrong while scanning.'}</p>`
          : r.isPaymentPage && r.factors.length
            ? `<ul class="tb-factors">${r.factors
                .map((f) => `<li><span>${f.label}</span><span class="impact">+${f.impact}</span></li>`)
                .join('')}</ul>`
            : ''}
        ${r.isPaymentPage && r.notes.length
          ? `<div class="tb-feet">${r.notes.map((n) => `<div>${n}</div>`).join('')}</div>`
          : ''}
        ${r.isPaymentPage && r.action === 'challenge'
          ? `<div class="tb-cta">🔒 Guard attached — this form is blocked from sending your card.</div>`
          : ''}
      </div>`;
    el.querySelector('.tb-x').addEventListener('click', () => el.remove());
    document.body.appendChild(el);
  }

  // -- run once per injection; NEVER allow a raw exception to sink the report --
  let r;
  try {
    r = runScan();
  } catch (e) {
    r = {
      isPaymentPage: false,
      score: 0,
      action: 'error',
      factors: [],
      notes: [],
      domain: location.hostname,
      url: location.href,
      hasPay: false,
      hostedBy: null,
      nonPayment: false,
      fatal: true,
      error: String((e && e.message) || e),
    };
  }
  globalThis.__tpPageScanResult = r;
  try { showBanner(r); } catch {}
})();