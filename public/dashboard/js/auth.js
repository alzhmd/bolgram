/**
 * SyncPay BD — Auth & Session Manager
 * Handles merchant login, registration, package-based access control
 */

const PLANS = {
  starter: {
    label: 'Starter',
    badge: '🟢 Starter',
    price: '৳100/mo',
    color: '#10b981',
    txLimit: Infinity,
    deviceLimit: 1,
    siteLimit: 1,
    threads: 10,
    features: ['transactions', 'invoices', 'devices', 'payment-methods', 'quick-verify', 'sms-logs', 'api-keys', 'webhooks', 'docs', 'plugins', 'reports'],
    locked: [],
  },
  pro: {
    label: 'Pro',
    badge: '🔵 Pro',
    price: '৳150/mo',
    color: '#0284c7',
    txLimit: Infinity,
    deviceLimit: 2,
    siteLimit: 2,
    threads: 25,
    features: ['transactions', 'invoices', 'devices', 'payment-methods', 'quick-verify', 'sms-logs', 'api-keys', 'webhooks', 'docs', 'plugins', 'reports'],
    locked: [],
  },
  business: {
    label: 'Business',
    badge: '⭐ Business',
    price: '৳200/mo',
    color: '#0284c7',
    txLimit: Infinity,
    deviceLimit: 3,
    siteLimit: 3,
    threads: 50,
    features: ['transactions', 'invoices', 'devices', 'payment-methods', 'quick-verify', 'sms-logs', 'api-keys', 'webhooks', 'docs', 'plugins', 'reports'],
    locked: [],
  },
  enterprise: {
    label: 'Enterprise',
    badge: '⚡ Enterprise',
    price: '৳300/mo',
    color: '#8b5cf6',
    txLimit: Infinity,
    deviceLimit: 5,
    siteLimit: 5,
    threads: 100,
    features: ['transactions', 'invoices', 'devices', 'payment-methods', 'quick-verify', 'sms-logs', 'api-keys', 'webhooks', 'docs', 'plugins', 'reports'],
    locked: [],
  },
  agency: {
    label: 'Agency',
    badge: '🟣 Agency',
    price: '৳250/mo',
    color: '#a855f7',
    txLimit: Infinity,
    deviceLimit: 4,
    siteLimit: 4,
    threads: 60,
    features: ['transactions', 'invoices', 'devices', 'payment-methods', 'quick-verify', 'sms-logs', 'api-keys', 'webhooks', 'docs', 'plugins', 'reports'],
    locked: [],
  },
  elite: {
    label: 'Elite',
    badge: '👑 Elite',
    price: '৳350/mo',
    color: '#f59e0b',
    txLimit: Infinity,
    deviceLimit: 10,
    siteLimit: 10,
    threads: 100,
    features: ['transactions', 'invoices', 'devices', 'payment-methods', 'quick-verify', 'sms-logs', 'api-keys', 'webhooks', 'docs', 'plugins', 'reports'],
    locked: [],
  },
  growth: {
    label: 'Growth',
    badge: '🔵 Growth',
    price: '৳700/mo',
    color: '#0284c7',
    txLimit: Infinity,
    deviceLimit: 20,
    siteLimit: 20,
    threads: 200,
    features: ['transactions', 'invoices', 'devices', 'payment-methods', 'quick-verify', 'sms-logs', 'api-keys', 'webhooks', 'docs', 'plugins', 'reports'],
    locked: [],
  },
  scale: {
    label: 'Scale',
    badge: '🚀 Scale',
    price: '৳1000/mo',
    color: '#ec4899',
    txLimit: Infinity,
    deviceLimit: 30,
    siteLimit: 30,
    threads: 300,
    features: ['transactions', 'invoices', 'devices', 'payment-methods', 'quick-verify', 'sms-logs', 'api-keys', 'webhooks', 'docs', 'plugins', 'reports'],
    locked: [],
  },
  mega: {
    label: 'Mega',
    badge: '💎 Mega',
    price: '৳2000/mo',
    color: '#6366f1',
    txLimit: Infinity,
    deviceLimit: 50,
    siteLimit: 50,
    threads: 500,
    features: ['transactions', 'invoices', 'devices', 'payment-methods', 'quick-verify', 'sms-logs', 'api-keys', 'webhooks', 'docs', 'plugins', 'reports'],
    locked: [],
  },
};

