<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * درگاه بولگرام برای ووکامرس.
 *
 * جریان کار:
 *  1. process_payment: فاکتور را با POST /api/v1/payment/create می‌سازد و مشتری را به payment_url می‌فرستد.
 *  2. مشتری واریز می‌کند؛ بولگرام پیامک بانک را تطبیق می‌دهد و وب‌هوک امضاشده می‌فرستد (?wc-api=bolgram_webhook).
 *  3. وب‌هوک: امضا (X-Bolgram-Signature) بررسی، وضعیت با /api/v1/payment/verify تأیید و سفارش یک‌بار پرداخت‌شده می‌شود.
 *  4. بازگشت مشتری (?wc-api=bolgram_return): همان تأیید را انجام می‌دهد تا بدون انتظار وب‌هوک سفارش تکمیل شود.
 */
class WC_Gateway_Bolgram extends WC_Payment_Gateway
{
    /** ضریب تبدیل واحد پول فروشگاه به ریال */
    private const RIAL_MULTIPLIER = ['IRR' => 1, 'IRT' => 10, 'IRHR' => 1000, 'IRHT' => 10000];

    public function __construct()
    {
        $this->id = 'bolgram';
        $this->icon = '';
        $this->has_fields = false;
        $this->method_title = 'بولگرام (کارت به کارت)';
        $this->method_description = 'پرداخت کارت‌به‌کارت با تأیید خودکار. افزونه آدرس وب‌هوک را همراه هر فاکتور می‌فرستد؛ فقط کلید امضا را از پنل بولگرام (بخش وب‌هوک) اینجا بگذارید.';
        $this->supports = ['products'];

        $this->init_form_fields();
        $this->init_settings();

        $this->title = $this->get_option('title');
        $this->description = $this->get_option('description');

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
        add_action('woocommerce_api_bolgram_webhook', [$this, 'handle_webhook']);
        add_action('woocommerce_api_bolgram_return', [$this, 'handle_return']);
    }

    public function init_form_fields()
    {
        $this->form_fields = [
            'enabled' => [
                'title' => 'فعال‌سازی',
                'type' => 'checkbox',
                'label' => 'پرداخت با بولگرام فعال باشد',
                'default' => 'no',
            ],
            'title' => [
                'title' => 'عنوان درگاه',
                'type' => 'text',
                'description' => 'عنوانی که مشتری هنگام پرداخت می‌بیند.',
                'default' => 'پرداخت کارت به کارت',
                'desc_tip' => true,
            ],
            'description' => [
                'title' => 'توضیحات',
                'type' => 'textarea',
                'default' => 'مبلغ دقیق سفارش را از کارت خود واریز کنید؛ پرداخت شما بعد از واریز خودکار تأیید می‌شود.',
            ],
            'server_url' => [
                'title' => 'آدرس سرور بولگرام',
                'type' => 'text',
                'description' => 'مثلاً https://bolgram.ir (بدون / در انتها).',
                'default' => BOLGRAM_GATEWAY_DEFAULT_SERVER,
                'custom_attributes' => ['dir' => 'ltr'],
            ],
            'api_key' => [
                'title' => 'کلید API',
                'type' => 'password',
                'description' => 'از پنل بولگرام، بخش «افزونه‌ها و API» یک کلید بسازید.',
                'custom_attributes' => ['dir' => 'ltr', 'autocomplete' => 'off'],
            ],
            'webhook_secret' => [
                'title' => 'کلید امضای وب‌هوک',
                'type' => 'password',
                'description' => 'از پنل بولگرام، بخش «وب‌هوک»، گزینهٔ نمایش کلید. برای رد درخواست‌های جعلی ضروری است.',
                'custom_attributes' => ['dir' => 'ltr', 'autocomplete' => 'off'],
            ],
        ];
    }

    public function is_available()
    {
        return parent::is_available()
            && $this->get_option('api_key') !== ''
            && isset(self::RIAL_MULTIPLIER[get_woocommerce_currency()]);
    }

