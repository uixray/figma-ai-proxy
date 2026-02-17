# 🚀 Quick Start Guide

## Для Yandex Cloud VM

### 1. Скачай на сервер

```bash
ssh your-user@your-server.com
cd ~/apps
git clone https://github.com/your-username/figma-yandex-proxy.git
cd figma-yandex-proxy
```

### 2. Запусти деплой

```bash
chmod +x deploy.sh
bash deploy.sh
```

### 3. Настрой Nginx

**Вариант A: Поддомен** (например `proxy.yourdomain.com`)

```bash
sudo nano /etc/nginx/sites-available/figma-proxy
```

```nginx
server {
    listen 80;
    server_name proxy.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/figma-proxy /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d proxy.yourdomain.com
```

**Вариант B: Путь** (например `yourdomain.com/api/yandex-proxy`)

Добавь в существующий конфиг Nginx:

```nginx
location /api/yandex-proxy {
    rewrite ^/api/yandex-proxy/(.*)$ /$1 break;
    proxy_pass http://localhost:3001;
    proxy_set_header Host $host;
}
```

### 4. Протестируй

```bash
# Через curl
curl https://proxy.yourdomain.com/health

# В браузере
https://proxy.yourdomain.com
```

### 5. Обнови плагин

В `figma-llm-plugin/src/shared/constants.ts`:

```typescript
export const YANDEX_PROXY_URL = 'https://proxy.yourdomain.com/api/yandex';
```

---

## Управление

```bash
# Статус
pm2 status

# Логи
pm2 logs figma-proxy

# Перезапуск
pm2 restart figma-proxy

# Остановка
pm2 stop figma-proxy
```

---

## Endpoints

- `GET /` - Web UI для тестирования
- `GET /health` - Health check
- `GET /api/info` - API документация
- `POST /api/yandex` - Основной прокси

---

## Полная документация

- [README.md](README.md) - Полная документация
- [SETUP-YANDEX-CLOUD.md](SETUP-YANDEX-CLOUD.md) - Детальная настройка для твоего случая

---

Готово! 🎉
