#!/usr/bin/env bash
# Разворачивает CRM на чистом Ubuntu-сервере.
# Запускать НА СЕРВЕРЕ из каталога с кодом:
#   sudo bash scripts/bootstrap-server.sh crm.вашдомен.ru
#
# Идемпотентен: можно запускать повторно.

set -euo pipefail

DOMAIN="${1:-}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "$DOMAIN" ]]; then
  echo "Укажите домен: sudo bash scripts/bootstrap-server.sh crm.вашдомен.ru" >&2
  exit 1
fi

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------- 1. Docker
say "Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
else
  echo "уже установлен"
fi

# ---------------------------------------------------------------- 1.5 swap
# Сборка Next.js — самая тяжёлая операция. На 2 ГБ без swap она падает по памяти.
say "Проверка памяти"
MEM_MB=$(free -m | awk '/^Mem:/ {print $2}')
SWAP_MB=$(free -m | awk '/^Swap:/ {print $2}')
echo "RAM ${MEM_MB} МБ, swap ${SWAP_MB} МБ"

if [[ "$MEM_MB" -lt 3000 && "$SWAP_MB" -lt 1000 ]]; then
  say "Мало памяти — создаю swap 4 ГБ"
  if [[ ! -f /swapfile ]]; then
    fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile || true
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  free -h
fi

# ---------------------------------------------------------------- 2. .env
say "Переменные окружения"
cd "$APP_DIR"
if [[ ! -f .env ]]; then
  {
    echo "POSTGRES_DB=crm"
    echo "POSTGRES_USER=crm"
    echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
    echo "SESSION_SECRET=$(openssl rand -base64 48)"
  } > .env
  chmod 600 .env
  echo "создан .env с новыми секретами"
else
  echo ".env уже есть, не трогаю"
fi

# ---------------------------------------------------------------- 3. Запуск
say "Сборка и запуск контейнеров"
docker compose up -d --build

say "Ожидание готовности приложения"
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/login >/dev/null 2>&1; then
    echo "приложение отвечает"
    break
  fi
  [[ $i -eq 60 ]] && { echo "приложение не поднялось за 60 сек" >&2; docker compose logs --tail=50 app; exit 1; }
  sleep 1
done

# ---------------------------------------------------------------- 4. Миграции
say "Миграции"
docker compose exec -T app npx tsx scripts/migrate.ts

# ---------------------------------------------------------------- 5. HTTPS
say "HTTPS через Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update && apt-get install -y caddy
fi

cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:3000
    encode gzip
    header {
        X-Frame-Options DENY
        X-Content-Type-Options nosniff
        Referrer-Policy same-origin
    }
}
EOF
systemctl reload caddy || systemctl restart caddy
echo "Caddy настроен на $DOMAIN, сертификат получит сам"

# ---------------------------------------------------------------- 6. Файрвол
say "Файрвол"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  ufw status numbered | head -20
fi

# ---------------------------------------------------------------- 7. Бэкапы
say "Ежедневные бэкапы"
cat > /etc/cron.daily/crm-backup <<EOF
#!/bin/sh
cd $APP_DIR
mkdir -p /var/backups/crm
docker compose exec -T db pg_dump -U crm crm | gzip > /var/backups/crm/crm-\$(date +\%F).sql.gz
find /var/backups/crm -name '*.sql.gz' -mtime +30 -delete
EOF
chmod +x /etc/cron.daily/crm-backup
echo "бэкап в /var/backups/crm, хранение 30 дней"

# ---------------------------------------------------------------- готово
say "Готово"
cat <<EOF

Адрес:  https://$DOMAIN
        (сертификат выпускается 10–30 секунд после первого обращения)

Осталось завести пользователей:

  cd $APP_DIR
  docker compose exec app npx tsx scripts/set-password.ts denis '<пароль>' 'Денис' head
  docker compose exec app npx tsx scripts/set-password.ts lev '<пароль>' 'Лев' manager

И загрузить выгрузку из 1С в разделе «Импорт».
Кампании собираются командой:

  docker compose exec app npx tsx scripts/seed.ts /путь/к/выгрузке.xlsx

EOF
