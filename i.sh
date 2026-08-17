#!/usr/bin/env bash
# Короткий запуск установки — чтобы в консоли сервера набирать меньше.
#
#   bash /opt/crm/i.sh              обновиться и установить
#   bash /opt/crm/i.sh --no-pull    установить то, что уже лежит на диске
#
# Домен можно передать вторым аргументом, иначе берётся значение по умолчанию.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

DOMAIN_DEFAULT="shu6ka812.fvds.ru"
PULL=1
DOMAIN=""

for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    *) DOMAIN="$arg" ;;
  esac
done

# Подтягиваем свежий код сами: иначе легко запустить установку по старому
# коду и долго искать, почему исправление «не помогло».
if [[ $PULL -eq 1 && -d .git ]]; then
  echo "==> Обновление кода"
  # Приводим рабочее дерево в исходное состояние. Раньше здесь оставались
  # следы правки переводов строк, и git отказывался делать pull.
  git checkout -- . 2>/dev/null || true
  if git fetch --quiet origin 2>/dev/null; then
    git reset --hard --quiet "origin/$(git rev-parse --abbrev-ref HEAD)" 2>/dev/null \
      || git reset --hard --quiet origin/main
    echo "код обновлён до $(git log --oneline -1)"
  else
    echo "не удалось связаться с GitHub — ставлю то, что есть на диске"
  fi
fi

# Файлы могли приехать с переводами строк Windows — bash такое не выполняет.
# Правим во временной копии, чтобы не пачкать рабочее дерево git.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp scripts/bootstrap-server.sh "$TMP/bootstrap.sh"
sed -i 's/\r$//' "$TMP/bootstrap.sh"

# Каталог с кодом передаём явно: скрипт запускается из временной копии
# и сам его определить не сможет.
export APP_DIR="$PWD"
exec bash "$TMP/bootstrap.sh" "${DOMAIN:-$DOMAIN_DEFAULT}"
