#!/usr/bin/env bash
# Проверяет, какие каналы наружу с этого сервера вообще открыты.
#
# Туннель Cloudflare не поднялся: запрос на регистрацию отваливается по
# таймауту. Прежде чем пробовать следующий способ, выясняем, куда сервер
# может достучаться, а куда нет — вслепую перебирать долго.
#
#   bash p.sh

set -uo pipefail

echo
printf '%-34s %-7s %10s  %s\n' 'КУДА' 'ПОРТ' 'ВРЕМЯ' 'РЕЗУЛЬТАТ'
printf '%s\n' '--------------------------------------------------------------------------'

probe() {
  local name="$1" host="$2" port="$3"
  local t0 t1 ms out
  t0=$(date +%s%3N)
  if timeout 8 bash -c "</dev/tcp/$host/$port" 2>/dev/null; then
    out='открыт'
  else
    out='НЕДОСТУПЕН'
  fi
  t1=$(date +%s%3N)
  ms=$((t1 - t0))
  printf '%-34s %-7s %8s мс  %s\n' "$name" "$port" "$ms" "$out"
}

# Куда ходит агент Cloudflare — то, что сейчас не работает
probe 'api.trycloudflare.com'      api.trycloudflare.com      443
probe 'region1.v2.argotunnel.com'  region1.v2.argotunnel.com  7844

# Туннели поверх обычного SSH — часто проходят там, где HTTPS режут
probe 'localhost.run'              localhost.run              22
probe 'a.pinggy.io'                a.pinggy.io                443
probe 'bore.pub'                   bore.pub                   7835

# Контроль: заведомо живые адреса. Если и они молчат — дело не в туннелях
probe 'github.com'                 github.com                 443
probe 'ya.ru'                      ya.ru                      443

echo
echo '--- запрос регистрации туннеля Cloudflare, подробно ---'
curl -sS -o /dev/null -m 20 \
  -w 'соединение %{time_connect} с, ответ %{time_total} с, код %{http_code}\n' \
  -X POST 'https://api.trycloudflare.com/tunnel' 2>&1 | tail -3

echo
echo '--- что отдаёт DNS ---'
getent ahostsv4 api.trycloudflare.com 2>/dev/null | awk '{print $1}' | sort -u | head -4
echo
