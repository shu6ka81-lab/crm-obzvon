#!/usr/bin/env bash
# Публикует CRM наружу через туннель Cloudflare.
#
# Зачем: до сервера не доходят входящие пакеты — их режут выше по сети,
# у хостера. Наружу сервер при этом ходит свободно. Туннель этим и
# пользуется: сервер сам устанавливает исходящее соединение, а Cloudflare
# отдаёт сайт по обычной ссылке. Открывать порты не требуется.
#
#   bash t.sh          поднять туннель и показать ссылку
#   bash t.sh --stop   выключить
#   bash t.sh --url    показать текущую ссылку
#
# Ссылка временная: при перезапуске туннеля она меняется.

set -euo pipefail

LOG=/var/log/cloudflared-quick.log
UNIT=/etc/systemd/system/crm-tunnel.service

show_url() {
  grep -oh 'https://[a-z0-9-]\+\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1
}

case "${1:-}" in
  --stop)
    systemctl disable --now crm-tunnel >/dev/null 2>&1 || true
    echo "Туннель выключен."
    exit 0
    ;;
  --url)
    u="$(show_url)"
    if [[ -n "$u" ]]; then echo "$u"; else echo "Ссылки нет — туннель не запущен." >&2; exit 1; fi
    exit 0
    ;;
esac

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# ------------------------------------------------------------ приложение живо?
say "Проверка приложения"
if curl -fsS --max-time 10 http://127.0.0.1:3000/login >/dev/null 2>&1; then
  echo "отвечает на 127.0.0.1:3000"
else
  echo "приложение не отвечает — сначала поднимите его: docker compose up -d" >&2
  exit 1
fi

# ------------------------------------------------------------ cloudflared
say "Программа туннеля"
if command -v cloudflared >/dev/null 2>&1; then
  echo "уже установлена: $(cloudflared --version 2>/dev/null | head -1)"
else
  case "$(uname -m)" in
    x86_64)  ARCH=amd64 ;;
    aarch64) ARCH=arm64 ;;
    *) echo "неизвестная архитектура $(uname -m)" >&2; exit 1 ;;
  esac
  BASE=https://github.com/cloudflare/cloudflared/releases/latest/download
  if curl -fsSL --max-time 120 "$BASE/cloudflared-linux-$ARCH.deb" -o /tmp/cloudflared.deb; then
    dpkg -i /tmp/cloudflared.deb >/dev/null
  else
    echo "пакет не скачался, беру отдельный файл"
    curl -fsSL --max-time 120 "$BASE/cloudflared-linux-$ARCH" -o /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared
  fi
  echo "установлена: $(cloudflared --version 2>/dev/null | head -1)"
fi

# ------------------------------------------------------------ служба
say "Запуск туннеля"
: > "$LOG"
cat > "$UNIT" <<UNITEOF
[Unit]
Description=Туннель Cloudflare для CRM
After=network-online.target docker.service
Wants=network-online.target

[Service]
ExecStart=$(command -v cloudflared) tunnel --no-autoupdate --loglevel info --logfile $LOG --url http://127.0.0.1:3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNITEOF
systemctl daemon-reload
systemctl enable crm-tunnel >/dev/null 2>&1 || true
systemctl restart crm-tunnel

# ------------------------------------------------------------ ждём ссылку
say "Ожидание ссылки"
URL=""
for i in $(seq 1 40); do
  URL="$(show_url)"
  [[ -n "$URL" ]] && break
  sleep 2
done

if [[ -z "$URL" ]]; then
  echo "ссылка не появилась за 80 секунд. Журнал:" >&2
  tail -30 "$LOG" >&2
  exit 1
fi

# Проверяем снаружи же, а не только по журналу: туннель может подняться,
# а приложение за ним отвечать ошибкой — тогда ссылка бесполезна.
say "Проверка снаружи"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$URL/login" || echo '000')"
echo "ответ по ссылке: HTTP $CODE"

cat <<EOF

============================================================
  Адрес системы:  $URL
============================================================

Открывается из любой сети — входящие порты не нужны.
Ссылка временная и меняется при перезапуске туннеля.

  bash t.sh --url    показать ссылку снова
  bash t.sh --stop   выключить туннель

EOF
