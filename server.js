/**
 * Figma AI Proxy Server v2.0.0
 *
 * Multi-provider CORS proxy for AI APIs.
 * Solves CSP restrictions in Figma plugins by proxying requests to:
 * Yandex Cloud, Anthropic Claude, Google Gemini, Groq, Mistral AI, Cohere.
 *
 * Security:
 * - Stateless — does not store API keys or request data
 * - Rate limiting per IP per provider
 * - Helmet security headers
 * - Logs only timestamps, methods, paths, IPs (no private data)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { fetch: undiciFetch, ProxyAgent } = require('undici');

// Optional SOCKS5 support
let socksDispatcher;
try {
  socksDispatcher = require('fetch-socks').socksDispatcher;
} catch {
  socksDispatcher = null;
}

const app = express();
const PORT = process.env.PORT || 3001;
const VERSION = '2.0.0';
const REQUEST_TIMEOUT = 120000; // 120 seconds

// =====================================================================
// PROVIDER CONFIGURATION
// =====================================================================

/**
 * pathMode:
 *   'fixed'   — always forward to targetBaseUrl (no subpath)
 *   'subpath' — append subpath + query string to targetBaseUrl
 *
 * transformHeaders(headers) — modify headers before forwarding
 * validateRequest(req)      — custom validation, returns { valid, status?, error? }
 */
const PROVIDERS = {
  yandex: {
    name: 'Yandex Cloud',
    targetBaseUrl: 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
    pathMode: 'fixed',
    transformHeaders: null,
    validateRequest: validateYandexRequest,
  },

  claude: {
    name: 'Anthropic Claude',
    targetBaseUrl: 'https://api.anthropic.com/v1',
    pathMode: 'subpath',
    transformHeaders: (headers) => {
      const transformed = { ...headers };

      // Convert "Authorization: Bearer sk-ant-..." to "x-api-key: sk-ant-..."
      const auth = transformed['authorization'] || transformed['Authorization'] || '';
      if (auth.startsWith('Bearer ')) {
        transformed['x-api-key'] = auth.slice(7);
        delete transformed['authorization'];
        delete transformed['Authorization'];
      }

      // Ensure anthropic-version is set
      if (!transformed['anthropic-version']) {
        transformed['anthropic-version'] = '2023-06-01';
      }

      // Remove browser-access header (proxy handles CORS)
      delete transformed['anthropic-dangerous-direct-browser-access'];

      return transformed;
    },
    validateRequest: null,
  },

  gemini: {
    name: 'Google Gemini',
    targetBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    pathMode: 'subpath',
    transformHeaders: null,
    validateRequest: null,
  },

  groq: {
    name: 'Groq',
    targetBaseUrl: 'https://api.groq.com/openai/v1',
    pathMode: 'subpath',
    transformHeaders: null,
    validateRequest: null,
  },

  mistral: {
    name: 'Mistral AI',
    targetBaseUrl: 'https://api.mistral.ai/v1',
    pathMode: 'subpath',
    transformHeaders: null,
    validateRequest: null,
  },

  cohere: {
    name: 'Cohere',
    targetBaseUrl: 'https://api.cohere.ai/v1',
    pathMode: 'subpath',
    transformHeaders: null,
    validateRequest: null,
  },
};

// =====================================================================
// PROXY CONFIGURATION
// =====================================================================

/**
 * Proxy types:
 *   'worker'  — Cloudflare Worker (URL scheme: worker://host)
 *   'http'    — HTTP/HTTPS proxy via undici ProxyAgent
 *   'socks5'  — SOCKS5 proxy via fetch-socks
 *   null      — direct connection (no proxy)
 *
 * Priority: PROXY_{PROVIDER} > PROXY_URL > null (direct)
 * Special value "direct" forces direct connection even if global proxy is set.
 */
function resolveProxyConfig(providerKey) {
  const envKey = `PROXY_${providerKey.toUpperCase()}`;
  const perProvider = process.env[envKey];

  if (perProvider === 'direct') return null;

  const raw = (perProvider && perProvider.trim()) || (process.env.PROXY_URL && process.env.PROXY_URL.trim()) || null;
  if (!raw) return null;

  // Determine proxy type from URL scheme
  if (raw.startsWith('worker://')) {
    return { type: 'worker', url: 'https://' + raw.slice('worker://'.length) };
  }
  if (raw.startsWith('socks5://') || raw.startsWith('socks4://') || raw.startsWith('socks://')) {
    return { type: 'socks5', url: raw };
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return { type: 'http', url: raw };
  }

  console.warn(`[PROXY] Unknown scheme in proxy URL: ${raw}`);
  return null;
}

