import { Platform, Innertube } from 'youtubei.js';

// Configure the javascript execution shim required by youtubei.js to decipher stream signatures
Platform.shim.eval = async (data) => {
  return new Function(data.output)();
};

let ytMusic = null;
let ytVR = null;

/**
 * Initializes and caches the Innertube instance for search.
 */
export async function getYTClient() {
  if (!ytMusic) {
    ytMusic = await Innertube.create();
  }
  return ytMusic;
}

/**
 * Initializes and caches a separate Innertube instance for ANDROID_VR streaming.
 */
export async function getYTTVClient() {
  if (!ytVR) {
    ytVR = await Innertube.create();
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
  // Always create a fresh Innertube instance for streaming to ensure player signature keys are up-to-date.
  const client = await Innertube.create();
  
  let info = null;
  let errors = [];
  const clientProfiles = ['ANDROID_VR', 'IOS', 'TV_EMBEDDED', 'WEB'];

  for (const clientName of clientProfiles) {
    try {
      console.log(`[YouTube Service] Trying to resolve stream info using client: ${clientName}`);
      info = await client.getInfo(videoId, { client: clientName });
      if (info) break;
    } catch (e) {
      const errMsg = e.message || e.toString();
      console.warn(`[YouTube Service] Client ${clientName} failed: ${errMsg}`);
      errors.push(`${clientName}: ${errMsg}`);
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
