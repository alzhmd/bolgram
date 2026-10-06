// PayFlow MFS — Production API Client with Supabase Abstraction Layer

export class ApiClient {
  constructor() {
    this.baseUrl = window.location.origin;
    this.apiKey = localStorage.getItem('payflow_api_key') || 'sandbox_test_8f4c9a2e7b31';
    this.useSupabase = false; // Set to true when integrating Supabase directly
  }

  setApiKey(key) {
    this.apiKey = key;
    localStorage.setItem('payflow_api_key', key);
  }

  async request(endpoint, options = {}) {
    let sessionMerchantId = '';
    let sessionApiKey = '';
    try {
      const sess = JSON.parse(localStorage.getItem('syncpay_session') || '{}');
      if (sess && sess.merchantId) sessionMerchantId = sess.merchantId;
      if (sess && sess.apiKey) sessionApiKey = sess.apiKey;
    } catch (e) {}

    const effectiveApiKey = sessionApiKey || this.apiKey;

    const headers = {
      'syncpay-api-key': effectiveApiKey,
      'payflow-api-key': effectiveApiKey,
      'zini-api-key': effectiveApiKey,
      'x-merchant-id': sessionMerchantId,
      ...options.headers,
    };

    if (options.body && typeof options.body === 'string' && options.body.length > 0) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || `HTTP ${res.status}`);
      }

      return await res.json();
    } catch (err) {
      console.warn(`[ApiClient] Request to ${endpoint} failed:`, err.message);
      throw err;
    }
  }

  // 1. Fetch Merchant Stats
  async getStats() {
    try {
      const res = await this.request('/api/v1/merchant/stats');
      if (res.success && res.data) {
        return {
          todayRevenue: res.data.todayRevenue || 0,
          todayCount: res.data.todayCount || 0,
          totalVerified: res.data.totalVerified || 0,
          pendingCount: res.data.pendingCount || 0,
          failedCount: res.data.failedCount || 0,
          deviceCount: (res.data.devices && res.data.devices.length) || (res.data.deviceCount || 0),
          isLive: true,
        };
      }
    } catch (e) {}

    return {
      todayRevenue: 0,
      todayCount: 0,
      totalVerified: 0,
      pendingCount: 0,
      failedCount: 0,
      deviceCount: 0,
      isLive: true,
    };
  }

  // 2. Fetch Chart Breakdown
  async getChartData(days = 7) {
    try {
      const res = await this.request(`/api/v1/merchant/chart-data?days=${days}`);
      if (res.success && Array.isArray(res.data) && res.data.length > 0) {
        return res.data;
      }
    } catch (e) {}

    const dates = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    }

    return dates.map((d) => ({
      date: d,
      revenue: 0,
      total_txs: 0,
      successful_txs: 0,
      failed_txs: 0,
    }));
  }

  // 3. Fetch Recent Transactions
  async getTransactions(limit = 50) {
    try {
      const res = await this.request('/api/v1/merchant/transactions');
      if (res.success && Array.isArray(res.data)) {
        return res.data;
      }
    } catch (e) {}

    return [];
  }

  // 4. Fetch Invoices
  async getInvoices() {
    try {
      const res = await this.request('/api/v1/merchant/invoices');
      if (res.success && Array.isArray(res.data)) {
        return res.data;
      }
    } catch (e) {}

    return [];
  }

  // 5. Create Invoice
  async createInvoice(payload) {
    return await this.request('/v1/payment/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // 6. Fetch Devices
  async getDevices() {
    try {
      const res = await this.request('/api/v1/merchant/devices');
      if (res.success && res.data && res.data.length > 0) {
        return res.data;
      }
    } catch (e) {}

    // Only return simulated device when explicitly exploring in Demo Mode via URL ?demo=true
    let isDemo = false;
    try {
      isDemo = new URLSearchParams(window.location.search).get('demo') === 'true';
    } catch (err) {}

    if (isDemo) {
      return [
        {
          id: '00000000-0000-0000-0000-000000000001',
          device_name: 'TECNO KM5 (Demo Forwarder)',
          sim_number: '017•••••••',
          status: 'ONLINE',
          last_seen: new Date().toISOString(),
          device_token: 'token_phone_primary_uuid',
          sms_count: 3,
        },
      ];
    }

    return [];
  }

  // 7. Add Device
  async addDevice(payload) {
    return await this.request('/api/v1/merchant/devices', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // 8. Delete Device
  async deleteDevice(id) {
    return await this.request(`/api/v1/merchant/devices/${id}`, {
      method: 'DELETE',
    });
  }

  // 9. Fetch API Keys
  async getApiKeys() {
    try {
      const res = await this.request('/api/v1/merchant/api-keys');
      if (res.success && Array.isArray(res.data)) {
        return res.data;
      }
    } catch (e) {}

    return [];
  }

  // 9b. Fetch Unified Credentials (Merchant ID, API Key, Webhook Secret)
  async getCredentials() {
    try {
      const res = await this.request('/api/v1/merchant/credentials');
      if (res.success && res.data) {
        return res.data;
      }
    } catch (e) {}
    return null;
  }

  // 10. Create API Key
  async createApiKey(payload) {
    return await this.request('/api/v1/merchant/api-keys', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // 10b. Revoke API Key
  async revokeApiKey(keyId) {
    return await this.request(`/api/v1/merchant/api-keys/${keyId}/revoke`, {
      method: 'POST',
    });
  }

  // 11. Send Test Webhook
  async sendTestWebhook(targetUrl) {
    return await this.request('/api/v1/merchant/test-webhook', {
      method: 'POST',
      body: JSON.stringify({ webhook_url: targetUrl }),
    });
  }

  // 12. Get Device QR Code & Pairing Config
  async getDeviceQr(deviceId) {
    return await this.request(`/api/v1/merchant/devices/${deviceId}/qr`);
  }

  // 13. Get Merchant Subscription & Quotas
  async getSubscription() {
    return await this.request('/api/v1/merchant/subscription');
  }

  // 14. Connect New Website under Quota
  async connectWebsite(payload) {
    return await this.request('/api/v1/merchant/websites', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // 15. Merchant Auth
  async registerMerchant(payload) {
    return await this.request('/api/v1/merchant/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async loginMerchant(payload) {
    return await this.request('/api/v1/merchant/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // 16. Payment Methods & Instructions Management
  async getPaymentMethods() {
    const res = await this.request('/api/v1/merchant/payment-methods');
    return res.data || [];
  }

  async savePaymentMethod(payload) {
    return await this.request('/api/v1/merchant/payment-methods', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async togglePaymentMethod(id, isActive) {
    return await this.request(`/api/v1/merchant/payment-methods/${id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: isActive }),
    });
  }

  async deletePaymentMethod(id) {
    return await this.request(`/api/v1/merchant/payment-methods/${id}`, {
      method: 'DELETE',
    });
  }

  // 17. Merchant Branding & Custom Domain
  async getBranding() {
    const token = localStorage.getItem('payflow_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    return await this.request('/api/v1/merchant/branding', { headers });
  }

  async updateBranding(payload) {
    const token = localStorage.getItem('payflow_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    return await this.request('/api/v1/merchant/branding', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }
}

export const api = new ApiClient();
