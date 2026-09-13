// api.js — thin fetch wrapper. In dev the Vite proxy forwards /api to
// localhost:4000. At deploy (S4) VITE_API_URL carries the live Railway URL.

const BASE = (import.meta.env && import.meta.env.VITE_API_URL) || '';

async function http(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export const api = {
  risk: (signals) => http('/api/risk', { method: 'POST', body: JSON.stringify({ signals }) }),
  transactions: () => http('/api/transactions'),
  mfaSend: (txnId) => http('/api/mfa/send', { method: 'POST', body: JSON.stringify({ txnId }) }),
  mfaVerify: (txnId, code) =>
    http('/api/mfa/verify', { method: 'POST', body: JSON.stringify({ txnId, code }) }),
};