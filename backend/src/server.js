import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Readable } from 'stream';
import { searchMusic, getStreamDetails, getYTClient } from './services/youtube.js';

const fastify = Fastify({
  logger: true
});

// Configure CORS to allow frontend connections
await fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range'],
  exposedHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges']
});

/**
 * Health check endpoint
 */
fastify.get('/health', async (request, reply) => {
  return { status: 'ok' };
});

/**
 * Endpoint to search tracks on YouTube Music
 * GET /api/search?q=query
 */
fastify.get('/api/search', async (request, reply) => {
  const { q } = request.query;
  if (!q) {
    return reply.status(400).send({ error: 'Search query parameter "q" is required' });
  }

  try {
    const results = await searchMusic(q);
    return results;
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Failed to search music' });
  }
});

/**
 * Endpoint to get track lyrics
 * GET /api/lyrics/:id
 */
fastify.get('/api/lyrics/:id', async (request, reply) => {
  const { id } = request.params;
  if (!id) {
    return reply.status(400).send({ error: 'Track ID is required' });
  }

  try {
    const client = await getYTClient();
    const lyrics = await client.music.getLyrics(id);
    if (lyrics && lyrics.description) {
      return {
        lyrics: lyrics.description.text || 'Lyrics not available.',
        source: lyrics.footer?.text || ''
      };
    }
    return { lyrics: 'Lyrics not available.', source: '' };
  } catch (error) {
    fastify.log.error(error);
    return { lyrics: 'Lyrics not available for this track.', source: '' };
  }
});

/**
 * Endpoint to stream track audio
 * GET /api/stream/:id
 */
fastify.get('/api/stream/:id', async (request, reply) => {
  const { id } = request.params;
  if (!id) {
    return reply.status(400).send({ error: 'Track ID is required' });
  }

  try {
    const streamInfo = await getStreamDetails(id);

    // Set up request headers to forward to YouTube CDN
    const headers = {};
    if (request.headers.range) {
      headers.range = request.headers.range;
    }

    fastify.log.info(`[Streaming Proxy] Video: ${id}, Forwarding Range: ${request.headers.range || 'None'}`);

    // Request the raw audio stream from YouTube CDN
    const response = await fetch(streamInfo.url, {
      method: 'GET',
      headers: headers
    });

    if (!response.ok && response.status !== 206) {
      const errorText = await response.text().catch(() => 'no body');
      fastify.log.error(`[CDN Error] URL: ${streamInfo.url}`);
      fastify.log.error(`[CDN Error] Response Status: ${response.status} ${response.statusText}`);
      fastify.log.error(`[CDN Error] Response Body: ${errorText}`);
      throw new Error(`Failed to fetch from YouTube CDN: ${response.statusText}`);
    }

    // Forward status code and headers back to client
    reply.status(response.status);

    if (response.headers.has('content-type')) {
      reply.header('content-type', response.headers.get('content-type'));
    } else {
      reply.header('content-type', streamInfo.mimeType);
    }

    if (response.headers.has('content-length')) {
      reply.header('content-length', response.headers.get('content-length'));
    }

    if (response.headers.has('content-range')) {
      reply.header('content-range', response.headers.get('content-range'));
    }

    reply.header('accept-ranges', 'bytes');
    reply.header('cache-control', 'public, max-age=31536000');

    // Pipe the stream back to the client
    const nodeStream = Readable.fromWeb(response.body);
    return reply.send(nodeStream);
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Failed to resolve or stream audio' });
  }
});

// Start the Fastify server
const start = async () => {
  try {
    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server is running on http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
