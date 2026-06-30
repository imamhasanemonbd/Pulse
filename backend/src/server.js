import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import { Readable } from 'stream';
import { searchMusic, getStreamDetails, getYTClient } from './services/youtube.js';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { OAuth2Client } from 'google-auth-library';

// Initialize Prisma with SQLite adapter
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./dev.db',
});
const prisma = new PrismaClient({ adapter });

// Google OAuth2 client for verifying tokens
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const fastify = Fastify({
  logger: true
});

// Configure CORS to allow frontend connections
await fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range', 'Authorization'],
  exposedHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges']
});

// Register JWT plugin
await fastify.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || 'pulse-default-jwt-secret-change-me'
});

// Authentication decorator – verifies JWT from Authorization header
fastify.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Unauthorized' });
  }
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
    const { client, info } = await getStreamDetails(id);

    fastify.log.info(`[Streaming Proxy] Video: ${id}, using info.download() for streaming`);

    // Use youtubei.js's built-in download method which handles URL resolution,
    // signature deciphering, and streaming all internally.
    const downloadStream = await info.download({ type: 'audio', quality: 'best' });

    reply.status(200);
    reply.header('content-type', 'audio/webm');
    reply.header('accept-ranges', 'bytes');
    reply.header('cache-control', 'public, max-age=31536000');

    // Convert the ReadableStream (web) to a Node.js Readable stream and pipe it
    const nodeStream = Readable.fromWeb(downloadStream);
    return reply.send(nodeStream);
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Failed to resolve or stream audio' });
  }
});

// ============================================================================
// AUTHENTICATION & USER DATA SYNC ENDPOINTS
// ============================================================================

/**
 * Google Sign-In: Verify Google ID token and return a Pulse JWT
 * POST /api/auth/google
 * Body: { credential: "google-id-token-string" }
 */
fastify.post('/api/auth/google', async (request, reply) => {
  const { credential } = request.body || {};
  if (!credential) {
    return reply.status(400).send({ error: 'Google credential token is required' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    // Upsert user in database
    const user = await prisma.user.upsert({
      where: { email },
      update: { name, picture },
      create: { email, name, picture },
    });

    // Generate Pulse JWT session token
    const token = fastify.jwt.sign(
      { userId: user.id, email: user.email },
      { expiresIn: '30d' }
    );

    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, picture: user.picture },
    };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(401).send({ error: 'Invalid Google credential' });
  }
});

/**
 * Get current user profile
 * GET /api/user/me
 */
fastify.get('/api/user/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { id: true, email: true, name: true, picture: true },
    });
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return user;
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Failed to fetch user' });
  }
});

/**
 * Get all user data (playlists, likes, history)
 * GET /api/user/sync
 */
fastify.get('/api/user/sync', { preHandler: [fastify.authenticate] }, async (request, reply) => {
  try {
    const userId = request.user.userId;
    const [playlists, likes, history] = await Promise.all([
      prisma.playlist.findMany({
        where: { userId },
        include: { tracks: { orderBy: { addedAt: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.likedSong.findMany({
        where: { userId },
        orderBy: { likedAt: 'desc' },
      }),
      prisma.historyItem.findMany({
        where: { userId },
        orderBy: { playedAt: 'desc' },
        take: 100,
      }),
    ]);
    return { playlists, likes, history };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Failed to sync user data' });
  }
});

/**
 * Bulk upload/merge local data to database on first login
 * POST /api/user/sync
 * Body: { likes: [...], history: [...], playlists: [{ name, tracks: [...] }] }
 */
fastify.post('/api/user/sync', { preHandler: [fastify.authenticate] }, async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { likes = [], history = [], playlists = [] } = request.body || {};

    // Merge liked songs (skip duplicates by trackId)
    for (const track of likes) {
      const exists = await prisma.likedSong.findFirst({
        where: { userId, trackId: track.id || track.trackId },
      });
      if (!exists) {
        await prisma.likedSong.create({
          data: {
            userId,
            trackId: track.id || track.trackId,
            title: track.title,
            artist: track.artist,
            thumbnail: track.thumbnail || null,
            duration: track.duration ? Math.floor(track.duration) : null,
          },
        });
      }
    }

    // Merge history items
    for (const track of history) {
      await prisma.historyItem.create({
        data: {
          userId,
          trackId: track.id || track.trackId,
          title: track.title,
          artist: track.artist,
          thumbnail: track.thumbnail || null,
          duration: track.duration ? Math.floor(track.duration) : null,
        },
      });
    }

    // Merge playlists
    for (const pl of playlists) {
      const playlist = await prisma.playlist.create({
        data: {
          name: pl.name,
          userId,
        },
      });
      for (const track of (pl.tracks || [])) {
        await prisma.playlistTrack.create({
          data: {
            playlistId: playlist.id,
            trackId: track.id || track.trackId,
            title: track.title,
            artist: track.artist,
            thumbnail: track.thumbnail || null,
            duration: track.duration ? Math.floor(track.duration) : null,
          },
        });
      }
    }

    return { success: true };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Failed to merge data' });
  }
});

// --- Liked Songs ---

/**
 * Add a liked song
 * POST /api/user/likes
 */
fastify.post('/api/user/likes', { preHandler: [fastify.authenticate] }, async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { trackId, title, artist, thumbnail, duration } = request.body || {};
    if (!trackId || !title) return reply.status(400).send({ error: 'trackId and title required' });

    const exists = await prisma.likedSong.findFirst({ where: { userId, trackId } });
    if (exists) return { success: true, action: 'already_liked' };

    await prisma.likedSong.create({
      data: { userId, trackId, title, artist, thumbnail: thumbnail || null, duration: duration ? Math.floor(duration) : null },
    });
    return { success: true, action: 'liked' };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Failed to like song' });
  }
});

/**
 * Remove a liked song
 * DELETE /api/user/likes/:trackId
 */
fastify.delete('/api/user/likes/:trackId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { trackId } = request.params;
    await prisma.likedSong.deleteMany({ where: { userId, trackId } });
    return { success: true, action: 'unliked' };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Failed to unlike song' });
  }
});