    private function server()
    {
        $url = trim((string) $this->get_option('server_url'));
        return rtrim($url !== '' ? $url : BOLGRAM_GATEWAY_DEFAULT_SERVER, '/');
    }

    private function to_rial($amount)
    {
        $mult = self::RIAL_MULTIPLIER[get_woocommerce_currency()] ?? null;
        return $mult === null ? null : (int) round(((float) $amount) * $mult);
    }

    /** @return array{ok:bool,data:array,error:string} */
    private function call($path, array $body)
    {
        $res = wp_remote_post($this->server() . $path, [
            'timeout' => 20,
            'headers' => [
                'Content-Type' => 'application/json',
                'x-api-key' => $this->get_option('api_key'),
            ],
            'body' => wp_json_encode($body),
        ]);
        if (is_wp_error($res)) {
            return ['ok' => false, 'data' => [], 'error' => $res->get_error_message()];
        }
        $code = wp_remote_retrieve_response_code($res);
        $data = json_decode(wp_remote_retrieve_body($res), true);
        $data = is_array($data) ? $data : [];
        if ($code < 200 || $code >= 300) {
            $msg = $data['message'] ?? ('HTTP ' . $code);
            return ['ok' => false, 'data' => $data, 'error' => (string) $msg];
        }
        return ['ok' => true, 'data' => $data, 'error' => ''];
    }

    public function process_payment($order_id)
    {
        $order = wc_get_order($order_id);
        if (!$order) {
            return ['result' => 'failure'];
        }
        $amount = $this->to_rial($order->get_total());
        if (!$amount || $amount < 1) {
            wc_add_notice('واحد پول فروشگاه برای این درگاه پشتیبانی نمی‌شود (ریال یا تومان).', 'error');
            return ['result' => 'failure'];
        }

        $return = add_query_arg(
            ['wc-api' => 'bolgram_return', 'order_id' => $order->get_id(), 'key' => $order->get_order_key()],
            home_url('/')
        );
        $r = $this->call('/api/v1/payment/create', [
            'amount' => $amount,
            'currency' => 'IRR',
            'cus_name' => trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name()),
            'cus_email' => $order->get_billing_email(),
            'redirect_url' => $return,
            'cancel_url' => wc_get_checkout_url(),
            'webhook_url' => WC()->api_request_url('bolgram_webhook'),
            'metadata' => ['order_id' => (string) $order->get_id(), 'source' => 'woocommerce'],
        ]);
        if (!$r['ok'] || empty($r['data']['payment_url']) || empty($r['data']['invoice_id'])) {
            $order->add_order_note('ساخت فاکتور در بولگرام ناموفق بود: ' . $r['error']);
            wc_add_notice('اتصال به درگاه برقرار نشد. لطفاً دوباره تلاش کنید یا با فروشگاه تماس بگیرید.', 'error');
            return ['result' => 'failure'];
        }

        $order->update_meta_data('_bolgram_invoice_id', sanitize_text_field($r['data']['invoice_id']));
        $order->update_status('pending', 'در انتظار پرداخت در بولگرام. فاکتور: ' . $r['data']['invoice_id'] . ' · مبلغ قابل پرداخت: ' . number_format((float) ($r['data']['amount'] ?? $amount)) . ' ریال');
        $order->save();

