<?php
/**
 * Plugin Name: SyncPay BD - MFS Payment Gateway for WooCommerce
 * Plugin URI: https://syncpaybd.site
 * Description: Automated bKash, Nagad, Rocket & Upay direct payments for WooCommerce with real-time SMS TrxID verification.
 * Version: 2.4.2
 * Author: SyncPay BD
 * Author URI: https://syncpaybd.site
 * Text Domain: syncpay-woocommerce
 * Domain Path: /languages
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * WC requires at least: 5.0
 * WC tested up to: 8.9
 */

if (!defined('ABSPATH')) {
    exit;
}

// Ensure WooCommerce is active
add_action('plugins_loaded', 'syncpay_woocommerce_init', 0);

function syncpay_woocommerce_init() {
    if (!class_exists('WC_Payment_Gateway')) {
        return;
    }

    class WC_Gateway_SyncPay extends WC_Payment_Gateway {

        public function __construct() {
            $this->id = 'syncpay';
            $this->icon = apply_filters('woocommerce_syncpay_icon', plugins_url('assets/icon.png', __FILE__));
            $this->has_fields = false;
            $this->method_title = __('SyncPay BD (bKash/Nagad/Rocket)', 'syncpay-woocommerce');
            $this->method_description = __('Automated Mobile Financial Services (MFS) payment gateway with direct SIM forwarder integration.', 'syncpay-woocommerce');

            // Load settings
            $this->init_form_fields();
            $this->init_settings();

            $this->title = $this->get_option('title', 'bKash / Nagad / Rocket (SyncPay BD)');
            $this->description = $this->get_option('description', 'বিকাশ, নগদ বা রকেট এর মাধ্যমে নিরাপদে এবং স্বয়ংক্রিয়ভাবে পেমেন্ট করুন।');
            $this->api_url = rtrim($this->get_option('api_url', 'http://localhost:4000'), '/');
            $this->api_key = $this->get_option('api_key', '');
            $this->order_status_success = $this->get_option('order_status_success', 'processing');

            // Save admin options
            add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'process_admin_options'));

            // Webhook IPN listener
            add_action('woocommerce_api_syncpay_webhook', array($this, 'handle_webhook'));
        }

        public function init_form_fields() {
            $this->form_fields = array(
                'enabled' => array(
                    'title'       => __('Enable/Disable', 'syncpay-woocommerce'),
                    'type'        => 'checkbox',
                    'label'       => __('Enable SyncPay BD MFS Gateway', 'syncpay-woocommerce'),
                    'default'     => 'yes',
                ),
                'title' => array(
                    'title'       => __('Title', 'syncpay-woocommerce'),
                    'type'        => 'text',
                    'description' => __('Payment method title displayed to customer at checkout.', 'syncpay-woocommerce'),
                    'default'     => __('bKash / Nagad / Rocket (SyncPay BD)', 'syncpay-woocommerce'),
                    'desc_tip'    => true,
                ),
                'description' => array(
                    'title'       => __('Description', 'syncpay-woocommerce'),
                    'type'        => 'textarea',
                    'description' => __('Description displayed to customer at checkout.', 'syncpay-woocommerce'),
                    'default'     => __('বিকাশ, নগদ বা রকেট এর মাধ্যমে নিরাপদে এবং স্বয়ংক্রিয়ভাবে পেমেন্ট করুন।', 'syncpay-woocommerce'),
                ),
                'api_url' => array(
                    'title'       => __('SyncPay Server URL', 'syncpay-woocommerce'),
                    'type'        => 'text',
                    'description' => __('Your SyncPay server endpoint (e.g. http://localhost:4000 or https://pay.yourdomain.com)', 'syncpay-woocommerce'),
                    'default'     => 'http://localhost:4000',
                    'desc_tip'    => true,
                ),
                'api_key' => array(
                    'title'       => __('Merchant API Key', 'syncpay-woocommerce'),
                    'type'        => 'password',
                    'description' => __('Find your API key in SyncPay Dashboard > API Keys.', 'syncpay-woocommerce'),
                    'default'     => '',
                ),
                'order_status_success' => array(
                    'title'       => __('Order Status Upon Payment', 'syncpay-woocommerce'),
                    'type'        => 'select',
                    'description' => __('Status assigned to order upon successful TrxID verification.', 'syncpay-woocommerce'),
                    'default'     => 'processing',
                    'options'     => array(
                        'processing' => __('Processing', 'syncpay-woocommerce'),
                        'completed'  => __('Completed', 'syncpay-woocommerce'),
                    ),
                ),
            );
        }

        public function process_payment($order_id) {
            $order = wc_get_order($order_id);

            if (!$order) {
                wc_add_notice(__('Order not found.', 'syncpay-woocommerce'), 'error');
                return;
            }

            $amount = $order->get_total();
            $customer_name = $order->get_billing_first_name() . ' ' . $order->get_billing_last_name();
            $customer_email = $order->get_billing_email();
            $customer_phone = $order->get_billing_phone();

            $webhook_url = add_query_arg('wc-api', 'syncpay_webhook', home_url('/'));
            $success_url = $this->get_return_url($order);
            $cancel_url  = $order->get_cancel_order_url();

            $payload = array(
                'amount'         => floatval($amount),
                'order_id'       => (string)$order->get_id(),
                'customer_name'  => $customer_name,
                'customer_email' => $customer_email,
                'customer_phone' => $customer_phone,
                'callback_url'   => $webhook_url,
                'success_url'    => $success_url,
                'cancel_url'     => $cancel_url,
            );

            $response = wp_remote_post($this->api_url . '/v1/payment/create', array(
                'method'    => 'POST',
                'timeout'   => 25,
                'headers'   => array(
                    'Content-Type'       => 'application/json',
                    'syncpay-api-key'    => $this->api_key,
                    'syncpay-api-key'    => $this->api_key,
                ),
                'body'      => wp_json_encode($payload),
            ));

            if (is_wp_error($response)) {
                wc_add_notice(__('Connection error: ', 'syncpay-woocommerce') . $response->get_error_message(), 'error');
                return;
            }

            $body = wp_remote_retrieve_body($response);
            $data = json_decode($body, true);

            if (isset($data['success']) && $data['success'] && !empty($data['data']['payment_url'])) {
                $payment_url = $data['data']['payment_url'];
                if (isset($data['data']['invoice_id'])) {
                    $order->update_meta_data('_syncpay_invoice_id', $data['data']['invoice_id']);
                    $order->save();
                }

                return array(
                    'result'   => 'success',
                    'redirect' => $payment_url,
                );
            }

            // Fallback to direct hosted checkout URL
            $checkout_fallback = $this->api_url . '/checkout.html?invoice_id=' . ($data['data']['invoice_id'] ?? 'INV_' . $order->get_id()) . '&amount=' . $amount . '&order_id=' . $order->get_id();
            return array(
                'result'   => 'success',
                'redirect' => $checkout_fallback,
            );
        }

        public function handle_webhook() {
            $raw_input = file_get_contents('php://input');
            $data = json_decode($raw_input, true);

            if (!$data) {
                $data = $_REQUEST;
            }

            $order_id = $data['order_id'] ?? null;
            $trx_id   = $data['trx_id'] ?? null;
            $status   = $data['status'] ?? null;
            $provider = $data['provider'] ?? 'MFS';

            if (!$order_id) {
                status_header(400);
                echo wp_json_encode(array('status' => 'error', 'message' => 'Missing order_id'));
                exit;
            }

            $order = wc_get_order($order_id);
            if (!$order) {
                status_header(404);
                echo wp_json_encode(array('status' => 'error', 'message' => 'Order not found'));
                exit;
            }

            if ($status === 'PAID' || $status === 'COMPLETED' || $status === 'verified') {
                if ($order->get_status() !== 'completed' && $order->get_status() !== 'processing') {
                    $order->payment_complete($trx_id);
                    $order->add_order_note(sprintf(
                        __('SyncPay BD Payment Verified via %s. Transaction ID: %s', 'syncpay-woocommerce'),
                        esc_html($provider),
                        esc_html($trx_id)
                    ));
                    $order->update_status($this->order_status_success, __('Payment confirmed via SyncPay MFS.', 'syncpay-woocommerce'));
                }
            }

            status_header(200);
            echo wp_json_encode(array('status' => 'success', 'order_id' => $order_id));
            exit;
        }
    }

    function add_syncpay_gateway_class($methods) {
        $methods[] = 'WC_Gateway_SyncPay';
        return $methods;
    }

    add_filter('woocommerce_payment_gateways', 'add_syncpay_gateway_class');
}
