# Figma AI Proxy v2.0.0

Multi-provider CORS proxy for AI APIs, designed for Figma plugins.

## Why?

Figma plugins run with `null` origin, which most AI provider APIs reject due to CORS restrictions. This proxy solves the problem by acting as an intermediary with a real domain.

```
Figma Plugin (null origin)
    ↓ POST /api/{provider}/...
Proxy Server (real domain)
    ↓ POST to real API
AI Provider (OpenAI, Claude, Gemini, etc.) ✅
```

## Supported Providers

| Provider | Proxy Endpoint | Real API Target |
|----------|---------------|-----------------|
| **Yandex Cloud** | `POST /api/yandex` | `llm.api.cloud.yandex.net` |
| **Anthropic Claude** | `POST /api/claude/*` | `api.anthropic.com` |
| **Google Gemini** | `POST /api/gemini/*` | `generativelanguage.googleapis.com` |
| **Groq** | `POST /api/groq/*` | `api.groq.com` |
| **Mistral AI** | `POST /api/mistral/*` | `api.mistral.ai` |
| **Cohere** | `POST /api/cohere/*` | `api.cohere.ai` |

## Security

- **Stateless** — does not store API keys, request bodies, or user data
- **Rate limiting** — 60 requests/min per IP per provider
- **Helmet.js** — security headers (XSS, MIME sniffing, etc.)
- **Safe logging** — logs only timestamps, methods, paths, IPs
- **Open source** — code available for audit

## Quick Start

### Requirements

- Node.js >= 18.0.0
- npm
- Domain with HTTPS (via Nginx reverse proxy)

### Install & Run

```bash
git clone https://github.com/uixray/figma-ai-proxy.git
cd figma-ai-proxy
npm install
cp .env.example .env
npm start
```

Server starts on port 3001 by default.

### Test

```bash
# Health check
curl http://localhost:3001/health

# Run test suite
node test.js

# Test specific providers (set API keys in test.js first)
node test.js groq claude
```

### Web UI

Open `http://localhost:3001` in browser — interactive API tester with provider selector.

## API Endpoints

### `GET /health`

Server health check.

```json
{
  "status": "ok",
  "service": "figma-ai-proxy",
  "version": "2.0.0",
  "uptime": 12345,
  "providers": ["yandex", "claude", "gemini", "groq", "mistral", "cohere"]
}
```

### `GET /api/info`

Full API documentation with provider endpoints and usage examples.

### `POST /api/{provider}/...`

Proxy requests to AI providers. The proxy transparently forwards request body and headers to the real API.

## Usage Examples

### Yandex Cloud

```javascript
const response = await fetch('https://proxy.uixray.tech/api/yandex', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Api-Key YOUR_YANDEX_API_KEY'
  },
  body: JSON.stringify({
    modelUri: 'gpt://FOLDER_ID/yandexgpt-lite/latest',
    completionOptions: { stream: false, temperature: 0.7, maxTokens: '500' },
    messages: [{ role: 'user', text: 'Hello!' }]
  })
});
```

### Anthropic Claude

```javascript
const response = await fetch('https://proxy.uixray.tech/api/claude/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk-ant-...',
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 500,
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});
```

### Groq / Mistral (OpenAI-compatible)

```javascript
const response = await fetch('https://proxy.uixray.tech/api/groq/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer gsk_...'
  },
  body: JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: 'Hello!' }],
    temperature: 0.7,
    max_tokens: 500
  })
});
```

### Google Gemini

```javascript
const response = await fetch('https://proxy.uixray.tech/api/gemini/models/gemini-2.0-flash:generateContent?key=YOUR_KEY', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'Hello!' }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
  })
});
```

### Cohere

```javascript
const response = await fetch('https://proxy.uixray.tech/api/cohere/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_COHERE_KEY'
  },
  body: JSON.stringify({
    model: 'command-r',
    message: 'Hello!',
    temperature: 0.7,
    max_tokens: 500
  })
});
```

## Production Deployment

### PM2 (recommended)

```bash
# Install PM2
sudo npm install -g pm2

# Start the proxy
pm2 start server.js --name "figma-ai-proxy" --time

# Auto-restart on reboot
pm2 startup
pm2 save

# Useful commands
pm2 status                # Check status
pm2 logs figma-ai-proxy   # View logs
pm2 restart figma-ai-proxy # Restart
```

### Nginx Reverse Proxy (HTTPS)

```nginx
server {
    listen 80;
    server_name proxy.uixray.tech;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name proxy.uixray.tech;

    ssl_certificate /etc/letsencrypt/live/proxy.uixray.tech/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/proxy.uixray.tech/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### SSL Certificate (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d proxy.uixray.tech
sudo certbot renew --dry-run
```

## Architecture

The proxy uses a **config-driven architecture** — a single generic handler routes requests based on provider configuration:

```
PROVIDERS = {
  yandex:  { targetBaseUrl: '...', pathMode: 'fixed' },
  claude:  { targetBaseUrl: '...', pathMode: 'subpath', transformHeaders: ... },
  gemini:  { targetBaseUrl: '...', pathMode: 'subpath' },
  groq:    { targetBaseUrl: '...', pathMode: 'subpath' },
  mistral: { targetBaseUrl: '...', pathMode: 'subpath' },
  cohere:  { targetBaseUrl: '...', pathMode: 'subpath' },
}
```

- **`fixed`** — always forward to the same URL (Yandex)
- **`subpath`** — append the subpath after `/api/{provider}/` to the target base URL
- **`transformHeaders`** — provider-specific header modifications (e.g., Claude auth conversion)

## Adding a New Provider

To add a new provider, add an entry to the `PROVIDERS` object in `server.js`:

```javascript
newprovider: {
  name: 'New Provider',
  targetBaseUrl: 'https://api.newprovider.com/v1',
  pathMode: 'subpath',
  transformHeaders: null,    // or custom function
  validateRequest: null,     // or custom function
},
```

No other code changes needed — the generic handler will pick it up automatically.

## Performance

**Tested on 2 vCPU, 2GB RAM VM:**
- Latency: depends on upstream provider (50-5000ms)
- Throughput: ~100 req/sec
- Memory: ~50MB
- Rate limit: 60 req/min per IP per provider
- Request timeout: 120 seconds

## Troubleshooting

### Server not starting

```bash
pm2 logs figma-ai-proxy         # Check logs
sudo netstat -tulpn | grep 3001 # Check port
pm2 restart figma-ai-proxy      # Restart
```

### CORS errors

Ensure Nginx forwards headers correctly. Check `proxy_set_header` directives.

### Provider returns errors

The proxy forwards errors from upstream APIs as-is. Check:
1. Your API key is valid
2. The request body matches the provider's API format
3. The provider is not rate-limiting your key

## License

MIT License

## Links

- [Yandex Cloud Foundation Models](https://cloud.yandex.ru/docs/foundation-models/)
- [Anthropic Claude API](https://docs.anthropic.com/)
- [Google Gemini API](https://ai.google.dev/docs)
- [Groq API](https://console.groq.com/docs)
- [Mistral AI API](https://docs.mistral.ai/)
- [Cohere API](https://docs.cohere.com/)
- [Figma Plugin API](https://www.figma.com/plugin-docs/)