function createProxyDispatcher(config) {
  if (!config || config.type === 'worker') return null;

  if (config.type === 'socks5') {
    if (!socksDispatcher) {
      console.warn('[PROXY] SOCKS proxy configured but fetch-socks is not installed.');
      console.warn('[PROXY] Install it: npm install fetch-socks');
      console.warn('[PROXY] Falling back to direct connection.');
      return null;
    }
    const url = new URL(config.url);
    return socksDispatcher({
      type: url.protocol === 'socks4:' ? 4 : 5,
      host: url.hostname,
      port: parseInt(url.port, 10) || 1080,
      ...(url.username && { userId: decodeURIComponent(url.username) }),
      ...(url.password && { password: decodeURIComponent(url.password) }),
    });
  }

  // HTTP/HTTPS proxy
  const url = new URL(config.url);
  const opts = { uri: config.url };
  if (url.username && url.password) {
    opts.token = `Basic ${Buffer.from(
      `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
    ).toString('base64')}`;
  }
  return new ProxyAgent(opts);
}

// Resolve proxy configs at startup
const PROXY_CONFIGS = {};
const PROXY_DISPATCHERS = {};
for (const key of Object.keys(PROVIDERS)) {
  const config = resolveProxyConfig(key);
  if (config) {
    PROXY_CONFIGS[key] = config;
    const dispatcher = createProxyDispatcher(config);
    if (dispatcher) PROXY_DISPATCHERS[key] = dispatcher;
    const label = config.type === 'worker' ? config.url : config.url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
    console.log(`[PROXY] ${key}: routing via ${config.type} → ${label}`);
  }
}

// =====================================================================
// VALIDATION FUNCTIONS
// =====================================================================

/**
 * Legacy validation for Yandex Cloud requests.
 * Checks Authorization format and required body fields.
 */
function validateYandexRequest(req) {
  const apiKey = req.headers.authorization || req.headers['Authorization'] || '';

  if (!apiKey) {
    return {
      valid: false,
      status: 401,
      error: {
        error: 'Authorization header is required',
        hint: 'Include your Yandex Cloud API key: "Authorization: Api-Key YOUR_KEY"',
      },
    };
  }

  if (!apiKey.startsWith('Api-Key ') && !apiKey.startsWith('Bearer ')) {
    return {
      valid: false,
      status: 401,
      error: {
        error: 'Invalid Authorization format',
        hint: 'Use format: "Api-Key YOUR_KEY" or "Bearer YOUR_IAM_TOKEN"',
      },
    };
  }

  if (!req.body || typeof req.body !== 'object') {
    return {
      valid: false,
      status: 400,
      error: {
        error: 'Invalid request body',
        hint: 'Send JSON with modelUri, completionOptions, and messages',
      },
    };
  }

  if (!req.body.modelUri || !req.body.messages) {
    return {
      valid: false,
      status: 400,
      error: {
        error: 'Missing required fields',
        hint: 'Request must include modelUri and messages',
        received: Object.keys(req.body),
      },
    };
  }

  return { valid: true };
}

// =====================================================================
// HELPER FUNCTIONS
// =====================================================================

/**
 * Execute a fetch request, optionally through a proxy.
 * - worker: sends to CF Worker with X-Target-URL header
 * - http/socks5: uses undici fetch with dispatcher
 * - direct: uses native fetch
 */
async function proxyFetch(url, options, providerKey) {
  const config = PROXY_CONFIGS[providerKey];

  if (config && config.type === 'worker') {
    // Cloudflare Worker proxy: send to worker URL with target in headers
    const workerHeaders = { ...options.headers };
    workerHeaders['X-Target-URL'] = url;
    const authToken = process.env.PROXY_AUTH_TOKEN;
    if (authToken) {
      workerHeaders['X-Auth-Token'] = authToken;
    }
    return undiciFetch(config.url, {
      ...options,
      headers: workerHeaders,
    });
  }

  const dispatcher = PROXY_DISPATCHERS[providerKey];
  if (dispatcher) {
    return undiciFetch(url, { ...options, dispatcher });
  }

  // Direct connection
  return fetch(url, options);
}

/**
 * Build the target URL for the upstream API.
 *
 * 'fixed'   → return targetBaseUrl as-is (e.g., Yandex)
 * 'subpath' → targetBaseUrl + everything after /api/{provider} (including query string)
 */
function buildTargetUrl(req, provider, providerKey) {
  if (provider.pathMode === 'fixed') {
    return provider.targetBaseUrl;
  }

  // Extract subpath from originalUrl: /api/claude/messages?foo=bar → /messages?foo=bar
  const prefix = `/api/${providerKey}`;
  const fullPath = req.originalUrl;
  const subpath = fullPath.slice(prefix.length); // includes leading / and query string

  const base = provider.targetBaseUrl.replace(/\/$/, '');
  return base + subpath;
}

/**
 * Build headers for the upstream API request.
 * Starts with Content-Type and Authorization, then applies provider-specific transformations.
 */
function buildForwardHeaders(req, provider) {
  const headers = {};

  // Always forward Content-Type
  headers['Content-Type'] = req.headers['content-type'] || 'application/json';

  // Forward Authorization if present
  if (req.headers['authorization']) {
    headers['Authorization'] = req.headers['authorization'];
  }

  // Forward anthropic-version if present (Claude provider sends this)
  if (req.headers['anthropic-version']) {
    headers['anthropic-version'] = req.headers['anthropic-version'];
  }

  // Forward anthropic-dangerous-direct-browser-access if present
  if (req.headers['anthropic-dangerous-direct-browser-access']) {
    headers['anthropic-dangerous-direct-browser-access'] = req.headers['anthropic-dangerous-direct-browser-access'];
  }

  // Apply provider-specific header transformations
  if (provider.transformHeaders) {
    return provider.transformHeaders(headers);
  }

  return headers;
}

/**
 * Handle proxy errors with categorized responses.
 */
function handleProxyError(res, error, startTime, provider) {
  const responseTime = Date.now() - startTime;
  console.error(`[ERROR:${provider.name}] Proxy error (${responseTime}ms):`, error.message);

  if (error.name === 'AbortError' || error.message.includes('timeout')) {
    return res.status(504).json({
      error: 'Gateway Timeout',
      message: `Request to ${provider.name} API timed out`,
      hint: 'Try again or check the provider status',
    });
  }

  if (error.message.includes('ECONNREFUSED') && error.message.includes('proxy')) {
    return res.status(502).json({
      error: 'Proxy Connection Failed',
      message: `Unable to connect to proxy for ${provider.name}`,
      hint: 'Check that the proxy server is running and accessible',
    });
  }

  if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
    return res.status(502).json({
      error: 'Bad Gateway',
      message: `Unable to connect to ${provider.name} API`,
      hint: `${provider.name} may be temporarily unavailable`,
    });
  }

  res.status(500).json({
    error: 'Internal Proxy Error',
    message: 'An unexpected error occurred',
    hint: 'Contact proxy administrator if this persists',
  });
}

// =====================================================================
// MIDDLEWARE
// =====================================================================

// Security headers
app.use(helmet());

// CORS — allow requests from Figma plugins (null origin)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'anthropic-version',
    'anthropic-dangerous-direct-browser-access',
    'x-api-key',
  ],
  credentials: false,
}));

// JSON body parser
app.use(express.json({ limit: '10mb' }));

// Per-provider rate limiting: 60 req/min per IP per provider
const providerLimiters = {};
for (const [key, config] of Object.entries(PROVIDERS)) {
  providerLimiters[key] = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 60,
    message: {
      error: `Too many requests to ${config.name}, please try again later.`,
      retryAfter: 60,
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}-${key}`,
  });
}

