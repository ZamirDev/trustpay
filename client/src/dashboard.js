// dashboard.js — merchant transaction feed: live risk scores + factors.

import { api } from './api.js';
import { formatPrice } from './checkout.js';

let timer = null;

export async function renderDashboard(root) {
  root.innerHTML = `
    <h2>Merchant dashboard — Kicks Store</h2>
    <div class="dash-summary" id="dashSummary"></div>
    <div class="dash-empty" id="dashEmpty" hidden>Fetching transactions…</div>
    <div class="tx-table-wrap" id="txWrap" hidden>
      <table class="tx">
        <thead>
          <tr>
            <th>Time</th><th>User</th><th>Item</th><th>Amount</th>
            <th>Score</th><th>Verdict</th><th>Status</th><th>Why</th>
          </tr>
        </thead>
        <tbody id="txBody"></tbody>
      </table>
    </div>
    <p class="checkout-note">Auto-refreshes every 5s. Run the Checkout demo to add rows live.</p>`;

  await refresh(root);
  clearInterval(timer);
  timer = setInterval(() => refresh(root), 5000);
}

export function stopDashboard() {
  clearInterval(timer);
  timer = null;
}

async function refresh(root) {
  const summary = root.querySelector('#dashSummary');
  const empty = root.querySelector('#dashEmpty');
  const wrap = root.querySelector('#txWrap');
  const body = root.querySelector('#txBody');
  if (!summary || !body) return;

  try {
    const { transactions } = await api.transactions();
    if (!transactions.length) {
      empty.hidden = false;
      empty.textContent = 'No transactions yet — go run the Checkout demo.';
      wrap.hidden = true;
      return;
    }
    empty.hidden = true;
    wrap.hidden = false;
    renderSummary(summary, transactions);
    body.innerHTML = transactions.map(txRow).join('');
  } catch (e) {
    empty.hidden = false;
    empty.textContent = 'Engine unreachable — is the server running on :4000?';
    wrap.hidden = true;
  }
}

function renderSummary(el, txns) {
  const total = txns.length;
  const approved = txns.filter((t) => t.status === 'approved' || t.status === 'allow').length;
  const challenged = txns.filter((t) => t.status === 'challenged').length;
  const value = txns.reduce((s, t) => s + (t.amount || 0), 0);
  el.innerHTML = `
    <div class="dash-stat"><b>${total}</b><span>transactions</span></div>
    <div class="dash-stat"><b>${approved}</b><span>approved</span></div>
    <div class="dash-stat"><b>${challenged}</b><span>challenged</span></div>
    <div class="dash-stat"><b>${formatPrice(value)}</b><span>total value</span></div>`;
}

function txRow(t) {
  const time = new Date(t.ts).toLocaleTimeString();
  const score = t.score ?? '–';
  const verdict = t.action || t.level || '–';
  const reasons =
    t.factors && t.factors.length ? t.factors.map((f) => f.label).join(' · ') : 'clean';
  return `
    <tr>
      <td>${time}</td>
      <td>${t.userId || 'anonymous'}</td>
      <td>${t.item || 'Order'}</td>
      <td>${formatPrice(t.amount ?? 0)}</td>
      <td><b>${score}</b></td>
      <td><span class="pill pill-${verdict}">${verdict}</span></td>
      <td><span class="pill pill-${t.status}">${t.status}</span></td>
      <td class="tx-factors">${reasons}</td>
    </tr>`;
}