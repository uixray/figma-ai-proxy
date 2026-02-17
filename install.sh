#!/bin/bash

# Figma Yandex Proxy - Автоматическая установка на Yandex Cloud VM
# Версия: 1.0.0
#
# Использование:
#   bash <(curl -s https://raw.githubusercontent.com/your-username/figma-yandex-proxy/main/install.sh)
#
# Или скачать и запустить локально:
#   curl -O https://raw.githubusercontent.com/your-username/figma-yandex-proxy/main/install.sh
#   bash install.sh

set -e

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Баннер
echo ""
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}     🚀 Figma Yandex Proxy - Автоустановка${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}Этот скрипт установит и настроит прокси-сервер для Figma плагина${NC}"
echo ""

# Функция логирования
log_info() {
    echo -e "${CYAN}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[⚠]${NC} $1"
}

# Проверка прав sudo
check_sudo() {
    if ! sudo -n true 2>/dev/null; then
        log_info "Для установки требуются права sudo"
        sudo -v
    fi
}

# Обновление системы
update_system() {
    log_info "Обновление списка пакетов..."
    sudo apt-get update -qq
    log_success "Система обновлена"
}

# Установка Node.js
install_nodejs() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        log_success "Node.js уже установлен: $NODE_VERSION"

        # Проверка версии
        MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$MAJOR_VERSION" -lt 18 ]; then
            log_warning "Версия Node.js < 18, рекомендуется обновить"
            read -p "Обновить Node.js до версии 20.x? (y/n): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                log_info "Установка Node.js 20.x..."
                curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>&1 | grep -v "^deb"
                sudo apt-get install -y nodejs > /dev/null
                log_success "Node.js обновлён: $(node --version)"
            fi
        fi
    else
        log_info "Установка Node.js 20.x LTS..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>&1 | grep -v "^deb"
        sudo apt-get install -y nodejs > /dev/null
        log_success "Node.js установлен: $(node --version)"
    fi
}

# Создание директории проекта
create_project_dir() {
    PROJECT_DIR="$HOME/apps/figma-yandex-proxy"

    if [ -d "$PROJECT_DIR" ]; then
        log_warning "Директория $PROJECT_DIR уже существует"
        read -p "Удалить и переустановить? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log_info "Удаление старой версии..."
            rm -rf "$PROJECT_DIR"
            log_success "Старая версия удалена"
        else
            log_error "Установка прервана"
            exit 1
        fi
    fi

    log_info "Создание директории проекта..."
    mkdir -p "$PROJECT_DIR"
    cd "$PROJECT_DIR"
    log_success "Директория создана: $PROJECT_DIR"
}

# Скачивание файлов проекта
download_files() {
    log_info "Скачивание файлов проекта..."

    # Создаём package.json
    cat > package.json << 'EOF'
{
  "name": "figma-yandex-proxy",
  "version": "1.0.0",
  "description": "CORS proxy for Yandex Cloud Foundation Models API (Figma Plugin)",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "node test.js"
  },
  "keywords": ["figma", "yandex", "proxy", "cors"],
  "author": "",
  "license": "MIT",
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "express-rate-limit": "^7.1.5",
    "dotenv": "^16.3.1"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
EOF

    # Создаём server.js
    cat > server.js << 'SERVEREOF'
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;
const YANDEX_API_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

app.use(helmet());
app.use(cors({ origin: '*', methods: ['POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({
  windowMs: 60000,
  max: 60,
  message: { error: 'Too many requests, try again later' }
});

app.use('/api/yandex', limiter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'figma-yandex-proxy', version: '1.0.0', uptime: process.uptime() });
});

app.get('/api/info', (req, res) => {
  res.json({
    service: 'Figma Yandex Cloud Proxy',
    version: '1.0.0',
    endpoints: { health: 'GET /health', proxy: 'POST /api/yandex', info: 'GET /api/info' }
  });
});

