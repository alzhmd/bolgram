#!/usr/bin/env bash
# Bolgram one-shot installer (Ubuntu/Debian, run as root):
#   curl -fsSL https://raw.githubusercontent.com/alzhmd/bolgram/main/deploy/install.sh | bash
# or, inside a clone:  sudo bash deploy/install.sh
#
# Settings (environment variables, all optional):
#   SITE_DOMAIN=bolgram.ir        marketing site
#   PAY_DOMAIN=pay.bolgram.ir     panel, checkout, API
#   REPO=https://github.com/alzhmd/bolgram.git   BRANCH=main   DIR=/opt/bolgram
#   CF_API_TOKEN=...              Cloudflare API token (Zone:DNS:Edit); or CF_API_KEY + CF_EMAIL (global key)
#   CF_PROXIED=false              true = orange cloud (set SSL mode to Full (strict) in Cloudflare first)
#   ADMIN_EMAIL=admin@bolgram.ir  owner panel login (password is generated)
set -euo pipefail

SITE_DOMAIN=${SITE_DOMAIN:-bolgram.ir}
PAY_DOMAIN=${PAY_DOMAIN:-pay.$SITE_DOMAIN}
REPO=${REPO:-https://github.com/alzhmd/bolgram.git}
BRANCH=${BRANCH:-main}
DIR=${DIR:-/opt/bolgram}
CF_PROXIED=${CF_PROXIED:-false}
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@$SITE_DOMAIN}

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "با کاربر root اجرا کنید (sudo bash deploy/install.sh)"

say "پیش‌نیازها"
export DEBIAN_FRONTEND=noninteractive
command -v curl >/dev/null && command -v git >/dev/null && command -v openssl >/dev/null || { apt-get update -y && apt-get install -y curl git openssl ca-certificates; }
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
docker compose version >/dev/null 2>&1 || apt-get install -y docker-compose-plugin

say "دریافت کد در $DIR"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" checkout -q "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
elif [ -f "$(dirname "$0")/../docker-compose.yml" ] && [ "$(cd "$(dirname "$0")/.." && pwd)" != "$DIR" ] && [ ! -e "$DIR" ]; then cp -a "$(cd "$(dirname "$0")/.." && pwd)" "$DIR"
elif [ ! -e "$DIR" ]; then git clone -q --branch "$BRANCH" "$REPO" "$DIR" || die "کلون مخزن نشد. اگر مخزن خصوصی است: REPO=https://<token>@github.com/alzhmd/bolgram.git"
fi
cd "$DIR"

