<?php
require_once __DIR__ . '/SyncPayClient.php';

use SyncPay\SyncPayClient;

$client = new SyncPayClient('YOUR_MERCHANT_API_KEY', 'http://localhost:4000');

try {
    // 1. Create a payment invoice
    $invoice = $client->createInvoice([
        'amount' => 1500,
        'order_id' => 'ORD-' . time(),
        'customer_name' => 'Customer Name',
        'customer_phone' => '01712345678',
        'callback_url' => 'https://yoursite.com/webhook',
    ]);

    echo "Payment URL: " . $invoice['data']['payment_url'] . "\n";

    // 2. Verify payment by TrxID
    $verify = $client->verifyTransaction('BL78A4982J');
    print_r($verify);

} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