app.post('/api/yandex', async (req, res) => {
  try {
    const apiKey = req.headers.authorization;
    if (!apiKey) return res.status(401).json({ error: 'Authorization required' });

    const yandexResponse = await fetch(YANDEX_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
      body: JSON.stringify(req.body)
    });

    const data = await yandexResponse.json();
    res.status(yandexResponse.status).json(data);
  } catch (error) {
    console.error('[ERROR]', error.message);
    res.status(500).json({ error: 'Proxy error' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Proxy running on port ${PORT}`);
});
SERVEREOF

    # Создаём .env
    cat > .env << 'EOF'
PORT=3001
NODE_ENV=production
EOF

    log_success "Файлы проекта созданы"
}

# Установка зависимостей
install_dependencies() {
    log_info "Установка зависимостей npm..."
    npm install --silent 2>&1 | grep -v "npm WARN"
    log_success "Зависимости установлены"
}

# Установка PM2
install_pm2() {
    if command -v pm2 &> /dev/null; then
        log_success "PM2 уже установлен: $(pm2 --version)"
    else
        log_info "Установка PM2..."
        sudo npm install -g pm2 --silent
        log_success "PM2 установлен"
    fi
}

# Запуск сервера
start_server() {
    log_info "Остановка старого процесса (если существует)..."
    pm2 stop figma-proxy 2>/dev/null || true
    pm2 delete figma-proxy 2>/dev/null || true

    log_info "Запуск нового процесса..."
    pm2 start server.js --name "figma-proxy" --time
    pm2 save

    log_success "Сервер запущен!"

    # Настройка автозапуска
    log_info "Настройка автозапуска при перезагрузке..."
    sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME 2>&1 | grep -v "PM2"

    log_success "Автозапуск настроен"
}

# Тест сервера
test_server() {
    log_info "Тестирование сервера..."
    sleep 2

    RESPONSE=$(curl -s http://localhost:3001/health)
    if echo "$RESPONSE" | grep -q "ok"; then
        log_success "Сервер работает корректно!"
        echo ""
        echo -e "${GREEN}Тест health check:${NC}"
        echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
    else
        log_error "Сервер не отвечает"
        log_info "Проверьте логи: pm2 logs figma-proxy"
    fi
}

# Настройка Nginx
setup_nginx() {
    echo ""
    log_info "Настройка Nginx..."

    if ! command -v nginx &> /dev/null; then
        log_warning "Nginx не установлен"
        read -p "Установить Nginx? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sudo apt-get install -y nginx
            log_success "Nginx установлен"
        else
            log_warning "Пропускаем настройку Nginx"
            return
        fi
    fi

    echo ""
    echo "Выберите вариант настройки:"
    echo "  1) Поддомен (например: proxy.yourdomain.com)"
    echo "  2) Путь на существующем домене (например: yourdomain.com/api/yandex-proxy)"
    echo "  3) Пропустить настройку Nginx (сделаю вручную)"
    echo ""
    read -p "Ваш выбор (1/2/3): " -n 1 -r
    echo

    case $REPLY in
        1)
            read -p "Введите имя поддомена (например: proxy.yourdomain.com): " SUBDOMAIN
            create_nginx_subdomain "$SUBDOMAIN"
            ;;
        2)
            read -p "Введите основной домен (например: yourdomain.com): " DOMAIN
            create_nginx_path "$DOMAIN"
            ;;
        3)
            log_info "Настройка Nginx пропущена"
            ;;
        *)
            log_warning "Неверный выбор, пропускаем"
            ;;
    esac
}

# Создание конфига Nginx для поддомена
create_nginx_subdomain() {
    local SUBDOMAIN=$1
    local CONFIG_FILE="/etc/nginx/sites-available/figma-proxy"

    log_info "Создание конфига для $SUBDOMAIN..."

    sudo tee $CONFIG_FILE > /dev/null << EOF
server {
    listen 80;
    server_name $SUBDOMAIN;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

    sudo ln -sf $CONFIG_FILE /etc/nginx/sites-enabled/figma-proxy
    sudo nginx -t && sudo systemctl reload nginx

    log_success "Nginx конфиг создан"
    echo ""
    log_info "Теперь настройте DNS для $SUBDOMAIN → $(curl -s ifconfig.me)"
    log_info "Затем получите SSL сертификат:"
    echo -e "${YELLOW}  sudo certbot --nginx -d $SUBDOMAIN${NC}"
}

# Создание конфига Nginx для пути
create_nginx_path() {
    local DOMAIN=$1

    log_warning "Необходимо вручную добавить в существующий конфиг Nginx:"
    echo ""
    echo -e "${YELLOW}location /api/yandex-proxy {${NC}"
    echo -e "${YELLOW}    rewrite ^/api/yandex-proxy/(.*)\$ /\$1 break;${NC}"
    echo -e "${YELLOW}    proxy_pass http://localhost:3001;${NC}"
    echo -e "${YELLOW}    proxy_set_header Host \$host;${NC}"
    echo -e "${YELLOW}}${NC}"
    echo ""
    log_info "Добавьте эти строки в конфиг для $DOMAIN"
}

# Финальная информация
show_final_info() {
    echo ""
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✅ Установка завершена!${NC}"
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${CYAN}📊 Статус сервера:${NC}"
    pm2 status figma-proxy
    echo ""
    echo -e "${CYAN}📝 Полезные команды:${NC}"
    echo ""
    echo "  Просмотр логов:"
    echo -e "    ${YELLOW}pm2 logs figma-proxy${NC}"
    echo ""
    echo "  Перезапуск сервера:"
    echo -e "    ${YELLOW}pm2 restart figma-proxy${NC}"
    echo ""
    echo "  Остановка сервера:"
    echo -e "    ${YELLOW}pm2 stop figma-proxy${NC}"
    echo ""
    echo "  Тест health check:"
    echo -e "    ${YELLOW}curl http://localhost:3001/health${NC}"
    echo ""
    echo -e "${CYAN}🌐 Endpoints:${NC}"
    echo "  Health: http://localhost:3001/health"
    echo "  Info:   http://localhost:3001/api/info"
    echo "  Proxy:  http://localhost:3001/api/yandex"
    echo ""
    echo -e "${CYAN}📂 Директория проекта:${NC}"
    echo "  $PROJECT_DIR"
    echo ""
    echo -e "${CYAN}🔧 Следующие шаги:${NC}"
    echo "  1. Настройте DNS для вашего домена"
    echo "  2. Получите SSL сертификат (certbot)"
    echo "  3. Обновите Figma плагин с URL вашего прокси"
    echo ""
    echo -e "${GREEN}🎉 Прокси готов к использованию!${NC}"
    echo ""
}

# Главная функция
main() {
    check_sudo
    update_system
    install_nodejs
    create_project_dir
    download_files
    install_dependencies
    install_pm2
    start_server
    test_server
    setup_nginx
    show_final_info
}

# Запуск
main
