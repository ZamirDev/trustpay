// riskModel.js — TrustPay Guard's embedded explainable risk engine.
//
// EXACT MIRROR of server/src/riskModel.js — keep these two files in sync.
// This copy lets the extension score checkouts fully OFFLINE (no API up).
// Everything here returns the same shapes the API would:
//   scoreRisk(signals) -> { score, level, action, factors, contributorCount }
//   explain(verdict)   -> string

// Weights (tweakable — single source of truth for the model doc).
export const WEIGHTS = {
  base: 4,
  deviceUnseen: 18,
  typingErratic: 15,
  cardPasted: 16,
  vpn: 14,
  countryMismatch: 12,
  mouseJitterHigh: 8,
  autofillFast: 7,
  amountScaleHigh: 10,
  retryCount: 10,
  rushTyping: 8,
};

const LEVELS = {
  allow: { min: 0, label: 'allow' },
  review: { min: 35, label: 'review' },
  challenge: { min: 65, label: 'challenge' },
};

function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

function levelFor(score) {
  if (score >= LEVELS.challenge.min) return LEVELS.challenge.label;
  if (score >= LEVELS.review.min) return LEVELS.review.label;
  return LEVELS.allow.label;
}

export function scoreRisk(signals = {}) {
  const factors = [];
  let score = WEIGHTS.base;

  const push = (id, label, impact) => {
    if (impact > 0) factors.push({ id, label, impact });
    score += impact;
  };

  const dev = signals.device || {};
  if (dev.seen === false) push('device_unseen', `New device (${dev.name || 'unknown'})`, WEIGHTS.deviceUnseen);

  const typ = signals.typing || {};
  if (typ.isErratic) push('typing_erratic', 'Erratic typing cadence', WEIGHTS.typingErratic);
  if (typ.charsPerMin > 260 && typ.isErratic !== true) {
    push('typing_rush', `Rush typing (${typ.charsPerMin} cpm)`, WEIGHTS.rushTyping);
  }

  const form = signals.form || {};
  if (form.pastedCard) push('card_pasted', 'Card number pasted, not typed', WEIGHTS.cardPasted);
  if (form.fillTimeMs != null && form.fillTimeMs < 8000 && form.fieldCount >= 3) {
    push('autofill_fast', `Auto-filled form in ${Math.round(form.fillTimeMs / 1000)}s`, WEIGHTS.autofillFast);
  }

  const mouse = signals.mouse || {};
  if (mouse.jitterHigh) push('mouse_robotic', 'Robotic mouse movement (low jitter path)', WEIGHTS.mouseJitterHigh);

  const net = signals.net || {};
  if (net.vpn) push('vpn', 'VPN / anonymizing network in use', WEIGHTS.vpn);
  if (net.countryMismatch) {
    push('country_mismatch', `IP country ${net.ipCountry || '?'} ≠ card country ${net.cardCountry || '?'}`, WEIGHTS.countryMismatch);
  }

  const txn = signals.txn || {};
  if (txn.amountScale != null && txn.amountScale > 3) {
    push('amount_high', `Amount ${txn.amountScale.toFixed(1)}× typical`, WEIGHTS.amountScaleHigh);
  }
  if (txn.retryCount >= 2) {
    push('velocity_retries', `${txn.retryCount} payment attempts`, WEIGHTS.retryCount);
  }

  score = Math.round(clamp(score));
  const sorted = factors.sort((a, b) => b.impact - a.impact);
  const top = sorted.slice(0, 3).map((f) => ({ id: f.id, label: f.label, impact: f.impact }));

  return {
    score,
    level: levelFor(score),
    action: levelFor(score),
    factors: top,
    contributorCount: sorted.length,
  };
}

export function explain(verdict) {
  if (verdict.action === 'allow') return 'No concerning signals — checkout continues seamlessly.';
  if (verdict.action === 'review') return 'A few signals look off. We take a closer look without slowing good customers.';
  return 'High-risk signals detected. A quick identity check (MFA) is required to finish.';
}