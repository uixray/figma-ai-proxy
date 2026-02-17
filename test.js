/**
 * Figma AI Proxy — Test Suite v2.0.0
 *
 * Usage:
 *   node test.js                  — health check + info + routing tests only
 *   node test.js yandex           — test Yandex provider with real API key
 *   node test.js claude groq      — test specific providers
 *   node test.js all              — test all providers (requires all API keys)
 *
 * Before running real provider tests:
 *   1. Start the server: npm start
 *   2. Set your API keys in the PROVIDER_KEYS object below
 */

const BASE_URL = 'http://localhost:3001';

// =====================================================================
// API KEYS — replace with your own to test real provider requests
// =====================================================================

const PROVIDER_KEYS = {
  yandex: {
    apiKey: 'YOUR_YANDEX_API_KEY',     // Api-Key from Yandex Cloud console
    folderId: 'YOUR_FOLDER_ID',         // Folder ID from Yandex Cloud console
  },
  claude: {
    apiKey: 'YOUR_CLAUDE_API_KEY',      // sk-ant-api03-...
  },
  gemini: {
    apiKey: 'YOUR_GEMINI_API_KEY',      // AIzaSy...
  },
  groq: {
    apiKey: 'YOUR_GROQ_API_KEY',        // gsk_...
  },
  mistral: {
    apiKey: 'YOUR_MISTRAL_API_KEY',
  },
  cohere: {
    apiKey: 'YOUR_COHERE_API_KEY',
  },
};

// =====================================================================
// Test request configs for each provider
// =====================================================================

function getProviderTestConfig(providerKey) {
  const keys = PROVIDER_KEYS[providerKey];

  const configs = {
    yandex: {
      path: '/api/yandex',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${keys.apiKey}`,
      },
      body: {
        modelUri: `gpt://${keys.folderId}/yandexgpt-lite/latest`,
        completionOptions: { stream: false, temperature: 0.7, maxTokens: '100' },
        messages: [{ role: 'user', text: 'Reply with one word: hello' }],
      },
      extractText: (data) => data?.result?.alternatives?.[0]?.message?.text,
    },

    claude: {
      path: '/api/claude/messages',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${keys.apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Reply with one word: hello' }],
      },
      extractText: (data) => data?.content?.[0]?.text,
    },

    gemini: {
      path: `/api/gemini/models/gemini-2.0-flash:generateContent?key=${keys.apiKey}`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        contents: [{ role: 'user', parts: [{ text: 'Reply with one word: hello' }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 100 },
      },
      extractText: (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text,
    },

    groq: {
      path: '/api/groq/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${keys.apiKey}`,
      },
      body: {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'Reply with one word: hello' }],
        temperature: 0.7,
        max_tokens: 100,
      },
      extractText: (data) => data?.choices?.[0]?.message?.content,
    },

    mistral: {
      path: '/api/mistral/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${keys.apiKey}`,
      },
      body: {
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: 'Reply with one word: hello' }],
        temperature: 0.7,
        max_tokens: 100,
      },
      extractText: (data) => data?.choices?.[0]?.message?.content,
    },

    cohere: {
      path: '/api/cohere/chat',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${keys.apiKey}`,
      },
      body: {
        model: 'command-r',
        message: 'Reply with one word: hello',
        temperature: 0.7,
        max_tokens: 100,
      },
      extractText: (data) => data?.text,
    },
  };

  return configs[providerKey];
}

// =====================================================================
// Test functions
// =====================================================================

let passed = 0;
let failed = 0;

function ok(msg) {
  passed++;
  console.log(`  ✅ ${msg}`);
}

function fail(msg) {
  failed++;
  console.log(`  ❌ ${msg}`);
}

async function testHealthCheck() {
  console.log('\n1. Health Check');
  try {
    const res = await fetch(`${BASE_URL}/health`);
    const data = await res.json();

    if (data.status === 'ok') ok(`Status: ok`);
    else fail(`Expected status ok, got: ${data.status}`);

    if (data.version === '2.0.0') ok(`Version: ${data.version}`);
    else fail(`Expected version 2.0.0, got: ${data.version}`);

    if (Array.isArray(data.providers) && data.providers.length === 6) {
      ok(`Providers: ${data.providers.join(', ')}`);
    } else {
      fail(`Expected 6 providers, got: ${JSON.stringify(data.providers)}`);
    }
  } catch (error) {
    fail(`Health check failed: ${error.message}`);
    console.log('   Make sure server is running: npm start');
    return false;
  }
  return true;
}

async function testApiInfo() {
  console.log('\n2. API Info');
  try {
    const res = await fetch(`${BASE_URL}/api/info`);
    const data = await res.json();

    if (data.version === '2.0.0') ok(`Version: ${data.version}`);
    else fail(`Expected version 2.0.0, got: ${data.version}`);

    if (data.service === 'Figma AI Proxy') ok(`Service: ${data.service}`);
    else fail(`Expected 'Figma AI Proxy', got: ${data.service}`);

    const providers = Object.keys(data.endpoints?.providers || {});
    if (providers.length === 6) ok(`Provider endpoints: ${providers.join(', ')}`);
    else fail(`Expected 6 provider endpoints, got: ${providers.length}`);
  } catch (error) {
    fail(`API info failed: ${error.message}`);
  }
}

async function testUnknownProvider() {
  console.log('\n3. Unknown Provider (404)');
  try {
    const res = await fetch(`${BASE_URL}/api/nonexistent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    });
    const data = await res.json();

    if (res.status === 404) ok(`Status: 404`);
    else fail(`Expected 404, got: ${res.status}`);

    if (data.error === 'Unknown provider') ok(`Error message: ${data.error}`);
    else fail(`Expected 'Unknown provider', got: ${data.error}`);

    if (Array.isArray(data.availableProviders)) ok(`Listed ${data.availableProviders.length} providers`);
    else fail(`Missing availableProviders list`);
  } catch (error) {
    fail(`Unknown provider test failed: ${error.message}`);
  }
}

