#!/usr/bin/env bash
# Пользователи системы: посмотреть список, завести нового, сменить пароль.
#
# Длинные команды с docker compose в консоли сервера набирать неудобно, а при
# вставке она теряет отдельные слова — уже дважды портила строку так, что
# команда выполнялась не та. Поэтому короткая обёртка.
#
#   bash u.sh                                     кто заведён
#   bash u.sh admin МойПароль123                  сменить пароль
#   bash u.sh lev Пароль123 Лев manager           завести нового
#
# Роли: head — видит всех и все кампании, manager — работает со своими.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ $# -eq 0 ]]; then
  docker compose exec -T db psql -U crm -d crm \
    -c 'select id, login, name, role from users order by id'
  echo
  echo 'Сменить пароль:  bash u.sh <логин> <пароль>'
  echo 'Завести нового:  bash u.sh <логин> <пароль> <Имя> <manager|head>'
  exit 0
fi

docker compose exec -T app node dist-scripts/set-password.js "$@"
