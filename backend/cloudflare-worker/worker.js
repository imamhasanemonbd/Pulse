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

    if (!targetUrl) {
      return new Response('Pulse YT Proxy is running.', { status: 200 });
    }

    try {
      const proxyHeaders = {};
      const fwd = ['cookie', 'content-type', 'accept', 'accept-language', 'origin', 'referer', 'authorization'];
      for (const key of fwd) {
        const val = request.headers.get(key);
        if (val) proxyHeaders[key] = val;
      }

      // Crucial: Always enforce a clean, realistic browser User-Agent
      // If we forward node-fetch or undici User-Agents, YouTube immediately returns a 403 Bot Block.
      const incomingUserAgent = request.headers.get('user-agent') || '';
      if (
        !incomingUserAgent ||
        incomingUserAgent.includes('node') ||
        incomingUserAgent.includes('undici') ||
        incomingUserAgent.includes('axios') ||
        incomingUserAgent.includes('node-fetch')
      ) {
        proxyHeaders['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
      } else {
        proxyHeaders['user-agent'] = incomingUserAgent;
      }

      const response = await fetch(targetUrl, {
        method: request.method,
        headers: proxyHeaders,
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
      return new Response(JSON.stringify({ error: e.message }), { status: 502 });
    }
  },
};