async function testYandexValidation() {
  console.log('\n4. Yandex Validation (no auth)');
  try {
    const res = await fetch(`${BASE_URL}/api/yandex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    });
    const data = await res.json();

    if (res.status === 401) ok(`Status: 401 (auth required)`);
    else fail(`Expected 401, got: ${res.status}`);

    if (data.hint) ok(`Hint provided: "${data.hint.slice(0, 60)}..."`);
    else fail(`Missing hint in error response`);
  } catch (error) {
    fail(`Yandex validation test failed: ${error.message}`);
  }
}

async function testCORSPreflight() {
  console.log('\n5. CORS Preflight');
  try {
    const res = await fetch(`${BASE_URL}/api/claude/messages`, {
      method: 'OPTIONS',
    });

    const allowOrigin = res.headers.get('access-control-allow-origin');
    if (allowOrigin === '*') ok(`Access-Control-Allow-Origin: *`);
    else fail(`Expected CORS origin *, got: ${allowOrigin}`);
  } catch (error) {
    fail(`CORS test failed: ${error.message}`);
  }
}

async function testProviderRequest(providerKey) {
  const keys = PROVIDER_KEYS[providerKey];
  const isConfigured = keys.apiKey && !keys.apiKey.startsWith('YOUR_');

  console.log(`\n🔌 Testing ${providerKey.toUpperCase()}${isConfigured ? '' : ' (skipped — no API key)'}`);

  if (!isConfigured) {
    console.log(`   Set PROVIDER_KEYS.${providerKey}.apiKey in test.js to test`);
    return;
  }

  const config = getProviderTestConfig(providerKey);

  try {
    const startTime = Date.now();

    const res = await fetch(`${BASE_URL}${config.path}`, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(config.body),
    });

    const responseTime = Date.now() - startTime;
    const data = await res.json();

    if (res.ok) {
      ok(`Status: ${res.status} (${responseTime}ms)`);

      const text = config.extractText(data);
      if (text) {
        ok(`Response text: "${text.trim().slice(0, 80)}"`);
      } else {
        fail(`Could not extract text from response`);
        console.log('   Response:', JSON.stringify(data).slice(0, 200));
      }
    } else {
      fail(`Status: ${res.status} (${responseTime}ms)`);
      console.log('   Error:', JSON.stringify(data).slice(0, 300));
    }
  } catch (error) {
    fail(`${providerKey} request failed: ${error.message}`);
  }
}

// =====================================================================
// Main test runner
// =====================================================================

async function main() {
  const args = process.argv.slice(2);
  const allProviders = ['yandex', 'claude', 'gemini', 'groq', 'mistral', 'cohere'];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Figma AI Proxy — Test Suite v2.0.0');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Always run structural tests
  const serverOk = await testHealthCheck();
  if (!serverOk) {
    console.log('\n❌ Server is not running. Start it with: npm start\n');
    process.exit(1);
  }

  await testApiInfo();
  await testUnknownProvider();
  await testYandexValidation();
  await testCORSPreflight();

  // Run provider tests if requested
  let providersToTest = [];

  if (args.includes('all')) {
    providersToTest = allProviders;
  } else if (args.length > 0) {
    providersToTest = args.filter((a) => allProviders.includes(a));
    const unknown = args.filter((a) => !allProviders.includes(a) && a !== 'all');
    if (unknown.length > 0) {
      console.log(`\n⚠️  Unknown providers: ${unknown.join(', ')}`);
      console.log(`   Available: ${allProviders.join(', ')}`);
    }
  }

  if (providersToTest.length > 0) {
    console.log(`\n━━━ Provider Tests ━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    for (const p of providersToTest) {
      await testProviderRequest(p);
    }
  }

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (providersToTest.length === 0 && args.length === 0) {
    console.log('  Tip: test real providers with:');
    console.log('    node test.js groq         — test Groq');
    console.log('    node test.js claude groq  — test multiple');
    console.log('    node test.js all          — test all\n');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
