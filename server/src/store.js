// store.js — in-memory transaction + MFA store with seeded demo data.
// No native deps (Railway-safe). Data resets on restart — fine for a demo
// API; a real deployment would swap in Postgres/Mongo.

const transactions = new Map(); // txnId -> txn record
const mfaCodes = new Map(); // txnId -> { code, expiresAt, verified }

export function listTransactions() {
  return [...transactions.values()].sort((a, b) => (b.ts - a.ts));
}

export function getTransaction(id) {
  return transactions.get(id);
}

export function saveTransaction(txn) {
  transactions.set(txn.id, txn);
  return txn;
}

export function seed() {
  if (transactions.size > 0) return;
  const now = Date.now();
  const mk = (partial) => ({
    id: partial.id,
    ts: partial.ts,
    merchant: 'Kicks Store',
    userId: partial.userId,
    item: partial.item,
    amount: partial.amount,
    score: partial.score,
    level: partial.level,
    action: partial.action,
    status: partial.status,
    factors: partial.factors,
  });

  [
    [1, 28, 'approved', 'allow', [], 't-1001', 2],
    [2, 16, 'approved', 'allow', [], 't-1002', 149],
    [3, 42, 'review', 'review', [{ id: 'vpn', label: 'VPN / anonymizing network in use', impact: 14 }], 't-1003', 1290],
    [4, 88, 'challenged', 'challenge', [
      { id: 'device_unseen', label: 'New device (Chrome on Windows)', impact: 18 },
      { id: 'card_pasted', label: 'Card number pasted, not typed', impact: 12 },
      { id: 'vpn', label: 'VPN / anonymizing network in use', impact: 14 },
    ], 't-1004', 4900],
    [5, 71, 'challenged', 'challenge', [
      { id: 'country_mismatch', label: 'IP country DE ≠ card country US', impact: 12 },
      { id: 'typing_erratic', label: 'Erratic typing cadence', impact: 15 },
      { id: 'amount_high', label: 'Amount 4.2× typical', impact: 10 },
    ], 't-1005', 2199],
    [6, 12, 'approved', 'allow', [], 't-1006', 84],
  ].forEach(([i, score, status, action, factors, id, amount]) => {
    saveTransaction(mk({
      id: `seed-${id}`,
      ts: now - i * 47 * 60 * 1000,
      userId: `user-${1000 + i}`,
      item: 'Limited Drop Sneakers',
      amount,
      score,
      level: action,
      action,
      status,
      factors,
    }));
  });
}

// --- MFA (demo) ---
export function createMfa(txnId) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const record = { code, expiresAt: Date.now() + 5 * 60 * 1000, verified: false };
  mfaCodes.set(txnId, record);
  return record;
}

export function getMfa(txnId) {
  return mfaCodes.get(txnId);
}

export function markMfaVerified(txnId) {
  const r = mfaCodes.get(txnId);
  if (r) r.verified = true;
  return r;
}