        return ['result' => 'success', 'redirect' => $r['data']['payment_url']];
    }

    /** وضعیت فاکتور را از سرور بولگرام می‌پرسد (هرگز فقط به وب‌هوک یا آدرس بازگشت اعتماد نمی‌شود). */
    private function invoice_paid($invoice_id, &$trx = null)
    {
        $r = $this->call('/api/v1/payment/verify', ['invoice_id' => $invoice_id]);
        if (!$r['ok']) {
            return false;
        }
        $trx = isset($r['data']['transaction_id']) ? (string) $r['data']['transaction_id'] : '';
        return ($r['data']['invoice_status'] ?? '') === 'PAID';
    }

    /** یک‌بار و idempotent: اگر سفارش قبلاً پرداخت‌شده است کاری نمی‌کند. */
    private function complete($order, $trx)
    {
        if ($order->is_paid()) {
            return;
        }
        $order->add_order_note('پرداخت در بولگرام تأیید شد.' . ($trx ? ' کد پیگیری: ' . $trx : ''));
        $order->payment_complete($trx ?: $order->get_meta('_bolgram_invoice_id'));
    }

    private function order_by_invoice($invoice_id)
    {
        $orders = wc_get_orders([
            'limit' => 1,
            'meta_key' => '_bolgram_invoice_id',
            'meta_value' => $invoice_id,
            'return' => 'objects',
        ]);
        return $orders ? $orders[0] : null;
    }

    public function handle_webhook()
    {
        $body = (string) file_get_contents('php://input');
        $header = isset($_SERVER['HTTP_X_BOLGRAM_SIGNATURE']) ? (string) $_SERVER['HTTP_X_BOLGRAM_SIGNATURE'] : '';
        $secret = (string) $this->get_option('webhook_secret');

        if ($secret === '' || !$this->signature_valid($header, $body, $secret)) {
            status_header(401);
            echo 'invalid signature';
            exit;
        }
        $data = json_decode($body, true);
        if (!is_array($data) || ($data['event'] ?? 'invoice.paid') === 'ping') {
            status_header(200);
            echo 'ok';
            exit;
        }
        $invoice_id = isset($data['invoice_id']) ? sanitize_text_field($data['invoice_id']) : '';
        $order = $invoice_id !== '' ? $this->order_by_invoice($invoice_id) : null;
        if (!$order) {
            status_header(200); // ناشناس: دوباره ارسال نشود
            echo 'unknown invoice';
            exit;
        }
        if ($order->is_paid()) {
            status_header(200);
            echo 'already paid';
            exit;
        }
        $trx = '';
        if ($this->invoice_paid($invoice_id, $trx)) {
            $this->complete($order, $trx);
            status_header(200);
            echo 'ok';
        } else {
            status_header(409); // بولگرام بعداً دوباره تلاش می‌کند
            echo 'not paid yet';
        }
        exit;
    }

    /** t=<unix>,v1=<hex>[,v1=<hex>] روی "t.body" با HMAC-SHA256؛ در بازهٔ چرخش کلید، دو v1 می‌آید. */
    private function signature_valid($header, $body, $secret)
    {
        $t = null;
        $sigs = [];
        foreach (explode(',', $header) as $part) {
            $kv = explode('=', trim($part), 2);
            if (count($kv) !== 2) {
                continue;
            }
            if ($kv[0] === 't') {
                $t = (int) $kv[1];
            } elseif ($kv[0] === 'v1') {
                $sigs[] = $kv[1];
            }
        }
        if (!$t || !$sigs || abs(time() - $t) > 300) {
            return false;
        }
        $expected = hash_hmac('sha256', $t . '.' . $body, $secret);
        foreach ($sigs as $sig) {
            if (hash_equals($expected, $sig)) {
                return true;
            }
        }
        return false;
    }

    public function handle_return()
    {
        $order_id = isset($_GET['order_id']) ? absint($_GET['order_id']) : 0;
        $key = isset($_GET['key']) ? wc_clean(wp_unslash($_GET['key'])) : '';
        $order = $order_id ? wc_get_order($order_id) : null;
        if (!$order || !hash_equals((string) $order->get_order_key(), (string) $key)) {
            wp_safe_redirect(wc_get_page_permalink('myaccount'));
            exit;
        }
        $invoice_id = (string) $order->get_meta('_bolgram_invoice_id');
        $trx = '';
        if ($invoice_id !== '' && $this->invoice_paid($invoice_id, $trx)) {
            $this->complete($order, $trx);
        } elseif (!$order->is_paid()) {
            wc_add_notice('پرداخت هنوز تأیید نشده است. اگر واریز کرده‌اید، چند لحظه بعد وضعیت سفارش خودکار به‌روز می‌شود.', 'notice');
        }
        wp_safe_redirect($this->get_return_url($order));
        exit;
    }
}