IP=$(curl -4 -fsS https://api.ipify.org || curl -4 -fsS https://ifconfig.me || hostname -I | awk '{print $1}')
say "IP سرور: $IP"

# ---------- Cloudflare DNS ----------
if [ -z "${CF_API_TOKEN:-}" ] && [ -z "${CF_API_KEY:-}" ]; then
  say "جستجوی کلید Cloudflare روی سرور"
  FOUND=$(grep -rIhoE --exclude-dir={proc,sys,dev,run,node_modules,.git,docker,containerd,snap} -m1 \
    '(CF_API_TOKEN|CLOUDFLARE_API_TOKEN|CF_DNS_API_TOKEN|cloudflare_api_token|CF_API_KEY|CLOUDFLARE_API_KEY|CF_Key|CF_Token|dns_cloudflare_api_token|dns_cloudflare_api_key)[\"'"'"' ]*[:=][\"'"'"' ]*[A-Za-z0-9_-]{30,}' \
    /root /home /etc /opt /srv /var/www 2>/dev/null | head -n 5 || true)
  EMAILF=$(grep -rIhoE --exclude-dir={proc,sys,dev,run,node_modules,.git,docker,containerd,snap} -m1 \
    '(CF_EMAIL|CLOUDFLARE_EMAIL|CF_Email|dns_cloudflare_email)[\"'"'"' ]*[:=][\"'"'"' ]*[^ \"'"'"']+@[^ \"'"'"']+' /root /home /etc /opt /srv 2>/dev/null | head -n1 || true)
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    val=$(printf '%s' "$line" | grep -oE '[A-Za-z0-9_-]{30,}$')
    if printf '%s' "$line" | grep -qiE 'key'; then CF_API_KEY=${CF_API_KEY:-$val}; else CF_API_TOKEN=${CF_API_TOKEN:-$val}; fi
  done <<< "$FOUND"
  [ -n "$EMAILF" ] && CF_EMAIL=${CF_EMAIL:-$(printf '%s' "$EMAILF" | grep -oE '[^ "'"'"'=:]+@[^ "'"'"']+$')}
fi
cf() {
  if [ -n "${CF_API_TOKEN:-}" ]; then curl -fsS -H "Authorization: Bearer $CF_API_TOKEN" -H 'Content-Type: application/json' "$@"
  else curl -fsS -H "X-Auth-Email: ${CF_EMAIL:-}" -H "X-Auth-Key: $CF_API_KEY" -H 'Content-Type: application/json' "$@"; fi
}
if [ -n "${CF_API_TOKEN:-}" ] || { [ -n "${CF_API_KEY:-}" ] && [ -n "${CF_EMAIL:-}" ]; }; then
  say "تنظیم DNS در Cloudflare"
  API=https://api.cloudflare.com/client/v4
  ZONE=$(cf "$API/zones?name=$SITE_DOMAIN" | grep -oE '"id":"[a-f0-9]{32}"' | head -n1 | cut -d'"' -f4 || true)
  if [ -z "$ZONE" ]; then
    echo "  دامنه $SITE_DOMAIN در این حساب Cloudflare نیست؛ اضافه می‌کنم…"
    ACC=$(cf "$API/accounts" | grep -oE '"id":"[a-f0-9]{32}"' | head -n1 | cut -d'"' -f4 || true)
    ZONE=$(cf -X POST "$API/zones" --data "{\"name\":\"$SITE_DOMAIN\",\"account\":{\"id\":\"$ACC\"},\"type\":\"full\"}" | grep -oE '"id":"[a-f0-9]{32}"' | head -n1 | cut -d'"' -f4 || true)
    NS=$(cf "$API/zones/$ZONE" | grep -oE '"name_servers":\[[^]]*\]' || true)
    echo "  ⚠ Nameserverهای دامنه را در ثبت‌کننده (مثلاً ایرنیک) روی این مقادیر بگذارید: $NS"
  fi
  [ -n "$ZONE" ] || die "Zone پیدا/ساخته نشد؛ دسترسی کلید Cloudflare را بررسی کنید"
  for NAME in "$SITE_DOMAIN" "www.$SITE_DOMAIN" "$PAY_DOMAIN"; do
    REC=$(cf "$API/zones/$ZONE/dns_records?type=A&name=$NAME" | grep -oE '"id":"[a-f0-9]{32}"' | head -n1 | cut -d'"' -f4 || true)
    BODY="{\"type\":\"A\",\"name\":\"$NAME\",\"content\":\"$IP\",\"ttl\":1,\"proxied\":$CF_PROXIED}"
    if [ -n "$REC" ]; then cf -X PUT "$API/zones/$ZONE/dns_records/$REC" --data "$BODY" >/dev/null; else cf -X POST "$API/zones/$ZONE/dns_records" --data "$BODY" >/dev/null; fi
    echo "  ✓ $NAME → $IP"
  done
else
  echo "  کلید Cloudflare پیدا نشد؛ رکوردهای A را دستی بسازید: $SITE_DOMAIN، www.$SITE_DOMAIN و $PAY_DOMAIN → $IP"
fi

# ---------- .env ----------
if [ ! -f .env ]; then
  say "ساخت .env با کلیدهای تصادفی"
  ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
  cp .env.example .env
  set_env() { if grep -q "^$1=" .env; then sed -i "s#^$1=.*#$1=$2#" .env; else echo "$1=$2" >> .env; fi; }
  set_env DOMAIN "$PAY_DOMAIN"; set_env SITE_DOMAIN "$SITE_DOMAIN"; set_env PUBLIC_BASE_URL "https://$PAY_DOMAIN"
  set_env JWT_SECRET "$(openssl rand -hex 32)"; set_env CARD_ENC_KEY "$(openssl rand -hex 32)"
  set_env ADMIN_EMAIL "$ADMIN_EMAIL"; set_env ADMIN_PASSWORD "$ADMIN_PASSWORD"
  chmod 600 .env
  umask 077; printf 'Owner panel: https://%s/owner/\nEmail: %s\nPassword: %s\nCARD_ENC_KEY is in %s/.env — back it up, never change it.\n' "$PAY_DOMAIN" "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$DIR" > /root/bolgram-credentials.txt
fi

# Marketing site points to this server
grep -rl 'pay.bolgram.example' website/public 2>/dev/null | xargs -r sed -i "s#pay.bolgram.example#$PAY_DOMAIN#g"

# ---------- ports ----------
BUSY=$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v docker-proxy || true)
if [ -n "$BUSY" ]; then
  if echo "$BUSY" | grep -q nginx; then
    say "nginx روی پورت ۸۰/۴۴۳ فعال است؛ بولگرام پشت همان nginx قرار می‌گیرد"
    cat > docker-compose.override.yml <<YML
