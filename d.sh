#!/usr/bin/env bash
# Переводит систему на ваш домен и включает HTTPS.
#
#   bash d.sh crm.adminshu6ka.ru
#
# Полную установку для этого гонять незачем: контейнеры, база и данные
# остаются на месте, меняется только настройка обратного прокси.
#
# Почему свой домен, а не выданный хостером. Сертификаты выдаёт Let's Encrypt,
# и лимит у неё считается на домен целиком — а fvds.ru общий для всех клиентов
# хостера. Его недельный запас выбирают другие, и наш запрос упирается в отказ.
# На своём домене запас свой и свободный.

set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Укажите домен: bash d.sh crm.adminshu6ka.ru" >&2
  exit 1
fi

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# ------------------------------------------------------ 1. Куда указывает имя
say "Проверка домена"
MY_IP="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
[[ -z "$MY_IP" ]] && MY_IP="$(hostname -I | awk '{print $1}')"
DOMAIN_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1)"

echo "адрес сервера : ${MY_IP:-неизвестен}"
echo "адрес домена  : ${DOMAIN_IP:-запись не найдена}"

if [[ -z "$DOMAIN_IP" ]]; then
  cat >&2 <<EOF

Имя $DOMAIN пока никуда не указывает.
Заведите у регистратора запись типа A: $DOMAIN -> $MY_IP
и запустите скрипт снова через несколько минут.
EOF
  exit 1
fi

if [[ "$DOMAIN_IP" != "$MY_IP" ]]; then
  cat >&2 <<EOF

Имя указывает на другой адрес. Сертификат так не выпустится:
Let's Encrypt проверяет владение, обращаясь по имени, и попадёт не сюда.

Поправьте запись A на $MY_IP и подождите обновления (обычно минуты,
иногда до часа), затем запустите скрипт снова.
EOF
  exit 1
fi
echo "совпадает — можно выпускать сертификат"

# ------------------------------------------------- 2. Убираем следы обходного пути
say "Отключение обходного туннеля"
systemctl disable --now crm-tunnel >/dev/null 2>&1 || true
sed -i '/crm-tunnel: обход недоступного узла Cloudflare/d' /etc/hosts 2>/dev/null || true
echo "выключен, подмена адреса убрана"

# ------------------------------------------------------------- 3. Приложение живо?
say "Проверка приложения"
if curl -fsS --max-time 10 http://127.0.0.1:3000/login >/dev/null 2>&1; then
  echo "отвечает на 127.0.0.1:3000"
else
  echo "приложение не отвечает — поднимите его: docker compose up -d" >&2
  exit 1
fi

# ------------------------------------------------------------------ 4. Обратный прокси
say "Настройка HTTPS"
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
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy
sleep 3

if ! systemctl is-active --quiet caddy; then
  echo "Caddy не запустился. Журнал:" >&2
  journalctl -u caddy -n 30 --no-pager >&2
  exit 1
fi
echo "Caddy работает"

# --------------------------------------------------------------- 5. Ждём сертификат
say "Выпуск сертификата"
echo "обычно занимает 10-30 секунд"
CODE=''
for i in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/login" 2>/dev/null || true)"
  [[ "$CODE" == '200' ]] && break
  sleep 3
done

if [[ "$CODE" == '200' ]]; then
  echo "сертификат выпущен, страница входа отдаётся по HTTPS"
else
  echo "по HTTPS пока ответ '${CODE:-нет}'. Журнал Caddy:" >&2
  journalctl -u caddy -n 30 --no-pager | tail -20 >&2
  echo >&2
  echo "Частая причина — лимит Let's Encrypt на домен. Подробности в журнале выше." >&2
  exit 1
fi

cat <<EOF

============================================================
  Адрес системы:  https://$DOMAIN
============================================================

Обычные HTTP-обращения теперь сами переходят на HTTPS.
Пароли и данные больше не ходят открытым текстом.

EOF
