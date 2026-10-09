"""Bolgram client for Telegram/Bale bots (Python 3.8+, no dependencies).

    from bolgram import Bolgram
    bg = Bolgram("https://pay.bolgram.ir", "live_sk_...")          # panel → «افزونه‌ها و API»
    inv = bg.create_invoice(150_000, order_id="u123-vpn-30d", customer="@ali")
    # send inv["payment_url"] to the user as a button; the payable amount is inv["amount_toman"] (unique tail included)
    if bg.is_paid(inv["invoice_id"]): deliver()
    # or receive the webhook and check it with Bolgram.verify_webhook(raw_body, headers["X-Bolgram-Signature"], secret)

For async bots (aiogram, python-telegram-bot) call these from asyncio.to_thread(...).
"""
import hashlib, hmac, json, time, urllib.request, urllib.error


class BolgramError(Exception):
    pass


class Bolgram:
    def __init__(self, base_url: str, api_key: str, timeout: int = 15):
        self.base = base_url.rstrip("/")
        self.key = api_key
        self.timeout = timeout

    def _post(self, path: str, body: dict) -> dict:
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "x-api-key": self.key})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            raise BolgramError(e.read().decode(errors="replace")) from None

    def create_invoice(self, amount_toman: int, order_id: str, customer: str = "", return_url: str = "",
                       webhook_url: str = "") -> dict:
        """Returns {invoice_id, payment_url, amount_toman, ...}. Invoices expire after 30 minutes."""
        body = {"amount": int(amount_toman), "currency": "IRT", "cus_name": customer[:120] or order_id,
                "metadata": {"order_id": order_id}, "redirect_url": return_url or self.base + "/checkout.html"}
        if webhook_url:
            body["webhook_url"] = webhook_url
        res = self._post("/api/v1/payment/create", body)
        if not res.get("status"):
            raise BolgramError(res.get("message", "create failed"))
        return res

    def status(self, invoice_id: str) -> dict:
        """{invoice_status: PENDING|PAID|EXPIRED|CANCELLED, paid: bool, amount_toman, metadata, ...}"""
        return self._post("/api/v1/payment/verify", {"invoice_id": invoice_id})

    def is_paid(self, invoice_id: str) -> bool:
        return bool(self.status(invoice_id).get("paid"))

    @staticmethod
    def verify_webhook(raw_body: bytes, signature_header: str, secret: str, tolerance: int = 300) -> bool:
        """Checks X-Bolgram-Signature: t=<unix>,v1=<hex hmac-sha256(secret, t + "." + body)>."""
        try:
            parts = dict(p.split("=", 1) for p in signature_header.split(","))
            t, v1 = int(parts["t"]), parts["v1"]
        except Exception:
            return False
        if abs(time.time() - t) > tolerance:
            return False
        body = raw_body if isinstance(raw_body, bytes) else raw_body.encode()
        want = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(want, v1)
