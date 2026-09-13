// checkout.js — Kicks storefront + TrustPay risk widget.

import { api } from './api.js';
import { startCollector, applyPersona, getDevice, getUserId } from './collector.js';
import { PERSONAS, scriptType } from './personas.js';
import { mfaModal } from './mfa.js';

const CATALOG = [
  { id: 'cloud', name: 'Cloudrunner', price: 89, typical: true },
  { id: 'court', name: 'Court Classic', price: 119, typical: true },
  { id: 'vapor', name: 'Vapor Max', price: 229, typical: false },
  { id: 'drop', name: 'Drop Dead Limited', price: 489, typical: false },
];

const TYPICAL_AMOUNT = 119;

let selected = CATALOG[0];
let collectSignals = null;
let busy = false;

export async function renderCheckout(root, onTransaction) {
  root.innerHTML = `
    <div class="checkout-layout">
      <div class="catalog">
        <h2>The Kicks store</h2>
        <p class="checkout-note">Pick a pair, then run a persona — or type your own card details and tap Pay.</p>
        <div class="kick-grid">
          ${CATALOG.map(kickCard).join('')}
        </div>
      </div>
      <div class="checkout-panel">
        <h2>Checkout</h2>
        <form id="payForm">
          <div class="field"><label>Name on card</label><input data-field="name" autocomplete="name" placeholder="John Alston" /></div>
          <div class="field"><label>Card number</label><input data-field="card" data-card autocomplete="cc-number" placeholder="4242 4242 4242 4242" inputmode="numeric" /></div>
          <div class="field-row">
            <div class="field"><label>Expiry</label><input data-field="exp" autocomplete="cc-exp" placeholder="12 / 28" /></div>
            <div class="field"><label>CVC</label><input data-field="cvc" autocomplete="cc-csc" placeholder="737" /></div>
          </div>
          <div class="checkout-actions">
            <button type="button" class="clay-btn clay-btn-green" data-persona="alex">${PERSONAS.alex.emoji} ${PERSONAS.alex.label}</button>
            <button type="button" class="clay-btn clay-btn-ghost" data-persona="review">${PERSONAS.review.emoji} ${PERSONAS.review.label}</button>
            <button type="button" class="clay-btn" data-persona="shady">${PERSONAS.shady.emoji} ${PERSONAS.shady.label}</button>
          </div>
          <div class="checkout-actions">
            <button type="submit" class="clay-btn clay-btn-primary" id="payBtn">Pay ${formatPrice(selected.price)}</button>
          </div>
          <p class="checkout-note">${getDevice().seen ? 'Known device' : 'New device (first visit)'} · ${getUserId()} · typical order ≈ ${formatPrice(TYPICAL_AMOUNT)}</p>
        </form>
        <div class="risk-widget" id="riskWidget" hidden></div>
        <div class="status-line" id="statusLine"></div>
      </div>
    </div>`;

  const form = root.querySelector('#payForm');
  collectSignals = startCollector(form);

  wireCatalog(root);
  wireForm(root, onTransaction);
}

function kickCard(k) {
  const sel = k.id === selected.id ? ' is-selected' : '';
  return `
    <div class="kick-card${sel}" data-kick="${k.id}">
      <div class="kick-swatch" style="background:${swatch(k.id)}"></div>
      <h3>${k.name}</h3>
      <div class="kick-price">${formatPrice(k.price)}</div>
      <div class="kick-typical">${k.typical ? '≈ typical order' : 'large order'}</div>
    </div>`;
}

function swatch(id) {
  return {
    cloud: '#c8d8ff',
    court: '#f5c86b',
    vapor: '#ff9f9f',
    drop: '#3d2c2e',
  }[id] || '#9fe6a0';
}

function wireCatalog(root) {
  root.querySelectorAll('.kick-card').forEach((card) => {
    card.addEventListener('click', () => {
      selected = CATALOG.find((k) => k.id === card.dataset.kick);
      const payBtn = root.querySelector('#payBtn');
      if (payBtn) payBtn.textContent = `Pay ${formatPrice(selected.price)}`;
      root.querySelectorAll('.kick-card').forEach((c) => c.classList.toggle('is-selected', c === card));
      clearWidget(root);
    });
  });
}

