/**
 * PayFlow MFS Super Admin — Master Application Controller
 */

import { i18n } from './i18n.js';
import { adminApi } from './api.js';
import { components } from './components.js';

class AdminApp {
  constructor() {
    this.currentRoute = window.location.hash || '#dashboard';
    this.currentMetric = 'revenue';
    this.statsCache = null;
    this.merchantsCache = [];
    this.transactionsCache = [];
    this.devicesCache = [];

    this.initTheme();
    this.bindEvents();
    this.registerGlobalWindowHooks();
  }

  initTheme() {
    const savedTheme = localStorage.getItem('payflow_admin_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon) {
      themeIcon.innerHTML = savedTheme === 'dark'
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    }
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('payflow_admin_theme', next);
    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon) {
      themeIcon.innerHTML = next === 'dark'
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    }
  }

  toggleLanguage() {
    const nextLang = i18n.currentLang === 'en' ? 'bn' : 'en';
    i18n.setLanguage(nextLang);
    const langBtn = document.getElementById('langToggleBtn');
    if (langBtn) {
      langBtn.textContent = nextLang === 'en' ? 'BN' : 'EN';
    }
    this.showToast(`Language switched to ${nextLang.toUpperCase()}`);
    this.renderCurrentView();
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    const iconSvg = type === 'success'
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
      : (type === 'error'
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`);

    toast.innerHTML = `<span style="display:inline-flex;align-items:center;">${iconSvg}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  bindEvents() {
    // Hash change routing
    window.addEventListener('hashchange', () => {
      this.currentRoute = window.location.hash || '#dashboard';
      this.updateSidebarActiveState();
      this.renderCurrentView();
    });

    // Mobile sidebar toggle
    const menuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('adminSidebar');
    if (menuBtn && sidebar) {
      menuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
      });
    }

    // Theme toggle
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => this.toggleTheme());
    }

    // Language toggle
    const langBtn = document.getElementById('langToggleBtn');
    if (langBtn) {
      langBtn.addEventListener('click', () => this.toggleLanguage());
    }

    // Keyboard shortcut Cmd+K or Ctrl+K for search
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.getElementById('globalSearchInput');
        if (searchInput) searchInput.focus();
      }
    });

    // Start 5-second polling for live health and stats
    setInterval(() => {
      if (this.currentRoute === '#dashboard') {
        this.loadDashboardData(true);
      }
    }, 5000);
  }

  updateSidebarActiveState() {
    document.querySelectorAll('.nav-link').forEach((link) => {
      const href = link.getAttribute('href');
      if (href === this.currentRoute) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  async start() {
    i18n.translateDOM();
    this.updateSidebarActiveState();
    await this.renderCurrentView();
  }

  async renderCurrentView() {
    const route = this.currentRoute.replace('#', '') || 'dashboard';
    const container = document.getElementById('viewContainer');
    if (!container) return;

    // Show skeleton
    container.innerHTML = `
      <div style="padding: 2rem 0;">
        <div style="height: 32px; width: 220px; background: var(--bg-card); border-radius: var(--radius-md); margin-bottom: 1.5rem;"></div>
        <div style="height: 120px; background: var(--bg-card); border-radius: var(--radius-lg); margin-bottom: 1.5rem;"></div>
        <div style="height: 300px; background: var(--bg-card); border-radius: var(--radius-lg);"></div>
      </div>
    `;

    try {
      switch (route) {
        case 'dashboard':
          await this.renderDashboardView(container);
          break;
        case 'transactions':
          await this.renderTransactionsView(container);
          break;
        case 'invoices':
          await this.renderInvoicesView(container);
          break;
        case 'unmatched-sms':
          await this.renderUnmatchedSmsView(container);
          break;
        case 'merchants':
          await this.renderMerchantsView(container);
          break;
        case 'payouts':
          await this.renderPayoutsView(container);
          break;
        case 'devices':
          await this.renderDevicesView(container);
          break;
        case 'api-keys':
        case 'api-usage':
        case 'api-logs':
          await this.renderApiKeysView(container);
          break;
        case 'webhooks':
          await this.renderWebhooksView(container);
          break;
        case 'providers':
        case 'bkash':
        case 'nagad':
        case 'rocket':
        case 'upay':
          await this.renderProvidersView(container);
          break;
        case 'reports':
          await this.renderReportsView(container);
          break;
        case 'audit-logs':
          await this.renderAuditLogsView(container);
          break;
        case 'suspicious':
          await this.renderSuspiciousView(container);
          break;
        case 'blacklist':
          await this.renderBlacklistView(container);
          break;
        case 'simulator':
          await this.renderSimulatorView(container);
          break;
        case 'system-health':
          await this.renderSystemHealthView(container);
          break;
        case 'server-logs':
          await this.renderServerLogsView(container);
          break;
        case 'admin-users':
          await this.renderAdminUsersView(container);
          break;
        case 'settings':
          await this.renderSettingsView(container);
          break;
        default:
          await this.renderDashboardView(container);
          break;
      }
      i18n.translateDOM();
    } catch (err) {
      container.innerHTML = `
        <div class="dashboard-panel" style="text-align:center;padding:3rem;">
          <h2 style="color:var(--danger);margin-bottom:0.5rem;">Something went wrong</h2>
          <p style="color:var(--text-muted);margin-bottom:1.5rem;">${err.message}</p>
          <button class="btn-primary" onclick="window.location.reload()">Try Again</button>
        </div>
      `;
    }
  }

  // View Renderers
  async renderDashboardView(container) {
    const statsRes = await adminApi.getGlobalStats();
    const chartRes = await adminApi.getRevenueAnalytics(7, 'daily');
    const provRes = await adminApi.getMfsProviders();
    const txRes = await adminApi.getTransactions(10);

    this.statsCache = statsRes.data;
    this.transactionsCache = txRes.data;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1 data-i18n="greeting">${i18n.get('greeting')}</h1>
          <p data-i18n="subGreeting">${i18n.get('subGreeting')}</p>
        </div>
        <div class="header-actions">
          <div class="filter-group">
            <button class="filter-btn active">7 Days</button>
            <button class="filter-btn">30 Days</button>
            <button class="filter-btn">90 Days</button>
          </div>
          <button class="btn-primary" onclick="window.exportTransactionsCsv()">
            ${i18n.get('exportCsv')}
          </button>
        </div>
      </div>

      <!-- KPI Metric Cards Grid -->
      <div class="kpi-grid">
        ${components.renderStatCards(statsRes.data)}
      </div>

      <!-- Analytics Split: Large Chart + Provider Cards -->
      <div class="analytics-split">
        <div class="dashboard-panel">
          <div class="panel-header">
            <div class="panel-title" data-i18n="paymentRevenueOverview">${i18n.get('paymentRevenueOverview')}</div>
            <div class="filter-group">
              <button class="filter-btn ${this.currentMetric === 'revenue' ? 'active' : ''}" onclick="window.switchChartMetric('revenue')">Revenue (৳)</button>
              <button class="filter-btn ${this.currentMetric === 'transactions' ? 'active' : ''}" onclick="window.switchChartMetric('transactions')">Count</button>
              <button class="filter-btn ${this.currentMetric === 'successful' ? 'active' : ''}" onclick="window.switchChartMetric('successful')">Success</button>
              <button class="filter-btn ${this.currentMetric === 'failed' ? 'active' : ''}" onclick="window.switchChartMetric('failed')">Failed</button>
            </div>
          </div>
          <div class="chart-container" id="adminChartContainer">
            ${components.renderRevenueChart(chartRes.data, this.currentMetric)}
          </div>
        </div>

        <div class="dashboard-panel">
          <div class="panel-header">
            <div class="panel-title" data-i18n="providerPerformance">${i18n.get('providerPerformance')}</div>
            <span class="badge badge-operational">ALL ONLINE</span>
          </div>
          <div class="provider-cards-grid">
            ${components.renderMfsProviders(provRes.data)}
          </div>
        </div>
      </div>

      <!-- Recent Transactions Table -->
      <div class="table-card">
        <div class="table-toolbar">
          <div style="font-weight:700;font-size:1rem;" data-i18n="recentTransactions">${i18n.get('recentTransactions')}</div>
          <input type="text" class="table-search-input" placeholder="Filter by TrxID or Merchant..." oninput="window.filterTableRows(this.value)">
        </div>
        <div class="table-responsive">
          <table class="admin-table">
            <thead>
              <tr>
                <th data-i18n="trxId">TrxID</th>
                <th data-i18n="merchant">Merchant</th>
                <th data-i18n="provider">Provider</th>
                <th data-i18n="amount">Amount</th>
                <th>Sender (Masked)</th>
                <th data-i18n="device">Device</th>
                <th data-i18n="status">Status</th>
                <th data-i18n="time">Time</th>
                <th data-i18n="action">Action</th>
              </tr>
            </thead>
            <tbody id="transactionsTableBody">
              ${components.renderTransactionsTable(txRes.data)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async renderTransactionsView(container) {
    const txRes = await adminApi.getTransactions(100);
    this.transactionsCache = txRes.data;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>Gateway Transactions</h1>
          <p>Global multi-merchant transactions, automated TrxID reconciliations and SMS logs.</p>
        </div>
        <div class="header-actions">
          <button class="btn-secondary" onclick="window.openManualVerifyModal()" style="display:inline-flex;align-items:center;gap:0.35rem;">
            ✓ Manual Verify Override
          </button>
          <button class="btn-primary" onclick="window.exportTransactionsCsv()">Export CSV</button>
        </div>
      </div>

      <div class="table-card">
        <div class="table-toolbar">
          <input type="text" class="table-search-input" placeholder="Search TrxID, Merchant, Sender..." oninput="window.filterTableRows(this.value)">
        </div>
        <div class="table-responsive">
          <table class="admin-table">
            <thead>
              <tr>
                <th>TrxID</th>
                <th>Merchant</th>
                <th>Provider</th>
                <th>Amount</th>
                <th>Sender</th>
                <th>Device</th>
                <th>Status</th>
                <th>Time</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="transactionsTableBody">
              ${components.renderTransactionsTable(txRes.data)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async renderMerchantsView(container) {
    const res = await adminApi.getMerchants();
    this.merchantsCache = res.data;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>Merchants Management</h1>
          <p>Configure enterprise merchants, API credentials, webhooks, and device permissions.</p>
        </div>
        <div class="header-actions">
          <button class="btn-primary" onclick="window.openAddMerchantModal()">+ Add New Merchant</button>
        </div>
      </div>

      <div class="table-card">
        <div class="table-toolbar">
          <input type="text" class="table-search-input" placeholder="Search merchants by business name or ID...">
        </div>
        <div class="table-responsive">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Merchant Business</th>
                <th>Contact Info</th>
                <th>Plan Tier</th>
                <th>Account Status</th>
                <th>Devices</th>
                <th>Total Volume</th>
                <th>Created</th>
                <th>Approval & Plan Action</th>
              </tr>
            </thead>
            <tbody>
              ${components.renderMerchantsTable(res.data)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async renderDevicesView(container) {
    const res = await adminApi.getDevices();
    this.devicesCache = res.data;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>Android Forwarder Devices</h1>
          <p>Realtime forwarder fleet status, battery health, SMS counts, and heartbeats.</p>
        </div>
      </div>

      <div class="table-card">
        <div class="table-responsive">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Device Model</th>
                <th>Assigned Merchant</th>
                <th>SIM Number</th>
                <th>Status</th>
                <th>SMS Processed</th>
                <th>Last Seen</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${components.renderDevicesTable(res.data)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async renderInvoicesView(container) {
    const res = await adminApi.getInvoices(100);
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>Invoice Management</h1>
          <p>All checkout sessions generated across all merchants.</p>
        </div>
      </div>

      <div class="table-card">
        <div class="table-responsive">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Invoice ID</th>
                <th>Merchant</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              ${components.renderInvoicesTable(res.data)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async renderApiKeysView(container) {
    const res = await adminApi.getApiKeys();
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>API Keys & Credentials</h1>
          <p>Audit and revoke live and sandbox merchant API keys. Secrets are permanently masked.</p>
        </div>
      </div>

      <div class="table-card">
        <div class="table-responsive">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Key Prefix</th>
                <th>Merchant</th>
                <th>Environment</th>
                <th>Status</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${components.renderApiKeysTable(res.data)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async renderWebhooksView(container) {
    const res = await adminApi.getWebhooks();
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>Webhooks Monitoring</h1>
          <p>Realtime delivery audit of payment.completed and payment.failed events to merchant endpoints.</p>
        </div>
      </div>

      <div class="table-card">
        <div class="table-responsive">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Merchant</th>
                <th>Invoice</th>
                <th>HTTP Status</th>
                <th>Response Time</th>
                <th>Attempts</th>
                <th>Time</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${components.renderWebhooksTable(res.data)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async renderUnmatchedSmsView(container) {
    const res = await adminApi.getUnmatchedSms();
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>📬 Unmatched Incoming SMS Pool</h1>
          <p>Inbound payments received via SMS forwarders that did not match an active pending invoice. Assign them manually to resolve customer checkouts.</p>
        </div>
      </div>

      <div class="table-card">
        <div class="table-responsive">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>TrxID</th>
                <th>Amount</th>
                <th>Sender</th>
                <th>Status</th>
                <th>Received At</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${components.renderUnmatchedSmsTable(res.data || [])}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async renderPayoutsView(container) {
    const res = await adminApi.getPayouts();
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>💸 Merchant Settlements & Payout Requests</h1>
          <p>Manage merchant ledger withdrawal requests, review bank/MFS accounts, and authorize settlements.</p>
        </div>
      </div>

      <div class="table-card">
        <div class="table-responsive">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Payout ID</th>
                <th>Merchant</th>
                <th>Gross Amount</th>
                <th>Platform Fee (1.5%)</th>
                <th>Net Disbursement</th>
                <th>Disbursement Account</th>
                <th>Status</th>
                <th>Actions / TrxID</th>
              </tr>
            </thead>
            <tbody>
              ${components.renderPayoutsTable(res.data || [])}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async renderBlacklistView(container) {
    const res = await adminApi.getBlacklist();
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>🚫 Security Blacklist & Fraud Guard</h1>
          <p>Enforced blocklist of abusive IP addresses, fraudulent phone numbers, and intercepted fake TrxIDs.</p>
        </div>
        <div class="header-actions">
          <button class="btn-primary" onclick="window.openAddBlacklistModal()" style="background:var(--danger);border-color:var(--danger);">+ Block IP / Number</button>
        </div>
      </div>

      <div class="table-card">
        <div class="table-responsive">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Entity Type</th>
                <th>Blocked Target</th>
                <th>Detection Reason</th>
                <th>Enforced By</th>
                <th>Created At</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${components.renderBlacklistTable(res.data || [])}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async renderSimulatorView(container) {
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>⚡ Developer & Payment Simulator</h1>
          <p>Simulate inbound MFS payment SMS events and verify real-time invoice reconciliation and webhook delivery without physical devices.</p>
        </div>
      </div>

      <div class="dashboard-panel" style="max-width:700px;">
        <h3 class="panel-title" style="margin-bottom:1.25rem;">Dispatch Simulated Payment Event</h3>
        
        <div style="margin-bottom:1rem;">
          <label style="font-size:0.8rem;color:var(--text-muted);display:block;margin-bottom:0.35rem;">MFS Payment Channel *</label>
          <select id="simProvider" class="table-search-input" style="width:100%;">
            <option value="bKash">bKash (Shortcode: bKash / 16247)</option>
            <option value="Nagad">Nagad (Shortcode: 16167)</option>
            <option value="Rocket">DBBL Rocket (Shortcode: 16216)</option>
            <option value="Upay">Upay (Shortcode: Upay)</option>
          </select>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
          <div>
            <label style="font-size:0.8rem;color:var(--text-muted);display:block;margin-bottom:0.35rem;">Simulated Amount (BDT) *</label>
            <input type="number" id="simAmount" class="table-search-input" style="width:100%;" value="2450" placeholder="e.g. 2450">
          </div>
          <div>
            <label style="font-size:0.8rem;color:var(--text-muted);display:block;margin-bottom:0.35rem;">Customer Phone (Sender) *</label>
            <input type="text" id="simSender" class="table-search-input" style="width:100%;" value="01712349988" placeholder="e.g. 01712349988">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem;">
          <div>
            <label style="font-size:0.8rem;color:var(--text-muted);display:block;margin-bottom:0.35rem;">Mock TrxID (Leave empty for auto-gen)</label>
            <input type="text" id="simTrxId" class="table-search-input" style="width:100%;font-family:var(--font-mono);" placeholder="Auto-generated if blank">
          </div>
          <div>
            <label style="font-size:0.8rem;color:var(--text-muted);display:block;margin-bottom:0.35rem;">Target Order ID / Ref (Optional)</label>
            <input type="text" id="simOrderId" class="table-search-input" style="width:100%;" placeholder="e.g. inv_demo_88">
          </div>
        </div>

        <div style="display:flex;gap:0.75rem;">
          <button class="btn-primary" onclick="window.submitSimulatorSms()" style="background:linear-gradient(135deg,#4f46e5,#06b6d4);border:none;padding:0.6rem 1.25rem;font-weight:700;">
            ⚡ Inject Inbound SMS & Test Match
          </button>
        </div>

        <div id="simResult" style="margin-top:1.5rem;display:none;padding:1rem;background:var(--bg-elevated);border-radius:var(--radius-md);border:1px solid var(--border-color);">
        </div>
      </div>
    `;
  }

  async renderProvidersView(container) {
    const [res, rulesRes] = await Promise.all([
      adminApi.getMfsProviders(),
      adminApi.getProviderRules(),
    ]);
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>MFS Providers & Dynamic Regex Configuration</h1>
          <p>Throughput, latency, live parser regex capture groups, and daily limits for bKash, Nagad, Rocket, and Upay.</p>
        </div>
      </div>

      <div class="analytics-split">
        <div class="provider-cards-grid">
          ${components.renderMfsProviders(res.data)}
        </div>
        <div class="dashboard-panel">
          <h3 class="panel-title" style="margin-bottom:1rem;">Provider Routing Rules</h3>
          <div style="font-size:0.85rem;color:var(--text-secondary);line-height:1.7;">
            <p><strong>Primary bKash Node:</strong> Forwarder SIM 01712345678 (Fastest SMS response time ~1.2s)</p>
            <p style="margin-top:0.75rem;"><strong>Primary Nagad Node:</strong> Forwarder SIM 01899123456 (Multi-SIM failover active)</p>
            <p style="margin-top:0.75rem;"><strong>Rocket Auto-Reconcile:</strong> Active regex engine v2.4 (Supports 16216 shortcode)</p>
            <p style="margin-top:0.75rem;"><strong>No-Deploy Configuration:</strong> Modify regex capture groups below for instant parser reconfiguration without app redeployment.</p>
          </div>
        </div>
      </div>

      <div style="margin-top:1.5rem;">
        <h2 style="font-size:1.15rem;font-weight:700;margin-bottom:1rem;">No-Deploy Regex & Threshold Controls</h2>
        ${components.renderProviderRulesEditor(rulesRes.data || [])}
      </div>
    `;
  }

  async renderReportsView(container) {
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>Financial & Gateway Reports</h1>
          <p>Generate aggregated volume and transaction statement reports.</p>
        </div>
        <div class="header-actions">
          <button class="btn-primary" onclick="window.exportTransactionsCsv()">Export Comprehensive CSV</button>
        </div>
      </div>

      <div class="dashboard-panel">
        <h3 class="panel-title" style="margin-bottom:1rem;">Select Report Parameters</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.5rem;">
          <div>
            <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:0.35rem;">Report Type</label>
            <select class="table-search-input" style="width:100%;">
              <option>Total Settlement Statement</option>
              <option>Merchant Transaction Log</option>
              <option>MFS Provider Breakdown</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:0.35rem;">Date Filter</label>
            <select class="table-search-input" style="width:100%;">
              <option>This Month (September 2026)</option>
              <option>Last 30 Days</option>
              <option>Custom Range</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:0.35rem;">Format</label>
            <select class="table-search-input" style="width:100%;">
              <option>CSV (Comma Separated)</option>
              <option>JSON Data Stream</option>
            </select>
          </div>
        </div>
        <button class="btn-primary" onclick="window.exportTransactionsCsv()">Download Report</button>
      </div>
    `;
  }

  async renderAuditLogsView(container) {
    const res = await adminApi.getAuditLogs();
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>Security Audit Logs</h1>
          <p>Tamper-evident log of all administrative operations and state mutations.</p>
        </div>
      </div>

      <div class="table-card">
        <div class="table-responsive">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Admin Email</th>
                <th>Action</th>
                <th>Resource Target</th>
                <th>IP Address</th>
                <th>Result</th>
                <th>Operation Details</th>
              </tr>
            </thead>
            <tbody>
              ${components.renderAuditLogsTable(res.data)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async renderSuspiciousView(container) {
    const res = await adminApi.getSuspiciousActivity();
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>Suspicious Activity & Fraud Guard</h1>
          <p>Automated detection of duplicate TrxIDs, velocity spikes, and rogue device payloads.</p>
        </div>
      </div>

      <div class="table-card">
        <div class="table-responsive">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Threat Event</th>
                <th>Associated Merchant</th>
                <th>Origin IP</th>
                <th>Risk Detection Reason</th>
                <th>Guard Action</th>
              </tr>
            </thead>
            <tbody>
              ${components.renderSuspiciousTable(res.data)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async renderSystemHealthView(container) {
    const res = await adminApi.getSystemHealth();
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>System Health & Infrastructure</h1>
          <p>Realtime diagnostics of gateway microservices, SQLite WAL persistence, and memory pressure.</p>
        </div>
      </div>

      <div>
        ${components.renderSystemHealth(res.data)}
      </div>
    `;
  }

  async renderServerLogsView(container) {
    const res = await adminApi.getServerLogs('ALL');
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>Live Server Daemon Logs</h1>
          <p>Stdout/Stderr streams from PayFlow payment processor daemon.</p>
        </div>
        <div class="header-actions">
          <div class="filter-group">
            <button class="filter-btn active" onclick="window.filterServerLogs('ALL')">ALL</button>
            <button class="filter-btn" onclick="window.filterServerLogs('INFO')">INFO</button>
            <button class="filter-btn" onclick="window.filterServerLogs('WARN')">WARN</button>
            <button class="filter-btn" onclick="window.filterServerLogs('ERROR')">ERROR</button>
          </div>
        </div>
      </div>

      <div id="serverLogContainer">
        ${components.renderServerLogsTerminal(res.data)}
      </div>
    `;
  }

  async renderAdminUsersView(container) {
    const res = await adminApi.getAdminUsers();
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>Admin Users & Role Matrix</h1>
          <p>Manage administrative personnel access (Super Admin, Operations, Security, Support).</p>
        </div>
        <div class="header-actions">
          <button class="btn-primary" onclick="window.openAddAdminModal()">+ Add New Admin</button>
        </div>
      </div>

      <div class="table-card">
        <div class="table-responsive">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Full Name</th>
                <th>Email Address</th>
                <th>Role Tier</th>
                <th>Account Status</th>
                <th>Last Active</th>
              </tr>
            </thead>
            <tbody>
              ${components.renderAdminUsersTable(res.data)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async renderSettingsView(container) {
    const res = await adminApi.getSettings();
    const settings = res.data || {};
    const isMaintenance = settings.maintenance_mode === 'true';

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-wrap">
          <h1>Gateway Settings & Maintenance</h1>
          <p>Global system switches, retry policies, and emergency maintenance controls.</p>
        </div>
      </div>

      <div class="dashboard-panel" style="max-width:800px;">
        <h3 class="panel-title" style="margin-bottom:1.5rem;">Core Operational Flags</h3>
        
        <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 0;border-bottom:1px solid var(--border-color);">
          <div>
            <strong style="font-size:0.95rem;">System Maintenance Mode</strong>
            <p style="font-size:0.8rem;color:var(--text-muted);margin-top:0.25rem;">
              When enabled, customer checkout and API creation return 503 Maintenance gracefully.
            </p>
          </div>
          <button class="btn-${isMaintenance ? 'primary' : 'secondary'}" onclick="window.toggleMaintenanceMode('${isMaintenance ? 'false' : 'true'}')">
            ${isMaintenance ? 'Disable Maintenance' : 'Enable Maintenance'}
          </button>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 0;border-bottom:1px solid var(--border-color);">
          <div>
            <strong style="font-size:0.95rem;">Webhook Retry Limit</strong>
            <p style="font-size:0.8rem;color:var(--text-muted);margin-top:0.25rem;">
              Maximum exponential backoff retry attempts for merchant webhook endpoints.
            </p>
          </div>
          <select class="table-search-input" style="min-width:120px;" onchange="window.saveSetting('webhook_retry_limit', this.value)">
            <option value="3" ${settings.webhook_retry_limit === '3' ? 'selected' : ''}>3 attempts</option>
            <option value="5" ${settings.webhook_retry_limit === '5' ? 'selected' : ''}>5 attempts</option>
            <option value="10" ${settings.webhook_retry_limit === '10' ? 'selected' : ''}>10 attempts</option>
          </select>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 0;border-bottom:1px solid var(--border-color);">
          <div>
            <strong style="font-size:0.95rem;">Database Storage Optimization</strong>
            <p style="font-size:0.8rem;color:var(--text-muted);margin-top:0.25rem;">
              Truncate SQLite Write-Ahead Log (WAL) and run VACUUM to reclaim disk space.
            </p>
          </div>
          <button class="btn-secondary" onclick="window.triggerVacuum()" style="display:inline-flex;align-items:center;gap:0.35rem;">
            ⚙ Run Checkpoint & VACUUM
          </button>
        </div>

        <div style="margin-top:1.5rem;">
          <button class="btn-primary" onclick="window.app.showToast('Settings successfully persisted in gateway SQLite configuration', 'success')">
            Save Configuration
          </button>
        </div>
      </div>
    `;
  }

  registerGlobalWindowHooks() {
    window.app = this;

    window.switchChartMetric = (metric) => {
      this.currentMetric = metric;
      this.renderCurrentView();
    };

    window.filterTableRows = (query) => {
      const q = query.toLowerCase().trim();
      const rows = document.querySelectorAll('#transactionsTableBody tr');
      rows.forEach((row) => {
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    };

    window.exportTransactionsCsv = () => {
      const txs = this.transactionsCache || [];
      if (!txs.length) {
        this.showToast('No transactions available to export', 'error');
        return;
      }
      let csv = 'Transaction ID,Merchant,Provider,Amount,Sender,Device,Verified,Created At\n';
      txs.forEach((t) => {
        csv += `"${t.trx_id}","${t.merchant_name || t.merchant_id}","${t.provider}",${t.amount},"${t.sender || ''}","${t.device_name || ''}",${t.is_verified},"${t.created_at}"\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payflow_super_admin_export_${Date.now()}.csv`;
      a.click();
      this.showToast('Exported transactions CSV successfully', 'success');
    };

    window.inspectTransaction = (id) => {
      const t = (this.transactionsCache || []).find((item) => item.id === id);
      if (!t) return;
      const drawer = document.getElementById('inspectionDrawer');
      const backdrop = document.getElementById('drawerBackdrop');
      const body = document.getElementById('drawerBody');
      if (!drawer || !backdrop || !body) return;

      body.innerHTML = `
        <div class="drawer-prop-row">
          <span class="drawer-prop-label">Transaction ID</span>
          <span class="drawer-prop-val">${t.trx_id}</span>
        </div>
        <div class="drawer-prop-row">
          <span class="drawer-prop-label">Merchant</span>
          <span class="drawer-prop-val">${t.merchant_name || t.merchant_id}</span>
        </div>
        <div class="drawer-prop-row">
          <span class="drawer-prop-label">MFS Provider</span>
          <span class="drawer-prop-val">${t.provider}</span>
        </div>
        <div class="drawer-prop-row">
          <span class="drawer-prop-label">Amount</span>
          <span class="drawer-prop-val" style="color:var(--success);font-size:1.1rem;">${components.formatCurrency(t.amount)}</span>
        </div>
        <div class="drawer-prop-row">
          <span class="drawer-prop-label">Sender Number (Masked)</span>
          <span class="drawer-prop-val" id="senderVal">${components.maskPhoneNumber(t.sender)}</span>
        </div>
        <div class="drawer-prop-row">
          <span class="drawer-prop-label">Device Name</span>
          <span class="drawer-prop-val">${t.device_name || t.device_id}</span>
        </div>
        <div class="drawer-prop-row">
          <span class="drawer-prop-label">Verification Status</span>
          <span class="drawer-prop-val">${t.is_verified ? 'VERIFIED (PAID)' : 'PENDING'}</span>
        </div>
        <div class="drawer-prop-row">
          <span class="drawer-prop-label">Timestamp</span>
          <span class="drawer-prop-val">${new Date(t.created_at).toLocaleString()}</span>
        </div>
        
        <div style="margin-top:1.5rem;">
          <span class="drawer-prop-label" style="display:block;margin-bottom:0.5rem;">Raw SMS Payload</span>
          <div style="background:var(--bg-elevated);padding:0.75rem;border-radius:var(--radius-sm);font-family:var(--font-mono);font-size:0.75rem;border:1px solid var(--border-color);line-height:1.6;">
            ${t.raw_sms || 'No raw SMS record stored.'}
          </div>
        </div>

        <div style="margin-top:1.5rem;display:flex;gap:0.75rem;">
          <button class="btn-secondary" onclick="document.getElementById('senderVal').textContent='${t.sender || 'N/A'}'; window.app.showToast('Sender number revealed for compliance check', 'info');">
            Reveal Sender
          </button>
        </div>
      `;

      drawer.classList.add('active');
      backdrop.classList.add('active');
    };

    window.closeDrawer = () => {
      const drawer = document.getElementById('inspectionDrawer');
      const backdrop = document.getElementById('drawerBackdrop');
      if (drawer) drawer.classList.remove('active');
      if (backdrop) backdrop.classList.remove('active');
    };

    window.toggleDeviceStatus = async (id, status) => {
      try {
        await adminApi.updateDeviceStatus(id, status);
        this.showToast(`Device ${id} status updated to ${status}`, 'success');
        this.renderCurrentView();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    window.revokeApiKey = async (id) => {
      if (!confirm('Are you sure you want to revoke this API key? Merchant integrations using it will fail immediately.')) return;
      try {
        await adminApi.revokeApiKey(id);
        this.showToast(`API Key revoked successfully`, 'success');
        this.renderCurrentView();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    window.retryWebhook = async (id) => {
      try {
        await adminApi.retryWebhook(id);
        this.showToast('Webhook retry dispatch scheduled', 'success');
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    window.toggleMaintenanceMode = async (val) => {
      try {
        await adminApi.updateSetting('maintenance_mode', val);
        this.showToast(`Maintenance mode set to ${val.toUpperCase()}`, 'info');
        this.renderCurrentView();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    window.saveSetting = async (key, val) => {
      try {
        await adminApi.updateSetting(key, val);
        this.showToast(`Updated ${key}`, 'success');
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    window.openAddMerchantModal = () => {
      const modal = document.getElementById('addMerchantModal');
      if (modal) modal.classList.add('active');
    };

    window.closeAddMerchantModal = () => {
      const modal = document.getElementById('addMerchantModal');
      if (modal) modal.classList.remove('active');
    };

    window.submitNewMerchant = async () => {
      const nameInput = document.getElementById('newMerchantName');
      const webhookInput = document.getElementById('newMerchantWebhook');
      if (!nameInput || !nameInput.value.trim()) {
        this.showToast('Please enter merchant business name', 'error');
        return;
      }
      try {
        await adminApi.createMerchant(nameInput.value.trim(), webhookInput ? webhookInput.value.trim() : '');
        this.showToast(`Merchant ${nameInput.value} created successfully`, 'success');
        window.closeAddMerchantModal();
        this.renderCurrentView();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    window.openAddAdminModal = () => {
      const modal = document.getElementById('addAdminModal');
      if (modal) modal.classList.add('active');
    };

    window.closeAddAdminModal = () => {
      const modal = document.getElementById('addAdminModal');
      if (modal) modal.classList.remove('active');
    };

    window.submitNewAdmin = async () => {
      const name = document.getElementById('newAdminName')?.value.trim();
      const email = document.getElementById('newAdminEmail')?.value.trim();
      const role = document.getElementById('newAdminRole')?.value;
      if (!name || !email) {
        this.showToast('Name and email are required', 'error');
        return;
      }
      try {
        await adminApi.createAdminUser(name, email, role);
        this.showToast(`Admin user ${name} created successfully`, 'success');
        window.closeAddAdminModal();
        this.renderCurrentView();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    window.filterServerLogs = async (level) => {
      const res = await adminApi.getServerLogs(level);
      const container = document.getElementById('serverLogContainer');
      if (container) {
        container.innerHTML = components.renderServerLogsTerminal(res.data);
      }
    };

    // Unmatched SMS Handlers
    window.openAssignModal = (smsId, trxId, amount) => {
      const modal = document.getElementById('assignSmsModal');
      const idInput = document.getElementById('assignSmsId');
      const summary = document.getElementById('assignSmsSummary');
      if (idInput) idInput.value = smsId;
      if (summary) summary.textContent = `TrxID ${trxId} (${components.formatCurrency(amount)})`;
      if (modal) modal.classList.add('active');
    };

    window.closeAssignModal = () => {
      const modal = document.getElementById('assignSmsModal');
      if (modal) modal.classList.remove('active');
    };

    window.submitAssignSms = async () => {
      const smsId = document.getElementById('assignSmsId')?.value;
      const invoiceId = document.getElementById('assignInvoiceId')?.value.trim();
      if (!smsId || !invoiceId) {
        this.showToast('Please enter target Invoice ID', 'error');
        return;
      }
      try {
        await adminApi.assignUnmatchedSms(smsId, invoiceId);
        this.showToast(`Assigned to invoice ${invoiceId} and marked PAID`, 'success');
        window.closeAssignModal();
        this.renderCurrentView();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    // Manual Verification Handlers
    window.openManualVerifyModal = () => {
      const modal = document.getElementById('manualVerifyModal');
      if (modal) modal.classList.add('active');
    };

    window.closeManualVerifyModal = () => {
      const modal = document.getElementById('manualVerifyModal');
      if (modal) modal.classList.remove('active');
    };

    window.submitManualVerify = async () => {
      const invoiceId = document.getElementById('verifyInvoiceId')?.value.trim();
      const trxId = document.getElementById('verifyTrxId')?.value.trim();
      const amount = Number(document.getElementById('verifyAmount')?.value) || 0;
      if (!invoiceId || !trxId) {
        this.showToast('Invoice ID and TrxID are required', 'error');
        return;
      }
      try {
        await adminApi.manualVerifyPayment(invoiceId, trxId, amount);
        this.showToast(`Invoice ${invoiceId} marked as PAID with TrxID ${trxId}`, 'success');
        window.closeManualVerifyModal();
        this.renderCurrentView();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    // Payouts Handlers
    window.promptApprovePayout = (id) => {
      const modal = document.getElementById('approvePayoutModal');
      const inputId = document.getElementById('payoutApproveId');
      if (inputId) inputId.value = id;
      if (modal) modal.classList.add('active');
    };

    window.closeApprovePayoutModal = () => {
      const modal = document.getElementById('approvePayoutModal');
      if (modal) modal.classList.remove('active');
    };

    window.submitApprovePayout = async () => {
      const id = document.getElementById('payoutApproveId')?.value;
      const trxId = document.getElementById('payoutTrxId')?.value.trim();
      if (!id || !trxId) {
        this.showToast('Disbursement TrxID is required', 'error');
        return;
      }
      try {
        await adminApi.approvePayout(id, trxId);
        this.showToast(`Payout ${id} approved with reference ${trxId}`, 'success');
        window.closeApprovePayoutModal();
        this.renderCurrentView();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    window.promptRejectPayout = async (id) => {
      const reason = prompt('Enter rejection reason:');
      if (!reason) return;
      try {
        await adminApi.rejectPayout(id, reason);
        this.showToast(`Payout ${id} rejected`, 'info');
        this.renderCurrentView();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    // Blacklist Handlers
    window.openAddBlacklistModal = () => {
      const modal = document.getElementById('addBlacklistModal');
      if (modal) modal.classList.add('active');
    };

    window.closeAddBlacklistModal = () => {
      const modal = document.getElementById('addBlacklistModal');
      if (modal) modal.classList.remove('active');
    };

    window.submitNewBlacklist = async () => {
      const type = document.getElementById('blacklistType')?.value;
      const value = document.getElementById('blacklistValue')?.value.trim();
      const reason = document.getElementById('blacklistReason')?.value.trim();
      if (!value || !reason) {
        this.showToast('Value and reason are required', 'error');
        return;
      }
      try {
        await adminApi.addBlacklist(type, value, reason, 'Super Admin');
        this.showToast(`Added ${value} to blacklist`, 'success');
        window.closeAddBlacklistModal();
        this.renderCurrentView();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    window.removeBlacklist = async (id) => {
      if (!confirm('Remove this entity from blacklist?')) return;
      try {
        await adminApi.removeBlacklist(id);
        this.showToast('Entity removed from blacklist', 'info');
        this.renderCurrentView();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    // Provider Dynamic Regex Handler
    window.saveProviderRule = async (provider) => {
      const regexInput = document.getElementById(`rule_regex_${provider}`);
      const limitInput = document.getElementById(`rule_limit_${provider}`);
      const feeInput = document.getElementById(`rule_fee_${provider}`);
      const enInput = document.getElementById(`rule_en_${provider}`);
      try {
        await adminApi.updateProviderRule({
          provider,
          regex_pattern: regexInput?.value.trim(),
          daily_limit: Number(limitInput?.value) || 0,
          fee_percentage: Number(feeInput?.value) || 0,
          is_enabled: enInput?.checked ? 1 : 0,
        });
        this.showToast(`Configuration updated for ${provider.toUpperCase()}`, 'success');
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    // Simulator Handler
    window.submitSimulatorSms = async () => {
      const provider = document.getElementById('simProvider')?.value;
      const amount = Number(document.getElementById('simAmount')?.value) || 0;
      const sender = document.getElementById('simSender')?.value.trim();
      const trxId = document.getElementById('simTrxId')?.value.trim() || undefined;
      const orderId = document.getElementById('simOrderId')?.value.trim() || undefined;
      const resultBox = document.getElementById('simResult');

      if (!amount || !sender) {
        this.showToast('Amount and sender phone are required', 'error');
        return;
      }

      try {
        const res = await adminApi.triggerMockSms({ provider, amount, sender, trxId, orderId });
        this.showToast('Simulated SMS processed by Gateway Ingest Engine', 'success');
        if (resultBox) {
          resultBox.style.display = 'block';
          if (res.data?.matched) {
            resultBox.innerHTML = `
              <div style="color:var(--success);font-weight:700;margin-bottom:0.35rem;">✓ INVOICE AUTO-MATCHED & PAID!</div>
              <div style="font-size:0.85rem;line-height:1.6;">
                <strong>Invoice ID:</strong> ${res.data.invoiceId}<br>
                <strong>TrxID:</strong> ${res.data.trxId}<br>
                <strong>Channel:</strong> ${res.data.provider} (Tk ${res.data.amount})<br>
                <em>Webhook dispatch to merchant automatically queued.</em>
              </div>
            `;
          } else {
            resultBox.innerHTML = `
              <div style="color:var(--brand);font-weight:700;margin-bottom:0.35rem;">📬 SAVED IN UNMATCHED SMS POOL</div>
              <div style="font-size:0.85rem;line-height:1.6;">
                <strong>SMS Pool ID:</strong> ${res.data.unmatchedSmsId}<br>
                <strong>TrxID:</strong> ${res.data.trxId}<br>
                <em>No pending invoice matched this amount. Visible under <a href="#unmatched-sms" style="color:var(--brand);text-decoration:underline;">Unmatched SMS</a>.</em>
              </div>
            `;
          }
        }
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    // Vacuum Handler
    window.triggerVacuum = async () => {
      try {
        const res = await adminApi.triggerVacuum();
        this.showToast(res.message || 'SQLite VACUUM & WAL checkpoint completed', 'success');
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    // Merchant Plan & Approval Handlers
    window.setMerchantPlan = async (id, plan = 'FREE', status = 'ACTIVE', payment_status = 'FREE', payment_note = '') => {
      try {
        await adminApi.updateMerchantPlan(id, { plan, status, payment_status, payment_note });
        this.showToast(`✅ Merchant approved with ${plan} plan`, 'success');
        const container = document.getElementById('view-content');
        if (container) await this.renderMerchantsView(container);
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    window.promptRequirePayment = async (id, name) => {
      const note = prompt(`Require Payment from "${name}". Enter instructions/amount (e.g. ৳999/month for Pro tier):`, '৳999/month — Please pay to bKash/Nagad: 01700000000');
      if (note === null) return;
      try {
        await adminApi.updateMerchantPlan(id, {
          plan: 'PRO',
          status: 'PAYMENT_REQUIRED',
          payment_status: 'UNPAID',
          payment_note: note.trim(),
        });
        this.showToast(`⚠️ Payment requirement sent to ${name}`, 'warning');
        const container = document.getElementById('view-content');
        if (container) await this.renderMerchantsView(container);
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    window.toggleMerchantStatus = async (id, newStatus) => {
      try {
        await adminApi.updateMerchantStatus(id, newStatus);
        this.showToast(`Merchant status changed to ${newStatus}`, 'info');
        const container = document.getElementById('view-content');
        if (container) await this.renderMerchantsView(container);
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };

    window.payflowAdmin = this;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new AdminApp();
  app.start();
});