const DEMO_ACCOUNTS = [
  {
    id: '01711000000260923',
    email: 'demo@syncpaybd.site',
    phone: '01711000000',
    password: 'demo1234',
    name: 'Demo Merchant',
    business: 'Demo Store BD',
    plan: 'growth',
    joinedAt: '2025-01-15',
    apiKey: 'live_sk_demo_99410abc',
  },
  {
    id: '01811000000260923',
    email: 'starter@test.com',
    phone: '01811000000',
    password: 'test1234',
    name: 'Starter User',
    business: 'My Small Shop',
    plan: 'starter',
    joinedAt: '2026-01-01',
    apiKey: 'live_sk_starter_11111',
  },
  {
    id: '01911000000260923',
    email: 'enterprise@test.com',
    phone: '01911000000',
    password: 'ent1234',
    name: 'Enterprise Corp',
    business: 'BigCorp BD Ltd',
    plan: 'enterprise',
    joinedAt: '2024-06-01',
    apiKey: 'live_sk_ent_999abc',
  },
];

export const auth = {
  SESSION_KEY: 'syncpay_session',
  ACCOUNTS_KEY: 'syncpay_accounts',

  getAccounts() {
    const stored = JSON.parse(localStorage.getItem(this.ACCOUNTS_KEY) || '[]');
    const storedEmails = stored.map(a => a.email);
    return [...DEMO_ACCOUNTS.filter(d => !storedEmails.includes(d.email)), ...stored];
  },

  login(identifier, password) {
    const accounts = this.getAccounts();
    const cleanId = (identifier || '').trim().toLowerCase();
    const cleanPhone = (identifier || '').replace(/[\s\-\(\)\+]/g, '');
    const merchant = accounts.find(a => {
      const aEmail = (a.email || '').toLowerCase();
      const aPhone = (a.phone || '').replace(/[\s\-\(\)\+]/g, '');
      if (aEmail && aEmail === cleanId) return true;
      if (cleanPhone.length >= 6 && aPhone && (aPhone === cleanPhone || aPhone.endsWith(cleanPhone.slice(-10)))) return true;
      return false;
    });
    if (!merchant) return { ok: false, error: 'Account not found with this email or phone number.' };
    if (merchant.password !== password) return { ok: false, error: 'Invalid password.' };
    const session = {
      merchantId: merchant.id,
      email: merchant.email,
      phone: merchant.phone || (cleanPhone.length >= 6 ? cleanPhone : ''),
      name: merchant.name,
      business: merchant.business,
      plan: merchant.plan,
      apiKey: merchant.apiKey,
      loginAt: new Date().toISOString(),
    };
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
    if (session.apiKey) {
      localStorage.setItem('payflow_api_key', session.apiKey);
    }
    return { ok: true, merchant: session };
  },

  register({ name, business, email, password, plan = 'starter' }) {
    const accounts = this.getAccounts();
    if (accounts.find(a => a.email === email.trim().toLowerCase())) {
      return { ok: false, error: 'An account with this email already exists.' };
    }
    if (!name || !business || !email || !password) {
      return { ok: false, error: 'Please fill in all required fields.' };
    }
    if (password.length < 6) {
      return { ok: false, error: 'Password must be at least 6 characters.' };
    }
    const cleanDigits = (phone || '01700000000').replace(/\D/g, '').slice(-11).padStart(11, '0');
    const d = new Date();
    const dateStr = String(d.getFullYear()).slice(-2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const id = cleanDigits + dateStr; // Exactly 17 digits: 11 phone + 6 date
    const apiKey = 'live_sk_' + Math.random().toString(36).slice(2, 18);
    const newMerchant = {
      id, name, business,
      email: email.trim().toLowerCase(),
      password, plan,
      joinedAt: new Date().toISOString().slice(0, 10),
      apiKey,
    };
    const custom = JSON.parse(localStorage.getItem(this.ACCOUNTS_KEY) || '[]');
    custom.push(newMerchant);
    localStorage.setItem(this.ACCOUNTS_KEY, JSON.stringify(custom));
    const session = { merchantId: id, email: newMerchant.email, name, business, plan, apiKey, loginAt: new Date().toISOString() };
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
    localStorage.setItem('payflow_api_key', apiKey);
    return { ok: true, merchant: session };
  },

  getSession() {
    try { return JSON.parse(localStorage.getItem(this.SESSION_KEY)); } catch { return null; }
  },

  isLoggedIn() { return !!this.getSession(); },

  logout() {
    localStorage.removeItem(this.SESSION_KEY);
    window.location.href = '/';
  },

  getPlan(planKey) { return PLANS[planKey] || PLANS.starter; },

  canAccess(feature, planKey) {
    // Use blacklist approach: blocked only if explicitly in 'locked' list
    // home, settings, and any other view are always accessible
    return !this.getPlan(planKey).locked.includes(feature);
  },

  upgradePlan(newPlan) {
    const session = this.getSession();
    if (!session) return;
    session.plan = newPlan;
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
    const custom = JSON.parse(localStorage.getItem(this.ACCOUNTS_KEY) || '[]');
    const idx = custom.findIndex(a => a.email === session.email);
    if (idx !== -1) { custom[idx].plan = newPlan; localStorage.setItem(this.ACCOUNTS_KEY, JSON.stringify(custom)); }
  },

  checkSubscription(session) {
    if (!session) return { status: 'EXPIRED', daysLeft: 0, isExpired: true, expiresAt: null };
    
    // If no expiration date exists yet, grant 30 days active trial
    if (!session.expiresAt) {
      session.expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
      session.planStatus = 'ACTIVE';
      session.billingCycle = session.billingCycle || 'monthly';
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
    }

    const now = Date.now();
    const expTime = new Date(session.expiresAt).getTime();
    const diffDays = Math.ceil((expTime - now) / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) {
      session.planStatus = 'EXPIRED';
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
      return { status: 'EXPIRED', daysLeft: 0, isExpired: true, expiresAt: session.expiresAt };
    }

    session.planStatus = 'ACTIVE';
    return { status: 'ACTIVE', daysLeft: diffDays, isExpired: false, expiresAt: session.expiresAt };
  },

  activatePaidPlan(planId, billingCycle = 'monthly', trxId = '', amount = 0) {
    const session = this.getSession();
    if (!session) return { ok: false, error: 'No active session' };

    const durationDays = billingCycle === 'yearly' ? 365 : 30;
    const now = new Date();
    const expiresAt = new Date(Date.now() + durationDays * 86400000).toISOString();

    session.plan = planId;
    session.planStatus = 'ACTIVE';
    session.billingCycle = billingCycle;
    session.planActivatedAt = now.toISOString();
    session.expiresAt = expiresAt;
    session.lastPaidAmount = amount;
    session.lastPaidTrx = trxId;

    localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));

    // Update in stored accounts list
    const custom = JSON.parse(localStorage.getItem(this.ACCOUNTS_KEY) || '[]');
    const idx = custom.findIndex(a => a.email === session.email);
    if (idx !== -1) {
      custom[idx].plan = planId;
      custom[idx].planStatus = 'ACTIVE';
      custom[idx].billingCycle = billingCycle;
      custom[idx].expiresAt = expiresAt;
      localStorage.setItem(this.ACCOUNTS_KEY, JSON.stringify(custom));
    }

    return { ok: true, session, expiresAt, durationDays };
  },

  simulateExpiry(daysLeft = 0) {
    const session = this.getSession();
    if (!session) return;
    session.expiresAt = new Date(Date.now() + daysLeft * 86400000).toISOString();
    session.planStatus = daysLeft <= 0 ? 'EXPIRED' : 'ACTIVE';
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
    return this.checkSubscription(session);
  },

  updateProfile({ name, business, email, phone, website }) {
    const session = this.getSession();
    if (!session) return { ok: false, error: 'No session' };
    if (name) session.name = name;
    if (business) session.business = business;
    if (email) session.email = email;
    if (phone) session.phone = phone;
    if (website) session.website = website;
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));

    const custom = JSON.parse(localStorage.getItem(this.ACCOUNTS_KEY) || '[]');
    const idx = custom.findIndex(a => a.id === session.merchantId || a.email === session.email);
    if (idx !== -1) {
      Object.assign(custom[idx], { name, business, email, phone, website });
      localStorage.setItem(this.ACCOUNTS_KEY, JSON.stringify(custom));
    }
    return { ok: true, merchant: session };
  },

  getAllPlans() { return PLANS; },
};
