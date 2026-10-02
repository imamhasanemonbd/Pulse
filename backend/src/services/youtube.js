import { Platform, Innertube } from 'youtubei.js';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

// Configure the javascript execution shim required by youtubei.js to decipher stream signatures
Platform.shim.eval = async (data) => {
  return new Function(data.output)();
};

let ytClient = null;
let lastClientInit = 0;
const CLIENT_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Direct Innertube client for metadata, search, and lyrics (no proxies)
 */
export async function getYTClient() {
  const now = Date.now();
  if (!ytClient || now - lastClientInit > CLIENT_CACHE_TTL) {
    console.log('[YouTube Service] Initializing direct Innertube client...');
    ytClient = await Innertube.create();
    lastClientInit = now;
  }
  return ytClient;
}

// In-memory stream URL cache: videoId -> { url, mimeType, expiresAt }
const streamUrlCache = new Map();
const URL_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours (YouTube URLs typically valid 6h)

/**
 * Resolves a direct audio stream URL for a given YouTube video ID.
 * Uses local yt-dlp first for robust, ad-free, unthrottled streaming without 403 blocks.
 * Falls back to direct Innertube extraction if needed.
 */
export async function getAudioStreamUrl(videoId) {
  const cached = streamUrlCache.get(videoId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached;
  }

  // 1. Primary: Use yt-dlp with proxy rotating logic
  // Parse proxy list if provided (formats accepted: http://... or IP:PORT:USER:PASS separated by space/comma)
  const proxyInput = process.env.YOUTUBE_PROXY_LIST || process.env.YOUTUBE_PROXY || '';
  let proxyList = proxyInput.split(/[\s,]+/).map(p => p.trim()).filter(Boolean);
  proxyList = proxyList.map(p => {
    const parts = p.split(':');
    if (parts.length === 4) {
      return `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
    }
    return p;
  });

  // If no proxies provided, we still want to try yt-dlp once without proxy
  if (proxyList.length === 0) {
    proxyList.push('');
  } else {
    // Shuffle proxies to distribute load randomly
    proxyList = proxyList.sort(() => 0.5 - Math.random());
    // Limit to max 3 attempts to prevent long hangs
    if (proxyList.length > 3) proxyList.length = 3;
  }

  for (const proxyUrl of proxyList) {
    try {
      const proxyArg = proxyUrl ? `--proxy "${proxyUrl}" ` : '';
      const cmd = `yt-dlp ${proxyArg}-f "140/ba[ext=m4a]/bestaudio" -g "https://www.youtube.com/watch?v=${videoId}"`;
      const { stdout } = await execPromise(cmd, {
        env: {
          ...process.env,
          PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`
        },
        timeout: 10000
      });

      const lines = stdout.trim().split('\n').filter(l => l.startsWith('http'));
      if (lines.length > 0) {
        const url = lines[0].trim();
        const result = {
          url,
          mimeType: 'audio/mp4',
          expiresAt: Date.now() + URL_CACHE_TTL,
          proxy: proxyUrl || undefined
        };
        streamUrlCache.set(videoId, result);
        console.log(`[YouTube Service] Successfully resolved stream URL for ${videoId} via yt-dlp ${proxyUrl ? '(with proxy)' : ''}`);
        return result;
      }
    } catch (err) {
      console.warn(`[YouTube Service] yt-dlp resolution failed for ${videoId} ${proxyUrl ? 'with proxy' : ''}: ${err.message}`);
    }
  }

  // 2. Fallback: Direct Innertube player resolution
  try {
    const client = await getYTClient();
    for (const clientProfile of ['TV_SIMPLY', 'IOS', 'WEB']) {
      try {
        const info = await client.getInfo(videoId, { client: clientProfile });
        const formats = info.streaming_data?.adaptive_formats || [];
        const audioFormat = formats.find(f => f.itag === 140) ||
                            formats.find(f => f.mime_type?.includes('audio/mp4')) ||
                            formats.find(f => f.mime_type?.includes('audio'));
        if (audioFormat) {
          let url = audioFormat.url;
          if (!url && typeof audioFormat.decipher === 'function') {
            url = await audioFormat.decipher(client.session.player);
          }
          if (url) {
            const result = {
              url,
              mimeType: audioFormat.mime_type?.split(';')[0] || 'audio/mp4',
              expiresAt: Date.now() + URL_CACHE_TTL
            };
            streamUrlCache.set(videoId, result);
            console.log(`[YouTube Service] Resolved stream URL for ${videoId} via Innertube (${clientProfile})`);
            return result;
          }
        }
      } catch (profileErr) {
        console.warn(`[YouTube Service] Innertube profile ${clientProfile} failed: ${profileErr.message}`);
      }
    }
  } catch (innertubeErr) {
    console.error(`[YouTube Service] Innertube fallback failed: ${innertubeErr.message}`);
  }

  // 3. Fallback: Piped API (free open source proxy)
  try {
    const pipedRes = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`);
    if (pipedRes.ok) {
      const data = await pipedRes.json();
      const audioStreams = data.audioStreams || [];
      const bestAudio = audioStreams.find(s => s.mimeType?.includes('audio/mp4')) || audioStreams[0];
      if (bestAudio && bestAudio.url) {
        const result = {
          url: bestAudio.url,
          mimeType: bestAudio.mimeType?.split(';')[0] || 'audio/mp4',
          expiresAt: Date.now() + URL_CACHE_TTL
        };
        streamUrlCache.set(videoId, result);
        console.log(`[YouTube Service] Resolved stream URL for ${videoId} via Piped fallback`);
        return result;
      }
    }
  } catch (pipedErr) {
    console.error(`[YouTube Service] Piped fallback failed: ${pipedErr.message}`);
  }

  throw new Error(`Could not resolve audio stream URL for video: ${videoId}`);
}

/**
 * Resolves video info for metadata and details.
 */
export async function getStreamDetails(videoId) {
  const client = await getYTClient();
  const info = await client.getInfo(videoId, { client: 'TV_SIMPLY' }).catch(() => client.getInfo(videoId));
  return { client, info };
}

/**
 * Parses a YouTube Music item node into a clean structure.
 */
function parseSongItem(item) {
  try {
    const id = item.id || item.videoId || item.endpoint?.payload?.videoId;
    if (!id) return null;

    const title = item.title?.toString() || item.name?.toString() || 'Unknown Track';

    // Collect artist names
    let artist = 'Unknown Artist';
    if (item.artists && Array.isArray(item.artists)) {
      artist = item.artists.map(a => a.name).join(', ');
    } else if (item.authors && Array.isArray(item.authors)) {
      artist = item.authors.map(a => a.name).join(', ');
    } else if (item.author) {
      artist = item.author.name || item.author.toString();
    } else if (item.artists) {
      artist = item.artists.name || item.artists.toString();
    }

    // Parse duration to seconds
    let duration = 0;
    if (item.duration) {
      if (typeof item.duration === 'object') {
        duration = item.duration.seconds || 0;
      } else if (typeof item.duration === 'string') {
        duration = parseDurationString(item.duration);
      }
    }

    // Extract the highest quality thumbnail and upgrade to maximum resolution
    let thumbnail = '';
    const thumbs = item.thumbnail?.contents || item.thumbnail || item.thumbnails;
    if (Array.isArray(thumbs) && thumbs.length > 0) {
      thumbnail = thumbs[thumbs.length - 1].url || thumbs[0].url || '';
    } else if (thumbs && typeof thumbs === 'object') {
      thumbnail = thumbs.url || '';
    }

    if (thumbnail) {
      if (thumbnail.includes('googleusercontent.com') || thumbnail.includes('ggpht.com')) {
        thumbnail = thumbnail.replace(/=w\d+-h\d+/, '=w720-h720').replace(/-w\d+-h\d+/, '-w720-h720');
      } else if (thumbnail.includes('i.ytimg.com/vi/')) {
        thumbnail = thumbnail.replace(/(default|mqdefault|hqdefault|sddefault)\.jpg/, 'hq720.jpg');
      }
    }

    return { id, title, artist, duration, thumbnail };
  } catch (err) {
    console.error('Error parsing song item:', err);
    return null;
  }
}

/**
 * Helper to parse a time string (e.g. "3:45", "1:02:15") into seconds.
 */
function parseDurationString(str) {
  const parts = str.split(':').map(Number);
  let secs = 0;
  if (parts.length === 2) {
    secs = parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return secs;
}

/**
 * Search YouTube Music songs directly without proxies
 */
export async function searchMusic(query) {
  const client = await getYTClient();
  const results = await client.music.search(query, { type: 'song' });
  const songs = [];

  if (results.songs && results.songs.contents) {
    for (const item of results.songs.contents) {
      const parsed = parseSongItem(item);
      if (parsed) songs.push(parsed);
    }
  } else if (results.sections) {
    for (const section of results.sections) {
      if (section.contents) {
        for (const item of section.contents) {
          const parsed = parseSongItem(item);
          if (parsed) songs.push(parsed);
        }
      }
    }
  }

  // Fallback to general search if no song results found
  if (songs.length === 0) {
    try {
      const generalSearch = await client.search(query, { type: 'video' });
      const items = generalSearch.videos || generalSearch.results || [];
      for (const item of items) {
        const parsed = parseSongItem(item);
        if (parsed) songs.push(parsed);
      }
    } catch (e) {
      console.error('General search fallback failed:', e);
    }
  }

  return songs;
}
