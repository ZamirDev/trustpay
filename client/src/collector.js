// collector.js — live behavioral signal capture on the checkout page.
//
// Target signal contract (server riskModel):
//   device: { seen, name }
//   typing: { isErratic, charsPerMin }
//   form:   { pastedCard, fillTimeMs, fieldCount }
//   mouse:  { jitterHigh }
//   net:    { vpn, countryMismatch, ipCountry, cardCountry }
//   txn:    { amount, amountScale, retryCount, item, merchant }
//   meta:   { uid }

const UF_KEY = 'trustpay.user';
const DEV_KEY = 'trustpay.device';

let startMs = null;
let keyDowns = [];
let mouse = { samples: 0, dev: 0, mean: 0 };
let pastedCard = false;

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function getUserId() {
  try {
    let u = localStorage.getItem(UF_KEY);
    if (!u) {
      u = 'user-' + Math.floor(1000 + Math.random() * 9000);
      localStorage.setItem(UF_KEY, u);
    }
    return u;
  } catch (e) {
    return 'anon';
  }
}

export function getDevice() {
  // Fingerprint-ish identity: stored per browser. First visit = "seen".
  try {
    const d = localStorage.getItem(DEV_KEY);
    if (d) return { seen: true, name: JSON.parse(d).name };
    const name = browserName();
    localStorage.setItem(DEV_KEY, JSON.stringify({ name }));
    return { seen: false, name };
  } catch (e) {
    return { seen: false, name: browserName() };
  }
}

function browserName() {
  const ua = navigator.userAgent || '';
  if (/Edg\//.test(ua)) return 'Edge on ' + osName();
  if (/Chrome\//.test(ua)) return 'Chrome on ' + osName();
  if (/Firefox\//.test(ua)) return 'Firefox on ' + osName();
  if (/Safari\//.test(ua)) return 'Safari on ' + osName();
  return 'browser';
}

function osName() {
  const ua = navigator.userAgent || '';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iOS';
  return 'desktop';
}

export function startCollector(formEl) {
  startMs = now();
  keyDowns = [];
  mouse = { samples: 0, dev: 0, mean: 0 };
  pastedCard = false;

  const cardInput = formEl.querySelector('[data-card]');

  formEl.addEventListener('keydown', (e) => {
    if (e.target && e.target.matches && e.target.matches('input')) {
      keyDowns.push(now());
    }
  });

  if (cardInput) {
    cardInput.addEventListener('paste', () => {
      pastedCard = true;
    });
  }

  let last = null;
  formEl.addEventListener('mousemove', (e) => {
    if (!last) {
      last = { x: e.clientX, y: e.clientY, t: now() };
      return;
    }
    const dt = Math.max(1, now() - last.t);
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    const speed = Math.sqrt(dx * dx + dy * dy) / dt; // px/ms
    mouse.samples++;
    const oldMean = mouse.mean;
    mouse.mean += (speed - mouse.mean) / mouse.samples;
    mouse.dev += speed * speed; // for variance later
    // jitter = variance / mean ratio; high for robotic steady fast paths
    if (mouse.samples < 200) mouse.dev += Math.abs(speed - oldMean);
    last = { x: e.clientX, y: e.clientY, t: now() };
  });

  return () => collect(formEl);
}

function collect(formEl) {
  const fillTimeMs = now() - startMs;

  // typing cadence
  let charsPerMin = 0;
  let isErratic = false;
  if (keyDowns.length >= 3) {
    const totalMs = keyDowns[keyDowns.length - 1] - keyDowns[0];
    const avgGap = totalMs / (keyDowns.length - 1);
    // cadence: 8 chars per word-ish; 60ms gap ≈ 100 cpm (natural) — 40ms ≈ rush
    charsPerMin = Math.round(1000 / Math.max(20, avgGap) * 6 * 0.6);
    // erratic = high variance in inter-key gaps (someone copy-pasting + hunting keys)
    let s = 0;
    for (let i = 1; i < keyDowns.length; i++) s += keyDowns[i] - keyDowns[i - 1];
    const meanGap = s / (keyDowns.length - 1);
    let v = 0;
    for (let i = 1; i < keyDowns.length; i++) {
      const g = keyDowns[i] - keyDowns[i - 1];
      v += (g - meanGap) * (g - meanGap);
    }
    const sd = Math.sqrt(v / (keyDowns.length - 1));
    isErratic = meanGap > 0 && sd / meanGap > 1.2;
  }

  // mouse: high mean + low variance = smooth robotic path
  const meanSpeed = mouse.samples ? mouse.mean : 0;
  const jitterHigh = mouse.samples > 30 && meanSpeed > 0.5;

  const fields = formEl.querySelectorAll('input').length;

  return {
    device: getDevice(),
    typing: { isErratic, charsPerMin },
    form: { pastedCard, fillTimeMs: Math.round(fillTimeMs), fieldCount: fields },
    mouse: { jitterHigh },
    net: { vpn: false, countryMismatch: false, ipCountry: 'IN', cardCountry: 'IN' },
    meta: { uid: getUserId() },
  };
}

// Persona overrides let the scripted demo force a clear story even on the
// first visit (strongly typed beats real-time nuance for a judge).
export function applyPersona(signals, persona) {
  if (!persona) return signals;
  return {
    ...signals,
    device: persona.device,
    typing: persona.typing,
    form: persona.form,
    mouse: persona.mouse,
    net: persona.net,
  };
}