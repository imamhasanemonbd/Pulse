/**
 * Pulse YT Proxy - Cloudflare Worker
 * 
 * Transparent proxy for YouTube API requests.
 * Usage: https://your-worker.workers.dev/?url=<encoded-target-url>
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    // Health check
    if (!targetUrl) {
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
