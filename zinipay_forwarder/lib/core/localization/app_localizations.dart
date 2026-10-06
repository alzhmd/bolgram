class AppLocalizations {
  final String languageCode;

  AppLocalizations(this.languageCode);

  static final Map<String, Map<String, String>> _localizedValues = {
    'en': {
      'app_name': 'SyncPay Agent',
      'app_tagline': 'Secure Payment Forwarder',
      'status_online': 'ONLINE',
      'status_offline': 'OFFLINE',
      'status_not_ready': 'NOT READY',
      'status_connected': 'Connected',
      'status_disconnected': 'Disconnected',
      'last_synced': 'Last Synced',
      'just_now': 'Just now',
      'backend': 'Backend',
      'latency': 'Latency',
      'reconnect': 'Reconnect',
      'disconnect': 'Disconnect Device',
      'disconnect_confirm_title': 'Disconnect this device?',
      'disconnect_confirm_desc': 'SMS forwarding will stop and local queue will be cleared.',
      'cancel': 'Cancel',

      // KPIs
      'sms_received': 'SMS Received',
      'processed': 'Processed',
      'matched_payments': 'Matched Payments',
      'rejected': 'Rejected',
      'today_payment_volume': "Today's Payment Volume",

      // Permissions
      'required_permissions': 'Required Permissions',
      'sms_access': 'SMS Access',
      'notifications': 'Notifications',
      'background_activity': 'Background Activity',
      'battery_optimization': 'Battery Optimization',
      'granted': 'Granted ✓',
      'required': 'Required',
      'needs_setup': 'Needs Setup',
      'grant_permissions': 'Grant Permissions',
      'permission_desc': 'All permissions are required for autonomous SMS forwarding in the background.',

      // Device Setup & Pairing
      'connect_your_device': 'Connect Your Device',
      'connect_device_desc': 'Connect this Android device to your SyncPay merchant account.',
      'device_id': 'Device ID',
      'merchant_id': 'Merchant ID',
      'pairing_token': 'Pairing Token',
      'backend_url': 'Backend URL',
      'scan_qr_code': 'Scan QR Code',
      'enter_pairing_code': 'Enter Pairing Code',
      'connect_device_btn': 'Connect Device',
      'device_connected_success': 'Device Connected Successfully',

      // Navigation
      'nav_home': 'Home',
      'nav_activity': 'Activity',
      'nav_connection': 'Connection',
      'nav_settings': 'Settings',

      // SMS Status & Activity
      'sms_activity': 'SMS Activity',
      'no_sms_title': 'No payment SMS yet',
      'no_sms_desc': 'Incoming supported MFS payment messages will appear here.',
      'status_received': 'RECEIVED',
      'status_processing': 'PROCESSING',
      'status_processed': 'PROCESSED',
      'status_matched': 'MATCHED',
      'status_rejected': 'REJECTED',
      'status_failed': 'FAILED',
      'status_retrying': 'RETRYING',

      // SMS Details Dialog
      'sms_details': 'SMS Details',
      'provider': 'Provider',
      'type': 'Type',
      'amount': 'Amount',
      'transaction_id': 'Transaction ID',
      'sender': 'Sender',
      'received_time': 'Received Time',
      'server_status': 'Server Status',
      'invoice': 'Invoice',
      'raw_sms_preview': 'Raw SMS (Sanitized)',
      'close': 'Close',

      // Queue & Sync
      'pending_uploads': 'Pending Uploads',
      'sync_now': 'Sync Now',
      'waiting_to_sync': 'SMS waiting to sync',
      'auto_sync': 'Auto Sync',
      'retry_failed': 'Retry Failed Uploads',

      // Background Service
      'background_service': 'Background Service',
      'service_running': 'Running',
      'service_stopped': 'Stopped',
      'start_service': 'Start Service',
      'stop_service': 'Stop Service',
      'battery_settings_btn': 'Open Battery Settings',
      'battery_guidance': 'For reliable SMS processing, allow SyncPay Agent to run unrestricted in the background.',

      // Connection & Device Info
      'connected_merchant': 'Connected Merchant',
      'business_name': 'Business Name',
      'device_information': 'Device Information',
      'device_name': 'Device Name',
      'android_version': 'Android Version',
      'app_version': 'App Version',
      'mfs_providers': 'MFS Providers',

      // Settings
      'language': 'Language',
      'theme': 'Theme',
      'theme_dark': 'Dark',
      'theme_light': 'Light',
      'theme_system': 'System Default',
      'activity_logs': 'Activity Logs',
      'clear_logs': 'Clear Logs',
      'security': 'Security',
      'about': 'About',

      // Simulator
      'simulate_sms': 'Simulate Incoming SMS',
      'simulate_desc': 'Test MFS detection without physical SIM',
    },
    'bn': {
      'app_name': 'সিঙ্কপে এজেন্ট',
      'app_tagline': 'সিকিউর পেমেন্ট ফরোয়ার্ডার',
      'status_online': 'অনলাইন',
      'status_offline': 'অফলাইন',
      'status_not_ready': 'প্রস্তুত নয়',
      'status_connected': 'সংযুক্ত',
      'status_disconnected': 'সংযোগ বিচ্ছিন্ন',
      'last_synced': 'সর্বশেষ সিঙ্ক',
      'just_now': 'এইমাত্র',
      'backend': 'ব্যাকএন্ড',
      'latency': 'লেটেন্সি',
      'reconnect': 'পুনরায় সংযোগ করুন',
      'disconnect': 'ডিভাইস সংযোগ বিচ্ছিন্ন করুন',
      'disconnect_confirm_title': 'এই ডিভাইসটি বিচ্ছিন্ন করবেন?',
      'disconnect_confirm_desc': 'এসএমএস ফরোয়ার্ডিং বন্ধ হবে এবং স্থানীয় কিউ মুছে যাবে।',
      'cancel': 'বাতিল',

      // KPIs
      'sms_received': 'এসএমএস প্রাপ্ত',
      'processed': 'প্রসেস হয়েছে',
      'matched_payments': 'ম্যাচড পেমেন্ট',
      'rejected': 'বাতিল',
      'today_payment_volume': 'আজকের পেমেন্ট ভলিউম',

      // Permissions
      'required_permissions': 'প্রয়োজনীয় পারমিশনসমূহ',
      'sms_access': 'এসএমএস অ্যাক্সেস',
      'notifications': 'নোটিফিকেশনস',
      'background_activity': 'ব্যাকগ্রাউন্ড অ্যাক্টিভিটি',
      'battery_optimization': 'ব্যাটারি অপ্টিমাইজেশন',
      'granted': 'অনুমোদিত ✓',
      'required': 'প্রয়োজন',
      'needs_setup': 'সেটআপ প্রয়োজন',
      'grant_permissions': 'পারমিশন দিন',
      'permission_desc': 'ব্যাকগ্রাউন্ডে স্বয়ংক্রিয়ভাবে এসএমএস পাঠানোর জন্য সব পারমিশন আবশ্যক।',

      // Device Setup & Pairing
      'connect_your_device': 'ডিভাইস সংযুক্ত করুন',
      'connect_device_desc': 'আপনার SyncPay মার্চেন্ট অ্যাকাউন্টের সাথে এই ডিভাইসটি সংযুক্ত করুন।',
      'device_id': 'ডিভাইস আইডি',
      'merchant_id': 'মার্চেন্ট আইডি',
      'pairing_token': 'পেয়ারিং টোকেন',
      'backend_url': 'ব্যাকএন্ড ইউআরএল',
      'scan_qr_code': 'QR কোড স্ক্যান করুন',
      'enter_pairing_code': 'পেয়ারিং কোড লিখুন',
      'connect_device_btn': 'ডিভাইস যুক্ত করুন',
      'device_connected_success': 'ডিভাইস সফলভাবে সংযুক্ত হয়েছে',

      // Navigation
      'nav_home': 'হোম',
      'nav_activity': 'অ্যাক্টিভিটি',
      'nav_connection': 'সংযোগ',
      'nav_settings': 'সেটিংস',

      // SMS Status & Activity
      'sms_activity': 'এসএমএস মনিটরিং',
      'no_sms_title': 'এখনও কোনো পেমেন্ট এসএমএস পাওয়া যায়নি',
      'no_sms_desc': 'সমর্থিত এমএফএস পেমেন্ট এসএমএস এলে এখানে দেখতে পাবেন।',
      'status_received': 'প্রাপ্ত',
      'status_processing': 'প্রসেসিং',
      'status_processed': 'প্রসেসড',
      'status_matched': 'ম্যাচড',
      'status_rejected': 'বাতিল',
      'status_failed': 'ব্যর্থ',
      'status_retrying': 'পুনরায় চেষ্টা চলছে',

      // SMS Details Dialog
      'sms_details': 'এসএমএস বিস্তারিত',
      'provider': 'প্রোভাইডার',
      'type': 'ধরন',
      'amount': 'টাকার পরিমাণ',
      'transaction_id': 'ট্রানজেকশন আইডি',
      'sender': 'প্রেরক',
      'received_time': 'গ্রহণের সময়',
      'server_status': 'সার্ভার স্ট্যাটাস',
      'invoice': 'ইনভয়েস',
      'raw_sms_preview': 'র’ এসএমএস (সুরক্ষিত)',
      'close': 'বন্ধ করুন',

      // Queue & Sync
      'pending_uploads': 'পেন্ডিং আপলোড',
      'sync_now': 'এখনই সিঙ্ক করুন',
      'waiting_to_sync': 'টি এসএমএস সিঙ্কের অপেক্ষায়',
      'auto_sync': 'স্বয়ংক্রিয় সিঙ্ক',
      'retry_failed': 'ব্যর্থ আপলোড পুনরায় চেষ্টা',

      // Background Service
      'background_service': 'ব্যাকগ্রাউন্ড সার্ভিস',
      'service_running': 'চলমান',
      'service_stopped': 'বন্ধ',
      'start_service': 'সার্ভিস চালু করুন',
      'stop_service': 'সার্ভিস বন্ধ করুন',
      'battery_settings_btn': 'ব্যাটারি সেটিংস ওপেন করুন',
      'battery_guidance': 'নির্ভরযোগ্য এসএমএস প্রসেসিং নিশ্চিত করতে SyncPay এজেন্টকে ব্যাকগ্রাউন্ডে আনরেস্ট্রিক্টেড চলতে দিন।',

      // Connection & Device Info
      'connected_merchant': 'সংযুক্ত মার্চেন্ট',
      'business_name': 'ব্যবসার নাম',
      'device_information': 'ডিভাইস তথ্য',
      'device_name': 'ডিভাইসের নাম',
      'android_version': 'অ্যান্ড্রয়েড ভার্সন',
      'app_version': 'অ্যাপ ভার্সন',
      'mfs_providers': 'এমএফএস প্রোভাইডার',

      // Settings
      'language': 'ভাষা (Language)',
      'theme': 'থিম',
      'theme_dark': 'ডার্ক মোড',
      'theme_light': 'লাইট মোড',
      'theme_system': 'সিস্টেম ডিফল্ট',
      'activity_logs': 'অ্যাক্টিভিটি লগ',
      'clear_logs': 'লগ পরিষ্কার করুন',
      'security': 'নিরাপত্তা',
      'about': 'সম্পর্কে',

      // Simulator
      'simulate_sms': 'এসএমএস টেস্ট সিমুলেটর',
      'simulate_desc': 'সিম কার্ড ছাড়াই এমএফএস এসএমএস টেস্ট করুন',
    },
  };

  String tr(String key) {
    return _localizedValues[languageCode]?[key] ?? _localizedValues['en']?[key] ?? key;
  }
}