services:
  bolgram:
    ports: ["127.0.0.1:4000:4000"]
  caddy:
    profiles: ["disabled"]
YML
    cat > /etc/nginx/sites-available/bolgram.conf <<NGX
server { listen 80; server_name $PAY_DOMAIN; client_max_body_size 10m;
  location / { proxy_pass http://127.0.0.1:4000; proxy_set_header Host \$host; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme; } }
server { listen 80; server_name $SITE_DOMAIN www.$SITE_DOMAIN; root $DIR/website/public; index index.html; error_page 404 /404.html; location / { try_files \$uri \$uri/ \$uri.html =404; } }
NGX
    ln -sf /etc/nginx/sites-available/bolgram.conf /etc/nginx/sites-enabled/bolgram.conf
    nginx -t && systemctl reload nginx
    command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx
    NGINX_MODE=1
  else
    die "پورت ۸۰ یا ۴۴۳ دست برنامهٔ دیگری است (احتمالاً Xray/پنل VPN):
$BUSY
یا آن برنامه را به پورت دیگری ببرید، یا بولگرام را روی سرور دیگری نصب کنید."
  fi
fi

say "ساخت و اجرای بولگرام"
docker compose up -d --build
for i in $(seq 1 60); do docker compose exec -T bolgram node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && break; sleep 2; done
if [ "${NGINX_MODE:-}" = 1 ]; then
  certbot --nginx -n --agree-tos --register-unsafely-without-email --redirect -d "$PAY_DOMAIN" -d "$SITE_DOMAIN" -d "www.$SITE_DOMAIN" || echo "  ⚠ گواهی HTTPS گرفته نشد؛ بعد از اعمال DNS دوباره: certbot --nginx -d $PAY_DOMAIN -d $SITE_DOMAIN -d www.$SITE_DOMAIN"
fi

say "تمام شد"
cat <<TXT
  سایت:            https://$SITE_DOMAIN
  پنل فروشنده:     https://$PAY_DOMAIN/panel/
  پنل مالک:        https://$PAY_DOMAIN/owner/   (رمز در /root/bolgram-credentials.txt)
  گزارش‌ها:        cd $DIR && docker compose logs -f bolgram
  باقی تنظیمات (SMS.IR، ربات‌ها): $DIR/.env را ویرایش و «docker compose up -d» کنید.
TXT
