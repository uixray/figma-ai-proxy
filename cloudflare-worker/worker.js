/**
 * Cloudflare Worker — AI API Proxy
 *
 * Forwards requests from your server to AI provider APIs
 * through Cloudflare's edge network, bypassing regional restrictions.
 *
 * Protocol:
 *   - Client sends POST to this Worker
 *   - Header "X-Target-URL" specifies the real API endpoint
 *   - Header "X-Auth-Token" must match the AUTH_TOKEN secret
 *   - All other headers and body are forwarded to the target
 *   - Response from the target is returned as-is
 *
 * Setup:
 *   1. npx wrangler deploy
 *   2. npx wrangler secret put AUTH_TOKEN
 *   3. Use the Worker URL as PROXY_GEMINI=worker://your-worker.workers.dev
 */

// Headers that should not be forwarded to the target API
const STRIP_HEADERS = new Set([
  'x-target-url',
  'x-auth-token',
  'host',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'cf-worker',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-real-ip',
  'connection',
  'transfer-encoding',
]);

export default {
  async fetch(request, env) {
    // Only allow POST requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Target-URL, X-Auth-Token, anthropic-version, x-api-key',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'POST') {
      return Response.json(
        { error: 'Method not allowed', hint: 'Use POST with X-Target-URL header' },
        { status: 405 }
      );
    }

    // Verify auth token
    const authToken = request.headers.get('X-Auth-Token');
    if (!env.AUTH_TOKEN) {
      return Response.json(
        { error: 'Worker misconfigured', hint: 'AUTH_TOKEN secret is not set. Run: npx wrangler secret put AUTH_TOKEN' },
        { status: 500 }
      );
    }

    if (!authToken || authToken !== env.AUTH_TOKEN) {
      return Response.json(
        { error: 'Unauthorized', hint: 'Invalid or missing X-Auth-Token header' },
        { status: 401 }
      );
    }

    // Get target URL
    const targetUrl = request.headers.get('X-Target-URL');
    if (!targetUrl) {
      return Response.json(
        { error: 'Missing X-Target-URL header', hint: 'Set X-Target-URL to the API endpoint you want to reach' },
        { status: 400 }
      );
    }

    // Validate target URL
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      return Response.json(
        { error: 'Invalid X-Target-URL', hint: 'Must be a valid URL like https://api.example.com/v1/endpoint' },
        { status: 400 }
      );
    }

    // Only allow HTTPS targets
    if (parsedUrl.protocol !== 'https:') {
      return Response.json(
        { error: 'Only HTTPS targets are allowed' },
        { status: 400 }
      );
    }

    // Build forwarded headers
    const forwardHeaders = new Headers();
    for (const [key, value] of request.headers.entries()) {
      if (!STRIP_HEADERS.has(key.toLowerCase())) {
        forwardHeaders.set(key, value);
      }
    }

    // Forward the request
    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: forwardHeaders,
        body: request.body,
      });

      // Return the response with CORS headers
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('X-Proxied-By', 'cloudflare-worker');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return Response.json(
        {
          error: 'Upstream request failed',
          message: err.message,
          target: targetUrl,
        },
        { status: 502 }
      );
    }
  },
};