function wireForm(root, onTransaction) {
  const form = root.querySelector('#payForm');
  const personaBtns = root.querySelectorAll('[data-persona]');
  const statusLine = root.querySelector('#statusLine');

  personaBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      setBusy(root, true);
      clearWidget(root);
      statusLine.textContent = `▶ running ${PERSONAS[btn.dataset.persona].label}…`;

      const persona = PERSONAS[btn.dataset.persona];
      await scriptType(form, persona);
      // The collector ran during typing; force the persona's signal profile
      // so the story is exact (deterministic for a live demo).
      const real = collectionSignals(root);
      const signals = applyPersona(real, persona);
      await checkout(root, signals, persona, onTransaction);

      setBusy(root, false);
      busy = false;
      statusLine.textContent = '✓ run complete — pick another persona or tap Pay.';
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    setBusy(root, true);
    clearWidget(root);
    statusLine.textContent = '▶ trust-checking your order…';

    const signals = collectionSignals(root);
    await checkout(root, signals, null, onTransaction);

    setBusy(root, false);
    busy = false;
    statusLine.textContent = '✓ done — dashboard updated.';
  });

  form.addEventListener('input', () => {
    const dirty = !![...form.querySelectorAll('input')].find((i) => i.value.trim());
    if (!dirty) clearWidget(root);
  });
}

function collectionSignals(root) {
  // Real-time capture. Persona runs overwrite below; live Pay uses this as-is.
  if (collectSignals) return collectSignals();
  return {
    device: getDevice(),
    typing: { isErratic: false, charsPerMin: 0 },
    form: { pastedCard: false, fillTimeMs: 1, fieldCount: 4 },
    mouse: { jitterHigh: false },
    net: { vpn: false, countryMismatch: false, ipCountry: 'IN', cardCountry: 'IN' },
    meta: { uid: getUserId() },
  };
}

async function checkout(root, signals, persona, onTransaction) {
  const widget = root.querySelector('#riskWidget');
  widget.hidden = false;

  // Attach txn context on top of collected signals.
  const ctx = {
    txn: {
      amount: selected.price,
      amountScale: +((selected.price / TYPICAL_AMOUNT).toFixed(2)),
      retryCount: 0,
      item: selected.name,
      merchant: 'Kicks Store',
    },
  };

  let verdict;
  try {
    verdict = await api.risk({ ...ctx, ...signals });
  } catch (err) {
    widget.innerHTML = `<p class="modal-error">Engine unreachable — is the server running on :4000?</p>`;
    return;
  }

  showRiskWidget(widget, verdict, persona);

  if (verdict.action === 'allow') {
    widget.innerHTML += `<p class="risk-clean">🎉 ${persona ? persona.label : 'You'} checked out instantly — no friction.</p>`;
    if (onTransaction) onTransaction(verdict);
    return;
  }

  if (verdict.action === 'review') {
    widget.innerHTML += `<p class="risk-clean">🟡 Taking a closer look… approved after review.</p>`;
    if (onTransaction) onTransaction(verdict);
    return;
  }

  // challenge → MFA
  const ok = await mfaModal(root, verdict.txnId);
  if (ok) {
    widget.innerHTML += `<p class="risk-clean">✅ Identity verified — checkout complete. (Fraud stopped first, then approved.)</p>`;
    if (onTransaction) onTransaction(verdict);
  } else {
    widget.innerHTML += `<p class="modal-error">Verification failed — purchase blocked.</p>`;
  }
}

function showRiskWidget(widget, verdict, persona) {
  const name = persona ? `${persona.emoji} ${persona.label}` : 'This checkout';
  const factors =
    verdict.factors && verdict.factors.length
      ? `<ul class="risk-factors">${verdict.factors
          .map((f) => `<li><span>${f.label}</span><span class="impact">+${f.impact}</span></li>`)
          .join('')}</ul>`
      : `<p class="risk-clean">✅ Clean — no risk factors triggered.</p>`;
  widget.className = `risk-widget lv-${verdict.level}`;
  widget.innerHTML = `
    <div class="risk-head">
      <div class="score-ball">${verdict.score}</div>
      <div>
        <div class="score-level">${name} → ${verdict.level}</div>
        <p class="score-explainer">${verdict.explain || description(verdict.action)}</p>
      </div>
    </div>
    ${factors}`;
}

function description(action) {
  return {
    allow: 'All clear — checkout continues instantly.',
    review: 'A couple of signals look unusual — we verify quietly.',
    challenge: 'High-risk — an identity check is required.',
  }[action] || '';
}

function clearWidget(root) {
  const w = root.querySelector('#riskWidget');
  if (w) {
    w.hidden = true;
    w.innerHTML = '';
    w.className = 'risk-widget';
  }
}

function setBusy(root, busyState) {
  root.querySelector('#payBtn').disabled = busyState;
  root.querySelectorAll('[data-persona]').forEach((b) => (b.disabled = busyState));
}

export function formatPrice(n) {
  return '₹' + n;
}