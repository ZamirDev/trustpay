// mfa.js — the step-up challenge modal. Demo-only: the server SIMULATES the
// bank SMS by returning the OTP, which the modal shows as a phone bubble.
// (A real deployment would send it via SMS/email and never expose it.)

import { api } from './api.js';

export async function mfaModal(root, txnId) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <h2>🔐 Identity check required</h2>
        <p class="checkout-note">TrustPay flagged this purchase as high-risk. We texted a one-time code to your bank phone to confirm it's really you.</p>
        <div class="sms-bubble">💬 YourTrustBank — code: <code id="mfaCode">····</code> · valid 5 min</div>
        <div class="field">
          <label>Enter the 6-digit code</label>
          <input id="mfaInput" inputmode="numeric" placeholder="000000" autocomplete="one-time-code" />
        </div>
        <div class="modal-error" id="mfaErr"></div>
        <div class="modal-actions">
          <button class="clay-btn clay-btn-primary" id="mfaOk">Verify</button>
          <button class="clay-btn clay-btn-ghost" id="mfaCancel">Cancel</button>
        </div>
      </div>`;
    root.appendChild(backdrop);

    const input = backdrop.querySelector('#mfaInput');
    const errEl = backdrop.querySelector('#mfaErr');

    let invoked = false;
    const finish = (ok) => {
      if (invoked) return;
      invoked = true;
      backdrop.remove();
      resolve(ok);
    };

    const verify = async () => {
      errEl.textContent = '';
      try {
        const res = await api.mfaVerify(txnId, input.value.trim());
        if (res.ok) finish(true);
        else errEl.textContent = res.error || 'Wrong code — try again.';
      } catch (e) {
        errEl.textContent = e.message;
      }
    };

    backdrop.querySelector('#mfaOk').addEventListener('click', verify);
    backdrop.querySelector('#mfaCancel').addEventListener('click', () => finish(false));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish(false);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') verify();
    });

    // Demo: reveal the simulated SMS code.
    api
      .mfaSend(txnId)
      .then((res) => {
        backdrop.querySelector('#mfaCode').textContent = res.code;
        input.focus();
      })
      .catch(() => {
        errEl.textContent = 'Could not reach the challenge service.';
      });
  });
}