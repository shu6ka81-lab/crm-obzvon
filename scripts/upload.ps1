# Заливает код на сервер и запускает установку.
# Запуск с этой машины:
#   powershell -File scripts\upload.ps1 -Server root@1.2.3.4 -Domain crm.вашдомен.ru
#
# Требуется настроенный доступ по SSH-ключу. Пароли скрипт не спрашивает.

param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Domain,
  [string]$Path = '/opt/crm'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host "==> Проверка связи с $Server" -ForegroundColor Cyan
ssh -o BatchMode=yes -o ConnectTimeout=10 $Server 'echo ok' | Out-Null

Write-Host "==> Упаковка проекта" -ForegroundColor Cyan
$archive = Join-Path $env:TEMP 'crm-deploy.tar.gz'
if (Test-Path $archive) { Remove-Item $archive -Force }

# .env, node_modules, сборка и локальная база на сервер не едут
Push-Location $root
try {
  tar --exclude=node_modules --exclude=.next --exclude=.pglite --exclude=.env `
      --exclude=.git -czf $archive .
} finally {
  Pop-Location
}
$sizeMb = [math]::Round((Get-Item $archive).Length / 1MB, 1)
Write-Host "    архив $sizeMb МБ"

Write-Host "==> Загрузка на сервер" -ForegroundColor Cyan
ssh $Server "mkdir -p $Path"
scp $archive "${Server}:$Path/crm-deploy.tar.gz"

Write-Host "==> Распаковка и установка" -ForegroundColor Cyan
ssh $Server "cd $Path && tar -xzf crm-deploy.tar.gz && rm crm-deploy.tar.gz && sudo bash scripts/bootstrap-server.sh $Domain"

Write-Host ""
Write-Host "Готово. Откройте https://$Domain" -ForegroundColor Green
Write-Host "Дальше заведите пользователей — команды напечатаны выше." -ForegroundColor Green
