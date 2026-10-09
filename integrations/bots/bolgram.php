<?php
/**
 * Bolgram client for PHP bots (PHP 7.4+, ext-curl).
 *
 *   require 'bolgram.php';
 *   $bg = new Bolgram('https://pay.bolgram.ir', 'live_sk_...');   // panel → «افزونه‌ها و API»
 *   $inv = $bg->createInvoice(150000, 'u123-vpn-30d', '@ali');      // Toman
 *   // send $inv['payment_url'] to the user; payable amount = $inv['amount_toman']
 *   if ($bg->isPaid($inv['invoice_id'])) { deliver(); }
 *   // webhook: Bolgram::verifyWebhook(file_get_contents('php://input'), $_SERVER['HTTP_X_BOLGRAM_SIGNATURE'], $secret)
 */
class Bolgram
{
    private $base;
    private $key;

    public function __construct(string $baseUrl, string $apiKey)
    {
        $this->base = rtrim($baseUrl, '/');
        $this->key = $apiKey;
    }

    private function post(string $path, array $body): array
    {
        $ch = curl_init($this->base . $path);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-api-key: ' . $this->key],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
        ]);
        $raw = curl_exec($ch);
        if ($raw === false) throw new RuntimeException('Bolgram: ' . curl_error($ch));
        $res = json_decode($raw, true);
        if (!is_array($res)) throw new RuntimeException('Bolgram: bad response');
        return $res;
    }

    /** Returns [invoice_id, payment_url, amount_toman, ...]; invoices expire after 30 minutes. */
    public function createInvoice(int $amountToman, string $orderId, string $customer = '', string $returnUrl = '', string $webhookUrl = ''): array
    {
        $body = ['amount' => $amountToman, 'currency' => 'IRT', 'cus_name' => mb_substr($customer ?: $orderId, 0, 120),
                 'metadata' => ['order_id' => $orderId], 'redirect_url' => $returnUrl ?: $this->base . '/checkout.html'];
        if ($webhookUrl) $body['webhook_url'] = $webhookUrl;
        $res = $this->post('/api/v1/payment/create', $body);
        if (empty($res['status'])) throw new RuntimeException('Bolgram: ' . ($res['message'] ?? 'create failed'));
        return $res;
    }

    /** [invoice_status => PENDING|PAID|EXPIRED|CANCELLED, paid => bool, amount_toman, metadata, ...] */
    public function status(string $invoiceId): array
    {
        return $this->post('/api/v1/payment/verify', ['invoice_id' => $invoiceId]);
    }

    public function isPaid(string $invoiceId): bool
    {
        return !empty($this->status($invoiceId)['paid']);
    }

    /** Checks X-Bolgram-Signature: t=<unix>,v1=<hex hmac-sha256(secret, t . "." . body)>. */
    public static function verifyWebhook(string $rawBody, string $header, string $secret, int $tolerance = 300): bool
    {
        $parts = [];
        foreach (explode(',', $header) as $p) { $kv = explode('=', $p, 2); if (count($kv) === 2) $parts[$kv[0]] = $kv[1]; }
        if (!isset($parts['t'], $parts['v1']) || abs(time() - (int) $parts['t']) > $tolerance) return false;
        return hash_equals(hash_hmac('sha256', $parts['t'] . '.' . $rawBody, $secret), $parts['v1']);
    }
}
