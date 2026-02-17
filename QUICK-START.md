# Quick Start

## Install & Run

```bash
git clone https://github.com/uixray/figma-ai-proxy.git
cd figma-ai-proxy
npm install
cp .env.example .env
npm start
```

Server starts at `http://localhost:3001`.

---

## Deploy to Server (PM2)

```bash
# Run the deploy script
bash deploy.sh
```

Or manually:

```bash
npm install -g pm2
pm2 start server.js --name "figma-ai-proxy" --time
pm2 save
pm2 startup
```

---

## Update on Server

```bash
cd ~/apps/figma-ai-proxy && git pull && npm install && pm2 restart figma-ai-proxy
```

---

## Test

```bash
# Structural tests (no API keys needed)
node test.js

# Test specific provider with real API key (set key in test.js first)
node test.js groq
node test.js claude groq
node test.js all
```

---

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Web UI — interactive API tester |
| `GET /health` | Health check |
| `GET /api/info` | Full API documentation |
| `POST /api/yandex` | Yandex Cloud proxy |
| `POST /api/claude/*` | Anthropic Claude proxy |
| `POST /api/gemini/*` | Google Gemini proxy |
| `POST /api/groq/*` | Groq proxy |
| `POST /api/mistral/*` | Mistral AI proxy |
| `POST /api/cohere/*` | Cohere proxy |

---

## PM2 Commands

```bash
pm2 status                  # Status
pm2 logs figma-ai-proxy     # Logs
pm2 restart figma-ai-proxy  # Restart
pm2 stop figma-ai-proxy     # Stop
```

---

Full documentation: [README.md](README.md)
