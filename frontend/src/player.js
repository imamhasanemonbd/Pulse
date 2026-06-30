// Single, persistent HTML5 audio element for PWA background audio compliance on iOS & Android
const audio = new Audio();
audio.setAttribute('playsinline', 'true');
audio.setAttribute('webkit-playsinline', 'true');
audio.preload = 'auto';

// Callbacks set by Svelte UI
export const playerHooks = {
  onStateChange: null, // (state) => {} where state is 'playing' | 'paused' | 'loading'
  onTimeUpdate: null,  // (currentTime, duration) => {}
  onNext: null,        // () => {}
  onPrevious: null,    // () => {}
  onTrackChange: null  // (track) => {}
};

let currentTrack = null;

/**
 * iOS Safari Workaround: MUST be invoked synchronously inside a user gesture microtask
 * to unlock audio context playback.
 */
export function initializeAudio() {
  if (audio.src === '') {
    // Play a 1-second silent WAV to unlock the context
    audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
    audio.play()
      .then(() => {
        console.log('[Player] Audio context unlocked successfully.');
        audio.pause();
      })
      .catch((err) => {
        console.warn('[Player] Audio unlock deferred:', err);
      });
  }
}

/**
 * Loads and plays a music track.
 */
export async function playTrack(track) {
  if (!track || !track.id) return;
  currentTrack = track;

  if (playerHooks.onTrackChange) {
    playerHooks.onTrackChange(track);
  }

  if (playerHooks.onStateChange) {
    playerHooks.onStateChange('loading');
  }

  // Directly call local API stream proxy
  audio.src = `/api/stream/${track.id}`;
  audio.load();

  try {
    await audio.play();
  } catch (err) {
    console.error('[Player] Playback failed: ', err);
    if (playerHooks.onStateChange) {
      playerHooks.onStateChange('paused');
    }
  }

  updateMediaSession(track);
}

/**
 * Toggle between play/pause.
 */
export function play() {
  audio.play().catch(err => console.error('[Player] play() failed:', err));
}

export function pause() {
  audio.pause();
}

export function seek(time) {
  if (!isNaN(audio.duration)) {
    audio.currentTime = time;
    updatePlaybackPosition();
  }
}

export function getAudioElement() {
  return audio;
}

/**
 * Update mediaSession metadata on iOS/Android lock screen.
 */
function updateMediaSession(track) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'Unknown Track',
      artist: track.artist || 'Unknown Artist',
      album: 'Tempo',
      artwork: [
        {
          src: track.thumbnail || '/icon.png',
          sizes: '512x512',
          type: 'image/png'
        }
      ]
    });
    navigator.mediaSession.playbackState = 'playing';
  }
}

/**
 * Update playback position state for Lockscreen scrubbers.
 */
function updatePlaybackPosition() {
  if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
    if (!isNaN(audio.duration) && !isNaN(audio.currentTime)) {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1.0,
        position: audio.currentTime
      });
    }
  }
}

// Register Native Media Session control hooks
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => {
    play();
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    pause();
  });
  navigator.mediaSession.setActionHandler('previoustrack', () => {
    if (playerHooks.onPrevious) playerHooks.onPrevious();
  });
  navigator.mediaSession.setActionHandler('nexttrack', () => {
    if (playerHooks.onNext) playerHooks.onNext();
  });
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.fastSeek && 'fastSeek' in audio) {
      audio.fastSeek(details.seekTime);
    } else {
      audio.currentTime = details.seekTime;
    }
    updatePlaybackPosition();
  });
}

// Audio Element event listeners
audio.addEventListener('play', () => {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'playing';
  }
  if (playerHooks.onStateChange) {
    playerHooks.onStateChange('playing');
  }
});

audio.addEventListener('pause', () => {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'paused';
  }
  if (playerHooks.onStateChange) {
    playerHooks.onStateChange('paused');
  }
});

audio.addEventListener('timeupdate', () => {
  updatePlaybackPosition();
  if (playerHooks.onTimeUpdate) {
    playerHooks.onTimeUpdate(audio.currentTime, audio.duration || 0);
  }
});

audio.addEventListener('durationchange', () => {
  updatePlaybackPosition();
});

audio.addEventListener('ended', () => {
  if (playerHooks.onNext) {
    playerHooks.onNext();
  }
});
