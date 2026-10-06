<?php
/**
 * SyncPay BD - WHMCS Payment Gateway Module
 *
 * @copyright 2026 SyncPay BD
 * @version 1.8.0
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

function syncpay_MetaData()
{
    return array(
        'DisplayName' => 'SyncPay BD (bKash, Nagad & Rocket)',
        'APIVersion' => '1.1',
        'DisableLocalCreditCardInput' => true,
        'TokenisedStorage' => false,
    );
}

function syncpay_config()
{
    return array(
        'FriendlyName' => array(
            'Type' => 'System',
            'Value' => 'SyncPay BD (bKash / Nagad / Rocket)',
        ),
        'apiUrl' => array(
            'FriendlyName' => 'SyncPay Server Endpoint URL',
            'Type' => 'text',
            'Size' => '50',
            'Default' => 'http://localhost:4000',
            'Description' => 'Base URL of your SyncPay instance (e.g. http://localhost:4000)',
        ),
        'apiKey' => array(
            'FriendlyName' => 'Merchant API Key',
            'Type' => 'password',
            'Size' => '50',
            'Default' => '',
            'Description' => 'Your SyncPay Secret API Key from the merchant dashboard',
        ),
        'instructions' => array(
            'FriendlyName' => 'Customer Instructions',
            'Type' => 'textarea',
            'Rows' => '3',
            'Cols' => '60',
            'Default' => 'Click the button below to pay via bKash, Nagad or Rocket automatically.',
            'Description' => 'Message shown to clients on the unpaid invoice page.',
        ),
    );
}

function syncpay_link($params)
{
    $invoiceId = $params['invoiceid'];
    $amount = $params['amount'];
    $currencyCode = $params['currency'];
    $apiUrl = rtrim($params['apiUrl'], '/');
    $apiKey = $params['apiKey'];
    $systemUrl = $params['systemurl'];

    // Client details
    $firstname = $params['clientdetails']['firstname'];
    $lastname = $params['clientdetails']['lastname'];
    $email = $params['clientdetails']['email'];
    $phone = $params['clientdetails']['phonenumber'];

    $callbackUrl = $systemUrl . 'modules/gateways/callback/syncpay.php';
    $returnUrl = $params['returnurl'];

    // Hosted checkout button
    $checkoutUrl = $apiUrl . '/checkout.html?invoice_id=WHMCS_' . $invoiceId . '&amount=' . $amount . '&order_id=' . $invoiceId . '&callback_url=' . urlencode($callbackUrl) . '&return_url=' . urlencode($returnUrl);

    $html = '<form method="GET" action="' . htmlspecialchars($checkoutUrl) . '">';
    $html .= '<p>' . nl2br(htmlspecialchars($params['instructions'])) . '</p>';
    $html .= '<input type="submit" value="Pay Now with bKash / Nagad / Rocket" class="btn btn-primary" style="background:#0284c7; border:none; padding:10px 24px; font-weight:bold; color:#fff; border-radius:6px; cursor:pointer;" />';
    $html .= '</form>';

    return $html;
}
