enum SmsStatus {
  received,
  processing,
  processed,
  matched,
  forwarded,
  rejected,
  failed,
  retrying,
}

class SmsTransaction {
  final String id;
  final String provider; // bKash, Nagad, Rocket, Upay
  final String trxId;
  final double amount;
  final String sender;
  final String rawSms;
  final DateTime receivedAt;
  final SmsStatus status;
  final String? invoiceId;
  final int retryCount;
  final String? lastError;
  final String fingerprint;
  final int? simSlot;
  final String? carrier;
  final String? source;

  const SmsTransaction({
    required this.id,
    required this.provider,
    required this.trxId,
    required this.amount,
    required this.sender,
    required this.rawSms,
    required this.receivedAt,
    this.status = SmsStatus.received,
    this.invoiceId,
    this.retryCount = 0,
    this.lastError,
    required this.fingerprint,
    this.simSlot,
    this.carrier,
    this.source = 'SMS',
  });

  SmsTransaction copyWith({
    String? id,
    String? provider,
    String? trxId,
    double? amount,
    String? sender,
    String? rawSms,
    DateTime? receivedAt,
    SmsStatus? status,
    String? invoiceId,
    int? retryCount,
    String? lastError,
    String? fingerprint,
    int? simSlot,
    String? carrier,
    String? source,
  }) {
    return SmsTransaction(
      id: id ?? this.id,
      provider: provider ?? this.provider,
      trxId: trxId ?? this.trxId,
      amount: amount ?? this.amount,
      sender: sender ?? this.sender,
      rawSms: rawSms ?? this.rawSms,
      receivedAt: receivedAt ?? this.receivedAt,
      status: status ?? this.status,
      invoiceId: invoiceId ?? this.invoiceId,
      retryCount: retryCount ?? this.retryCount,
      lastError: lastError ?? this.lastError,
      fingerprint: fingerprint ?? this.fingerprint,
      simSlot: simSlot ?? this.simSlot,
      carrier: carrier ?? this.carrier,
      source: source ?? this.source,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'provider': provider,
      'trx_id': trxId,
      'amount': amount,
      'sender': sender,
      'raw_sms': rawSms,
      'received_at': receivedAt.toIso8601String(),
      'status': status.name,
      'invoice_id': invoiceId,
      'retry_count': retryCount,
      'last_error': lastError,
      'fingerprint': fingerprint,
      'sim_slot': simSlot,
      'carrier': carrier,
      'source': source,
    };
  }

  factory SmsTransaction.fromJson(Map<String, dynamic> json) {
    return SmsTransaction(
      id: json['id'] as String? ?? '',
      provider: json['provider'] as String? ?? 'UNKNOWN',
      trxId: json['trx_id'] as String? ?? '',
      amount: (json['amount'] as num?)?.toDouble() ?? 0.0,
      sender: json['sender'] as String? ?? '',
      rawSms: json['raw_sms'] as String? ?? '',
      receivedAt: DateTime.tryParse(json['received_at'] as String? ?? '') ?? DateTime.now(),
      status: SmsStatus.values.firstWhere(
        (e) => e.name == json['status'],
        orElse: () => SmsStatus.received,
      ),
      invoiceId: json['invoice_id'] as String?,
      retryCount: json['retry_count'] as int? ?? 0,
      lastError: json['last_error'] as String?,
      fingerprint: json['fingerprint'] as String? ?? '',
      simSlot: json['sim_slot'] as int?,
      carrier: json['carrier'] as String?,
      source: json['source'] as String? ?? 'SMS',
    );
  }
}
