<?php
/**
 * SyncPay BD - WHMCS Callback IPN Handler
 */

// Require WHMCS initialization
require_once __DIR__ . '/../../../init.php';
require_once __DIR__ . '/../../../includes/gatewayfunctions.php';
require_once __DIR__ . '/../../../includes/invoicefunctions.php';

$gatewayModuleName = 'syncpay';
$gatewayParams = getGatewayVariables($gatewayModuleName);

if (!$gatewayParams['type']) {
    die("Module Not Activated");
}

$raw_input = file_get_contents('php://input');
$data = json_decode($raw_input, true) ?: $_POST;

$invoiceId = $data['order_id'] ?? $data['invoice_id'] ?? null;
$trxId = $data['trx_id'] ?? null;
$amount = $data['amount'] ?? null;
$status = $data['status'] ?? null;

// Sanitize invoice ID if prefixed
$invoiceId = preg_replace('/[^0-9]/', '', $invoiceId);

$invoiceId = checkCbInvoiceID($invoiceId, $gatewayParams['name']);
checkCbTransID($trxId);

if ($status === 'PAID' || $status === 'COMPLETED' || $status === 'verified') {
    // Add transaction to invoice and mark as paid
    addInvoicePayment(
        $invoiceId,
        $trxId,
        $amount,
        0,
        $gatewayModuleName
    );

    logTransaction($gatewayParams['name'], $data, "Successful Payment");
    header("Content-Type: application/json");
    echo json_encode(array("status" => "success", "invoiceid" => $invoiceId));
    exit;
}

logTransaction($gatewayParams['name'], $data, "Payment Verification Pending or Failed");
header("HTTP/1.1 400 Bad Request");
echo json_encode(array("status" => "error", "message" => "Payment not confirmed"));
