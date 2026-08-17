# Развёртывание на сервере

## Требования к серверу

| | |
|---|---|
| ОС | Linux, Ubuntu 22.04/24.04 |
| Ресурсы | 2 CPU, 2 ГБ RAM, 20 ГБ диска — с запасом |
| Софт | Docker + Docker Compose |
| Расположение | **Россия** — см. раздел «Персональные данные» |
| Домен | нужен для HTTPS; можно поддомен вида `crm.вашдомен.ru` |

## Персональные данные

В системе лежат данные клиентов компании, а после загрузки справочника контрагентов
появятся **контактные лица, телефоны и e-mail — это персональные данные**.

Из этого следует:

- сервер должен быть **на территории России** (152-ФЗ, ст. 18 ч. 5);
- Vercel, Render, Fly.io, Netlify и прочий зарубежный хостинг **не подходят**;
- база наружу не публикуется, в `docker-compose.yml` порт Postgres не проброшен;
- доступ только по HTTPS;
- бэкапы хранить там же, где базу.

Подойдут: Timeweb Cloud, Selectel, Рег.ру, VK Cloud, Yandex Cloud, Cloud.ru.

---

## Установка

### 1. Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # перелогиниться после этого
```

### 2. Код и переменные

```bash
git clone <репозиторий> /opt/crm && cd /opt/crm
cp .env.example .env
```

Заполнить `.env`:

```bash
# сгенерировать значения
openssl rand -base64 32   # → POSTGRES_PASSWORD
openssl rand -base64 48   # → SESSION_SECRET
```

`SESSION_SECRET` короче 32 символов приложение не примет.

### 3. Запуск

```bash
docker compose up -d --build
docker compose logs -f app
```

Приложение слушает `127.0.0.1:3000` — наружу его выпускает обратный прокси.

### 4. Миграции и первый пользователь

```bash
docker compose exec app npx tsx scripts/migrate.ts
docker compose exec app npx tsx scripts/set-password.ts denis '<пароль>' 'Денис' head
docker compose exec app npx tsx scripts/set-password.ts lev '<пароль>' 'Лев' manager
```

### 5. Загрузка данных

Файл выгрузки из 1С загружается через веб-интерфейс, раздел **Импорт**.
Кампании после первого импорта собираются скриптом:

```bash
docker compose exec app npx tsx scripts/seed.ts /путь/к/выгрузке.xlsx
```

---

## HTTPS

Caddy сам получает и продлевает сертификат Let's Encrypt. `/etc/caddy/Caddyfile`:

```
crm.вашдомен.ru {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo apt install caddy && sudo systemctl reload caddy
```

Файрвол: наружу открыть только 80, 443 и SSH.

```bash
sudo ufw allow 22,80,443/tcp && sudo ufw enable
```

---

## Бэкапы

Ежедневный дамп базы в 3 часа ночи, хранить 30 дней:

```bash
sudo tee /etc/cron.daily/crm-backup >/dev/null <<'EOF'
#!/bin/sh
cd /opt/crm
mkdir -p /var/backups/crm
docker compose exec -T db pg_dump -U crm crm | gzip > /var/backups/crm/crm-$(date +\%F).sql.gz
find /var/backups/crm -name '*.sql.gz' -mtime +30 -delete
EOF
sudo chmod +x /etc/cron.daily/crm-backup
```

Восстановление:

```bash
gunzip -c /var/backups/crm/crm-2026-08-12.sql.gz | docker compose exec -T db psql -U crm crm
```

**Проверьте восстановление на тестовой базе хотя бы раз.** Бэкап, который никогда
не разворачивали, бэкапом не является.

---

## Обновление

```bash
cd /opt/crm && git pull
docker compose up -d --build
docker compose exec app npx tsx scripts/migrate.ts
```

---

## Что проверить после запуска

- [ ] `https://crm.домен.ru` открывается, отдаёт страницу входа
- [ ] без входа любой адрес редиректит на `/login`
- [ ] вход работает, в шапке видно имя
- [ ] «Выйти» разлогинивает
- [ ] Postgres снаружи недоступен: `nmap -p 5432 <ip>` — закрыт
- [ ] бэкап создался и разворачивается
