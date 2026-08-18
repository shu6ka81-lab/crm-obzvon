#!/usr/bin/env bash
# Ищет рабочий адрес api.trycloudflare.com — по-настоящему, а не по коду ответа.
#
# Предыдущая попытка исходила из того, что узлы Cloudflare взаимозаменяемы.
# Это неверно: чужой узел отвечает 403 с кодом 1034 «имя здесь не обслуживается».
# Проверка при этом видела «код 200» на странице отказа и считала узел годным.
# Теперь смотрим не на код, а на содержимое ответа.
#
# Заодно проверяем сеть шестой версии: адреса Cloudflare в ней те же по смыслу,
# но лежат в других диапазонах, и режут их заметно реже.
#
#   bash p3.sh

set -uo pipefail

HOST=api.trycloudflare.com
MARK='# crm-tunnel: обход недоступного узла Cloudflare'

# Снимаем прошлый обход: он направлял имя на узел, который его не обслуживает,
# и мешал бы честному замеру.
sed -i "/$MARK/d" /etc/hosts

command -v dig >/dev/null 2>&1 || apt-get install -y -qq dnsutils >/dev/null 2>&1 || true

echo
echo '--- есть ли у сервера сеть шестой версии ---'
if timeout 8 bash -c '</dev/tcp/2606:4700:4700::1111/443' 2>/dev/null; then
  echo 'да, узел Cloudflare отвечает по шестой версии'
  HAVE_V6=1
else
  echo 'нет, шестая версия недоступна'
  HAVE_V6=0
fi

echo
echo "--- какие адреса выдают разные серверы имён для $HOST ---"
IPS=''
for ns in 77.88.8.8 8.8.8.8 1.1.1.1 9.9.9.9 208.67.222.222; do
  got=$(dig +short +time=3 +tries=1 "@$ns" "$HOST" A 2>/dev/null | grep -E '^[0-9]+\.' | tr '\n' ' ')
  printf '  %-16s %s\n' "$ns" "${got:-нет ответа}"
  IPS="$IPS $got"
done

if [[ "$HAVE_V6" == '1' ]]; then
  echo
  echo "--- адреса шестой версии для $HOST ---"
  V6=$(dig +short +time=3 +tries=1 @1.1.1.1 "$HOST" AAAA 2>/dev/null | grep ':' | tr '\n' ' ')
  echo "  ${V6:-нет}"
  IPS="$IPS $V6"
fi

IPS=$(echo "$IPS" | tr ' ' '\n' | sed '/^$/d' | sort -u)

echo
printf '%-40s %-12s  %s\n' 'АДРЕС' 'ПОРТ 443' 'ЧТО ОТВЕЧАЕТ'
printf '%s\n' '----------------------------------------------------------------------------'

GOOD=''
for ip in $IPS; do
  # В curl адрес шестой версии для --resolve пишется в квадратных скобках
  case "$ip" in *:*) probe="[$ip]"; res="$HOST:443:[$ip]" ;; *) probe="$ip"; res="$HOST:443:$ip" ;; esac

  if timeout 6 bash -c "</dev/tcp/$ip/443" 2>/dev/null; then
    open='открыт'
    body=$(curl -sS -m 15 --resolve "$res" "https://$HOST/" 2>&1 | head -c 400)
    if echo "$body" | grep -q '1034'; then
      what='чужой узел, имя не обслуживает'
    elif [[ -z "$body" ]]; then
      what='пусто'
      [[ -z "$GOOD" ]] && GOOD="$ip"
    else
      what="отвечает по существу: $(echo "$body" | tr -d '\n' | head -c 60)"
      [[ -z "$GOOD" ]] && GOOD="$ip"
    fi
  else
    open='НЕДОСТУПЕН'
    what='—'
  fi
  printf '%-40s %-12s  %s\n' "$probe" "$open" "$what"
done

echo
if [[ -z "$GOOD" ]]; then
  cat <<'EOF'
Рабочего адреса нет: все адреса этого имени лежат в закрытых диапазонах.
Туннель Cloudflare с этого сервера не поднять — переходим к запасному пути.
EOF
  exit 1
fi

echo "Рабочий адрес: $GOOD"
printf '%s %s %s\n' "$GOOD" "$HOST" "$MARK" >> /etc/hosts
echo 'Прописан. Теперь:  bash t.sh'
echo
