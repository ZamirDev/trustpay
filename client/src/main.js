// main.js — TrustPay SPA. Hash router: #/ | #/checkout | #/dashboard.

import './style.css';
import { renderCheckout } from './checkout.js';
import { renderDashboard, stopDashboard } from './dashboard.js';

const app = document.querySelector('#app');
const navItems = document.querySelectorAll('.clay-nav-item');

function navigate() {
  const hash = location.hash || '#/';
  setActiveNav(hash);

  if (hash === '#/dashboard') {
    renderDashboard(app);
  } else if (hash === '#/checkout') {
    renderCheckout(app, () => {
      // Keep the dashboard fresh if it's mounted behind us.
      stopDashboard();
    });
  } else {
    app.innerHTML = `
      <section class="landing-hero">
        <span class="landing-eyebrow">explainable fraud risk engine</span>
        <h1 class="landing-title">Buy like a human.<br/>Get stopped like a pro.</h1>
        <p class="landing-sub">
          TrustPay watches how you <b>type</b>, <b>move</b>, and <b>spend</b> — then explains
          every score. Legit shoppers glide through. Risky ones get an identity check
          before a card is charged.
        </p>
        <div class="landing-cta">
          <a class="clay-btn clay-btn-primary" href="#/checkout">Try the checkout demo</a>
          <a class="clay-btn" href="#/dashboard">Watch the dashboard</a>
        </div>
        <ul class="landing-facts">
          <li>⌨ typing dynamics</li>
          <li>🖱 mouse velocity</li>
          <li>💳 paste detection</li>
          <li>🌐 VPN / geo checks</li>
          <li>💰 amount vs your norm</li>
          <li>🔐 step-up MFA when hot</li>
        </ul>
      </section>`;
  }
}

function setActiveNav(hash) {
  navItems.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === hash));
}

window.addEventListener('hashchange', navigate);
navigate();