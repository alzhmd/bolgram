/**
 * PayFlow MFS Super Admin — Centralized API Client
 * Designed for atomic Fastify backend execution & seamless Supabase transition
 */

class AdminApiClient {
  constructor() {
    this.baseUrl = window.location.origin;
    this.token = localStorage.getItem('payflow_admin_token') || 'super_admin_session_token';
  }

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.token}`,
      'X-PayFlow-Admin-Role': 'Super Admin',
    };
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = { ...this.getHeaders(), ...options.headers };
    try {
      const res = await fetch(url, { ...options, headers });
      if (!res.ok) {
        throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
      }
      return await res.json();
    } catch (err) {
      console.warn(`API Request failed for ${endpoint}:`, err);
      throw err;
    }
  }

  // Stats & Analytics
  async getGlobalStats() {
    return this.request('/api/v1/admin/stats');
  }

  async getRevenueAnalytics(days = 7, interval = 'daily') {
    return this.request(`/api/v1/admin/analytics/revenue?days=${days}&interval=${interval}`);
  }

  async getMfsProviders() {
    return this.request('/api/v1/admin/analytics/providers');
  }

  // Merchants
  async getMerchants() {
    return this.request('/api/v1/admin/merchants');
  }

  async createMerchant(name, webhookUrl) {
    return this.request('/api/v1/admin/merchants', {
      method: 'POST',
      body: JSON.stringify({ name, webhookUrl }),
    });
  }

  async updateMerchantPlan(id, { plan, status, payment_status, payment_note }) {
    return this.request(`/api/v1/admin/merchants/${id}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({ plan, status, payment_status, payment_note }),
    });
  }

  async updateMerchantStatus(id, status) {
    return this.request(`/api/v1/admin/merchants/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  // Devices
  async getDevices() {
    return this.request('/api/v1/admin/devices');
  }

  async updateDeviceStatus(id, status) {
    return this.request(`/api/v1/admin/devices/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  // Transactions & Invoices
  async getTransactions(limit = 100) {
    return this.request(`/api/v1/admin/transactions?limit=${limit}`);
  }

  async getInvoices(limit = 100) {
    return this.request(`/api/v1/admin/invoices?limit=${limit}`);
  }

  // API Keys
  async getApiKeys() {
    return this.request('/api/v1/admin/api-keys');
  }

  async revokeApiKey(id) {
    return this.request(`/api/v1/admin/api-keys/${id}/revoke`, {
      method: 'POST',
    });
  }

  // Webhooks
  async getWebhooks() {
    return this.request('/api/v1/admin/webhooks');
  }

  async retryWebhook(webhookId) {
    return this.request('/api/v1/admin/webhooks/retry', {
      method: 'POST',
      body: JSON.stringify({ webhookId }),
    });
  }

  // Security & Audit
  async getAuditLogs() {
    return this.request('/api/v1/admin/security/audit-logs');
  }

  async getSuspiciousActivity() {
    return this.request('/api/v1/admin/security/suspicious');
  }

  // System & Logs
  async getSystemHealth() {
    return this.request('/api/v1/admin/system/health');
  }

  async getServerLogs(level = 'ALL') {
    return this.request(`/api/v1/admin/system/logs?level=${level}`);
  }

  async getAdminUsers() {
    return this.request('/api/v1/admin/users');
  }

  async createAdminUser(name, email, role) {
    return this.request('/api/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ name, email, role }),
    });
  }

  async getSettings() {
    return this.request('/api/v1/admin/settings');
  }

  async updateSetting(key, value) {
    return this.request('/api/v1/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ key, value }),
    });
  }

  // Unmatched SMS Pool
  async getUnmatchedSms() {
    return this.request('/api/v1/admin/unmatched-sms');
  }

  async assignUnmatchedSms(id, invoiceId) {
    return this.request(`/api/v1/admin/unmatched-sms/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ invoiceId }),
    });
  }

  // Manual Payment Verification Override
  async manualVerifyPayment(invoiceId, trxId, amount) {
    return this.request('/api/v1/admin/transactions/manual-verify', {
      method: 'POST',
      body: JSON.stringify({ invoiceId, trxId, amount }),
    });
  }

  // Payouts & Settlements
  async getPayouts() {
    return this.request('/api/v1/admin/payouts');
  }

  async createPayout(data) {
    return this.request('/api/v1/admin/payouts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async approvePayout(id, trxId) {
    return this.request(`/api/v1/admin/payouts/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ trxId }),
    });
  }

  async rejectPayout(id, reason) {
    return this.request(`/api/v1/admin/payouts/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // Security Blacklist
  async getBlacklist() {
    return this.request('/api/v1/admin/security/blacklist');
  }

  async addBlacklist(type, value, reason, addedBy) {
    return this.request('/api/v1/admin/security/blacklist', {
      method: 'POST',
      body: JSON.stringify({ type, value, reason, addedBy }),
    });
  }

  async removeBlacklist(id) {
    return this.request(`/api/v1/admin/security/blacklist/${id}`, {
      method: 'DELETE',
    });
  }

  // Provider Rules & Dynamic Regex
  async getProviderRules() {
    return this.request('/api/v1/admin/providers/config');
  }

  async updateProviderRule(data) {
    return this.request('/api/v1/admin/providers/config', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Interactive Payment / SMS Simulator
  async triggerMockSms(data) {
    return this.request('/api/v1/admin/simulator/mock-sms', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // System Vacuum & Checkpoint
  async triggerVacuum() {
    return this.request('/api/v1/admin/system/vacuum', {
      method: 'POST',
    });
  }
}

export const adminApi = new AdminApiClient();
