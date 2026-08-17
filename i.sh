#!/usr/bin/env bash
# Короткий запуск установки — чтобы в консоли сервера набирать меньше.
#
#   bash /opt/crm/i.sh
#
# Домен можно передать аргументом, иначе берётся значение по умолчанию.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# Скрипты могли приехать с переводами строк Windows — bash такое не выполняет.
# Правим на месте, без установки лишних пакетов.
sed -i 's/\r$//' scripts/*.sh 2>/dev/null || true

exec bash scripts/bootstrap-server.sh "${1:-shu6ka812.fvds.ru}"
