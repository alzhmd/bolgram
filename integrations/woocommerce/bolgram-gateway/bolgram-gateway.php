<?php
/**
 * Plugin Name: درگاه پرداخت بولگرام (کارت به کارت)
 * Plugin URI:  https://bolgram.ir
 * Description: پرداخت کارت‌به‌کارت با تأیید خودکار پیامک بانکی برای ووکامرس. پول مستقیم به کارت خودتان واریز می‌شود.
 * Version:     1.0.0
 * Author:      بولگرام
 * Author URI:  https://bolgram.ir
 * Text Domain: bolgram-gateway
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * WC requires at least: 6.0
 * License: GPLv2 or later
 */

if (!defined('ABSPATH')) {
    exit;
}

define('BOLGRAM_GATEWAY_VERSION', '1.0.0');
define('BOLGRAM_GATEWAY_DEFAULT_SERVER', '__BOLGRAM_SERVER_URL__');

add_action('before_woocommerce_init', function () {
    if (class_exists('\Automattic\WooCommerce\Utilities\FeaturesUtil')) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
    }
});

add_action('plugins_loaded', function () {
    if (!class_exists('WC_Payment_Gateway')) {
        return;
    }
    require_once __DIR__ . '/includes/class-wc-gateway-bolgram.php';

    add_filter('woocommerce_payment_gateways', function ($gateways) {
        $gateways[] = 'WC_Gateway_Bolgram';
        return $gateways;
    });
});

add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
    $url = admin_url('admin.php?page=wc-settings&tab=checkout&section=bolgram');
    array_unshift($links, '<a href="' . esc_url($url) . '">تنظیمات</a>');
    return $links;
});
