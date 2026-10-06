/**
 * SyncPay BD - Official Node.js & TypeScript SDK
 * Version: 2.0.0
 */

class SyncPayClient {
  constructor(config = {}) {
    this.apiKey = typeof config === 'string' ? config : (config.apiKey || process.env.SYNCPAY_API_KEY || '');
    this.baseUrl = (config.baseUrl || process.env.SYNCPAY_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');

    if (!this.apiKey) {
      console.warn('[SyncPay] Warning: API Key is not set.');
    }
  }

  async _request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'syncpay-api-key': this.apiKey,
      'syncpay-api-key': this.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const config = {
      method: options.method || 'GET',
      headers,
    };

    if (options.body) {
      config.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const res = await fetch(url, config);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }

    return data;
  }

  /**
   * Create an invoice/payment link
   * @param {Object} params - { amount, order_id, customer_name, customer_phone, callback_url }
   */
  async createInvoice(params) {
    return this._request('/v1/payment/create', {
      method: 'POST',
      body: params,
    });
  }

  /**
   * Verify an MFS TrxID
   * @param {string} trxId - TrxID to verify (e.g. BL78A4982J)
   */
  async verifyTransaction(trxId) {
    return this._request('/v1/payment/verify', {
      method: 'POST',
      body: { trx_id: trxId },
    });
  }

  /**
   * Fetch recent transactions
   */
  async getTransactions() {
    return this._request('/api/v1/merchant/transactions');
  }

  /**
   * Fetch connected telephony forwarder devices
   */
  async getDevices() {
    return this._request('/api/v1/merchant/devices');
  }
}

module.exports = { SyncPayClient };
module.exports.default = SyncPayClient;
