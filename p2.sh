#!/usr/bin/env bash
# Ищет доступный узел Cloudflare и направляет на него регистрацию туннеля.
#
# Что выяснила проверка p.sh: край сети Cloudflare с этого сервера открыт
# (argotunnel:7844 отвечает за 38 мс), а адрес регистрации api.trycloudflare.com
# недоступен — он ведёт в диапазон 104.16.x, который здесь режут.
#
# Cloudflare — сеть anycast: одно и то же имя обслуживают сотни узлов, и любой
# из них отвечает за любое имя — узел выбирается по имени в запросе, а не по
# адресу. Значит достаточно найти узел, до которого пакеты доходят, и указать
# его в /etc/hosts. Имя останется прежним, сертификат сойдётся, поменяется
# только маршрут.
#
#   bash p2.sh

set -uo pipefail

HOST=api.trycloudflare.com
MARK='# crm-tunnel: обход недоступного узла Cloudflare'

echo
echo '--- собираю адреса узлов Cloudflare ---'
# Берём адреса разных имён, живущих на Cloudflare: у них разные узлы,
# и хотя бы часть окажется вне закрытого диапазона.
IPS=$(for h in \
        cloudflare.com www.cloudflare.com cdnjs.cloudflare.com \
        speed.cloudflare.com one.one.one.one workers.dev \
        region1.v2.argotunnel.com region2.v2.argotunnel.com "$HOST"; do
        getent ahostsv4 "$h" 2>/dev/null | awk '{print $1}'
      done | sort -u)
echo "$IPS" | tr '\n' ' '
echo
echo

printf '%-18s %-12s  %s\n' 'АДРЕС УЗЛА' 'ПОРТ 443' 'РЕГИСТРАЦИЯ'
printf '%s\n' '-------------------------------------------------------'

GOOD=''
for ip in $IPS; do
  if timeout 5 bash -c "</dev/tcp/$ip/443" 2>/dev/null; then
    open='открыт'
    # Пробуем сам запрос регистрации через этот узел. Код 000 означает,
    # что ответа не было вовсе; любой настоящий код — что узел говорит с нами.
    code=$(curl -sS -o /dev/null -m 15 -X POST \
             --resolve "$HOST:443:$ip" "https://$HOST/tunnel" \
             -w '%{http_code}' 2>/dev/null || echo 000)
    if [[ "$code" != '000' ]]; then
      res="отвечает, код $code"
      [[ -z "$GOOD" ]] && GOOD="$ip"
    else
      res='молчит'
    fi
  else
    open='НЕДОСТУПЕН'
    res='—'
  fi
  printf '%-18s %-12s  %s\n' "$ip" "$open" "$res"
done

echo
if [[ -z "$GOOD" ]]; then
  cat <<'EOF'
Ни один узел Cloudflare не отвечает на запрос регистрации.
Обход не получился — идём запасным путём (pinggy или bore).
EOF
  exit 1
fi

echo "Подходящий узел: $GOOD"
echo '--- прописываю его в /etc/hosts ---'
sed -i "/$MARK/d;/[[:space:]]$HOST\$/d" /etc/hosts
printf '%s %s %s\n' "$GOOD" "$HOST" "$MARK" >> /etc/hosts
grep "$HOST" /etc/hosts

echo
echo 'Готово. Теперь поднимайте туннель:  bash t.sh'
echo