// Request logging (no private data)
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip}`);
  next();
});

// =====================================================================
// ROUTES
// =====================================================================

// Serve static files
app.use(express.static('public'));

// Root page — API tester
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Health check
app.get('/health', (req, res) => {
  const proxyStatus = {};
  for (const key of Object.keys(PROVIDERS)) {
    const config = PROXY_CONFIGS[key];
    if (config) {
      const masked = config.url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
      proxyStatus[key] = `${config.type} → ${masked}`;
    } else {
      proxyStatus[key] = 'direct';
    }
  }

  res.json({
    status: 'ok',
    service: 'figma-ai-proxy',
    version: VERSION,
    uptime: process.uptime(),
    providers: Object.keys(PROVIDERS),
    proxy: proxyStatus,
  });
});

// API info
app.get('/api/info', (req, res) => {
  const providerEndpoints = {};
  for (const [key, config] of Object.entries(PROVIDERS)) {
    providerEndpoints[key] = {
      name: config.name,
      endpoint: config.pathMode === 'fixed' ? `POST /api/${key}` : `POST /api/${key}/*`,
      target: config.targetBaseUrl,
    };
  }

  res.json({
    service: 'Figma AI Proxy',
    description: 'Multi-provider CORS proxy for AI APIs (Figma Plugin)',
    version: VERSION,
    endpoints: {
      health: 'GET /health',
      info: 'GET /api/info',
      providers: providerEndpoints,
    },
    usage: {
      description: 'Send POST request to /api/{provider}/... with your API key',
      examples: {
        yandex: {
          url: '/api/yandex',
          method: 'POST',
          headers: { 'Authorization': 'Api-Key YOUR_KEY' },
          body: { modelUri: 'gpt://FOLDER_ID/yandexgpt-lite', messages: [{ role: 'user', text: 'Hello!' }] },
        },
        claude: {
          url: '/api/claude/messages',
          method: 'POST',
          headers: { 'Authorization': 'Bearer YOUR_KEY', 'anthropic-version': '2023-06-01' },
          body: { model: 'claude-3-5-haiku-20241022', max_tokens: 100, messages: [{ role: 'user', content: 'Hello!' }] },
        },
        groq: {
          url: '/api/groq/chat/completions',
          method: 'POST',
          headers: { 'Authorization': 'Bearer YOUR_KEY' },
          body: { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'Hello!' }] },
        },
      },
    },
  });
});

// =====================================================================
// GENERIC PROXY HANDLER
// =====================================================================

/**
 * Main proxy route: POST /api/:provider or POST /api/:provider/anything/else
 * Matches all POST requests to /api/{providerKey}/...
 */
