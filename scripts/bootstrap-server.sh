#!/usr/bin/env bash
# Разворачивает CRM на чистом Ubuntu-сервере.
# Запускать НА СЕРВЕРЕ из каталога с кодом:
#   sudo bash scripts/bootstrap-server.sh crm.вашдомен.ru
#
# Идемпотентен: можно запускать повторно.

set -euo pipefail

DOMAIN="${1:-}"
# Обычно каталог вычисляется по пути самого скрипта, но i.sh запускает
# его временную копию — тогда каталог приходит переменной окружения.
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

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

# ------------------------------------------------------- 1.2 зеркала реестра
# С российских серверов Docker Hub обычно недоступен: соединение до
# registry-1.docker.io отваливается по таймауту. Прописываем зеркала —
# Docker пробует их по очереди и только потом идёт в Docker Hub напрямую.
say "Зеркала реестра образов"
mkdir -p /etc/docker
if [[ -f /etc/docker/daemon.json ]] && grep -q registry-mirrors /etc/docker/daemon.json; then
  echo "уже настроены"
else
  cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": [
    "https://mirror.gcr.io",
    "https://cr.yandex/mirror",
    "https://dockerhub.timeweb.cloud",
    "https://huecker.io"
  ]
}
JSON
  systemctl restart docker
  sleep 3
  echo "прописаны, docker перезапущен"
fi

# Проверяем, что образы теперь тянутся — иначе дальше всё равно упадёт
if ! timeout 90 docker pull postgres:17-alpine >/dev/null 2>&1; then
  cat >&2 <<'ERR'

Не удалось скачать образ ни через одно из зеркал.

Что попробовать:
  1. Повторить запуск — зеркала бывают перегружены.
  2. Дописать своё зеркало в /etc/docker/daemon.json,
     затем: systemctl restart docker && bash i.sh

ERR
  exit 1
fi
echo "образы скачиваются"

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
docker compose exec -T app node dist-scripts/migrate.js

say "Первый пользователь"
docker compose exec -T app node dist-scripts/ensure-admin.js

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

Что дальше:

  1. Откройте адрес выше и войдите под логином и паролем, которые
     напечатаны выше в разделе «Первый пользователь».

  2. Раздел «Импорт» — загрузите выгрузку из 1С «Активность контрагентов».
     Кампании обзвона соберутся автоматически.

  3. Заведите остальных пользователей:

     cd $APP_DIR
     docker compose exec app node dist-scripts/set-password.js lev '<пароль>' 'Лев' manager

Обновление системы в дальнейшем:

  cd $APP_DIR && git pull && docker compose up -d --build

EOF
