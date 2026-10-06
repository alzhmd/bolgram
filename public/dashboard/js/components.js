// PayFlow MFS — Production Dashboard Reusable UI Components
import { i18n } from './i18n.js';
import { auth } from './auth.js';

export const components = {
  // 1. Stat Card Renderer
  renderStatCard({ id, titleKey, value, trend, isPositive, icon, isDemo }) {
    const trendClass = isPositive ? 'trend-up' : (isPositive === false ? 'trend-down' : 'trend-neutral');
    const trendArrow = isPositive ? '↑' : (isPositive === false ? '↓' : '•');
    const title = i18n.t(titleKey);
    const vsText = i18n.t('home.kpi.vsPrevious');

    return `
      <div class="stat-card" id="${id}">
        <div class="stat-card-top">
          <span class="stat-card-title">${title}</span>
          <div class="stat-card-icon">${icon}</div>
        </div>
        <div>
          <div class="stat-card-value">${value}</div>
          <div class="stat-card-trend ${trendClass}">
            <span>${trendArrow} ${trend}</span>
            <span style="color: var(--text-light); font-weight: normal; margin-left: 4px;">${vsText}</span>
          </div>
        </div>
        ${isDemo ? `<div style="position:absolute; top:8px; right:8px; font-size:9px; font-weight:800; background:var(--warning-bg); color:var(--warning); padding:1px 5px; border-radius:4px; border:1px solid var(--warning-border);">DEMO</div>` : ''}
      </div>
    `;
  },

  // 2. Interactive SVG Revenue Line Chart with Tooltips
  renderRevenueChart(data = [], metric = 'revenue') {
    if (!data || data.length === 0) {
      return `<div class="empty-state"><p>${i18n.t('table.noRecords')}</p></div>`;
    }

    const width = 640;
    const height = 200;
    const padX = 40;
    const padY = 30;

    const values = data.map(d => metric === 'revenue' ? d.revenue : (metric === 'transactions' ? d.total_txs : (metric === 'successful' ? d.successful_txs : d.failed_txs || 0)));
    const maxVal = Math.max(...values, 10);
    const minVal = 0;

    const points = values.map((val, idx) => {
      const x = padX + (idx / (values.length - 1 || 1)) * (width - padX * 2);
      const y = height - padY - ((val - minVal) / (maxVal - minVal)) * (height - padY * 2);
      return { x, y, val, date: data[idx].date, full: data[idx] };
    });

    const pathD = points.reduce((acc, p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const prev = points[i - 1];
      const cx = (prev.x + p.x) / 2;
      return `${acc} C ${cx} ${prev.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
    }, '');

    const areaD = `${pathD} L ${points[points.length - 1].x} ${height - padY} L ${points[0].x} ${height - padY} Z`;

    const dots = points.map((p, idx) => `
      <circle cx="${p.x}" cy="${p.y}" r="4" fill="#0284c7" stroke="#ffffff" stroke-width="2" class="chart-point" data-idx="${idx}" style="cursor:pointer;" />
    `).join('');

    const labels = points.map((p, idx) => `
      <text x="${p.x}" y="${height - 10}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--text-light)">${p.date}</text>
    `).join('');

    return `
      <div class="svg-chart-container" id="revenue-chart-svg-wrap">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
          <defs>
            <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#0284c7" stop-opacity="0.28" />
              <stop offset="100%" stop-color="#0284c7" stop-opacity="0.0" />
            </linearGradient>
          </defs>
          <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" stroke="var(--border)" stroke-width="1" />
          <line x1="${padX}" y1="${padY}" x2="${width - padX}" y2="${padY}" stroke="var(--border-subtle)" stroke-dasharray="4" />
          <path d="${areaD}" fill="url(#chartGrad)" />
          <path d="${pathD}" fill="none" stroke="#0284c7" stroke-width="2.5" />
          ${dots}
          ${labels}
        </svg>
        <div id="chart-tooltip" class="chart-tooltip"></div>
      </div>
    `;
  },

  // 3. Payment Methods Donut Breakdown
  renderPaymentMethodsDonut(transactions = []) {
    const counts = { bKash: 0, Nagad: 0, Rocket: 0, Upay: 0 };
    transactions.forEach(tx => {
      const p = (tx.provider || '').toLowerCase();
      if (p.includes('bkash')) counts.bKash += (tx.amount || 1);
      else if (p.includes('nagad')) counts.Nagad += (tx.amount || 1);
      else if (p.includes('rocket')) counts.Rocket += (tx.amount || 1);
      else if (p.includes('upay')) counts.Upay += (tx.amount || 1);
      else counts.bKash += (tx.amount || 1);
    });

    const total = (counts.bKash + counts.Nagad + counts.Rocket + counts.Upay) || 1;
    const pBkash = Math.round((counts.bKash / total) * 100);
    const pNagad = Math.round((counts.Nagad / total) * 100);
    const pRocket = Math.round((counts.Rocket / total) * 100);
    const pUpay = Math.max(0, 100 - pBkash - pNagad - pRocket);

    // SVG Donut circumference = 2 * PI * 40 = 251.2
    const circ = 251.2;
    const off1 = circ * (1 - pBkash / 100);
    const off2 = circ * (1 - (pBkash + pNagad) / 100);
    const off3 = circ * (1 - (pBkash + pNagad + pRocket) / 100);

    return `
      <div class="donut-wrap">
        <div style="position:relative; width:120px; height:120px;">
          <svg width="120" height="120" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="none" stroke="var(--border-subtle)" stroke-width="12" />
            <circle cx="50" cy="50" r="40" fill="none" stroke="#e2136e" stroke-width="12" stroke-dasharray="${circ}" stroke-dashoffset="${off1}" transform="rotate(-90 50 50)" />
            <circle cx="50" cy="50" r="40" fill="none" stroke="#f97316" stroke-width="12" stroke-dasharray="${circ}" stroke-dashoffset="${off2}" transform="rotate(-90 50 50)" />
            <circle cx="50" cy="50" r="40" fill="none" stroke="#8b5cf6" stroke-width="12" stroke-dasharray="${circ}" stroke-dashoffset="${off3}" transform="rotate(-90 50 50)" />
          </svg>
          <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;">
            <span style="font-size:11px; font-weight:700; color:var(--text-light);">TOTAL</span>
            <strong style="font-size:14px; color:var(--text-primary);">৳${total.toLocaleString()}</strong>
          </div>
        </div>

        <div class="donut-legend-grid">
          <div class="donut-legend-item">
            <span class="legend-color-dot" style="background:#e2136e;"></span>
            <span style="font-weight:700; color:var(--text-secondary);">bKash: ${pBkash}%</span>
          </div>
          <div class="donut-legend-item">
            <span class="legend-color-dot" style="background:#f97316;"></span>
            <span style="font-weight:700; color:var(--text-secondary);">Nagad: ${pNagad}%</span>
          </div>
          <div class="donut-legend-item">
            <span class="legend-color-dot" style="background:#8b5cf6;"></span>
            <span style="font-weight:700; color:var(--text-secondary);">Rocket: ${pRocket}%</span>
          </div>
          <div class="donut-legend-item">
            <span class="legend-color-dot" style="background:#0284c7;"></span>
            <span style="font-weight:700; color:var(--text-secondary);">Upay: ${pUpay}%</span>
          </div>
        </div>
      </div>
    `;
  },

  // 4. Recent Transactions Table
  renderTransactionsTable(transactions = [], limit = 10) {
    if (!transactions || transactions.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state-icon" style="color:var(--text-light); margin-bottom:12px;">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          </div>
          <div class="empty-state-title">${i18n.t('table.noRecords')}</div>
          <div class="empty-state-desc">${i18n.t('table.emptyDesc')}</div>
        </div>
      `;
    }

    const rows = transactions.slice(0, limit).map(tx => {
      const isVerified = tx.is_verified === 1;
      const statusClass = isVerified ? 'badge-completed' : 'badge-pending';
      const statusText = isVerified ? i18n.t('status.COMPLETED') : i18n.t('status.PENDING');

      const p = (tx.provider || 'bKash');
      let iconSrc = '/images/bkash.svg';
      if (p.toLowerCase().includes('nagad')) iconSrc = '/images/nagad.svg';
      else if (p.toLowerCase().includes('rocket')) iconSrc = '/images/rocket.svg';
      else if (p.toLowerCase().includes('upay')) iconSrc = '/images/upay.svg';

      return `
        <tr>
          <td><span class="mono" style="font-weight:700; color:var(--primary);">${tx.trx_id}</span></td>
          <td><span class="mono">${tx.invoice_id || 'N/A'}</span></td>
          <td>
            <div style="font-weight:600; color:var(--text-primary);">${tx.customer_phone || 'Anonymous'}</div>
            <div style="font-size:11px; color:var(--text-muted);">${tx.customer_name || 'Customer'}</div>
          </td>
          <td>
            <div class="provider-badge">
              <img src="${iconSrc}" alt="${p}" class="provider-logo" width="18" height="18" style="width:18px; height:18px; max-width:18px; max-height:18px; object-fit:contain;" onerror="this.style.display='none'" />
              <span>${p}</span>
            </div>
          </td>
          <td><strong style="font-size:14px; color:var(--text-primary);">৳ ${Number(tx.amount).toFixed(2)}</strong></td>
          <td><span class="badge ${statusClass}">${statusText}</span></td>
          <td><span style="font-size:12px; color:var(--text-muted);">${new Date(tx.created_at).toLocaleString('en-US', { hour12: true, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></td>
          <td>
            <button class="btn btn-secondary-action" style="padding:4px 8px; font-size:11px;" onclick="window.payflowApp.viewTxDetails('${tx.id}')">
              ${i18n.t('home.viewDetails', 'View')}
            </button>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>${i18n.t('table.colTrxId', i18n.t('table.trxId', 'TrxID'))}</th>
              <th>${i18n.t('table.colInvoice', i18n.t('table.invoice', 'Invoice'))}</th>
              <th>${i18n.t('table.colCustomer', i18n.t('table.customer', 'Customer'))}</th>
              <th>${i18n.t('table.colMethod', i18n.t('table.method', 'Method'))}</th>
              <th>${i18n.t('table.colAmount', i18n.t('table.amount', 'Amount'))}</th>
              <th>${i18n.t('table.colStatus', i18n.t('table.status', 'Status'))}</th>
              <th>${i18n.t('table.colDate', i18n.t('table.date', 'Date'))}</th>
              <th>${i18n.t('table.colActions', i18n.t('table.actions', 'Actions'))}</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  },

  // 5. Invoices Table
  renderInvoicesTable(invoices = []) {
    if (!invoices || invoices.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state-icon" style="color:var(--text-light); margin-bottom:12px;">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
          <div class="empty-state-title">No Invoices Found</div>
          <div class="empty-state-desc">Click '+ Create Invoice' to generate a payment link for customers.</div>
        </div>
      `;
    }

    const rows = invoices.map(inv => {
      const isPaid = inv.status === 'PAID';
      const isPending = inv.status === 'PENDING';
      const statusClass = isPaid ? 'badge-completed' : (isPending ? 'badge-pending' : 'badge-failed');
      const statusText = i18n.t(`status.${inv.status}`);
      const link = `${window.location.origin}/checkout?invoice_id=${inv.id}`;

      return `
        <tr>
          <td><span class="mono" style="font-weight:700; color:var(--primary);">${inv.id}</span></td>
          <td>
            <div>
              <strong style="color:var(--text-primary);">${inv.customer_name}</strong>
              <div style="font-size:11px; color:var(--text-muted);">${inv.customer_email || 'No email provided'}</div>
            </div>
          </td>
          <td><strong style="font-size:14px; color:var(--text-primary);">৳ ${Number(inv.expected_amount).toFixed(2)}</strong></td>
          <td><span class="badge ${statusClass}">${statusText}</span></td>
          <td><span style="font-size:12px; color:var(--text-muted);">${new Date(inv.created_at).toLocaleDateString()}</span></td>
          <td>
            <div style="display:flex; gap:6px; align-items:center;">
              <button class="btn btn-secondary-action" style="padding:4px 8px; font-size:11px; display:inline-flex; align-items:center; gap:4px;" onclick="window.payflowApp.copyText('${link}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>Copy Link</span>
              </button>
              <a href="${link}" target="_blank" class="btn btn-secondary-action" style="padding:4px 8px; font-size:11px; text-decoration:none;">
                ↗ Open
              </a>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Invoice ID</th>
              <th>Customer Info</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Created Date</th>
              <th>Payment Link</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  },

  // 6. Devices View Cards Grid
  renderDevicesList(devices = []) {
    return `
      <!-- 1-Click APK Download Banner -->
      <div class="card-panel" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(2, 132, 199, 0.08) 100%); border: 1px solid rgba(16, 185, 129, 0.3); margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; padding: 20px 24px;">
        <div style="display: flex; align-items: center; gap: 16px;">
          <div style="width: 48px; height: 48px; border-radius: 12px; background: #10b981; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35);">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8z"/><path d="M8 8V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/></svg>
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <h3 style="font-size: 16px; font-weight: 800; color: var(--text-primary); margin: 0;">SyncPay Android Forwarder APK</h3>
              <span class="badge badge-completed" style="font-size: 10px;">v1.2.0 STABLE</span>
            </div>
            <p style="font-size: 13px; color: var(--text-secondary); margin: 4px 0 0 0;">
              Install on your SIM-enabled Android phone. bKash, Nagad, and Rocket SMS are automatically captured and verified.
            </p>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <a href="/downloads/syncpay-forwarder-arm64.apk" download="syncpay-forwarder-arm64.apk" class="btn btn-primary-action" style="background: #10b981; border-color: #059669; padding: 10px 20px; font-size: 13px; font-weight: 800; text-decoration: none; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35); display: inline-flex; align-items: center; gap: 8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>⚡ 1-Click APK Download (18 MB)</span>
          </a>
        </div>
      </div>

      ${(!devices || devices.length === 0) ? `
        <div class="card-panel" style="text-align: center; padding: 48px 24px; border-radius: 12px; border: 1px dashed var(--border);">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(99, 102, 241, 0.1); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
          </div>
          <h4 style="font-size: 16px; font-weight: 800; color: var(--text-primary); margin: 0 0 6px 0;">কোনো ডিভাইস কানেক্ট করা নেই</h4>
          <p style="font-size: 13px; color: var(--text-secondary); max-width: 440px; margin: 0 auto 20px auto; line-height: 1.5;">
            আপনার ফোনে <strong>SyncPay Forwarder APK</strong> ইনস্টল করুন এবং নিচের বাটনে ক্লিক করে QR কোড স্ক্যান করে ডিভাইস যুক্ত করুন।
          </p>
          <div style="display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap;">
            <button class="btn btn-primary-action" onclick="window.payflowApp.openAddDeviceModal()" style="display: inline-flex; align-items: center; gap: 8px; font-weight: 700;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              <span>📱 Connect Device / QR Code</span>
            </button>
            <button class="btn btn-secondary-action" onclick="window.payflowApp.refreshDevices(true)" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 700;">
              <span>🔄 Refresh Devices</span>
            </button>
          </div>
        </div>
      ` : `
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(360px, 1fr)); gap:20px;">
        ${devices.map(d => {
      const isOnline = d.status === 'ONLINE';
      const batt = d.battery_level != null ? d.battery_level : null;
      const isCharging = d.is_charging === true || d.is_charging === 1;
      const model = d.device_model || (d.device_name && d.device_name !== 'Android Forwarder' ? d.device_name : 'Telephony Device');
      const osVer = d.android_version ? (d.android_version.startsWith('Android') ? d.android_version : `Android ${d.android_version}`) : 'Awaiting sync';

      let battColor = '#10b981';
      let battDisplay = 'Standby';
      if (batt !== null) {
        battDisplay = `${batt}%`;
        if (batt < 20) battColor = '#ef4444';
        else if (batt < 35) battColor = '#f59e0b';
      } else if (!isOnline) {
        battDisplay = 'Offline';
      }

      let simDisplayHtml = 'Awaiting SIM Telemetry';
      if (d.sim_slots && Array.isArray(d.sim_slots) && d.sim_slots.length > 0) {
        simDisplayHtml = d.sim_slots.map((s, idx) => {
          const carrier = s.carrier || s.displayName || 'Active';
          const slotNum = s.slot_index !== undefined ? s.slot_index + 1 : idx + 1;
          return `SIM ${slotNum}: <strong style="color:var(--text-primary);">${carrier}</strong>`;
        }).join(' • ');
      } else if (d.sim_number) {
        simDisplayHtml = `SIM 1: <strong style="color:var(--text-primary);">${d.sim_number}</strong>`;
      }

      const activeMethods = (window.payflowApp?.paymentMethods || []).filter(m => m.is_active);
      let walletsHtml = '';
      if (activeMethods.length > 0) {
        walletsHtml = activeMethods.map(m => {
          const type = (m.channel_type || '').toLowerCase();
          let color = '#6366f1';
          let bg = 'rgba(99,102,241,0.1)';
          if (type.includes('bkash')) { color = '#e2136e'; bg = 'rgba(226,19,110,0.1)'; }
          else if (type.includes('nagad')) { color = '#f7941d'; bg = 'rgba(247,148,29,0.1)'; }
          else if (type.includes('rocket')) { color = '#8c2b8d'; bg = 'rgba(140,43,141,0.1)'; }
          else if (type.includes('upay')) { color = '#00a859'; bg = 'rgba(0,168,89,0.1)'; }
          return `<span style="display:inline-flex; align-items:center; gap:3px; background:${bg}; color:${color}; padding:2px 6px; border-radius:4px; font-weight:700;">● ${m.channel_name || m.channel_type}</span>`;
        }).join(' ');
      } else {
        walletsHtml = `<span style="color:var(--text-secondary); font-size:12px;">Universal Ingest (bKash / Nagad / Rocket / Upay)</span>`;
      }

      return `
          <div class="card-panel" style="display:flex; flex-direction:column; justify-content:space-between; position:relative; overflow:hidden;">
            <!-- Top bar -->
            <div>
              <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;">
                <div>
                  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <h4 style="font-size:16px; font-weight:800; color:var(--text-primary); margin:0;">${d.device_name}</h4>
                    <span style="font-size:11px; padding:2px 8px; border-radius:10px; background:var(--bg-subtle); color:var(--text-secondary); font-weight:600; border:1px solid var(--border);">
                      ${model}
                    </span>
                  </div>
                  <div class="mono" style="font-size:12px; color:var(--text-muted); margin-top:4px;">
                    Device ID: <span style="color:var(--text-secondary);">${d.id}</span>
                  </div>
                </div>
                <span class="badge ${isOnline ? 'badge-online' : 'badge-offline'}" style="display:inline-flex; align-items:center; gap:6px; font-size:11px; padding:4px 10px;">
                  <span style="width:7px; height:7px; border-radius:50%; background:${isOnline ? '#10b981' : '#94a3b8'}; ${isOnline ? 'box-shadow:0 0 8px #10b981;' : ''}"></span>
                  ${isOnline ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>

              <!-- Hardware Telemetry Quick Strip -->
              <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:16px; background:var(--bg-subtle); padding:10px 12px; border-radius:8px; border:1px solid var(--border);">
                <!-- Battery -->
                <div style="display:flex; flex-direction:column; gap:2px;">
                  <span style="font-size:11px; color:var(--text-muted); font-weight:600;">Power</span>
                  <div style="display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:700; color:${battColor};">
                    <span>${isCharging ? '⚡' : '🔋'}</span>
                    <span>${battDisplay}</span>
                  </div>
                </div>

                <!-- Network / Ping -->
                <div style="display:flex; flex-direction:column; gap:2px;">
                  <span style="font-size:11px; color:var(--text-muted); font-weight:600;">Network</span>
                  <div style="display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:700; color:var(--primary);">
                    <span>📶</span>
                    <span>${isOnline ? 'Active (Heartbeat OK)' : 'Disconnected'}</span>
                  </div>
                </div>

                <!-- OS / Version -->
                <div style="display:flex; flex-direction:column; gap:2px;">
                  <span style="font-size:11px; color:var(--text-muted); font-weight:600;">System</span>
                  <div style="display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:700; color:var(--text-secondary);">
                    <span>⚙️</span>
                    <span>${osVer}</span>
                  </div>
                </div>
              </div>

              <!-- Details Grid -->
              <div class="details-list">
                <div class="detail-item">
                  <span class="detail-key">📶 SIM Configuration</span>
                  <span class="detail-val mono" style="font-size:12px; font-weight:600;">
                    ${simDisplayHtml}
                  </span>
                </div>

                <div class="detail-item">
                  <span class="detail-key">💳 Active Wallets</span>
                  <span class="detail-val" style="display:inline-flex; align-items:center; gap:6px; font-size:12px; flex-wrap:wrap;">
                    ${walletsHtml}
                  </span>
                </div>

                <div class="detail-item">
                  <span class="detail-key">🛡️ Ingestion Service</span>
                  <span class="detail-val" style="color:#10b981; font-weight:700; font-size:12px;">
                    SMS & Notification Listener: Active ✅
                  </span>
                </div>

                <div class="detail-item">
                  <span class="detail-key">✉️ Processed SMS</span>
                  <span class="detail-val" style="color:var(--primary); font-weight:800; font-size:13px;">
                    ${d.sms_count ?? 0} Transferred & Verified
                  </span>
                </div>

                <div class="detail-item" style="border-bottom:none; padding-bottom:0;">
                  <span class="detail-key">⏱️ Last Heartbeat</span>
                  <span class="detail-val" style="font-size:12px; color:var(--text-secondary);">
                    ${(() => {
          if (!d.last_seen) return isOnline ? 'Active Just Now' : 'Not recorded yet';
          const s = typeof d.last_seen === 'string' ? d.last_seen.replace(' ', 'T') : d.last_seen;
          const parsed = new Date(s);
          if (isNaN(parsed.getTime())) return 'Active Just Now';
          const diffSec = Math.floor((Date.now() - parsed.getTime()) / 1000);
          if (diffSec < 30) return 'Active (Just now)';
          if (diffSec < 120) return `${diffSec}s ago`;
          return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        })()}
                  </span>
                </div>
              </div>
            </div>

            <!-- Footer Action Buttons -->
            <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px; flex-wrap:wrap; border-top:1px solid var(--border-subtle); padding-top:16px;">
              <button class="btn btn-primary-action" style="padding:6px 14px; font-size:12px; background:var(--primary); display:inline-flex; align-items:center; gap:6px;" onclick="window.payflowApp.showDeviceQrModal('${d.id}', '${d.device_name}')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                <span>📱 Connect / QR Code</span>
              </button>
              <button class="btn btn-secondary-action" style="padding:6px 12px; font-size:12px; display:inline-flex; align-items:center; gap:5px;" onclick="window.payflowApp.pingDeviceTest('${d.id}')">
                <span>⚡ Ping Test</span>
              </button>
              <button class="btn btn-danger-action" style="padding:6px 12px; font-size:12px;" onclick="window.payflowApp.removeDevice('${d.id}')">
                Disconnect
              </button>
            </div>
          </div>
          `;
    }).join('')}
      </div>
    `}
    `;
  },

  // 7. API Keys & Webhooks Unified Integration Hub
  renderApiKeysList(keys = [], credentials = null, webhooksData = null) {
    let sessionKey = '';
    let sessionMerchantId = '';
    try {
      const sess = (window.payflowApp && window.payflowApp.session) || JSON.parse(localStorage.getItem('syncpay_session') || '{}');
      sessionKey = sess.apiKey || localStorage.getItem('payflow_api_key') || '';
      sessionMerchantId = sess.merchantId || '';
    } catch (_) {}

    let storedGenerated = {};
    try {
      storedGenerated = JSON.parse(localStorage.getItem('syncpay_generated_keys') || '{}');
    } catch (_) {}

    const resolvedMerchantId = credentials?.merchant_id || sessionMerchantId || '00000000-0000-42d3-a7b6-aa2aa137fd1b';
    const primaryApiKey = credentials?.api_key || (keys && keys[0] && keys[0].secret_key) || sessionKey || 'live_sk_no78zeijjjdrjmfe2tmmmi';
    const resolvedWebhookSecret = credentials?.webhook_secret || ('whsec_' + (resolvedMerchantId ? resolvedMerchantId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) : '99410abc'));

    const list = (keys && keys.length > 0) ? keys : [
      {
        id: 'key_live_default',
        name: 'Default Live Key',
        key_prefix: 'live_sk_',
        secret_key: primaryApiKey,
        environment: 'production',
        status: 'active',
        created_at: new Date().toISOString().slice(0, 10),
      }
    ];

    const currentOrigin = window.location.origin;

    return `
      <!-- ============================================================
           1. TOP 3-IN-1 WEBSITE CONNECTION CREDENTIALS CARD
           ============================================================ -->
      <div class="table-card" style="background:linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(2,132,199,0.05) 100%); border:1px solid rgba(16,185,129,0.25); border-radius:12px; padding:22px; margin-bottom:24px; box-shadow:0 4px 20px rgba(0,0,0,0.03);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; border-bottom:1px solid var(--border-subtle); padding-bottom:16px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <h3 style="font-size:16px; font-weight:800; color:var(--text-primary); margin:0;">
                🔑 Website Connection Credentials (ওয়েবসাইট কানেকশন কি ও আইডি)
              </h3>
              <span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981; font-weight:700; font-size:11px;">
                ● Gateway Ready & Connected
              </span>
            </div>
            <p style="font-size:12.5px; color:var(--text-secondary); margin:6px 0 0 0;">
              Use these 3 credentials in your <strong>WooCommerce, WordPress, or Custom PHP/Node.js website</strong> to enable full automated bKash, Nagad, Rocket & Upay payment checkout.
            </p>
          </div>
          <button class="btn btn-secondary-action" style="font-size:12px; padding:6px 14px; font-weight:700; display:inline-flex; align-items:center; gap:6px;" onclick="window.payflowApp.copyAllCredentials('${resolvedMerchantId}', '${primaryApiKey}', '${resolvedWebhookSecret}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>Copy All 3 Keys</span>
          </button>
        </div>

        <!-- 3 Credential Blocks Grid -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(290px, 1fr)); gap:16px; margin-top:18px;">
          <!-- Param 1: Merchant ID -->
          <div style="background:var(--card-bg, #ffffff); border:1px solid var(--border-subtle); border-radius:10px; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-size:11px; font-weight:800; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.5px;">
                1. Merchant ID (মার্চেন্ট আইডি)
              </span>
              <span class="badge" style="background:var(--bg-subtle); font-size:10px;">Unique ID</span>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
              <input type="text" readonly value="${resolvedMerchantId}" id="hero-cred-merchant-id" class="form-control mono" style="font-size:12px; padding:6px 10px; background:var(--bg-subtle); color:var(--text-primary); font-weight:600; cursor:pointer;" onclick="this.select()">
              <button class="btn btn-secondary-action" style="padding:6px 10px; font-size:11px; display:inline-flex; align-items:center; gap:4px;" title="Copy Merchant ID" onclick="window.payflowApp.copyCredential('Merchant ID', '${resolvedMerchantId}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>Copy</span>
              </button>
            </div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:6px;">Your unique tenant account identifier</div>
          </div>

          <!-- Param 2: Secret API Key -->
          <div style="background:var(--card-bg, #ffffff); border:1px solid var(--border-subtle); border-radius:10px; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-size:11px; font-weight:800; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.5px;">
                2. Secret API Key (সিক্রেট কি)
              </span>
              <span class="badge" style="background:rgba(16,185,129,0.12); color:#10b981; font-size:10px;">Active Live Key</span>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
              <input type="password" readonly value="${primaryApiKey}" id="hero-cred-api-key" class="form-control mono" style="font-size:12px; padding:6px 10px; background:var(--bg-subtle); color:var(--text-primary); font-weight:600; cursor:pointer;" onclick="this.select()">
              <button class="btn btn-secondary-action" id="btn-reveal-hero-api-key" style="padding:6px 8px; font-size:11px; display:inline-flex; align-items:center;" title="Reveal / Hide" onclick="window.payflowApp.toggleInputReveal('hero-cred-api-key', this)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <button class="btn btn-secondary-action" style="padding:6px 10px; font-size:11px; display:inline-flex; align-items:center; gap:4px;" title="Copy Secret API Key" onclick="window.payflowApp.copyCredential('Secret API Key', '${primaryApiKey}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>Copy</span>
              </button>
            </div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:6px;">Sends in <code>syncpay-api-key</code> or Bearer header</div>
          </div>

          <!-- Param 3: Webhook Secret -->
          <div style="background:var(--card-bg, #ffffff); border:1px solid var(--border-subtle); border-radius:10px; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-size:11px; font-weight:800; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.5px;">
                3. Webhook Secret (ওয়েবহুক সিক্রেট)
              </span>
              <span class="badge" style="background:rgba(2,132,199,0.12); color:#0284c7; font-size:10px;">HMAC SHA-256</span>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
              <input type="password" readonly value="${resolvedWebhookSecret}" id="hero-cred-webhook-secret" class="form-control mono" style="font-size:12px; padding:6px 10px; background:var(--bg-subtle); color:var(--text-primary); font-weight:600; cursor:pointer;" onclick="this.select()">
              <button class="btn btn-secondary-action" id="btn-reveal-hero-whsec" style="padding:6px 8px; font-size:11px; display:inline-flex; align-items:center;" title="Reveal / Hide" onclick="window.payflowApp.toggleInputReveal('hero-cred-webhook-secret', this)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <button class="btn btn-secondary-action" style="padding:6px 10px; font-size:11px; display:inline-flex; align-items:center; gap:4px;" title="Copy Webhook Secret" onclick="window.payflowApp.copyCredential('Webhook Secret', '${resolvedWebhookSecret}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>Copy</span>
              </button>
            </div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:6px;">Verifies payload integrity on callback delivery</div>
          </div>
        </div>

        <!-- Quick Connection Instruction Bar -->
        <div style="margin-top:16px; padding:12px 14px; background:var(--card-bg, #ffffff); border-radius:8px; border:1px dashed var(--border-subtle); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-secondary);">
            <span>🚀 <strong>How to connect:</strong> Paste <strong>Merchant ID</strong> and <strong>Secret Key</strong> into your WooCommerce plugin or website backend. When an invoice is paid, your Webhook URL will receive an instant callback.</span>
          </div>
          <div style="display:flex; gap:8px;">
            <a href="#docs" class="btn btn-secondary-action" style="font-size:11px; padding:4px 10px; text-decoration:none;">View API Docs</a>
            <a href="#plugins" class="btn btn-secondary-action" style="font-size:11px; padding:4px 10px; text-decoration:none;">Download Plugin</a>
          </div>
        </div>
      </div>

      <!-- ============================================================
           2. ACTIVE API AUTHENTICATION KEYS TABLE
           ============================================================ -->
      <div class="table-card" style="margin-bottom:24px;">
        <div class="table-toolbar">
          <div>
            <h4 style="font-size:14px; font-weight:800; color:var(--text-primary); margin:0;">Active API Authentication Keys</h4>
            <span style="font-size:12px; color:var(--text-muted);">Manage REST API keys used to sign and verify payments</span>
          </div>
          <button class="btn btn-primary-action" onclick="window.payflowApp.openCreateApiKeyModal()">
            + New API Key
          </button>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Key Name</th>
                <th>Environment</th>
                <th>Secret Key</th>
                <th>Created At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(k => {
      const env = (k.environment || 'production').toUpperCase();
      const prefix = k.key_prefix || 'live_sk_';
      const resolvedSecret = k.secret_key || storedGenerated[k.id] || primaryApiKey;
      const safeSecret = resolvedSecret.replace(/'/g, "\\'");

      return `
                  <tr>
                    <td>
                      <strong style="color:var(--text-primary);">${k.name || 'Website Integration Key'}</strong>
                    </td>
                    <td>
                      <span class="badge" style="background:${env === 'PRODUCTION' ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)'}; color:${env === 'PRODUCTION' ? '#10b981' : '#f59e0b'}; font-weight:700;">
                        ${env}
                      </span>
                    </td>
                    <td>
                      <div style="display:flex; align-items:center; gap:8px;">
                        <span class="mono" id="key-mask-${k.id}" style="color:var(--text-muted); font-size:12px; letter-spacing:0.5px; font-weight:600;">
                          ${prefix}••••••••••••••••
                        </span>
                        <button class="btn btn-secondary-action" style="padding:4px 6px; font-size:11px; display:inline-flex; align-items:center;" title="Reveal / Hide Key" onclick="window.payflowApp.toggleKeyReveal('${k.id}', '${safeSecret}', '${prefix}')">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
                        <button class="btn btn-secondary-action" style="padding:4px 6px; font-size:11px; display:inline-flex; align-items:center;" title="Copy Secret Key" onclick="window.payflowApp.copyApiKey('${k.id}', '${safeSecret}')">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        </button>
                      </div>
                    </td>
                    <td><span style="font-size:12px; color:var(--text-muted);">${k.created_at ? new Date(k.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Active'}</span></td>
                    <td>
                      <button class="btn btn-danger-action" style="padding:4px 8px; font-size:11px;" onclick="window.payflowApp.revokeApiKey('${k.id}')">
                        Revoke
                      </button>
                    </td>
                  </tr>
                `;
    }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- ============================================================
           3. INTEGRATED WEBHOOKS & ENDPOINTS SECTION
           ============================================================ -->
      <div id="webhooks-section">
        ${this.renderWebhooksInner(webhooksData, resolvedWebhookSecret)}
      </div>
    `;
  },

  // Helper: Inner Webhooks Component
  renderWebhooksInner(sub = null, defaultWebhookSecret = '') {
    const s = sub || {
      status: 'ACTIVE',
      webhook_url: 'https://yoursite.com/api/payment-webhook',
      connected_websites: [
        { id: 'site_1', name: 'Primary Store', domain: 'https://mystore.com', platform: 'WooCommerce', webhook_url: 'https://mystore.com/wp-json/syncpay/v1/callback', status: 'ACTIVE' }
      ]
    };

    const currentUrl = s.webhook_url || localStorage.getItem('syncpay_webhook_url') || '';

    return `
      <div class="table-card">
        <div class="table-toolbar">
          <div>
            <h4 style="font-size:14px; font-weight:800; color:var(--text-primary); margin:0;">Webhooks & Event Notifications (ওয়েবহুক কনফিগারেশন)</h4>
            <span style="font-size:12px; color:var(--text-muted);">Real-time HTTP push notifications sent to your server on payment completion</span>
          </div>
          <button class="btn btn-primary-action" onclick="window.payflowApp.sendTestWebhook()">
            Send Test Ping
          </button>
        </div>

        <div style="padding:16px 20px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
            <div>
              <label class="form-label" style="font-weight:700; font-size:12px; margin-bottom:6px; display:block;">Your Webhook Callback URL</label>
              <div style="display:flex; gap:8px;">
                <input type="url" id="wh-url-input" class="form-control mono" placeholder="https://yoursite.com/api/payment-webhook" value="${currentUrl}" style="font-size:12px;">
                <button class="btn btn-primary-action" onclick="window.payflowApp.saveWebhookUrl()" style="white-space:nowrap;">
                  Save URL
                </button>
              </div>
              <p style="font-size:11px; color:var(--text-muted); margin:6px 0 0 0;">
                SyncPay will send a POST request with HMAC-SHA256 signature when transactions succeed.
              </p>
            </div>

            <div>
              <label class="form-label" style="font-weight:700; font-size:12px; margin-bottom:6px; display:block;">Subscribed Events</label>
              <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:6px;">
                <span class="badge" style="background:rgba(16,185,129,0.12); color:#10b981;">✓ payment.completed</span>
                <span class="badge" style="background:rgba(16,185,129,0.12); color:#10b981;">✓ invoice.created</span>
                <span class="badge" style="background:rgba(2,132,199,0.12); color:#0284c7;">✓ trx.matched</span>
                <span class="badge" style="background:rgba(239,68,68,0.12); color:#ef4444;">✓ payment.failed</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  // 8. Webhooks & Connected Websites Management Panel
  renderWebhooksView(sub = null) {
    const s = sub || {
      plan_name: 'Growth Merchant Plan',
      tier: 'PRO',
      status: 'ACTIVE',
      quotas: {
        websites: { allowed: 5, connected: 2, percent: 40 },
        devices: { allowed: 3, connected: 1, percent: 33 },
        monthly_volume_bdt: { allowed: 500000, used: 48500, percent: 9.7 }
      },
      connected_websites: [
        { id: 'site_1', name: 'Primary E-commerce Store', domain: 'https://mystore-bd.com', platform: 'WooCommerce', webhook_url: 'https://mystore-bd.com/wp-json/payflow/v1/webhook', status: 'ACTIVE' },
        { id: 'site_2', name: 'EdTech Portal', domain: 'https://learncourses.io', platform: 'Next.js Custom', webhook_url: 'https://learncourses.io/api/payflow-webhook', status: 'ACTIVE' },
      ]
    };

    const activeSession = window.payflowApp?.session;
    const subInfo = activeSession ? auth.checkSubscription(activeSession) : { status: s.status, daysLeft: 30, isExpired: false, expiresAt: s.renews_at };
    const planKey = activeSession?.plan || 'business';
    const planConfig = auth.getPlan(planKey);
    const statusColor = subInfo.isExpired ? '#ef4444' : '#10b981';
    const statusBg = subInfo.isExpired ? '#fee2e2' : '#ecfdf5';
    const statusLabel = subInfo.isExpired ? '● EXPIRED (Suspended)' : `● ACTIVE (${subInfo.daysLeft} days left)`;
    const expiryFormatted = subInfo.expiresAt ? new Date(subInfo.expiresAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Oct 19, 2026';

    return `
      <!-- Subscription Plan & Quota Card -->
      <div class="quota-card">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; border-bottom:1px solid var(--border-subtle); padding-bottom:16px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <h3 style="font-size:16px; font-weight:800; color:var(--text-primary); margin:0;">Subscription Plan & Quotas</h3>
              <span class="badge" style="background:var(--primary-subtle); color:var(--primary); font-size:11px;">${planConfig.badge}</span>
              <span class="badge" style="background:${statusBg}; color:${statusColor}; font-size:11px; font-weight:800;">${statusLabel}</span>
            </div>
            <p style="font-size:13px; color:var(--text-muted); margin:4px 0 0 0;">
              ${subInfo.isExpired
        ? '<span style="color:#ef4444; font-weight:700;">⚠️ Subscription has expired. Your automation service is suspended—renew now to resume.</span>'
        : `Next billing & renewal date: <strong>${expiryFormatted}</strong> (${subInfo.daysLeft} days left)।`}
            </p>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn btn-primary-action" style="font-size:11px; padding:6px 12px; font-weight:700;" onclick="window.payflowApp.openRenewModal()">
              💳 ${subInfo.isExpired ? 'Renew & Activate Now' : 'Renew / Extend Plan'}
            </button>
            <button class="btn btn-secondary-action" style="font-size:11px; padding:6px 10px; color:#ef4444; border-color:#fca5a5;" onclick="window.payflowApp.simulateSubscriptionDays(0)" title="Test suspended state after plan expiry">
              ⏱️ Test: Expire (Off)
            </button>
            <button class="btn btn-secondary-action" style="font-size:11px; padding:6px 10px; color:#10b981; border-color:#86efac;" onclick="window.payflowApp.simulateSubscriptionDays(30)" title="Reset active state to 30 days">
              ⏱️ Test: 30 Days (Active)
            </button>
          </div>
        </div>

        <div class="quota-grid">
          <!-- Quota 1: Websites -->
          <div class="quota-item">
            <div class="quota-header">
              <span class="quota-title">🌐 Connected Websites Quota</span>
              <span class="quota-counts">${s.quotas.websites.connected} / ${s.quotas.websites.allowed} Sites</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width:${s.quotas.websites.percent}%;"></div>
            </div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:6px;">
              ${s.quotas.websites.allowed - s.quotas.websites.connected} website slots remaining.
            </div>
          </div>

          <!-- Quota 2: Devices -->
          <div class="quota-item">
            <div class="quota-header">
              <span class="quota-title">📱 Connected Forwarder Devices</span>
              <span class="quota-counts">${s.quotas.devices.connected} / ${s.quotas.devices.allowed} SIMs</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width:${s.quotas.devices.percent}%;"></div>
            </div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:6px;">
              ${s.quotas.devices.allowed - s.quotas.devices.connected} forwarder device slots remaining.
            </div>
          </div>

          <!-- Quota 3: Monthly Volume -->
          <div class="quota-item">
            <div class="quota-header">
              <span class="quota-title">💰 Monthly Transaction Volume</span>
              <span class="quota-counts">৳ ${(s.quotas.monthly_volume_bdt.used).toLocaleString()} / ৳ ${(s.quotas.monthly_volume_bdt.allowed).toLocaleString()}</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width:${s.quotas.monthly_volume_bdt.percent}%;"></div>
            </div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:6px;">
              Utilized ${s.quotas.monthly_volume_bdt.percent}% (Upgrade to Enterprise for unlimited throughput).
            </div>
          </div>
        </div>
      </div>

      <!-- Connected Websites Table -->
      <div class="table-card" style="margin-bottom:24px;">
        <div class="table-toolbar">
          <div>
            <h4 style="font-size:14px; font-weight:800; color:var(--text-primary); margin:0;">Connected Websites</h4>
            <span style="font-size:12px; color:var(--text-muted);">Authorized domains configured for checkout and webhooks</span>
          </div>
          <button class="btn btn-primary-action" onclick="window.payflowApp.openConnectWebsiteModal()">
            + Connect Website
          </button>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Website Name</th>
                <th>Domain URL</th>
                <th>Platform</th>
                <th>Webhook Callback URL</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${s.connected_websites.map(w => `
                <tr>
                  <td><strong style="color:var(--text-primary);">${w.name}</strong></td>
                  <td><a href="${w.domain}" target="_blank" class="mono" style="color:var(--primary); font-size:12px; text-decoration:none;">${w.domain} ↗</a></td>
                  <td><span class="badge" style="background:var(--bg-subtle); color:var(--text-secondary);">${w.platform}</span></td>
                  <td><span class="mono" style="font-size:11px; color:var(--text-muted);">${w.webhook_url}</span></td>
                  <td><span class="badge badge-completed">● ${w.status}</span></td>
                  <td>
                    <button class="btn btn-secondary-action" style="padding:4px 8px; font-size:11px;" onclick="window.payflowApp.testSiteWebhook('${w.id}', '${w.webhook_url}')">
                      Test Ping
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Webhook Configuration & Delivery Log -->
      <div style="display:grid; grid-template-columns:1fr 1.5fr; gap:20px;">
        <div class="card-panel">
          <h4 class="card-panel-title" style="margin-bottom:14px;">Global Webhook Secret</h4>
          <div class="form-group">
            <label class="form-label">Primary Webhook URL</label>
            <input type="text" id="wh-url-input" class="form-control mono" value="https://merchant.example.com/api/webhook">
          </div>
          <div class="form-group">
            <label class="form-label">HMAC SHA-256 Signing Secret</label>
            <input type="text" class="form-control mono" value="whsec_8f4c9a2e7b3199410" readonly>
          </div>
          <div style="margin-top:20px;">
            <button class="btn btn-primary-action" style="width:100%; display:inline-flex; align-items:center; justify-content:center; gap:8px;" onclick="window.payflowApp.sendTestWebhook()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              <span>Send Test Webhook (POST)</span>
            </button>
          </div>
        </div>

        <div class="card-panel">
          <h4 class="card-panel-title" style="margin-bottom:14px;">Recent Delivery History</h4>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>HTTP Status</th>
                  <th>Response Time</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody id="webhook-logs-tbody">
                <tr>
                  <td><span class="mono" style="font-size:12px;">payment.completed</span></td>
                  <td><span class="badge badge-completed">200 OK</span></td>
                  <td>112ms</td>
                  <td>10 mins ago</td>
                </tr>
                <tr>
                  <td><span class="mono" style="font-size:12px;">payment.completed</span></td>
                  <td><span class="badge badge-completed">200 OK</span></td>
                  <td>89ms</td>
                  <td>32 mins ago</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  // 12. Payment Channels & Instructions Grid Renderer
  renderPaymentMethodsList(methods = []) {
    if (!methods || methods.length === 0) {
      return `
        <div class="empty-state card-panel" style="text-align:center; padding:50px 20px;">
          <div style="width:56px; height:56px; border-radius:16px; background:var(--primary-subtle); color:var(--primary); display:flex; align-items:center; justify-content:center; margin:0 auto 16px;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          </div>
          <h3 style="font-size:18px; font-weight:800; color:var(--text-primary); margin-bottom:8px;">No Payment Channels Configured</h3>
          <p style="font-size:13px; color:var(--text-muted); max-width:440px; margin:0 auto 20px;">
            Add bKash, Nagad, Rocket, Bank Transfer, or Binance Pay channels for your customers.
          </p>
          <button class="btn btn-primary-action" onclick="window.payflowApp.openAddPaymentMethodModal()">
            + Add First Channel
          </button>
        </div>
      `;
    }

    const cardsHtml = methods.map(m => {
      const isActive = m.is_active === 1;
      const type = (m.provider_type || 'custom').toLowerCase();
      const color = m.theme_color || '#E2136E';

      const shortTitleMap = {
        bkash: 'bKash',
        nagad: 'Nagad',
        rocket: 'Rocket',
        upay: 'Upay',
        tap: 'TAP',
        islamic_wallet: 'Islamic Wallet',
        mcash: 'mCash',
        mycash: 'MYCash',
        ok_wallet: 'OK Wallet',
        meghna_pay: 'Meghna Pay',
        telecash: 'TeleCash',
        surecash: 'SureCash',
        rupali_surecash: 'Rupali SureCash',
        bank: m.bank_name ? m.bank_name.replace(/PLC|Ltd|Bank/gi, '').trim() + ' Bank' : 'City Bank',
        binance: 'Binance Pay'
      };
      const cleanTitle = shortTitleMap[type] || (m.title || '').replace(/\(.*?\)/g, '').replace(/Pay with /i, '').trim() || 'Payment';
      const badgeText = type === 'bank' ? 'BANK' : (type === 'binance' ? 'CRYPTO' : 'MFS');

      let iconSvg = '';
      if (type === 'bkash') {
        iconSvg = `<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>`;
      } else if (type === 'nagad') {
        iconSvg = `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`;
      } else if (type === 'rocket') {
        iconSvg = `<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>`;
      } else if (type === 'upay') {
        iconSvg = `<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>`;
      } else if (type === 'tap') {
        iconSvg = `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`;
      } else if (type === 'islamic_wallet') {
        iconSvg = `<path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>`;
      } else if (type === 'mcash') {
        iconSvg = `<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 15h0M2 9.5h20"/>`;
      } else if (type === 'mycash') {
        iconSvg = `<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>`;
      } else if (type === 'ok_wallet') {
        iconSvg = `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`;
      } else if (type === 'meghna_pay') {
        iconSvg = `<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>`;
      } else if (type === 'telecash') {
        iconSvg = `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>`;
      } else if (type === 'surecash' || type === 'rupali_surecash') {
        iconSvg = `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`;
      } else if (type === 'bank') {
        iconSvg = `<path d="M3 21h18"/><path d="M5 21V9"/><path d="M19 21V9"/><path d="M9 21V9"/><path d="M15 21V9"/><path d="m2 9 10-5 10 5"/>`;
      } else if (type === 'binance') {
        iconSvg = `<polygon points="12 2 2 12 12 22 22 12 12 2"/><circle cx="12" cy="12" r="3"/>`;
      } else {
        iconSvg = `<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>`;
      }

      // Format instructions for display
      const instFormatted = (m.instructions || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => `<li style="margin-bottom:2px;">${line}</li>`)
        .join('');

      return `
        <div class="card-panel" style="position:relative; display:flex; flex-direction:column; justify-content:space-between; border-top: 3px solid ${color}; padding:14px 16px; border-radius:12px;">
          <div>
            <!-- Header Row -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <div style="display:flex; align-items:center; gap:9px;">
                <div style="width:32px; height:32px; border-radius:8px; background:${color}15; color:${color}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">${iconSvg}</svg>
                </div>
                <div>
                  <div style="font-weight:700; font-size:14.5px; color:var(--text-primary); line-height:1.2;">${cleanTitle}</div>
                  <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
                    <span style="font-size:10px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">${badgeText}</span>
                    ${m.qr_code_url ? `<span style="font-size:9.5px; font-weight:700; color:#2563eb; background:rgba(37,99,235,0.08); border:1px solid rgba(37,99,235,0.2); padding:1px 5px; border-radius:4px; display:inline-flex; align-items:center; gap:3px;"><span>📷</span> Custom QR</span>` : ''}
                  </div>
                </div>
              </div>

              <!-- Active Toggle Switch -->
              <button 
                class="btn-icon-tool" 
                title="${isActive ? 'Click to deactivate' : 'Click to activate'}" 
                onclick="window.payflowApp.togglePaymentMethod('${m.id}', ${!isActive})"
                style="padding:4px 9px; border-radius:20px; font-size:11px; font-weight:700; display:inline-flex; align-items:center; gap:4px; background:${isActive ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)'}; color:${isActive ? '#10b981' : '#ef4444'}; border:1px solid ${isActive ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'};">
                <span style="width:6px; height:6px; border-radius:50%; background:${isActive ? '#10b981' : '#ef4444'}; display:inline-block;"></span>
                <span>${isActive ? 'Active' : 'Inactive'}</span>
              </button>
            </div>

            <!-- Numbers / Account Info Box -->
            <div style="background:var(--bg-subtle, #f8fafc); border:1px solid var(--border); border-radius:8px; padding:8px 10px; margin-bottom:8px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span class="mono" style="font-size:13.5px; font-weight:700; color:var(--text-primary); letter-spacing:0.03em;">
                  ${m.account_number}
                </span>
                <button class="btn btn-secondary-action" style="padding:1px 6px; font-size:10.5px;" onclick="window.payflowApp.copyText('${m.account_number}')">
                  Copy
                </button>
              </div>
              ${m.account_name ? `
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
                  ${m.account_name}
                </div>
              ` : ''}
              ${type === 'bank' && m.bank_name ? `
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
                  ${m.bank_name}
                </div>
              ` : ''}
            </div>

            <!-- Compact Collapsible Instructions -->
            ${instFormatted ? `
              <details style="margin-bottom:8px; font-size:11.5px;">
                <summary style="cursor:pointer; font-weight:600; color:var(--text-muted); display:inline-flex; align-items:center; gap:4px; user-select:none;">
                  <span>Instructions</span>
                </summary>
                <div style="background:var(--bg-main, #ffffff); border:1px solid var(--border); border-radius:6px; padding:6px 10px; margin-top:4px; font-size:11px; color:var(--text-secondary); line-height:1.4;">
                  <ul style="padding-left:14px; margin:0;">
                    ${instFormatted}
                  </ul>
                </div>
              </details>
            ` : ''}
          </div>

          <!-- Actions Footer -->
          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding-top:8px; margin-top:2px;">
            <div style="display:flex; gap:6px;">
              <button class="btn btn-secondary-action" style="padding:3px 8px; font-size:11px;" onclick="window.payflowApp.editPaymentMethod('${m.id}')">
                Edit
              </button>
              <a href="/checkout" target="_blank" class="btn btn-secondary-action" style="padding:3px 8px; font-size:11px; text-decoration:none;">
                Test
              </a>
            </div>

            <button class="btn-icon-tool" style="color:var(--danger, #ef4444); padding:3px;" title="Delete" onclick="window.payflowApp.deletePaymentMethod('${m.id}', '${m.title.replace(/'/g, "\\'")}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:14px;">
        ${cardsHtml}
      </div>
    `;
  },

  // 12. Reusable Generic Data Table Renderer
  renderDataTable({ columns, data, emptyMessage = 'No records found' }) {
    if (!data || data.length === 0) {
      return `<tr><td colspan="${columns.length}" style="text-align: center; padding: 2.5rem 1rem; color: var(--text-light); font-size: 13px;">${emptyMessage}</td></tr>`;
    }
    return data.map((item, index) => `
      <tr>
        ${columns.map(col => `<td>${col.render ? col.render(item, index) : (item[col.key] ?? '-')}</td>`).join('')}
      </tr>
    `).join('');
  },
};