async function proxyRequest(req, res) {
  const startTime = Date.now();
  const providerKey = req.params.provider;
  const provider = PROVIDERS[providerKey];

  // Unknown provider
  if (!provider) {
    return res.status(404).json({
      error: 'Unknown provider',
      message: `Provider "${providerKey}" is not supported`,
      availableProviders: Object.keys(PROVIDERS),
    });
  }

  // Apply rate limiter for this provider
  const limiter = providerLimiters[providerKey];
  if (limiter) {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    // If rate limiter already sent a response, stop
    if (res.headersSent) return;
  }

  try {
    // Provider-specific validation
    if (provider.validateRequest) {
      const validation = provider.validateRequest(req);
      if (!validation.valid) {
        return res.status(validation.status).json(validation.error);
      }
    }

    // Build target URL
    const targetUrl = buildTargetUrl(req, provider, providerKey);

    // Build headers
    const headers = buildForwardHeaders(req, provider);

    console.log(`[PROXY:${providerKey}] → ${provider.name} (${targetUrl.split('?')[0]})`);

    // Forward the request with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await proxyFetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
      signal: controller.signal,
    }, providerKey);

    clearTimeout(timeout);

    const responseTime = Date.now() - startTime;
    console.log(`[PROXY:${providerKey}] ← ${provider.name}: ${response.status} (${responseTime}ms)`);

    // Try to parse as JSON, fall back to text
    const contentType = response.headers.get('content-type') || '';
    let data;

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = {
          error: 'Non-JSON response from provider',
          status: response.status,
          body: text.slice(0, 500),
        };
      }
    }

    // Return response with original status code
    res.status(response.status).json(data);

  } catch (error) {
    handleProxyError(res, error, startTime, provider);
  }
}

// Route registration: match both /api/:provider and /api/:provider/any/sub/path
app.post('/api/:provider', proxyRequest);
app.post('/api/:provider/*', proxyRequest);

// =====================================================================
// ERROR HANDLERS
// =====================================================================

// 404 handler
app.use((req, res) => {
  const providerEndpoints = Object.keys(PROVIDERS).map(
    (key) => `POST /api/${key}${PROVIDERS[key].pathMode === 'fixed' ? '' : '/*'}`
  );

  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.method} ${req.path} does not exist`,
    availableEndpoints: [
      'GET /health',
      'GET /api/info',
      ...providerEndpoints,
    ],
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[FATAL ERROR]', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
  });
});

// =====================================================================
// START SERVER
// =====================================================================

app.listen(PORT, () => {
  const providerList = Object.entries(PROVIDERS)
    .map(([key, config]) => {
      const proxy = PROXY_CONFIGS[key];
      const tag = proxy ? ` [via ${proxy.type}]` : '';
      return `  ${key.padEnd(10)} → ${config.name}${tag}`;
    })
    .join('\n');

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Figma AI Proxy Server v${VERSION}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Port:    ${PORT}`);
  console.log(`  Health:  http://localhost:${PORT}/health`);
  console.log(`  Info:    http://localhost:${PORT}/api/info`);
  console.log('');
  console.log('  Providers:');
  console.log(providerList);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down gracefully...');
  process.exit(0);
});
