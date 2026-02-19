# Cloudflare Worker — AI API Proxy

Cloudflare Worker, который проксирует запросы к AI-провайдерам через сеть Cloudflare.
Позволяет обходить региональные ограничения без покупки дополнительных серверов.

## Как это работает

```
Ваш сервер (Яндекс.Облако, РФ)
    │
    │ POST к Worker с X-Target-URL
    ▼
Cloudflare Worker (edge-нода, Хельсинки/Франкфурт)
    │
    │ POST к реальному API
    ▼
AI Provider API (Gemini, Claude, и т.д.)
```

У Cloudflare нет серверов в РФ, поэтому Worker выполняется на ближайшей зарубежной ноде.

## Быстрый старт

### 1. Установите Wrangler (CLI для Cloudflare Workers)

```bash
npm install -g wrangler
```

### 2. Авторизуйтесь в Cloudflare

```bash
wrangler login
```

Откроется браузер для авторизации. Бесплатный аккаунт подходит.

### 3. Разверните Worker

```bash
cd cloudflare-worker
npx wrangler deploy
```

Вы получите URL вида: `https://ai-api-proxy.YOUR_NAME.workers.dev`

### 4. Установите секретный токен

```bash
npx wrangler secret put AUTH_TOKEN
```

Введите любой секретный токен (например, сгенерируйте: `openssl rand -hex 32`).

### 5. Настройте прокси-сервер

В файле `.env` на вашем сервере:

```env
PROXY_GEMINI=worker://ai-api-proxy.YOUR_NAME.workers.dev
PROXY_AUTH_TOKEN=ваш-секретный-токен
```

Перезапустите сервер. Запросы к Gemini теперь идут через Cloudflare.

## Лимиты бесплатного плана

| Параметр | Лимит |
|----------|-------|
| Запросов в день | 100,000 |
| CPU-время на запрос | 10 мс |
| Размер тела запроса | 100 МБ |

Для типичного использования AI API (десятки-сотни запросов в день) бесплатного плана более чем достаточно.

## Проверка работы

Проверить, что Worker развёрнут и работает:

```bash
curl -X POST https://ai-api-proxy.YOUR_NAME.workers.dev \
  -H "X-Auth-Token: ваш-токен" \
  -H "X-Target-URL: https://httpbin.org/post" \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

## Безопасность

- Worker защищён токеном (`AUTH_TOKEN`) — без него запросы отклоняются
- Поддерживаются только HTTPS-цели
- Worker не хранит данные, логи или API-ключи
- Токен хранится в Cloudflare Secrets (зашифрован, не виден в коде)
