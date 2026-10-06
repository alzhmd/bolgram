import json
import urllib.request
import urllib.error

class SyncPayClient:
    """
    Official Python SDK Client for SyncPay BD
    """
    def __init__(self, api_key: str, base_url: str = "http://localhost:4000"):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    def _request(self, endpoint: str, method: str = "GET", data: dict = None) -> dict:
        url = f"{self.base_url}{endpoint}"
        headers = {
            "syncpay-api-key": self.api_key,
            "syncpay-api-key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        body = json.dumps(data).encode("utf-8") if data else None
        req = urllib.request.Request(url, data=body, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            try:
                err_json = json.loads(err_body)
                raise Exception(err_json.get("message") or err_json.get("error") or f"HTTP {e.code}")
            except json.JSONDecodeError:
                raise Exception(f"HTTP {e.code}: {e.reason}")
        except urllib.error.URLError as e:
            raise Exception(f"Connection Error: {e.reason}")

    def create_invoice(self, amount: float, order_id: str, customer_name: str = "", customer_phone: str = "", callback_url: str = "") -> dict:
        payload = {
            "amount": amount,
            "order_id": order_id,
            "customer_name": customer_name,
            "customer_phone": customer_phone,
            "callback_url": callback_url,
        }
        return self._request("/v1/payment/create", method="POST", data=payload)

    def verify_transaction(self, trx_id: str) -> dict:
        return self._request("/v1/payment/verify", method="POST", data={"trx_id": trx_id})

    def get_transactions(self) -> dict:
        return self._request("/api/v1/merchant/transactions")

    def get_devices(self) -> dict:
        return self._request("/api/v1/merchant/devices")
