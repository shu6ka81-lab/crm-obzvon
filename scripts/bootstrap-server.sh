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

# ---------------------------------------------------------------- 0. DNS
# На свежих машинах хостера локальный резолвер иногда не отвечает: запросы
# к 127.0.0.53 истекают по таймауту. Тогда молча ломается всё сразу —
# apt, git, docker и выпуск сертификата, причём каждый раз по-разному.
say "Разрешение имён"
if getent hosts acme-v02.api.letsencrypt.org >/dev/null 2>&1; then
  echo "работает"
else
  echo "не отвечает — прописываю публичные серверы имён"
  mkdir -p /etc/systemd/resolved.conf.d
  cat > /etc/systemd/resolved.conf.d/dns.conf <<'DNSCONF'
[Resolve]
DNS=77.88.8.8 8.8.8.8
FallbackDNS=1.1.1.1 9.9.9.9
DNSCONF
  systemctl restart systemd-resolved 2>/dev/null || true
  resolvectl flush-caches 2>/dev/null || true
  sleep 2
  if getent hosts acme-v02.api.letsencrypt.org >/dev/null 2>&1; then
    echo "починено"
  else
    echo "имена по-прежнему не разрешаются — установка, скорее всего, упадёт" >&2
  fi
fi

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

# Проверяем доступность реестра только если образа ещё нет: при повторном
# запуске он уже на диске, и требовать скачивания заново незачем.
if docker image inspect postgres:17-alpine >/dev/null 2>&1; then
  echo "образ postgres уже на диске"
elif ! timeout 120 docker pull postgres:17-alpine >/dev/null 2>&1; then
  cat >&2 <<'ERR'

Не удалось скачать образ ни через одно из зеркал.

Что попробовать:
  1. Повторить запуск — зеркала бывают перегружены.
  2. Дописать своё зеркало в /etc/docker/daemon.json,
     затем: systemctl restart docker && bash i.sh

ERR
  exit 1
else
  echo "образ скачан"
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
docker compose exec -T app node dist-scripts/migrate.js

say "Первый пользователь"
docker compose exec -T app node dist-scripts/ensure-admin.js

# ---------------------------------------------------------------- 5. HTTPS
# В образах хостеров часто предустановлены nginx и apache. Они занимают
# порт 80, из-за чего Caddy молча не поднимается и сайт остаётся недоступен.
say "Освобождение портов 80 и 443"
for svc in nginx apache2 httpd lighttpd; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^${svc}\.service"; then
    systemctl disable --now "$svc" >/dev/null 2>&1 || true
    echo "$svc остановлен и убран из автозапуска"
  fi
done

if ss -tlnp 2>/dev/null | grep -qE ':(80|443)\s' ; then
  echo "внимание: порты всё ещё кем-то заняты:" >&2
  ss -tlnp | grep -E ':(80|443)\s' >&2
fi

say "HTTPS через Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update && apt-get install -y caddy
fi

# На голом IP публичный сертификат выпустить нельзя — ни один центр их не
# выдаёт. Значит сервер выпускает его сам, своим внутренним центром: браузер
# один раз предупредит, но соединение будет защищённым и куки сессии
# сохранятся. Без этой строки установка по IP клала сайт в ERR_SSL_PROTOCOL_ERROR.
TLS=""
if [[ "${DOMAIN#https://}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  TLS="
    tls internal"
fi

cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {$TLS
    reverse_proxy 127.0.0.1:3000
    encode gzip
    header {
        X-Frame-Options DENY
        X-Content-Type-Options nosniff
        Referrer-Policy same-origin
    }
}
EOF
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy
sleep 2
if systemctl is-active --quiet caddy; then
  echo "Caddy работает, слушает:"
  ss -tlnp | grep -E ':(80|443)\s' || echo "  порты пока не заняты — проверьте журнал"
else
  echo "Caddy не запустился. Журнал:" >&2
  journalctl -u caddy -n 20 --no-pager >&2
  exit 1
fi

# ---------------------------------------------------------------- 6. Файрвол
say "Файрвол"
if command -v ufw >/dev/null 2>&1; then
  # Политики задаём явно. Полагаться на умолчания образа нельзя: на этой
  # машине исходящие оказались запрещены, и после включения файрвола сервер
  # потерял связь наружу — сломались DNS, обновления и выпуск сертификата.
  ufw --force reset >/dev/null 2>&1 || true
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null

  # Проверяем, что связь наружу жива. Если нет — снимаем файрвол:
  # неработающий сервер хуже незащищённого, и молча так оставлять нельзя.
  sleep 2
  if ping -c 2 -W 3 8.8.8.8 >/dev/null 2>&1; then
    echo "включён, связь наружу работает"
    ufw status numbered | head -20
  else
    ufw disable >/dev/null 2>&1 || true
    echo "ВНИМАНИЕ: с включённым файрволом пропала связь наружу — он выключен." >&2
    echo "Сервер работает, но без сетевой защиты. Разберитесь с правилами ufw." >&2
  fi
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

Адрес:  https://${DOMAIN#https://}
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
