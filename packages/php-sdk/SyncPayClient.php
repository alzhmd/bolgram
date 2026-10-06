<?php
namespace SyncPay;

/**
 * SyncPay BD - Official PHP SDK Client
 * Version: 2.0.0
 */
class SyncPayClient {
    private $apiKey;
    private $baseUrl;

    public function __construct($apiKey, $baseUrl = 'http://localhost:4000') {
        $this->apiKey = $apiKey;
        $this->baseUrl = rtrim($baseUrl, '/');
    }

    private function request($endpoint, $method = 'GET', $data = null) {
        $url = $this->baseUrl . $endpoint;
        $ch = curl_init($url);

        $headers = [
            'syncpay-api-key: ' . $this->apiKey,
            'syncpay-api-key: ' . $this->apiKey,
            'Content-Type: application/json',
            'Accept: application/json',
        ];

        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);

        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            if ($data) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
            }
        } elseif ($method !== 'GET') {
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        }

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

        if (curl_errno($ch)) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new \Exception("SyncPay Request Failed: " . $error);
        }

        curl_close($ch);
        $decoded = json_decode($response, true);

        if ($httpCode >= 400) {
            throw new \Exception($decoded['message'] ?? $decoded['error'] ?? "HTTP Error " . $httpCode);
        }

        return $decoded;
    }

    /**
     * Create a payment invoice
     */
    public function createInvoice(array $params) {
        return $this->request('/v1/payment/create', 'POST', $params);
    }

    /**
     * Verify a Transaction ID
     */
    public function verifyTransaction($trxId) {
        return $this->request('/v1/payment/verify', 'POST', ['trx_id' => $trxId]);
    }

    /**
     * Fetch merchant transactions
     */
    public function getTransactions($limit = 50) {
        return $this->request('/api/v1/merchant/transactions', 'GET');
    }

    /**
     * Fetch active connected forwarder devices
     */
    public function getDevices() {
        return $this->request('/api/v1/merchant/devices', 'GET');
    }
}
