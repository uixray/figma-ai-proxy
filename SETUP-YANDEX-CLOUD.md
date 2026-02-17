# Настройка на Yandex Cloud VM (с существующими сервисами)

## Твоя ситуация
- ✅ VM уже работает
- ✅ Nginx уже установлен (для сайта)
- ✅ VPN Amnezia уже настроен
- 🎯 Нужно добавить прокси на отдельный поддомен

---

## 🚀 Быстрая установка (10 минут)

### 1. Подключиться к серверу

```bash
ssh your-user@your-server-ip
```

### 2. Скачать проект

```bash
# Создать директорию
mkdir -p ~/apps
cd ~/apps

# Клонировать (или скачать ZIP и распаковать)
git clone https://github.com/your-username/figma-yandex-proxy.git
cd figma-yandex-proxy

# Дать права на выполнение
chmod +x deploy.sh
```

### 3. Запустить деплой скрипт

```bash
bash deploy.sh
```

Скрипт автоматически:
- Проверит Node.js (установит если нужно)
- Установит зависимости
- Установит PM2
- Запустит сервер
- Настроит автозапуск

### 4. Проверить что работает

```bash
# Проверка здоровья
curl http://localhost:3001/health

# Должен вернуть:
# {"status":"ok","service":"figma-yandex-proxy",...}
```

---

## 🌐 Настройка Nginx (добавить поддомен)

### Вариант A: Отдельный поддомен (рекомендую)

**Пример:** `proxy.yourdomain.com`

```bash
# Создать конфиг
sudo nano /etc/nginx/sites-available/figma-proxy
```

Содержимое:
```nginx
server {
    listen 80;
    server_name proxy.yourdomain.com;

    # Для Let's Encrypt (временно)
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Редирект на HTTPS (раскомментировать после получения SSL)
    # return 301 https://$server_name$request_uri;

    # Временный проксинг до получения SSL
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Активировать:
```bash
sudo ln -s /etc/nginx/sites-available/figma-proxy /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Получить SSL сертификат:
```bash
sudo certbot --nginx -d proxy.yourdomain.com
```

После получения SSL, обновить конфиг (certbot сделает это автоматически).

---

### Вариант B: Путь на существующем домене

**Пример:** `yourdomain.com/api/yandex-proxy`

Добавить в **существующий** конфиг Nginx:

```bash
sudo nano /etc/nginx/sites-available/your-existing-site
```

Добавить внутрь `server` блока:
```nginx
server {
    # ... существующие настройки ...

    # Figma Yandex Proxy
    location /api/yandex-proxy {
        # Убрать /api/yandex-proxy из пути при проксировании
        rewrite ^/api/yandex-proxy/(.*)$ /$1 break;

        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # CORS заголовки (если Nginx не проксирует их)
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;

        # Preflight
        if ($request_method = 'OPTIONS') {
            return 204;
        }
    }
}
```

Перезагрузить Nginx:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 🧪 Тестирование

### 1. Локальный тест (на сервере)

```bash
curl http://localhost:3001/health
```

### 2. Тест через домен

```bash
# Если используешь поддомен
curl https://proxy.yourdomain.com/health

# Если используешь путь
curl https://yourdomain.com/api/yandex-proxy/health
```

### 3. Тест с реальным Yandex API

Отредактировать `test.js`:
```bash
nano test.js

# Заменить:
# - YANDEX_API_KEY на свой ключ
# - YANDEX_FOLDER_ID на свой folder ID
# - PROXY_URL на свой домен
```

Запустить:
```bash
node test.js
```

---

## 🔧 Совместимость с VPN и сайтом

### Порты

- **VPN Amnezia:** использует свои порты (обычно 51820 для WireGuard)
- **Сайт:** Nginx проксирует на свой порт (например, 8080)
- **Figma Proxy:** работает на порту 3001
- **Nginx:** 80/443 (уже занят, используется для всего)

✅ **Конфликтов нет** - все работает через Nginx на разных путях/доменах.

### Ресурсы

Figma proxy очень лёгкий:
- RAM: ~50MB
- CPU: минимальное использование (спайки только при запросах)

На VM с 2GB RAM это не проблема.

---

## 📊 Мониторинг

### PM2

```bash
# Статус
pm2 status

# Логи
pm2 logs figma-proxy

# Использование ресурсов
pm2 monit

# Перезапуск
pm2 restart figma-proxy
```

### Nginx

```bash
# Access logs
sudo tail -f /var/log/nginx/access.log | grep proxy

# Error logs
sudo tail -f /var/log/nginx/error.log
```

---

## 🛡️ Безопасность

### Firewall (если используешь ufw)

```bash
# Открыть только 80/443 (Nginx)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Порт 3001 НЕ открывать! Он доступен только локально
# Nginx проксирует к нему
```

### Rate Limiting в Nginx (опционально)

Добавить в конфиг:
```nginx
# В http блоке /etc/nginx/nginx.conf
limit_req_zone $binary_remote_addr zone=proxy_limit:10m rate=10r/s;

# В location блоке
location /api/yandex {
    limit_req zone=proxy_limit burst=20;
    # ... остальные настройки proxy_pass ...
}
```

---

## 🔄 Обновление

```bash
cd ~/apps/figma-yandex-proxy
git pull
npm install
pm2 restart figma-proxy
```

---

## ❓ FAQ

**Q: Прокси конфликтует с VPN?**
A: Нет, они работают независимо на разных портах.

**Q: Как изменить порт прокси?**
A: Отредактируй `.env` → `PORT=3002`, затем `pm2 restart figma-proxy`

**Q: Сколько это стоит?**
A: Прокси сам по себе бесплатный. Оплачивается только VM и трафик Yandex Cloud (копейки).

**Q: Может ли кто-то использовать мой прокси?**
A: Да, если знает домен. Но без своего Yandex API ключа они ничего не смогут сделать.

**Q: Нужно ли хранить API ключи на сервере?**
A: НЕТ! Каждый пользователь отправляет свой ключ в заголовке Authorization.

---

## 🆘 Помощь

**Прокси не запускается:**
```bash
pm2 logs figma-proxy --lines 50
```

**Nginx ошибки:**
```bash
sudo nginx -t
sudo systemctl status nginx
```

**Проверка портов:**
```bash
sudo netstat -tulpn | grep :3001
```

---

Готово! Теперь у тебя есть production-ready прокси для Figma плагина 🎉
