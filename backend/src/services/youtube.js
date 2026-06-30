import { Platform, Innertube } from 'youtubei.js';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execPromise = util.promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, 'po-token-generator.js');

// Configure the javascript execution shim required by youtubei.js to decipher stream signatures
Platform.shim.eval = async (data) => {
  return new Function(data.output)();
};

let cachedPoToken = null;
let cachedVisitorData = null;
let activeRefreshPromise = null;

// Programmatically generate and cache a valid PO Token using the server's own IP address
export async function refreshPoToken() {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = (async () => {
    try {
      console.log('[YouTube Service] Auto-generating fresh PO Token & Visitor Data via sub-process...');
      
      // Execute the token generator in a separate process to prevent memory leaks/OOM crashes in the main server
      const { stdout } = await execPromise(`node "${cliPath}"`);
      const result = JSON.parse(stdout.trim());
      
      if (result.error) {
        throw new Error(result.error + (result.details ? `: ${result.details}` : ''));
      }
      
      cachedPoToken = result.poToken;
      cachedVisitorData = result.visitorData;
      console.log('[YouTube Service] Successfully generated and cached PO Token via sub-process.');
      return { poToken: cachedPoToken, visitorData: cachedVisitorData };
    } catch (error) {
      console.error('[YouTube Service] Sub-process PO Token generation failed:', error.message || error);
      return {
        poToken: cachedPoToken || process.env.YT_PO_TOKEN,
        visitorData: cachedVisitorData || process.env.YT_VISITOR_DATA
      };
    } finally {
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
}

// Trigger initial generation in the background immediately on module load
refreshPoToken().catch(() => {});

// Keep refreshing the PO Token every 2 hours
setInterval(() => {
  refreshPoToken().catch(() => {});
}, 2 * 60 * 60 * 1000);

// Helper function to create an Innertube client with optional PO Token and Visitor Data
async function createInnertubeClient() {
  const options = {};
  
  // Use dynamically generated and cached token if available
  if (cachedPoToken && cachedVisitorData) {
    options.po_token = cachedPoToken;
    options.visitor_data = cachedVisitorData;
  } else {
    // If not generated yet (e.g. at initial startup request), trigger background generation without blocking
    refreshPoToken().catch(() => {});
  }

  // Fallback to static env variables if still empty
  if (!options.po_token && process.env.YT_PO_TOKEN) {
    options.po_token = process.env.YT_PO_TOKEN;
  }
  if (!options.visitor_data && process.env.YT_VISITOR_DATA) {
    options.visitor_data = process.env.YT_VISITOR_DATA;
  }
  
  if (options.po_token) {
    console.log('[YouTube Service] Initializing Innertube client with PO Token.');
  } else {
    console.log('[YouTube Service] Initializing Innertube client WITHOUT PO Token.');
  }
  
  return await Innertube.create(options);
}

// Export active promise to allow getStreamDetails to wait for active generation if necessary
export { activeRefreshPromise };

let ytMusic = null;
let ytVR = null;

/**
 * Initializes and caches the Innertube instance for search.
 */
export async function getYTClient() {
  if (!ytMusic) {
    ytMusic = await createInnertubeClient();
  }
  return ytMusic;
}

/**
 * Initializes and caches a separate Innertube instance for ANDROID_VR streaming.
 */
export async function getYTTVClient() {
  if (!ytVR) {
    ytVR = await createInnertubeClient();
  }
  return ytVR;
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

    // Extract the highest quality thumbnail
    let thumbnail = '';
    const thumbs = item.thumbnail?.contents || item.thumbnail || item.thumbnails;
    if (Array.isArray(thumbs) && thumbs.length > 0) {
      thumbnail = thumbs[thumbs.length - 1].url || thumbs[0].url || '';
    } else if (thumbs && typeof thumbs === 'object') {
      thumbnail = thumbs.url || '';
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
 * Search YouTube Music songs
 */
export async function searchMusic(query) {
  const client = await getYTClient();
  const results = await client.music.search(query, { type: 'song' });
  const songs = [];

  // Parse results. songs may be nested in sections or inside a shelf getter
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

  // Fallback to searching general video results if no songs found (handles edge queries)
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

/**
 * Resolves the stream URL and content details for a video ID using ANDROID_VR client
 */
export async function getStreamDetails(videoId) {
  // If the PO token is actively generating, await it to ensure we have it before creating the streaming client
  if (!cachedPoToken && activeRefreshPromise) {
    console.log('[YouTube Service] Awaiting active PO Token generation before resolving stream details...');
    await activeRefreshPromise;
  }
  // Always create a fresh Innertube instance for streaming to ensure player signature keys are up-to-date.
  const client = await createInnertubeClient();
  
  let info = null;
  let errors = [];

  // 1. If we have a cached PO Token, try the default client configuration first
  // (which uses the Web client session that matches our generated WEB PO Token)
  if (cachedPoToken) {
    try {
      console.log('[YouTube Service] Trying to resolve stream info using default client with PO Token...');
      const candidateInfo = await client.getInfo(videoId);
      
      const hasStreamingFormats = candidateInfo.streaming_data?.adaptive_formats?.length > 0 || 
                                  candidateInfo.streaming_data?.formats?.length > 0;
                                  
      if (candidateInfo && hasStreamingFormats) {
        info = candidateInfo;
        console.log('[YouTube Service] Successfully resolved stream info using default client with PO Token.');
      } else {
        const reason = candidateInfo?.playability_status?.reason || 'No streaming formats available';
        console.warn(`[YouTube Service] Default client returned no streaming formats: ${reason}`);
        errors.push(`DefaultClient: ${reason}`);
      }
    } catch (e) {
      console.warn('[YouTube Service] Default client with PO Token failed:', e.message || e);
      errors.push(`DefaultClient: ${e.message || e}`);
    }
  }

  // 2. Fall back to trying other profiles if default client with PO Token failed or wasn't available
  if (!info) {
    const clientProfiles = ['TV', 'ANDROID_VR', 'IOS', 'TV_EMBEDDED', 'YTMUSIC', 'WEB'];

    for (const clientName of clientProfiles) {
      try {
        console.log(`[YouTube Service] Trying to resolve stream info using client: ${clientName}`);
        const candidateInfo = await client.getInfo(videoId, { client: clientName });
        
        const hasStreamingFormats = candidateInfo.streaming_data?.adaptive_formats?.length > 0 || 
                                    candidateInfo.streaming_data?.formats?.length > 0;
                                    
        if (candidateInfo && hasStreamingFormats) {
          info = candidateInfo;
          console.log(`[YouTube Service] Successfully resolved stream info with client: ${clientName}`);
          break;
        } else {
          const reason = candidateInfo?.playability_status?.reason || 'No streaming formats available';
          console.warn(`[YouTube Service] Client ${clientName} returned no streaming formats: ${reason}`);
          errors.push(`${clientName}: ${reason}`);
        }
      } catch (e) {
        const errMsg = e.message || e.toString();
        console.warn(`[YouTube Service] Client ${clientName} failed: ${errMsg}`);
        errors.push(`${clientName}: ${errMsg}`);
      }
    }
  }

  if (!info) {
    throw new Error(`Failed to resolve video stream details with all client profiles. Errors: ${errors.join(' | ')}`);
  }

  let format = null;
  if (typeof info.chooseFormat === 'function') {
    try {
      format = info.chooseFormat({ type: 'audio', quality: 'best' });
    } catch (e) {
      console.warn('chooseFormat failed, falling back to manual selection:', e);
    }
  }

  if (!format) {
    const formats = info.streaming_data?.adaptive_formats || [];
    // Select the best audio stream
    format = formats.find(f => f.mime_type?.startsWith('audio/')) || 
             formats.find(f => f.mime_type?.includes('audio')) ||
             formats[0];
  }

  if (!format) {
    throw new Error('No formats found for stream resolution');
  }

  let url;
  if (typeof format.decipher === 'function') {
    url = await format.decipher(client.session.player);
  } else {
    url = format.url;
  }

  if (!url) {
    throw new Error('Could not resolve direct streaming URL');
  }

  return {
    url,
    mimeType: format.mime_type || 'audio/webm',
    contentLength: format.content_length || null
  };
}
