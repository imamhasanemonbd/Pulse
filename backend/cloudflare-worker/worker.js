/**
 * Pulse YT Proxy - Cloudflare Worker
 * 
 * This worker acts as a transparent proxy for YouTube API requests.
 * Deploy this to your Cloudflare account, then set the YT_PROXY_WORKER
 * environment variable in Coolify to the Worker URL.
 * 
 * Usage: https://your-worker.workers.dev/https://www.youtube.com/...
 * The target URL is embedded in the path after the worker domain.
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Extract the target URL from the path (everything after the leading /)
    const targetUrl = url.pathname.substring(1) + url.search;

    // Health check / root path
    if (!targetUrl || !targetUrl.startsWith('http')) {
      return new Response('Pulse YT Proxy is running.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Clone request headers, removing Cloudflare-specific ones
    const headers = new Headers(request.headers);
    headers.delete('host');
    for (const key of [...headers.keys()]) {
      if (
        key.startsWith('cf-') ||
        key.startsWith('x-forwarded') ||
        key.startsWith('x-real') ||
        key === 'cdn-loop'
      ) {
        headers.delete(key);
      }
    }

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
        redirect: 'follow',
      });

      // Stream the response back transparently
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
