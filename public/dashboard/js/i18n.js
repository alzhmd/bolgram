// SyncPay BD — Production Bilingual i18n Engine (BN / EN)

export const translations = {
  en: {
    // Sidebar
    'nav.dashboard': 'Dashboard',
    'nav.payments': 'Payments',
    'nav.transactions': 'Transactions',
    'nav.invoices': 'Invoices',
    'nav.paymentMethods': 'Payment Channels & Steps',
    'nav.payment_methods': 'Payment Channels & Steps',
    'nav.quickVerify': 'Quick TrxID Match',
    'nav.devices': 'Devices',
    'nav.smsLogs': 'Live SMS Logs',
    'nav.apiDevelopers': 'API & Developers',
    'nav.apiKeys': 'API Keys',
    'nav.webhooks': 'Webhooks',
    'nav.apiDocs': 'API Documentation',
    'nav.plugins': 'Plugins & SDKs',
    'nav.reports': 'Reports',
    'nav.settings': 'Settings',
    'nav.support': 'Support',
    'nav.profile': 'Merchant Profile',
    'nav.logout': 'Logout',
    'nav.sandboxMode': 'SANDBOX MODE',

    // Topbar
    'topbar.searchPlaceholder': 'Search TrxID, Invoice, Customer, Amount... (Cmd + K)',
    'topbar.notifications': 'Notifications',
    'topbar.unread': 'unread',
    'topbar.markAllRead': 'Mark all as read',
    'topbar.noNotifications': 'No new notifications',

    // Dashboard Home
    'home.greeting': 'Good morning',
    'home.subtitle': "Here's what's happening with your payments today.",
    'home.filter.today': 'Today',
    'home.filter.7d': '7 Days',
    'home.filter.30d': '30 Days',
    'home.filter.90d': '90 Days',
    'home.kpi.totalRevenue': 'Total Revenue',
    'home.kpi.successful': 'Successful Payments',
    'home.kpi.pending': 'Pending Payments',
    'home.kpi.failed': 'Failed Payments',
    'home.kpi.vsPrevious': 'vs previous period',
    'home.chart.revenueOverview': 'Revenue Overview',
    'home.chart.filterRevenue': 'Revenue',
    'home.chart.filterTransactions': 'Transactions',
    'home.chart.filterSuccessful': 'Successful',
    'home.chart.filterFailed': 'Failed',
    'home.paymentMethods': 'Payment Methods Breakdown',
    'home.recentTransactions': 'Recent Transactions',
    'home.viewAll': 'View All',

    // Common Table & Badges
    'table.trxId': 'Transaction ID',
    'table.invoice': 'Invoice',
    'table.customer': 'Customer',
    'table.method': 'Method',
    'table.amount': 'Amount',
    'table.status': 'Status',
    'table.date': 'Date',
    'table.actions': 'Actions',
    'table.colTrxId': 'Transaction ID',
    'table.colTxnId': 'Transaction ID',
    'table.colInvoice': 'Invoice',
    'table.colCustomer': 'Customer',
    'table.colMethod': 'Method',
    'table.colAmount': 'Amount',
    'table.colStatus': 'Status',
    'table.colDate': 'Date',
    'table.colActions': 'Actions',
    'table.viewDetails': 'View Details',
    'table.noRecords': 'No transactions found',
    'table.emptyDesc': 'Your incoming payments will appear here in real-time as customers send money.',

    // Statuses
    'status.COMPLETED': 'COMPLETED',
    'status.PAID': 'COMPLETED',
    'status.PENDING': 'PENDING',
    'status.FAILED': 'FAILED',
    'status.EXPIRED': 'EXPIRED',
    'status.ONLINE': 'ONLINE',
    'status.OFFLINE': 'OFFLINE',

    // Invoices Page
    'invoices.title': 'Payment Invoices',
    'invoices.subtitle': 'Manage hosted checkout links and tracked customer payments.',
    'invoices.createBtn': '+ Create Invoice',
    'invoices.filter.all': 'All',
    'invoices.filter.pending': 'Pending',
    'invoices.filter.completed': 'Completed',
    'invoices.filter.expired': 'Expired',
    'invoices.paymentLink': 'Payment Link',
    'invoices.modal.title': 'Create Payment Invoice',
    'invoices.modal.cusName': 'Customer Name',
    'invoices.modal.cusEmail': 'Customer Email',
    'invoices.modal.amount': 'Amount (BDT)',
    'invoices.modal.redirect': 'Success Redirect URL',
    'invoices.modal.webhook': 'Webhook Callback URL',
    'invoices.modal.submit': 'Generate Invoice Link',
    'invoices.modal.success': 'Invoice Created Successfully!',
    'invoices.modal.copyLink': 'Copy Link',
    'invoices.modal.openCheckout': 'Open Checkout',

    // Devices Page
    'devices.title': 'Connected Devices',
    'devices.subtitle': 'Monitor Android telephony SMS forwarder status and signal heartbeat.',
    'devices.addBtn': '+ Add Forwarder Device',
    'devices.provider': 'Provider Channels',
    'devices.lastSeen': 'Last Seen',
    'devices.smsProcessed': 'SMS Ingested',
    'devices.modal.title': 'Add Android Forwarder',
    'devices.modal.name': 'Device Label / Model',
    'devices.modal.sim': 'SIM Phone Number (bKash/Nagad)',
    'devices.modal.submit': 'Generate Pairing Token',
    'devices.modal.tokenNotice': 'Enter this token in your SyncPay Android APK daemon to connect.',

    // API Keys Page
    'apiKeys.title': 'API Authentication Keys',
    'apiKeys.subtitle': 'Manage cryptographic keys used to sign backend REST API requests.',
    'apiKeys.createBtn': '+ Create API Key',
    'apiKeys.name': 'Key Description',
    'apiKeys.key': 'Secret Key',
    'apiKeys.created': 'Created',
    'apiKeys.lastUsed': 'Last Used',
    'apiKeys.env': 'Environment',
    'apiKeys.reveal': 'Reveal',
    'apiKeys.hide': 'Hide',
    'apiKeys.revoke': 'Revoke',
    'apiKeys.modal.title': 'Generate New API Key',
    'apiKeys.modal.env': 'Target Environment',
    'apiKeys.modal.name': 'Key Identifier Name',
    'apiKeys.modal.submit': 'Generate Key',
    'apiKeys.modal.warning': 'Save this secret key now. For your security, you will not be able to view the full secret again.',

    // Webhooks Page
    'webhooks.title': 'Webhooks & Endpoints',
    'webhooks.subtitle': 'Real-time HTTP push notifications sent to your server on payment events.',
    'webhooks.url': 'Webhook Endpoint URL',
    'webhooks.secret': 'Signing Secret (HMAC SHA-256)',
    'webhooks.testBtn': 'Send Test Webhook',
    'webhooks.logsTitle': 'Recent Delivery Log',
    'webhooks.event': 'Event',
    'webhooks.httpStatus': 'HTTP Status',
    'webhooks.latency': 'Latency',

    // API Docs Page
    'docs.title': 'Developer API Reference',
    'docs.subtitle': 'Comprehensive integration guide for REST endpoints and signed webhooks.',
    'docs.tab.quickstart': 'Quickstart',
    'docs.tab.createPayment': 'Create Payment',
    'docs.tab.verifyPayment': 'Verify Payment',
    'docs.tab.webhooks': 'Webhooks',
    'docs.tab.errors': 'Error Codes',

    // Reports Page
    'reports.title': 'Financial & Operational Reports',
    'reports.subtitle': 'Export audit-ready payment transaction ledgers and device metrics.',
    'reports.exportCsv': 'Export CSV',
    'reports.exportExcel': 'Export Excel',
    'reports.exportPdf': 'Export PDF',

    // Settings Page
    'settings.title': 'Merchant Settings',
    'settings.subtitle': 'Configure business profile, payment rules, and security preferences.',
    'settings.businessName': 'Business Name',
    'settings.hotline': 'Support Hotline',
    'settings.theme': 'Theme Appearance',
    'settings.language': 'Dashboard Language',
    'settings.saveBtn': 'Save Changes',

    // Drawer Details
    'drawer.trxDetails': 'Transaction Details',
    'drawer.sender': 'Sender Number',
    'drawer.device': 'Ingestion Device',
    'drawer.verifiedAt': 'Verification Timestamp',
    'drawer.rawSms': 'Raw Ingested SMS',

    // Toasts
    'toast.copied': 'Copied to clipboard!',
    'toast.saved': 'Settings saved successfully.',
    'toast.keyCreated': 'New API Key generated successfully.',
    'toast.deviceAdded': 'Device forwarder registered.',
    'toast.webhookSent': 'Test webhook sent successfully.',
    'toast.error': 'An unexpected error occurred. Please try again.',
  },

  bn: {
    // Sidebar
    'nav.dashboard': 'ড্যাশবোর্ড',
    'nav.payments': 'পেমেন্ট ও আয়',
    'nav.transactions': 'লেনদেনসমূহ',
    'nav.invoices': 'ইনভয়েস',
    'nav.paymentMethods': 'পেমেন্ট চ্যানেল ও নির্দেশিকা',
    'nav.payment_methods': 'পেমেন্ট চ্যানেল ও নির্দেশিকা',
    'nav.quickVerify': 'কুইক TrxID ম্যাচ',
    'nav.devices': 'ডিভাইস ও সিম',
    'nav.smsLogs': 'লাইভ SMS লগ',
    'nav.apiDevelopers': 'API ও ডেভেলপার্স',
    'nav.apiKeys': 'API Keys',
    'nav.webhooks': 'ওয়েবহুক',
    'nav.apiDocs': 'API ডকস',
    'nav.plugins': 'প্লাগইন ও SDKs',
    'nav.reports': 'রিপোর্টস ও অডিট',
    'nav.settings': 'সেটিংস',
    'nav.support': 'সাপোর্ট',
    'nav.profile': 'মার্চেন্ট প্রোফাইল',
    'nav.logout': 'লগআউট',
    'nav.sandboxMode': 'স্যান্ডবক্স মোড',

    // Topbar
    'topbar.searchPlaceholder': 'TrxID, ইনভয়েস, কাস্টমার বা অ্যামাউন্ট খুঁজুন... (Cmd + K)',
    'topbar.notifications': 'নোটিফিকেশনস',
    'topbar.unread': 'অপঠিত',
    'topbar.markAllRead': 'সবগুলো পঠিত মার্ক করুন',
    'topbar.noNotifications': 'নতুন কোনো নোটিফিকেশন নেই',

    // Dashboard Home
    'home.greeting': 'শুভ সকাল',
    'home.subtitle': 'আজকের পেমেন্ট ও লেনদেনের সার্বিক পরিস্থিতি নিচে দেখুন।',
    'home.filter.today': 'আজ',
    'home.filter.7d': '৭ দিন',
    'home.filter.30d': '৩০ দিন',
    'home.filter.90d': '৯০ দিন',
    'home.kpi.totalRevenue': 'মোট আদায়কৃত রেভিনিউ',
    'home.kpi.successful': 'সফল লেনদেন',
    'home.kpi.pending': 'পেন্ডিং ভেরিফিকেশন',
    'home.kpi.failed': 'ব্যর্থ পেমেন্ট',
    'home.kpi.vsPrevious': 'পূর্বের সময়ের তুলনায়',
    'home.chart.revenueOverview': 'রেভিনিউ ওভারভিউ',
    'home.chart.filterRevenue': 'রেভিনিউ',
    'home.chart.filterTransactions': 'মোট লেনদেন',
    'home.chart.filterSuccessful': 'সফল',
    'home.chart.filterFailed': 'ব্যর্থ',
    'home.paymentMethods': 'পেমেন্ট মেথড বিভাজন',
    'home.recentTransactions': 'সাম্প্রতিক লেনদেনসমূহ',
    'home.viewAll': 'সবগুলো দেখুন',

    // Common Table & Badges
    'table.trxId': 'ট্রানজ্যাকশন আইডি',
    'table.invoice': 'ইনভয়েস',
    'table.customer': 'গ্রাহক',
    'table.method': 'মেথড',
    'table.amount': 'পরিমাণ',
    'table.status': 'স্ট্যাটাস',
    'table.date': 'তারিখ',
    'table.actions': 'অ্যাকশন',
    'table.colTrxId': 'ট্রানজ্যাকশন আইডি',
    'table.colTxnId': 'ট্রানজ্যাকশন আইডি',
    'table.colInvoice': 'ইনভয়েস',
    'table.colCustomer': 'গ্রাহক',
    'table.colMethod': 'মেথড',
    'table.colAmount': 'পরিমাণ',
    'table.colStatus': 'স্ট্যাটাস',
    'table.colDate': 'তারিখ',
    'table.colActions': 'অ্যাকশন',
    'table.viewDetails': 'বিস্তারিত দেখুন',
    'table.noRecords': 'কোনো লেনদেনের রেকর্ড পাওয়া যায়নি',
    'table.emptyDesc': 'গ্রাহক টাকা পাঠানোর সাথে সাথে রিয়েল-টাইমে এখানে লেনদেন যুক্ত হবে।',

    // Statuses
    'status.COMPLETED': 'সফল',
    'status.PAID': 'পরিশোধিত',
    'status.PENDING': 'অপেক্ষমান',
    'status.FAILED': 'ব্যর্থ',
    'status.EXPIRED': 'মেয়াদোত্তীর্ণ',
    'status.ONLINE': 'অনলাইন',
    'status.OFFLINE': 'অফলাইন',

    // Invoices Page
    'invoices.title': 'পেমেন্ট ইনভয়েস',
    'invoices.subtitle': 'হোস্টেড পেমেন্ট লিংক তৈরি ও গ্রাহকের অর্ডার ট্র্যাকিং।',
    'invoices.createBtn': '+ নতুন ইনভয়েস তৈরি',
    'invoices.filter.all': 'সকল',
    'invoices.filter.pending': 'পেন্ডিং',
    'invoices.filter.completed': 'সম্পন্ন',
    'invoices.filter.expired': 'বাতিল',
    'invoices.paymentLink': 'পেমেন্ট লিঙ্ক',
    'invoices.modal.title': 'নতুন পেমেন্ট ইনভয়েস তৈরি',
    'invoices.modal.cusName': 'গ্রাহকের নাম',
    'invoices.modal.cusEmail': 'গ্রাহকের ইমেইল',
    'invoices.modal.amount': 'টাকার পরিমাণ (BDT)',
    'invoices.modal.redirect': 'পেমেন্ট পরবর্তী রিডাইরেক্ট URL',
    'invoices.modal.webhook': 'ওয়েবহুক নোটিফিকেশন URL',
    'invoices.modal.submit': 'ইনভয়েস তৈরি করুন',
    'invoices.modal.success': 'ইনভয়েস সফলভাবে তৈরি হয়েছে!',
    'invoices.modal.copyLink': 'লিঙ্ক কপি',
    'invoices.modal.openCheckout': 'চেকআউট পেজ খুলুন',

    // Devices Page
    'devices.title': 'সংযুক্ত ফরওয়ার্ডার ডিভাইস',
    'devices.subtitle': 'অ্যান্ড্রয়েড টেলিফোনি SMS ফরওয়ার্ডার ও সিম কার্ডের লাইভ স্ট্যাটাস।',
    'devices.addBtn': '+ নতুন ডিভাইস যুক্ত করুন',
    'devices.provider': 'সাপোর্টেড MFS চ্যানেল',
    'devices.lastSeen': 'সর্বশেষ সিগন্যাল',
    'devices.smsProcessed': 'প্রসেসকৃত SMS',
    'devices.modal.title': 'নতুন অ্যান্ড্রয়েড ফরওয়ার্ডার কানেক্ট',
    'devices.modal.name': 'ডিভাইসের নাম / মডেল',
    'devices.modal.sim': 'সিম ফোন নাম্বার (bKash/Nagad)',
    'devices.modal.submit': 'পেয়ারিং টোকেন তৈরি করুন',
    'devices.modal.tokenNotice': 'এই টোকেনটি আপনার ফোনের SyncPay Android অ্যাপে ইনপুট দিয়ে কানেক্ট করুন।',

    // API Keys Page
    'apiKeys.title': 'API অথেনটিকেশন চাবি',
    'apiKeys.subtitle': 'সার্ভার থেকে নিরাপদে REST API কল করার সিক্রেট চাবি ব্যবস্থাপনা।',
    'apiKeys.createBtn': '+ নতুন API Key',
    'apiKeys.name': 'চাবির বিবরণ / নাম',
    'apiKeys.key': 'সিক্রেট কী',
    'apiKeys.created': 'তৈরির তারিখ',
    'apiKeys.lastUsed': 'সর্বশেষ ব্যবহার',
    'apiKeys.env': 'পরিবেশ',
    'apiKeys.reveal': 'দেখুন',
    'apiKeys.hide': 'লুকান',
    'apiKeys.revoke': 'বাতিল করুন',
    'apiKeys.modal.title': 'নতুন API Key জেনারেট',
    'apiKeys.modal.env': 'টার্গেট পরিবেশ',
    'apiKeys.modal.name': 'কী আইডেন্টিফায়ার নাম',
    'apiKeys.modal.submit': 'কী তৈরি করুন',
    'apiKeys.modal.warning': 'এই সিক্রেট কী-টি এখনই কপি করে সংরক্ষণ করুন। নিরাপত্তার স্বার্থে সম্পূর্ণ কী-টি পুনরায় দেখানো হবে না।',

    // Webhooks Page
    'webhooks.title': 'ওয়েবহুক ও এন্ডপয়েন্ট',
    'webhooks.subtitle': 'টাকা আসার সাথে সাথে আপনার সার্ভারে তাৎক্ষণিক নোটিফিকেশন পাঠানোর ব্যবস্থা।',
    'webhooks.url': 'ওয়েবহুক এন্ডপয়েন্ট URL',
    'webhooks.secret': 'সাইনিং সিক্রেট (HMAC SHA-256)',
    'webhooks.testBtn': 'টেস্ট ওয়েবহুক পাঠান',
    'webhooks.logsTitle': 'সাম্প্রতিক ডেলিভারি হিস্টোরি',
    'webhooks.event': 'ইভেন্ট',
    'webhooks.httpStatus': 'HTTP স্ট্যাটাস',
    'webhooks.latency': 'রেসপন্স সময়',

    // API Docs Page
    'docs.title': 'ডেভেলপার API রেফারেন্স',
    'docs.subtitle': 'সহজেই আপনার ওয়েবসাইটে পেমেন্ট যুক্ত করার সম্পূর্ণ ইন্টিগ্রেশন গাইড।',
    'docs.tab.quickstart': 'শুরুর গাইড',
    'docs.tab.createPayment': 'পেমেন্ট তৈরি',
    'docs.tab.verifyPayment': 'পেমেন্ট ভেরিফাই',
    'docs.tab.webhooks': 'ওয়েবহুক',
    'docs.tab.errors': 'এরর কোড',

    // Reports Page
    'reports.title': 'আর্থিক ও অপারেশনাল রিপোর্ট',
    'reports.subtitle': 'অডিট ও হিসাবের জন্য সকল লেনদেনের সম্পূর্ণ লেজার ডাউনলোড করুন।',
    'reports.exportCsv': 'CSV ডাউনলোড',
    'reports.exportExcel': 'Excel ডাউনলোড',
    'reports.exportPdf': 'PDF ডাউনলোড',

    // Settings Page
    'settings.title': 'মার্চেন্ট অ্যাকাউন্ট সেটিংস',
    'settings.subtitle': 'আপনার বিজনেস প্রোফাইল, MFS নাম্বার ও সিকিউরিটি কনফিগারেশন।',
    'settings.businessName': 'ব্যবসার নাম',
    'settings.hotline': 'সাপোর্ট হটলাইন',
    'settings.theme': 'থিম অ্যাপিয়ারেন্স',
    'settings.language': 'ড্যাশবোর্ড ভাষা',
    'settings.saveBtn': 'পরিবর্তন সংরক্ষণ করুন',

    // Drawer Details
    'drawer.trxDetails': 'লেনদেনের বিস্তারিত তথ্য',
    'drawer.sender': 'প্রেরকের ফোন নাম্বার',
    'drawer.device': 'রিসিভকৃত ডিভাইস',
    'drawer.verifiedAt': 'ভেরিফিকেশনের সময়',
    'drawer.rawSms': 'মূল টেলিফোনি SMS',

    // Toasts
    'toast.copied': 'ক্লিপবোর্ডে কপি হয়েছে!',
    'toast.saved': 'সেটিংস সফলভাবে সংরক্ষিত হয়েছে।',
    'toast.keyCreated': 'নতুন API Key সফলভাবে তৈরি হয়েছে।',
    'toast.deviceAdded': 'নতুন ফরওয়ার্ডার ডিভাইস নিবন্ধিত হয়েছে।',
    'toast.webhookSent': 'টেস্ট ওয়েবহুক সফলভাবে পাঠানো হয়েছে।',
    'toast.error': 'একটি অপ্রত্যাশিত সমস্যা হয়েছে। পুনরায় চেষ্টা করুন।',
  }
};

class I18nService {
  constructor() {
    this.currentLang = localStorage.getItem('syncpay_lang') || localStorage.getItem('payflow_lang') || 'en';
  }

  get lang() {
    return this.currentLang;
  }

  setLang(newLang) {
    this.setLanguage(newLang);
  }

  setLanguage(newLang) {
    if (newLang === 'bn' || newLang === 'en') {
      this.currentLang = newLang;
      localStorage.setItem('syncpay_lang', newLang);
      localStorage.setItem('payflow_lang', newLang);
      document.documentElement.lang = newLang;
      this.applyTranslations();
    }
  }

  t(key, fallback = '') {
    const dict = translations[this.currentLang] || translations.en;
    return dict[key] || fallback || key;
  }

  applyTranslations() {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
      const key = el.getAttribute('data-i18n');
      const text = this.t(key);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = text;
      } else {
        el.innerText = text;
      }
    });

    const placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    placeholders.forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.placeholder = this.t(key);
    });

    // Update active lang toggle in UI
    const langBtn = document.getElementById('btn-lang-toggle');
    if (langBtn) {
      langBtn.innerText = this.currentLang === 'bn' ? 'বাংলা (BN)' : 'English (EN)';
    }
  }
}

export const i18n = new I18nService();