// --- History ---

/**
 * Add a history item
 * POST /api/user/history
 */
fastify.post('/api/user/history', { preHandler: [fastify.authenticate] }, async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { trackId, title, artist, thumbnail, duration } = request.body || {};
    if (!trackId || !title) return reply.status(400).send({ error: 'trackId and title required' });

    await prisma.historyItem.create({
      data: { userId, trackId, title, artist, thumbnail: thumbnail || null, duration: duration ? Math.floor(duration) : null },
    });
    return { success: true };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Failed to add history' });
  }
});

// --- Playlists ---

/**
 * Create a new playlist
 * POST /api/user/playlists
 */
fastify.post('/api/user/playlists', { preHandler: [fastify.authenticate] }, async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { name } = request.body || {};
    if (!name) return reply.status(400).send({ error: 'Playlist name is required' });

    const playlist = await prisma.playlist.create({
      data: { name, userId },
      include: { tracks: true },
    });
    return playlist;
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Failed to create playlist' });
  }
});

/**
 * Delete a playlist
 * DELETE /api/user/playlists/:id
 */
fastify.delete('/api/user/playlists/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { id } = request.params;

    const playlist = await prisma.playlist.findFirst({ where: { id, userId } });
    if (!playlist) return reply.status(404).send({ error: 'Playlist not found' });

    await prisma.playlist.delete({ where: { id } });
    return { success: true };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Failed to delete playlist' });
  }
});

/**
 * Add a track to a playlist
 * POST /api/user/playlists/:id/tracks
 */
fastify.post('/api/user/playlists/:id/tracks', { preHandler: [fastify.authenticate] }, async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { id } = request.params;
    const { trackId, title, artist, thumbnail, duration } = request.body || {};

    const playlist = await prisma.playlist.findFirst({ where: { id, userId } });
    if (!playlist) return reply.status(404).send({ error: 'Playlist not found' });

    await prisma.playlistTrack.create({
      data: {
        playlistId: id,
        trackId,
        title,
        artist,
        thumbnail: thumbnail || null,
        duration: duration ? Math.floor(duration) : null,
      },
    });
    return { success: true };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Failed to add track to playlist' });
  }
});

/**
 * Remove a track from a playlist
 * DELETE /api/user/playlists/:playlistId/tracks/:trackId
 */
fastify.delete('/api/user/playlists/:playlistId/tracks/:trackId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { playlistId, trackId } = request.params;

    const playlist = await prisma.playlist.findFirst({ where: { id: playlistId, userId } });
    if (!playlist) return reply.status(404).send({ error: 'Playlist not found' });

    await prisma.playlistTrack.deleteMany({ where: { playlistId, trackId } });
    return { success: true };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Failed to remove track from playlist' });
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
