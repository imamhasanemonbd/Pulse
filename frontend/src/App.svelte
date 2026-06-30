<script>
  import { onMount } from 'svelte';
  import { 
    playerHooks, 
    playTrack, 
    play, 
    pause, 
    seek, 
    initializeAudio,
    getAudioElement
  } from './player.js';

  // State Management
  let query = '';
  let results = [];
  let queue = [];
  let currentTrackIndex = -1;
  let currentTrack = null;
  
  let isPlaying = false;
  let isLoading = false;
  let isSearching = false;
  let unlocked = false;

  let currentTime = 0;
  let duration = 0;

  // View state
  let isPlayerExpanded = false;
  let activeTab = 'home'; // 'home' | 'explore' | 'library' | 'settings' | 'search'
  let isSearchExpanded = false;
  let previousTab = 'home';
  let searchInputRef = null;
  
  // Volume state
  let volume = 0.8;
  let isMuted = false;
  let previousVolume = 0.8;

  // Playback modes
  let isShuffle = false;
  let repeatMode = 'none'; // 'none' | 'all' | 'one'

  // Dashboard feeds
  let quickPicks = [];
  let likedTracks = [];
  let historyTracks = [];

  // Expanded Player sub-sheets (Apple Music layout)
  let showLyrics = false;
  let showQueue = false;
  let cachedLyricsId = '';
  let lyricsText = '';
  let lyricsSource = '';
  let isLyricsLoading = false;

  // Option dropdown state
  let activeTrackMenuId = null;

  // Playlists and Library Subviews state
  let playlists = JSON.parse(localStorage.getItem('playlists') || '[]');
  let activeLibrarySubViewId = null; // null | 'liked' | 'history' | playlistId
  let playlistSelectorTrack = null; // null | track object

  // Swipe to Close gesture state
  let startY = 0;
  let currentY = 0;
  let dragY = 0;
  let isDragging = false;

  // Lyrics container reference for auto-scroll
  let lyricsScrollContainer;

  // Exploration genres (Apple Music styled gradients)
  const exploreGenres = [
    { name: 'Lofi Chill', query: 'lofi chill beats', gradient: 'linear-gradient(135deg, rgba(236, 72, 153, 0.35) 0%, rgba(139, 92, 246, 0.1) 100%)', icon: '☕' },
    { name: 'Synthwave', query: 'synthwave retro track', gradient: 'linear-gradient(135deg, rgba(244, 63, 94, 0.35) 0%, rgba(190, 24, 74, 0.1) 100%)', icon: '🌌' },
    { name: 'Piano & Focus', query: 'study piano focus instrumental', gradient: 'linear-gradient(135deg, rgba(14, 165, 233, 0.35) 0%, rgba(3, 105, 161, 0.1) 100%)', icon: '🎹' },
    { name: 'Cyberpunk', query: 'cyberpunk dark industrial synth', gradient: 'linear-gradient(135deg, rgba(168, 85, 247, 0.35) 0%, rgba(109, 40, 217, 0.1) 100%)', icon: '👾' },
    { name: 'Acoustic Cover', query: 'acoustic guitar pop songs cover', gradient: 'linear-gradient(135deg, rgba(245, 158, 11, 0.35) 0%, rgba(180, 83, 9, 0.1) 100%)', icon: '🎸' },
    { name: 'Summer Vibes', query: 'indie pop chill beach vibe', gradient: 'linear-gradient(135deg, rgba(16, 185, 129, 0.35) 0%, rgba(4, 120, 87, 0.1) 100%)', icon: '☀️' }
  ];

  // Distribute active line index linearly based on song progression
  $: lyricLines = lyricsText ? lyricsText.split('\n').map(l => l.trim()).filter(l => l.length > 0) : [];
  
  $: activeLineIndex = (lyricLines.length > 0 && duration > 0)
    ? Math.min(Math.floor(currentTime / duration * lyricLines.length), lyricLines.length - 1)
    : -1;

  $: activeLibrarySubView = (() => {
    if (activeLibrarySubViewId === 'liked') {
      return { id: 'liked', name: 'Liked Songs', tracks: likedTracks };
    } else if (activeLibrarySubViewId === 'history') {
      return { id: 'history', name: 'Recent History', tracks: historyTracks };
    } else if (activeLibrarySubViewId) {
      const pl = playlists.find(p => p.id === activeLibrarySubViewId);
      if (pl) {
        return { id: pl.id, name: pl.name, tracks: pl.tracks };
      }
    }
    return null;
  })();

  // Auto-scroll active line to center inside masked scrollbox
  $: if (lyricsScrollContainer && activeLineIndex !== -1) {
    const lines = lyricsScrollContainer.querySelectorAll('.lyric-line-item');
    const activeEl = lines[activeLineIndex];
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Dynamic lyrics fetching
  $: if (currentTrack && currentTrack.id !== cachedLyricsId) {
    cachedLyricsId = currentTrack.id;
    lyricsText = '';
    lyricsSource = '';
    if (showLyrics) {
      fetchLyrics();
    }
  }

  $: if (showLyrics && !lyricsText && !isLyricsLoading && currentTrack) {
    fetchLyrics();
  }

  async function fetchLyrics() {
    if (!currentTrack) return;
    isLyricsLoading = true;
    try {
      const res = await fetch(`/api/lyrics/${currentTrack.id}`);
      if (res.ok) {
        const data = await res.json();
        lyricsText = data.lyrics;
        lyricsSource = data.source;
      } else {
        lyricsText = 'Lyrics not available.';
      }
    } catch (e) {
      lyricsText = 'Failed to load lyrics.';
    } finally {
      isLyricsLoading = false;
    }
  }

  onMount(async () => {
    // Bind player.js callbacks to Svelte state
    playerHooks.onStateChange = (state) => {
      if (state === 'playing') {
        isPlaying = true;
        isLoading = false;
      } else if (state === 'paused') {
        isPlaying = false;
        isLoading = false;
      } else if (state === 'loading') {
        isLoading = true;
      }
    };

    playerHooks.onTimeUpdate = (cTime, dur) => {
      currentTime = cTime;
      duration = dur;
    };

    playerHooks.onTrackChange = (track) => {
      currentTrack = track;
      if (track) {
        // Add to history
        let history = JSON.parse(localStorage.getItem('historyTracks') || '[]');
        history = history.filter(t => t.id !== track.id);
        history.unshift(track);
        history = history.slice(0, 30);
        localStorage.setItem('historyTracks', JSON.stringify(history));
        historyTracks = history;
      }
    };

    playerHooks.onNext = () => {
      skipNext();
    };

    playerHooks.onPrevious = () => {
      skipPrevious();
    };

    // Load Liked Tracks and History from localStorage
    likedTracks = JSON.parse(localStorage.getItem('likedTracks') || '[]');
    historyTracks = JSON.parse(localStorage.getItem('historyTracks') || '[]');

    // Initialize volume
    const audioEl = getAudioElement();
    if (audioEl) {
      audioEl.volume = volume;
    }

    // Pre-populate Home view Quick Picks with lofi tracks
    try {
      const res = await fetch(`/api/search?q=lofi%20beats%20to%20relax`);
      if (res.ok) {
        quickPicks = (await res.json()).slice(0, 10);
      }
    } catch (e) {
      console.error('Failed to load quick picks:', e);
    }
  });

  // Search trigger
  async function handleSearch() {
    if (!query.trim()) return;
    isSearching = true;
    activeTab = 'search';
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        results = await res.json();
      }
    } catch (e) {
      console.error('Search failed:', e);
    } finally {
      isSearching = false;
    }
  }

  // Playback control functions
  function playSong(track, srcList) {
    if (!unlocked) {
      initializeAudio();
      unlocked = true;
    }
    queue = [...srcList];
    currentTrackIndex = queue.findIndex(t => t.id === track.id);
    if (currentTrackIndex === -1) {
      queue.unshift(track);
      currentTrackIndex = 0;
    }
    playCurrentTrack();
  }

  async function playCurrentTrack() {
    if (currentTrackIndex >= 0 && currentTrackIndex < queue.length) {
      const track = queue[currentTrackIndex];
      await playTrack(track);
    }
  }

  function togglePlay(e) {
    if (e) e.stopPropagation();
    if (!unlocked) {
      initializeAudio();
      unlocked = true;
    }

    if (!currentTrack) {
      if (queue.length > 0) {
        currentTrackIndex = 0;
        playCurrentTrack();
      } else if (quickPicks.length > 0) {
        queue = [...quickPicks];
        currentTrackIndex = 0;
        playCurrentTrack();
      }
      return;
    }

    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }

  function skipNext(e) {
    if (e) e.stopPropagation();
    if (queue.length === 0) return;
    
    if (repeatMode === 'one') {
      playCurrentTrack();
      return;
    }

    if (isShuffle) {
      currentTrackIndex = Math.floor(Math.random() * queue.length);
    } else {
      currentTrackIndex = (currentTrackIndex + 1) % queue.length;
      if (currentTrackIndex === 0 && repeatMode === 'none') {
        pause();
        return;
      }
    }
    playCurrentTrack();
  }

  function skipPrevious(e) {
    if (e) e.stopPropagation();
    if (queue.length === 0) return;
    currentTrackIndex = (currentTrackIndex - 1 + queue.length) % queue.length;
    playCurrentTrack();
  }

  function handleScrub(e) {
    const targetTime = parseFloat(e.target.value);
    seek(targetTime);
  }

  // Volume controls
  function handleVolumeChange(e) {
    volume = parseFloat(e.target.value);
    isMuted = volume === 0;
    const audioEl = getAudioElement();
    if (audioEl) {
      audioEl.volume = volume;
    }
  }

  function toggleMute() {
    const audioEl = getAudioElement();
    if (!audioEl) return;

    if (isMuted) {
      volume = previousVolume > 0 ? previousVolume : 0.8;
      audioEl.volume = volume;
      isMuted = false;
    } else {
      previousVolume = volume;
      volume = 0;
      audioEl.volume = 0;
      isMuted = true;
    }
  }

  // Shuffle & Repeat toggles
  function toggleShuffle() {
    isShuffle = !isShuffle;
  }

  function cycleRepeat() {
    if (repeatMode === 'none') {
      repeatMode = 'all';
    } else if (repeatMode === 'all') {
      repeatMode = 'one';
    } else {
      repeatMode = 'none';
    }
  }

  // Liked management
  function toggleLike(track, e) {
    if (e) e.stopPropagation();
    if (!track) return;
    
    let liked = JSON.parse(localStorage.getItem('likedTracks') || '[]');
    const index = liked.findIndex(t => t.id === track.id);
    if (index !== -1) {
      liked.splice(index, 1);
    } else {
      liked.unshift(track);
    }
    localStorage.setItem('likedTracks', JSON.stringify(liked));
    likedTracks = liked;
  }

  function createPlaylist() {
    const name = prompt("Enter playlist name:");
    if (!name || name.trim() === "") return;
    const newPlaylist = {
      id: 'pl_' + Date.now(),
      name: name.trim(),
      tracks: []
    };
    playlists = [...playlists, newPlaylist];
    localStorage.setItem('playlists', JSON.stringify(playlists));
  }

  function deletePlaylist(playlistId, e) {
    if (e) e.stopPropagation();
    if (!confirm("Are you sure you want to delete this playlist?")) return;
    playlists = playlists.filter(pl => pl.id !== playlistId);
    localStorage.setItem('playlists', JSON.stringify(playlists));
    if (activeLibrarySubViewId === playlistId) {
      activeLibrarySubViewId = null;
    }
  }

  function addTrackToPlaylist(track, playlistId) {
    playlists = playlists.map(pl => {
      if (pl.id === playlistId) {
        if (pl.tracks.some(t => t.id === track.id)) {
          alert("This song is already in the playlist.");
          return pl;
        }
        return { ...pl, tracks: [...pl.tracks, track] };
      }
      return pl;
    });
    localStorage.setItem('playlists', JSON.stringify(playlists));
  }

  function removeTrackFromPlaylist(trackId, playlistId, e) {
    if (e) e.stopPropagation();
    playlists = playlists.map(pl => {
      if (pl.id === playlistId) {
        return { ...pl, tracks: pl.tracks.filter(t => t.id !== trackId) };
      }
      return pl;
    });
    localStorage.setItem('playlists', JSON.stringify(playlists));
  }

  function selectGenre(genre) {
    query = genre.name;
    isSearchExpanded = true;
    handleSearch();
  }

  function expandSearch() {
    isSearchExpanded = true;
    if (activeTab !== 'search') {
      previousTab = activeTab;
    }
    activeTab = 'search';
    setTimeout(() => {
      if (searchInputRef) searchInputRef.focus();
    }, 150);
  }

  function collapseSearch() {
    isSearchExpanded = false;
    query = '';
    activeTab = previousTab;
  }

  // Menu Dropdown Handlers
  function toggleTrackMenu(trackId, e) {
    if (e) e.stopPropagation();
    activeTrackMenuId = activeTrackMenuId === trackId ? null : trackId;
  }

  function closeTrackMenu() {
    activeTrackMenuId = null;
  }

  function playNext(track, e) {
    if (e) e.stopPropagation();
    activeTrackMenuId = null;

    if (queue.length === 0) {
      queue = [track];
      currentTrackIndex = 0;
      playCurrentTrack();
      return;
    }

    const existingIndex = queue.findIndex(t => t.id === track.id);
    if (existingIndex !== -1) {
      queue.splice(existingIndex, 1);
      if (existingIndex < currentTrackIndex) {
        currentTrackIndex--;
      }
    }
    
    queue.splice(currentTrackIndex + 1, 0, track);
    queue = [...queue];
  }

  function addToQueue(track, e) {
    if (e) e.stopPropagation();
    activeTrackMenuId = null;

    const existingIndex = queue.findIndex(t => t.id === track.id);
    if (existingIndex !== -1) {
      return;
    }
    queue = [...queue, track];
  }

  // Sheet toggle shortcuts
  function toggleLyricsSheet() {
    showLyrics = !showLyrics;
    if (showLyrics) showQueue = false;
  }

  function toggleQueueSheet() {
    showQueue = !showQueue;
    if (showQueue) showLyrics = false;
  }

  // Swipe to Close Sheet Gesture Handlers
  function handleTouchStart(e) {
    const target = e.target;
    // Prevent dragging on range slider inputs, select tags, or buttons so the user can interact with them normally
    if (target.closest('input[type="range"]') || target.closest('select') || target.closest('button') || target.closest('svg')) {
      return;
    }

    // Allow dragging from anywhere except scroll containers that are currently scrolled down
    const scrollContainer = target.closest('.lyrics-scroll-box') || target.closest('.queue-overlay-scroll-box');
    if (scrollContainer && scrollContainer.scrollTop > 0) {
      return; // Let the container scroll naturally
    }

    startY = e.touches[0].clientY;
    isDragging = true;
    dragY = 0;
  }

  function handleTouchMove(e) {
    if (!isDragging) return;
    currentY = e.touches[0].clientY;
    const diff = currentY - startY;
    if (diff > 0) {
      dragY = diff;
      // Prevent standard browser scroll rubber-banding while we are dragging down the sheet
      if (e.cancelable) {
        e.preventDefault();
      }
    }
  }

  // Dismiss threshold: 100px (reduced from 120px for better responsiveness)
  function handleTouchEnd() {
    if (!isDragging) return;
    isDragging = false;
    if (dragY > 100) {
      isPlayerExpanded = false;
    }
    dragY = 0;
  }

  // Tap on lyrics line to seek directly to estimated timestamp
  function seekToLine(index) {
    if (duration > 0 && lyricLines.length > 0) {
      const targetTime = (index / lyricLines.length) * duration;
      seek(targetTime);
    }
  }

  // Formats time strings
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds === null) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  $: isCurrentTrackLiked = currentTrack && likedTracks.some(t => t.id === currentTrack.id);
</script>

<!-- Ambient Dynamic Liquid Backdrop -->
<div class="dynamic-backdrop">
  {#if currentTrack}
    <img src={currentTrack.thumbnail} alt="" class="backdrop-image" />
  {:else}
    <div class="default-backdrop-gradient"></div>
  {/if}
  <div class="backdrop-overlay"></div>
</div>

<div class="app-shell" on:click={closeTrackMenu}>
  <!-- Centered Liquid Glass Mobile Frame -->
  <div class="app-container">
    
    <!-- Top Glass Header -->
    <header class="top-header-glass">
      <div class="header-content-wrapper {isSearchExpanded ? 'search-mode-active' : ''}">
        
        <!-- Non-search header view -->
        <div class="header-brand-side">
          <div class="logo-container" on:click={() => { activeTab = 'home'; isSearchExpanded = false; showLyrics = false; showQueue = false; }} style="cursor: pointer;" title="Pulse Home">
            <svg viewBox="0 0 24 24" width="28" height="28" class="pulse-logo-icon">
              <defs>
                <linearGradient id="pulse-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#ff2d55" />
                  <stop offset="100%" stop-color="#ec4899" />
                </linearGradient>
              </defs>
              <circle cx="12" cy="12" r="9" fill="none" stroke="url(#pulse-grad)" stroke-width="2.5" class="pulse-ring" />
              <path d="M7 12h2l1.5-4 1 8 1.5-6 1 4 1-2h2" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
          <span class="header-brand-name" on:click={() => { activeTab = 'home'; isSearchExpanded = false; showLyrics = false; showQueue = false; }} style="cursor: pointer;">Pulse</span>
        </div>

        <button class="header-search-trigger-btn" on:click={expandSearch}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </button>

        <!-- Expanded Search header view -->
        <div class="expanded-search-bar-wrapper">
          <form class="expanded-search-form" on:submit|preventDefault={handleSearch}>
            <div class="search-pill-expanded">
              <svg class="search-pill-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input 
                type="search" 
                placeholder="Search artists, songs, lofi..." 
                bind:value={query}
                bind:this={searchInputRef}
                on:focus={() => {
                  if (!unlocked) {
                    initializeAudio();
                    unlocked = true;
                  }
                }}
              />
              {#if query}
                <button type="button" class="search-clear-btn" on:click={() => query = ''}>
                  ✕
                </button>
              {/if}
            </div>
            <button type="button" class="search-cancel-btn" on:click={collapseSearch}>
              Cancel
            </button>
          </form>
        </div>

      </div>
    </header>

    <!-- Scrollable content area -->
    <div class="content-scrollable">
      
      <!-- TAB 1: LISTEN NOW (HOME) -->
      {#if activeTab === 'home'}
        <h1 class="view-large-title">Listen Now</h1>
        
        <section class="home-shelf">
          <h2 class="shelf-title">Recently Played</h2>
          {#if historyTracks.length === 0}
            <div class="empty-shelf-card">
              <span class="empty-shelf-icon">🕒</span>
              <p>Your history will appear here as you stream.</p>
            </div>
          {:else}
            <div class="horizontal-scroll-shelf">
              {#each historyTracks.slice(0, 8) as track}
                <div class="shelf-item-card" on:click={() => playSong(track, historyTracks)}>
                  <div class="shelf-thumb-wrapper">
                    <img class="shelf-thumb" src={track.thumbnail || '/icon.png'} alt={track.title} />
                    <span class="shelf-play-badge">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                      </svg>
                    </span>
                  </div>
                  <span class="shelf-item-title">{track.title}</span>
                  <span class="shelf-item-artist">{track.artist}</span>
                </div>
              {/each}
            </div>
          {/if}
        </section>

        <section class="home-shelf">
          <h2 class="shelf-title">Quick Picks</h2>
          <div class="compact-tracks-grid">
            {#each quickPicks as track}
              <div 
                class="compact-track-item {currentTrack && currentTrack.id === track.id ? 'active-track-item' : ''}"
                on:click={() => playSong(track, quickPicks)}
              >
                <img class="compact-thumb" src={track.thumbnail || '/icon.png'} alt={track.title} />
                <div class="compact-details">
                  <span class="compact-title">{track.title}</span>
                  <span class="compact-artist">{track.artist}</span>
                </div>
                
                <div class="item-actions-row">
                  <button class="compact-like-btn" on:click={(e) => toggleLike(track, e)}>
                    {#if likedTracks.some(t => t.id === track.id)}
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="#ff2d55" stroke="#ff2d55" stroke-width="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                      </svg>
                    {:else}
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="rgba(255, 255, 255, 0.4)" stroke-width="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                      </svg>
                    {/if}
                  </button>

                  <!-- Options Menu -->
                  <div class="row-menu-container">
                    <button class="row-menu-trigger-btn" on:click={(e) => toggleTrackMenu(track.id, e)}>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="1"></circle>
                        <circle cx="19" cy="12" r="1"></circle>
                        <circle cx="5" cy="12" r="1"></circle>
                      </svg>
                    </button>
                    {#if activeTrackMenuId === track.id}
                      <div class="track-glass-dropdown">
                        <button class="dropdown-item" on:click={(e) => playNext(track, e)}>
                          <span>⏭️</span> Play Next
                        </button>
                        <button class="dropdown-item" on:click={(e) => addToQueue(track, e)}>
                          <span>➕</span> Add to Queue
                        </button>
                        <button class="dropdown-item" on:click={(e) => { e.stopPropagation(); playlistSelectorTrack = track; activeTrackMenuId = null; }}>
                          <span>🎶</span> Add to Playlist
                        </button>
                      </div>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- TAB 2: EXPLORE (GENRES) -->
      {#if activeTab === 'explore'}
        <h1 class="view-large-title">Explore</h1>
        
        <section class="home-shelf">
          <h2 class="shelf-title">Moods & Genres</h2>
          <div class="explore-genres-grid">
            {#each exploreGenres as genre}
              <div 
                class="explore-genre-card" 
                style="background: ${genre.gradient}"
                on:click={() => selectGenre(genre)}
              >
                <span class="genre-icon-large">{genre.icon}</span>
                <span class="genre-label-large">{genre.name}</span>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- TAB 3: LIBRARY -->
      {#if activeTab === 'library'}
        {#if activeLibrarySubViewId === null}
          <!-- MAIN LIBRARY OVERVIEW -->
          <h1 class="view-large-title">Library</h1>
          
          <!-- Liked Songs and Recent History as organised side-by-side cards -->
          <div class="library-cards-grid">
            <div class="library-card liked-songs-card" on:click={() => activeLibrarySubViewId = 'liked'}>
              <div class="library-card-icon-wrapper">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="#ff2d55" stroke="#ff2d55">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
              </div>
              <div class="library-card-info">
                <span class="library-card-name">Liked Songs</span>
                <span class="library-card-count">{likedTracks.length} {likedTracks.length === 1 ? 'song' : 'songs'}</span>
              </div>
            </div>

            <div class="library-card history-card" on:click={() => activeLibrarySubViewId = 'history'}>
              <div class="library-card-icon-wrapper">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#ff2d55" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </div>
              <div class="library-card-info">
                <span class="library-card-name">History</span>
                <span class="library-card-count">{historyTracks.length} {historyTracks.length === 1 ? 'item' : 'items'}</span>
              </div>
            </div>
          </div>

          <!-- Custom Playlists Section -->
          <div class="playlists-shelf-header">
            <h2 class="shelf-title">Playlists</h2>
            <button class="playlist-create-btn" on:click={createPlaylist}>
              <span>＋</span> Create
            </button>
          </div>

          <div class="playlists-cards-grid">
            {#if playlists.length === 0}
              <div class="empty-shelf-card no-playlists-placeholder" on:click={createPlaylist}>
                <span class="empty-shelf-icon">🎵</span>
                <p>Create your first playlist</p>
                <span class="placeholder-action-hint">Tap here or the Create button</span>
              </div>
            {:else}
              {#each playlists as pl}
                <div class="playlist-card" on:click={() => activeLibrarySubViewId = pl.id}>
                  <div class="playlist-card-badge">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M9 18V5l12-2v13"></path>
                      <circle cx="6" cy="18" r="3"></circle>
                      <circle cx="18" cy="16" r="3"></circle>
                    </svg>
                  </div>
                  <div class="playlist-card-details">
                    <span class="playlist-card-title">{pl.name}</span>
                    <span class="playlist-card-count">{pl.tracks.length} {pl.tracks.length === 1 ? 'song' : 'songs'}</span>
                  </div>
                  <button class="playlist-delete-card-btn" on:click={(e) => deletePlaylist(pl.id, e)} title="Delete Playlist">
                    ✕
                  </button>
                </div>
              {/each}
            {/if}
          </div>

        {:else}
          <!-- ORGANIZED SUB-VIEW FOR ACTIVE COLLECTION -->
          <div class="library-subview-wrapper">
            <button class="subview-back-button" on:click={() => activeLibrarySubViewId = null}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
              <span>Library</span>
            </button>

            <div class="subview-header-row">
              <div class="subview-header-text">
                <h1 class="view-large-title">{activeLibrarySubView.name}</h1>
                <span class="subview-meta-text">{activeLibrarySubView.tracks.length} {activeLibrarySubView.tracks.length === 1 ? 'song' : 'songs'}</span>
              </div>
              {#if activeLibrarySubView.tracks.length > 0}
                <button class="play-all-premium-btn" on:click={() => playSong(activeLibrarySubView.tracks[0], activeLibrarySubView.tracks)}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                  <span>Play All</span>
                </button>
              {/if}
            </div>

            <!-- List View -->
            {#if activeLibrarySubView.tracks.length === 0}
              <div class="empty-shelf-card">
                <span class="empty-shelf-icon">📭</span>
                <p>This list is empty.</p>
                <span class="empty-shelf-subtext" style="font-size: 0.75rem; opacity: 0.5; margin-top: 4px; display: block;">Add tracks from Search or Listen Now views.</span>
              </div>
            {:else}
              <div class="compact-tracks-grid">
                {#each activeLibrarySubView.tracks as track}
                  <div class="compact-track-item {currentTrack && currentTrack.id === track.id ? 'active-track-item' : ''}" on:click={() => playSong(track, activeLibrarySubView.tracks)}>
                    <img class="compact-thumb" src={track.thumbnail || '/icon.png'} alt={track.title} />
                    <div class="compact-details">
                      <span class="compact-title">{track.title}</span>
                      <span class="compact-artist">{track.artist}</span>
                    </div>
                    <div class="item-actions-row">
                      {#if activeLibrarySubView.id.startsWith('pl_')}
                        <!-- Remove button for custom playlists -->
                        <button class="remove-playlist-track-btn" on:click={(e) => removeTrackFromPlaylist(track.id, activeLibrarySubView.id, e)} title="Remove from Playlist">
                          ✕
                        </button>
                      {:else}
                        <!-- Like toggle for other list views -->
                        <button class="compact-like-btn" on:click={(e) => toggleLike(track, e)}>
                          {#if likedTracks.some(t => t.id === track.id)}
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="#ff2d55" stroke="#ff2d55" stroke-width="2">
                              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                            </svg>
                          {:else}
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="rgba(255, 255, 255, 0.4)" stroke-width="2">
                              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                            </svg>
                          {/if}
                        </button>
                      {/if}

                      <div class="row-menu-container">
                        <button class="row-menu-trigger-btn" on:click={(e) => toggleTrackMenu(track.id, e)}>
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="1"></circle>
                            <circle cx="19" cy="12" r="1"></circle>
                            <circle cx="5" cy="12" r="1"></circle>
                          </svg>
                        </button>
                        {#if activeTrackMenuId === track.id}
                          <div class="track-glass-dropdown">
                            <button class="dropdown-item" on:click={(e) => playNext(track, e)}>
                              <span>⏭️</span> Play Next
                            </button>
                            <button class="dropdown-item" on:click={(e) => addToQueue(track, e)}>
                              <span>➕</span> Add to Queue
                            </button>
                            <button class="dropdown-item" on:click={(e) => { e.stopPropagation(); playlistSelectorTrack = track; activeTrackMenuId = null; }}>
                              <span>🎶</span> Add to Playlist
                            </button>
                          </div>
                        {/if}
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/if}

      <!-- TAB 4: SEARCH RESULTS -->
      {#if activeTab === 'search'}
        <h1 class="view-large-title">Search Results</h1>
        
        {#if isSearching}
          <div class="search-loader-container">
            <div class="ios-loading-spinner"></div>
            <p>Searching Apple Music...</p>
          </div>
        {:else if results.length === 0}
          <div class="empty-shelf-card">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 8px;">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <p>Search for artists, songs, or genres above.</p>
          </div>
        {:else}
          <div class="compact-tracks-grid">
            {#each results as track}
              <div 
                class="compact-track-item {currentTrack && currentTrack.id === track.id ? 'active-track-item' : ''}"
                on:click={() => playSong(track, results)}
              >
                <img class="compact-thumb" src={track.thumbnail || '/icon.png'} alt={track.title} />
                <div class="compact-details">
                  <span class="compact-title">{track.title}</span>
                  <span class="compact-artist">{track.artist}</span>
                </div>
                <div class="search-item-actions">
                  <button class="compact-like-btn" on:click={(e) => toggleLike(track, e)}>
                    {#if likedTracks.some(t => t.id === track.id)}
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="#ff2d55" stroke="#ff2d55" stroke-width="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                      </svg>
                    {:else}
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="rgba(255, 255, 255, 0.4)" stroke-width="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                      </svg>
                    {/if}
                  </button>

                  <div class="row-menu-container">
                    <button class="row-menu-trigger-btn" on:click={(e) => toggleTrackMenu(track.id, e)}>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="1"></circle>
                        <circle cx="19" cy="12" r="1"></circle>
                        <circle cx="5" cy="12" r="1"></circle>
                      </svg>
                    </button>
                    {#if activeTrackMenuId === track.id}
                      <div class="track-glass-dropdown">
                        <button class="dropdown-item" on:click={(e) => playNext(track, e)}>
                          <span>⏭️</span> Play Next
                        </button>
                        <button class="dropdown-item" on:click={(e) => addToQueue(track, e)}>
                          <span>➕</span> Add to Queue
                        </button>
                        <button class="dropdown-item" on:click={(e) => { e.stopPropagation(); playlistSelectorTrack = track; activeTrackMenuId = null; }}>
                          <span>🎶</span> Add to Playlist
                        </button>
                      </div>
                    {/if}
                  </div>

                  <span class="search-track-duration">{formatTime(track.duration)}</span>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/if}

      <!-- TAB 5: SETTINGS -->
      {#if activeTab === 'settings'}
        <h1 class="view-large-title">Settings</h1>
        <div class="settings-stack-glass">
          
          <!-- App Preferences Section -->
          <div class="settings-group">
            <h3 class="settings-group-title">Audio & Streaming</h3>
            
            <div class="settings-row">
              <div class="settings-row-label">
                <span class="settings-row-icon">🎛️</span>
                <div class="settings-text-meta">
                  <span class="settings-title">Streaming Quality</span>
                  <span class="settings-subtitle">Adjust stream resolution bandwidth</span>
                </div>
              </div>
              <select class="settings-select" value="high">
                <option value="high">High (256kbps WebM)</option>
                <option value="medium">Normal (128kbps AAC)</option>
                <option value="low">Low (64kbps Opus)</option>
              </select>
            </div>

            <div class="settings-row">
              <div class="settings-row-label">
                <span class="settings-row-icon">📱</span>
                <div class="settings-text-meta">
                  <span class="settings-title">Background Playback</span>
                  <span class="settings-subtitle">Enable background lockscreen control</span>
                </div>
              </div>
              <label class="settings-switch">
                <input type="checkbox" checked disabled />
                <span class="switch-slider"></span>
              </label>
            </div>
          </div>

          <!-- Data Management Section -->
          <div class="settings-group">
            <h3 class="settings-group-title">Storage & History</h3>
            
            <button class="settings-action-row-btn" on:click={() => {
              localStorage.removeItem('historyTracks');
              historyTracks = [];
              alert('Playback history cleared.');
            }}>
              <div class="settings-row-label">
                <span class="settings-row-icon">🗑️</span>
                <div class="settings-text-meta">
                  <span class="settings-title">Clear Recent History</span>
                  <span class="settings-subtitle">Remove cached history tracks from homepage</span>
                </div>
              </div>
            </button>

            <button class="settings-action-row-btn" on:click={() => {
              localStorage.removeItem('likedTracks');
              likedTracks = [];
              alert('Liked library songs cleared.');
            }}>
              <div class="settings-row-label">
                <span class="settings-row-icon">❤️</span>
                <div class="settings-text-meta">
                  <span class="settings-title">Clear Liked Songs</span>
                  <span class="settings-subtitle">Reset Liked Songs library items</span>
                </div>
              </div>
            </button>
          </div>

          <!-- About Section -->
          <div class="settings-group">
            <h3 class="settings-group-title">About Pulse</h3>
            
            <div class="settings-row">
              <div class="settings-row-label">
                <span class="settings-row-icon">ℹ️</span>
                <div class="settings-text-meta">
                  <span class="settings-title">Application Version</span>
                  <span class="settings-subtitle">Pulse Web Player</span>
                </div>
              </div>
              <span class="settings-value-text">v1.1.0 (Stable)</span>
            </div>

            <div class="settings-row">
              <div class="settings-row-label">
                <span class="settings-row-icon">🛡️</span>
                <div class="settings-text-meta">
                  <span class="settings-title">License & Ads</span>
                  <span class="settings-subtitle">Completely Free & Ad-free forever</span>
                </div>
              </div>
              <span class="settings-value-text" style="color: #ff2d55; font-weight: 700;">Open Source</span>
            </div>
          </div>

        </div>
      {/if}

    </div>

    <!-- Floating Mini Player (Pill shape) -->
    {#if currentTrack && !isPlayerExpanded}
      <div class="floating-mini-player" on:click={() => isPlayerExpanded = true}>
        <img class="mini-art {isPlaying ? 'mini-art-playing' : ''}" src={currentTrack.thumbnail || '/icon.png'} alt="" />
        <div class="mini-details">
          <span class="mini-title">{currentTrack.title}</span>
          <span class="mini-artist">{currentTrack.artist}</span>
        </div>
        <div class="mini-controls">
          <button class="mini-control-btn" on:click={togglePlay}>
            {#if isLoading}
              <span class="ios-mini-spinner"></span>
            {:else if isPlaying}
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
              </svg>
            {:else}
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            {/if}
          </button>
          <button class="mini-control-btn" on:click={skipNext}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <polygon points="5 4 15 12 5 20 5 4"></polygon>
              <rect x="17" y="4" width="2" height="16"></rect>
            </svg>
          </button>
        </div>
      </div>
    {/if}

    <!-- Add to Playlist Glass Dialog Overlay -->
    {#if playlistSelectorTrack}
      <div class="playlist-selector-overlay-glass" on:click={() => playlistSelectorTrack = null}>
        <div class="playlist-selector-modal" on:click={(e) => e.stopPropagation()}>
          <header class="playlist-selector-header">
            <h3>Add to Playlist</h3>
            <button class="playlist-selector-close-btn" on:click={() => playlistSelectorTrack = null}>✕</button>
          </header>
          
          <div class="playlist-selector-scroll">
            <button class="playlist-selector-create-btn" on:click={() => { createPlaylist(); }}>
              <span>＋</span> Create New Playlist
            </button>

            {#if playlists.length === 0}
              <p class="playlist-selector-empty-text">No playlists created yet.</p>
            {:else}
              <div class="playlist-selector-list">
                {#each playlists as pl}
                  <button class="playlist-selector-item" on:click={() => { addTrackToPlaylist(playlistSelectorTrack, pl.id); playlistSelectorTrack = null; }}>
                    <div class="playlist-selector-item-badge">🎵</div>
                    <div class="playlist-selector-item-info">
                      <span class="playlist-selector-item-name">{pl.name}</span>
                      <span class="playlist-selector-item-count">{pl.tracks.length} songs</span>
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <!-- Bottom Tab Bar -->
    <nav class="bottom-tab-bar-glass">
      <button 
        class="tab-bar-item {activeTab === 'home' ? 'active' : ''}" 
        on:click={() => activeTab = 'home'}
      >
        <span class="tab-item-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
        </span>
        <span class="tab-item-label">Listen Now</span>
      </button>
      <button 
        class="tab-bar-item {activeTab === 'explore' ? 'active' : ''}" 
        on:click={() => activeTab = 'explore'}
      >
        <span class="tab-item-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
          </svg>
        </span>
        <span class="tab-item-label">Explore</span>
      </button>
      <button 
        class="tab-bar-item {activeTab === 'library' ? 'active' : ''}" 
        on:click={() => activeTab = 'library'}
      >
        <span class="tab-item-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
        </span>
        <span class="tab-item-label">Library</span>
      </button>
      <button 
        class="tab-bar-item {activeTab === 'settings' ? 'active' : ''}" 
        on:click={() => { activeTab = 'settings'; isSearchExpanded = false; }}
      >
        <span class="tab-item-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </span>
        <span class="tab-item-label">Settings</span>
      </button>
    </nav>

    <!-- Expanded Player Full Sheet (Liquid Glass) with swipe event hooks -->
    <div 
      class="expanded-player-sheet {isPlayerExpanded ? 'active' : ''} {isDragging ? 'no-transition' : ''}"
      style="transform: translateY({isPlayerExpanded ? (isDragging ? dragY + 'px' : '0') : '100%'})"
      on:touchstart={handleTouchStart}
      on:touchmove={handleTouchMove}
      on:touchend={handleTouchEnd}
    >
      <!-- Drag handle for swipe close visual cue -->
      <div class="swipe-dismiss-handle">
        <span class="handle-bar"></span>
      </div>

      <!-- Header / Close button -->
      <header class="expanded-player-header">
        <button class="close-sheet-btn" on:click={() => isPlayerExpanded = false}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        <span class="expanded-header-title">Now Playing</span>
        <button class="menu-sheet-btn" on:click={() => { isPlayerExpanded = false; activeTab = 'library'; }}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="6" x2="21" y2="6"></line>
            <line x1="8" y1="12" x2="21" y2="12"></line>
            <line x1="8" y1="18" x2="21" y2="18"></line>
            <line x1="3" y1="6" x2="3.01" y2="6"></line>
            <line x1="3" y1="12" x2="3.01" y2="12"></line>
            <line x1="3" y1="18" x2="3.01" y2="18"></line>
          </svg>
        </button>
      </header>

      <!-- Dynamic Center Segment (Album Art OR Synced Lyrics OR Queue List) -->
      <div class="expanded-center-viewport">
        {#if showLyrics}
          <!-- Apple Music Synced Lyrics viewport (Fading Masking scrollbox) -->
          <div class="lyrics-scroll-box" bind:this={lyricsScrollContainer}>
            {#if isLyricsLoading}
              <div class="lyrics-loader-centered">
                <div class="ios-loading-spinner"></div>
                <p>Loading Lyrics...</p>
              </div>
            {:else if lyricLines.length === 0}
              <p class="lyric-line-item active-lyric-line" style="text-align: center;">Lyrics not available for this track.</p>
            {:else}
              {#each lyricLines as line, index}
                <div 
                  class="lyric-line-item {activeLineIndex === index ? 'active-lyric-line' : ''}"
                  on:click={() => seekToLine(index)}
                >
                  {line}
                </div>
              {/each}
              {#if lyricsSource}
                <span class="lyrics-source-footer-text">{lyricsSource}</span>
              {/if}
            {/if}
          </div>
        {:else if showQueue}
          <!-- Apple Music Queue Overlay List -->
          <div class="queue-overlay-scroll-box">
            <h3 class="queue-heading-title">Playing Next</h3>
            {#if queue.length === 0}
              <p class="queue-empty-text">No upcoming tracks.</p>
            {:else}
              <div class="queue-tracks-stack">
                {#each queue as track, index}
                  <div 
                    class="queue-item-card-row {currentTrackIndex === index ? 'playing' : ''}"
                    on:click={() => { currentTrackIndex = index; playCurrentTrack(); }}
                  >
                    <span class="queue-index-no">{index + 1}</span>
                    <img class="queue-thumb-art" src={track.thumbnail || '/icon.png'} alt="" />
                    <div class="queue-meta-text">
                      <span class="queue-title-text">{track.title}</span>
                      <span class="queue-artist-text">{track.artist}</span>
                    </div>
                    {#if currentTrackIndex === index && isPlaying}
                      <span class="queue-speaker-glowing">🔊</span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <!-- Default View: Giant Album Art Card -->
          <div class="expanded-art-section">
            <div class="expanded-art-wrapper {isPlaying ? 'playing' : ''}">
              <img class="expanded-art-img" src={currentTrack ? currentTrack.thumbnail : '/icon.png'} alt="" />
            </div>
          </div>
        {/if}
      </div>

      <!-- Metadata & Like toggles -->
      <div class="expanded-meta-section">
        <div class="expanded-meta-details">
          <h2 class="expanded-meta-title">{currentTrack ? currentTrack.title : 'Not Playing'}</h2>
          <p class="expanded-meta-artist">{currentTrack ? currentTrack.artist : 'Select a track to start'}</p>
        </div>
        <button class="expanded-like-toggle" on:click={(e) => toggleLike(currentTrack, e)}>
          {#if isCurrentTrackLiked}
            <svg viewBox="0 0 24 24" width="26" height="26" fill="#ff2d55" stroke="#ff2d55" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="rgba(255, 255, 255, 0.5)" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
          {/if}
        </button>
      </div>

      <!-- Scrubber Timeline slider (iOS styled background) -->
      <div class="expanded-timeline-section">
        <input 
          type="range" 
          min="0" 
          max={duration || 100} 
          value={currentTime} 
          on:input={handleScrub}
          class="expanded-scrubber-slider"
          style="background: linear-gradient(to right, #ffffff 0%, #ffffff ${duration ? (currentTime / duration * 100) : 0}%, rgba(255, 255, 255, 0.15) ${duration ? (currentTime / duration * 100) : 0}%, rgba(255, 255, 255, 0.15) 100%)"
        />
        <div class="time-readout-row">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <!-- Primary Action Controls (Apple Music style round glass layout) -->
      <div class="expanded-controls-section">
        <button 
          class="exp-mode-btn {isShuffle ? 'active-mode' : ''}" 
          on:click={toggleShuffle} 
          title="Shuffle"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 3 21 3 21 8"></polyline>
            <line x1="4" y1="20" x2="21" y2="3"></line>
            <polyline points="21 16 21 21 16 21"></polyline>
            <line x1="15" y1="15" x2="21" y2="21"></line>
            <line x1="4" y1="4" x2="9" y2="9"></line>
          </svg>
        </button>
        
        <button class="exp-nav-btn" on:click={skipPrevious}>
          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
            <polygon points="19 20 9 12 19 4 19 20"></polygon>
            <rect x="5" y="4" width="2" height="16"></rect>
          </svg>
        </button>
        
        <button class="exp-main-play-btn" on:click={togglePlay}>
          {#if isLoading}
            <div class="ios-main-spinner"></div>
          {:else if isPlaying}
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16"></rect>
              <rect x="14" y="4" width="4" height="16"></rect>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" style="transform: translateX(2px);">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          {/if}
        </button>
        
        <button class="exp-nav-btn" on:click={skipNext}>
          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
            <polygon points="5 4 15 12 5 20 5 4"></polygon>
            <rect x="17" y="4" width="2" height="16"></rect>
          </svg>
        </button>
        
        <button 
          class="exp-mode-btn {repeatMode !== 'none' ? 'active-mode' : ''}" 
          on:click={cycleRepeat} 
          title="Repeat"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="17 1 21 5 17 9"></polyline>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
            <polyline points="7 23 3 19 7 15"></polyline>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
          </svg>
          {#if repeatMode === 'one'}<span class="badge-one">1</span>{/if}
        </button>
      </div>

      <!-- Volume sliders (iOS style white progress background) -->
      <div class="expanded-volume-section">
        <button class="volume-indicator-btn" on:click={toggleMute}>
          {#if isMuted || volume === 0}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <line x1="23" y1="9" x2="17" y2="15"></line>
              <line x1="17" y1="9" x2="23" y2="15"></line>
            </svg>
          {:else if volume < 0.4}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            </svg>
          {:else if volume < 0.7}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
          {/if}
        </button>
        <input 
          type="range" 
          min="0" 
          max="1" 
          step="0.01" 
          value={volume} 
          on:input={handleVolumeChange}
          class="expanded-volume-slider"
          style="background: linear-gradient(to right, #ffffff 0%, #ffffff ${volume * 100}%, rgba(255, 255, 255, 0.15) ${volume * 100}%, rgba(255, 255, 255, 0.15) 100%)"
        />
      </div>

      <!-- Apple Music style Footer Toolbar (Lyrics bubble & Queue list toggles) -->
      <footer class="expanded-player-footer-bar">
        <button class="footer-toggle-btn {showLyrics ? 'active-mode' : ''}" on:click={toggleLyricsSheet}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            <path d="M13 8H7"></path>
            <path d="M17 12H7"></path>
          </svg>
        </button>
        
        <div class="footer-center-mute">
          <button class="footer-mute-btn" on:click={toggleMute}>
            {isMuted ? '🔇 Muted' : '🔊 Playing'}
          </button>
        </div>

        <button class="footer-toggle-btn {showQueue ? 'active-mode' : ''}" on:click={toggleQueueSheet}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="6" x2="21" y2="6"></line>
            <line x1="8" y1="12" x2="21" y2="12"></line>
            <line x1="8" y1="18" x2="21" y2="18"></line>
            <line x1="3" y1="6" x2="3.01" y2="6"></line>
            <line x1="3" y1="12" x2="3.01" y2="12"></line>
            <line x1="3" y1="18" x2="3.01" y2="18"></line>
          </svg>
        </button>
      </footer>
      
    </div>

  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background-color: #030303;
    color: #ffffff;
    overflow: hidden;
    height: 100dvh;
    width: 100vw;
  }

  /* Dynamic blur background */
  .dynamic-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: -2;
    overflow: hidden;
    background-color: #000000;
  }

  .backdrop-image {
    width: 160%;
    height: 160%;
    object-fit: cover;
    position: absolute;
    top: -30%;
    left: -30%;
    filter: blur(120px) saturate(220%);
    opacity: 0.35;
    transition: all 1.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .default-backdrop-gradient {
    width: 100%;
    height: 100%;
    background: radial-gradient(circle at 10% 20%, #1e1b4b 0%, #030008 100%);
  }

  .backdrop-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: radial-gradient(circle at center, transparent 20%, #000000 95%);
  }

  /* App framework */
  .app-shell {
    width: 100vw;
    height: 100dvh;
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
    z-index: 1;
  }

  .app-container {
    width: 100%;
    height: 100%;
    max-width: 440px; /* Locked mobile width on desktop */
    background: rgba(10, 10, 15, 0.4);
    backdrop-filter: blur(40px) saturate(210%);
    -webkit-backdrop-filter: blur(40px) saturate(210%);
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.8);
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
    /* Respect hardware notch boundaries */
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    box-sizing: border-box;
  }

  @media (max-width: 768px) {
    .app-container {
      max-width: 100%;
      border-left: none;
      border-right: none;
      height: 100%;
    }
  }

  /* Headers */
  .top-header-glass {
    height: 68px;
    background: rgba(15, 15, 20, 0.25);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    padding: 0 16px;
    box-sizing: border-box;
    z-index: 10;
    overflow: hidden;
  }

  .header-content-wrapper {
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    height: 100%;
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .header-brand-side {
    display: flex;
    align-items: center;
    gap: 10px;
    transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s;
    transform: translateX(0);
    opacity: 1;
  }

  .header-brand-name {
    font-size: 1.4rem;
    font-weight: 800;
    letter-spacing: -0.5px;
    background: linear-gradient(135deg, #ffffff 0%, #a1a1aa 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  /* Pulse logo animations */
  .pulse-logo-icon {
    filter: drop-shadow(0 0 6px rgba(255, 45, 85, 0.6));
    transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }
  .pulse-logo-icon:hover {
    transform: scale(1.1);
  }
  .pulse-ring {
    transform-origin: center;
    animation: ring-pulse-logo 2.5s infinite ease-in-out;
  }
  @keyframes ring-pulse-logo {
    0%, 100% { transform: scale(1); opacity: 0.8; }
    50% { transform: scale(1.06); opacity: 1; stroke: #ff2d55; }
  }

  .header-search-trigger-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: #ffffff;
    opacity: 0.8;
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s;
    transform: translateX(0);
  }
  .header-search-trigger-btn:hover {
    color: #ff2d55;
    opacity: 1;
    transform: scale(1.05);
  }

  /* Expanded Search Bar styles (iOS styling) */
  .expanded-search-bar-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    background: transparent;
    transform: translateY(-100%);
    opacity: 0;
    pointer-events: none;
    transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s;
  }

  .expanded-search-form {
    display: flex;
    align-items: center;
    width: 100%;
    gap: 12px;
  }

  .search-pill-expanded {
    flex: 1;
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 12px;
    padding: 8px 12px;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .search-pill-expanded:focus-within {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.1);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1);
  }

  .search-pill-expanded input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: #ffffff;
    font-size: 0.95rem;
    font-family: inherit;
  }

  .search-cancel-btn {
    background: none;
    border: none;
    color: #ff2d55;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    padding: 6px 4px;
    transition: opacity 0.2s;
  }
  .search-cancel-btn:active {
    opacity: 0.6;
  }

  /* Transition modes */
  .search-mode-active .header-brand-side {
    transform: translateX(-40px);
    opacity: 0;
    pointer-events: none;
  }

  .search-mode-active .header-search-trigger-btn {
    transform: translateX(40px);
    opacity: 0;
    pointer-events: none;
  }

  .search-mode-active .expanded-search-bar-wrapper {
    transform: translateY(0);
    opacity: 1;
    pointer-events: auto;
  }

  /* Apple Transparent Search Pill Bar */
  .search-bar-apple {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 0 24px 0;
    background: transparent;
    animation: fadeInSearch 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes fadeInSearch {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .search-pill {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.08);
    border: none;
    border-radius: 12px;
    padding: 10px 14px;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .search-pill:focus-within {
    background: rgba(255, 255, 255, 0.12);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.15);
  }

  .search-pill-icon {
    color: rgba(255, 255, 255, 0.4);
    margin-right: 10px;
    transition: color 0.3s;
    display: flex;
    align-items: center;
  }

  .search-pill:focus-within .search-pill-icon {
    color: #ff2d55;
  }

  .search-pill input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: #ffffff;
    font-size: 1rem;
    font-family: inherit;
  }

  .search-clear-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.85rem;
    cursor: pointer;
    padding: 2px 6px;
  }

  /* Content view scroll area */
  .content-scrollable {
    flex: 1;
    overflow-y: auto;
    padding: 24px 24px 140px 24px;
    box-sizing: border-box;
  }

  .content-scrollable::-webkit-scrollbar {
    width: 4px;
  }

  .content-scrollable::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 10px;
  }

  .view-large-title {
    font-size: 2.1rem;
    font-weight: 800;
    margin: 0 0 28px 0;
    letter-spacing: -1px;
  }

  .home-shelf {
    margin-bottom: 32px;
  }

  .shelf-title {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0 0 16px 0;
    letter-spacing: -0.3px;
  }

  /* Horizontal shelf for recent history */
  .horizontal-scroll-shelf {
    display: flex;
    gap: 16px;
    overflow-x: auto;
    padding-bottom: 8px;
  }
  
  .horizontal-scroll-shelf::-webkit-scrollbar {
    display: none;
  }

  .shelf-item-card {
    width: 120px;
    flex-shrink: 0;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .shelf-thumb-wrapper {
    width: 120px;
    height: 120px;
    border-radius: 16px;
    overflow: hidden;
    position: relative;
    background-color: #1a1a1a;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  }

  .shelf-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .shelf-play-badge {
    position: absolute;
    bottom: 8px;
    right: 8px;
    background-color: rgba(255, 255, 255, 0.9);
    color: #000000;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 8px rgba(0,0,0,0.2);
  }

  .shelf-item-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .shelf-item-artist {
    font-size: 0.75rem;
    color: #888888;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty-shelf-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    padding: 32px 16px;
    text-align: center;
    color: #888888;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .empty-shelf-icon {
    font-size: 2rem;
  }

  /* Compact Track grids (Apple Music lists style) */
  .compact-tracks-grid {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .compact-track-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 14px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .compact-track-item:hover {
    background: rgba(255, 255, 255, 0.07);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .active-track-item {
    background: rgba(255, 45, 85, 0.15) !important;
    border-color: rgba(255, 45, 85, 0.3) !important;
  }

  .active-track-item .compact-title {
    color: #ff2d55;
  }

  .compact-thumb {
    width: 48px;
    height: 48px;
    border-radius: 10px;
    object-fit: cover;
  }

  .compact-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .compact-title {
    font-size: 0.9rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .compact-artist {
    font-size: 0.75rem;
    color: #888888;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }

  .item-actions-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .compact-like-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.4);
    transition: transform 0.2s;
  }

  .compact-like-btn:hover {
    transform: scale(1.15);
  }

  /* Three-dot menu dropdown */
  .row-menu-container {
    position: relative;
    display: flex;
    align-items: center;
  }

  .row-menu-trigger-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.45);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: all 0.2s;
  }

  .row-menu-trigger-btn:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.08);
  }

  .track-glass-dropdown {
    position: absolute;
    top: 28px;
    right: 0;
    background: rgba(25, 25, 30, 0.85);
    backdrop-filter: blur(25px) saturate(180%);
    -webkit-backdrop-filter: blur(25px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    width: 140px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 200;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    animation: fadeInDropdown 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes fadeInDropdown {
    from { opacity: 0; transform: translateY(-5px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .dropdown-item {
    background: none;
    border: none;
    color: #ffffff;
    font-size: 0.85rem;
    font-weight: 500;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: background 0.15s;
  }

  .dropdown-item:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  /* Explore Genre Card layout */
  .explore-genres-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }

  .explore-genre-card {
    height: 100px;
    border-radius: 16px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    cursor: pointer;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .explore-genre-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 30px rgba(0,0,0,0.3);
  }

  .genre-icon-large {
    font-size: 1.8rem;
    align-self: flex-end;
  }

  .genre-label-large {
    font-size: 1.05rem;
    font-weight: 700;
    color: #ffffff;
  }

  /* Library Views */
  .library-sections-stack {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  .search-item-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .search-track-duration {
    font-size: 0.75rem;
    color: #666666;
  }

  .search-loader-container {
    text-align: center;
    padding: 48px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    color: #888888;
  }

  .ios-loading-spinner {
    width: 32px;
    height: 32px;
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-top: 2px solid #ff2d55;
    border-radius: 50%;
    animation: ios-spin 0.8s linear infinite;
  }

  @keyframes ios-spin {
    to { transform: rotate(360deg); }
  }

  /* Floating Mini Player */
  .floating-mini-player {
    position: absolute;
    bottom: 74px; /* Perfectly aligned above the glass tab bar */
    left: 16px;
    right: 16px;
    height: 60px;
    background: rgba(25, 25, 30, 0.65);
    backdrop-filter: blur(30px) saturate(200%);
    -webkit-backdrop-filter: blur(30px) saturate(200%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    display: flex;
    align-items: center;
    padding: 0 16px 0 10px;
    box-sizing: border-box;
    z-index: 100;
    cursor: pointer;
    box-shadow: 0 10px 30px rgba(0,0,0,0.4);
    animation: miniSlideUp 0.3s ease-out;
  }

  @keyframes miniSlideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .mini-art {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    object-fit: cover;
    margin-right: 12px;
    box-shadow: 0 4px 10px rgba(0,0,0,0.3);
    transition: transform 0.3s;
  }

  .mini-art-playing {
    animation: miniScalePulse 2s infinite ease-in-out;
  }

  @keyframes miniScalePulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
  }

  .mini-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .mini-title {
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mini-artist {
    font-size: 0.72rem;
    color: #aaaaaa;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }

  .mini-controls {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .mini-control-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
  }

  .ios-mini-spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top: 2px solid #ffffff;
    border-radius: 50%;
    animation: ios-spin 0.8s linear infinite;
  }

  /* Apple Liquid Glass Bottom Navigation */
  .bottom-tab-bar-glass {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 60px;
    background: rgba(15, 15, 20, 0.45);
    backdrop-filter: blur(35px) saturate(200%);
    -webkit-backdrop-filter: blur(35px) saturate(200%);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    z-index: 90;
  }

  .tab-bar-item {
    background: none;
    border: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    color: #888888;
    cursor: pointer;
    transition: color 0.2s;
  }

  .tab-bar-item.active {
    color: #ff2d55;
  }

  .tab-item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tab-item-label {
    font-size: 0.65rem;
    font-weight: 600;
  }

  /* EXPANDED PLAYER SCREEN SHEET */
  .expanded-player-sheet {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(10, 10, 15, 0.55);
    backdrop-filter: blur(40px) saturate(210%);
    -webkit-backdrop-filter: blur(40px) saturate(210%);
    z-index: 120;
    display: flex;
    flex-direction: column;
    padding: calc(10px + env(safe-area-inset-top, 0px)) 24px calc(24px + env(safe-area-inset-bottom, 0px)) 24px;
    box-sizing: border-box;
    transform: translateY(100%);
    transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .expanded-player-sheet.active {
    transform: translateY(0);
  }

  .expanded-player-sheet.no-transition {
    transition: none !important;
  }

  /* Drag handle at the top */
  .swipe-dismiss-handle {
    width: 100%;
    height: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    flex-shrink: 0;
  }

  .swipe-dismiss-handle:active {
    cursor: grabbing;
  }

  .handle-bar {
    width: 36px;
    height: 4px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 100px;
  }

  .expanded-player-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 38px;
    color: #888888;
    flex-shrink: 0;
  }

  .close-sheet-btn {
    background: none;
    border: none;
    color: #ffffff;
    cursor: pointer;
    opacity: 0.7;
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .expanded-header-title {
    font-size: 0.85rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #ffffff;
    opacity: 0.5;
  }

  .menu-sheet-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: #ffffff;
    opacity: 0.8;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Custom switchable center viewport */
  .expanded-center-viewport {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    width: 100%;
    margin: 10px 0;
    min-height: 240px;
  }

  /* Center Art Zoom transitions */
  .expanded-art-section {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .expanded-art-wrapper {
    width: 230px;
    height: 230px;
    border-radius: 24px;
    overflow: hidden;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s ease;
    transform: scale(0.9);
    background-color: #1a1a1a;
  }

  .expanded-art-wrapper.playing {
    transform: scale(1.02);
    box-shadow: 0 30px 60px rgba(0, 0, 0, 0.7);
  }

  .expanded-art-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Metadata */
  .expanded-meta-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    flex-shrink: 0;
  }

  .expanded-meta-details {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .expanded-meta-title {
    font-size: 1.25rem;
    font-weight: 800;
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.5px;
  }

  .expanded-meta-artist {
    font-size: 0.95rem;
    color: #aaaaaa;
    margin: 4px 0 0 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .expanded-like-toggle {
    background: none;
    border: none;
    cursor: pointer;
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Timeline */
  .expanded-timeline-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 20px;
    flex-shrink: 0;
  }

  .expanded-scrubber-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 4px;
    border-radius: 2px;
    outline: none;
    cursor: pointer;
    transition: background 0.1s;
  }

  .expanded-scrubber-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #ffffff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .expanded-scrubber-slider:hover::-webkit-slider-thumb {
    transform: scale(1.6);
  }

  .time-readout-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: #888888;
    font-weight: 500;
  }

  /* Expanded Action Controls */
  .expanded-controls-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 8px;
    margin-bottom: 24px;
    flex-shrink: 0;
  }

  .exp-mode-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.45);
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    border-radius: 50%;
    transition: all 0.2s;
  }

  .exp-mode-btn:hover {
    color: #ffffff;
    background: rgba(255,255,255,0.06);
  }

  .exp-mode-btn.active-mode {
    color: #ff2d55;
  }

  .badge-one {
    position: absolute;
    top: 2px;
    right: 2px;
    background: #ff2d55;
    color: #ffffff;
    font-size: 0.55rem;
    font-weight: 900;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .exp-nav-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: #ffffff;
    opacity: 0.85;
    padding: 10px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }
  
  .exp-nav-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    opacity: 1;
  }
  
  .exp-nav-btn:active {
    transform: scale(0.9);
  }

  .exp-main-play-btn {
    background-color: rgba(255, 255, 255, 0.1);
    color: #ffffff;
    border: 1px solid rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    width: 60px;
    height: 60px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s, border-color 0.2s;
  }

  .exp-main-play-btn:hover {
    background-color: rgba(255, 255, 255, 0.18);
    border-color: rgba(255, 255, 255, 0.25);
    transform: scale(1.04);
  }

  .exp-main-play-btn:active {
    transform: scale(0.92);
  }

  .ios-main-spinner {
    width: 24px;
    height: 24px;
    border: 3px solid rgba(255, 255, 255, 0.2);
    border-top: 3px solid #ffffff;
    border-radius: 50%;
    animation: ios-spin 0.8s linear infinite;
  }

  /* Volume segment (iOS Slider styled) */
  .expanded-volume-section {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
    flex-shrink: 0;
  }

  .volume-indicator-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    transition: color 0.2s;
  }
  
  .volume-indicator-btn:hover {
    color: #ffffff;
  }

  .expanded-volume-slider {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    height: 4px;
    border-radius: 2px;
    outline: none;
    cursor: pointer;
    transition: background 0.1s;
  }

  .expanded-volume-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #ffffff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  }
  
  .expanded-volume-slider:hover::-webkit-slider-thumb {
    transform: scale(1.6);
  }

  /* Apple Music Synced Lyrics & Queue Sheets (Replaces Artwork area) */
  .lyrics-scroll-box, .queue-overlay-scroll-box {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    scroll-behavior: smooth;
    animation: fadeInOverlay 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes fadeInOverlay {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }

  /* Synced lyrics container style */
  .lyrics-scroll-box {
    gap: 20px;
    padding: 30px 10px 40px 10px;
    mask-image: linear-gradient(to bottom, transparent 0%, white 15%, white 85%, transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0%, white 15%, white 85%, transparent 100%);
  }

  .lyrics-scroll-box::-webkit-scrollbar, .queue-overlay-scroll-box::-webkit-scrollbar {
    display: none;
  }

  .lyric-line-item {
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1.6;
    text-align: left;
    color: rgba(255, 255, 255, 0.3);
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    cursor: pointer;
    padding: 4px 0;
  }

  .lyric-line-item.active-lyric-line {
    color: #ffffff;
    transform: scale(1.04);
    text-shadow: 0 0 20px rgba(255, 255, 255, 0.3);
  }

  .lyrics-source-footer-text {
    font-size: 0.72rem;
    color: #555555;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 24px;
    text-align: left;
  }

  .lyrics-loader-centered {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: #888888;
    margin-top: 40px;
  }

  /* Queue Overlay style */
  .queue-overlay-scroll-box {
    gap: 16px;
    padding: 10px 0;
  }

  .queue-heading-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: #888888;
    margin: 0;
  }

  .queue-tracks-stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .queue-item-card-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.2s;
  }

  .queue-item-card-row:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .queue-item-card-row.playing {
    background: rgba(255, 45, 85, 0.15) !important;
    border-color: rgba(255, 45, 85, 0.3) !important;
  }

  .queue-item-card-row.playing .queue-title-text {
    color: #ff2d55;
  }

  .queue-index-no {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.3);
    width: 16px;
    text-align: center;
  }

  .queue-thumb-art {
    width: 36px;
    height: 36px;
    border-radius: 6px;
    object-fit: cover;
  }

  .queue-meta-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .queue-title-text {
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .queue-artist-text {
    font-size: 0.72rem;
    color: #888888;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }

  .queue-speaker-glowing {
    font-size: 0.85rem;
  }

  /* Apple Music Synced Player Footer Bar */
  .expanded-player-footer-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 48px;
    margin-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 12px;
    flex-shrink: 0;
  }

  .footer-toggle-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.45);
    cursor: pointer;
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: all 0.2s;
  }

  .footer-toggle-btn:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.08);
  }

  .footer-toggle-btn.active-mode {
    color: #ff2d55;
    background: rgba(255, 45, 85, 0.1);
  }

  .footer-center-mute {
    display: flex;
    align-items: center;
  }

  .footer-mute-btn {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.6);
    font-size: 0.75rem;
    font-weight: 700;
    padding: 6px 12px;
    border-radius: 100px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .footer-mute-btn:hover {
    background: rgba(255,255,255,0.12);
    color: #ffffff;
  }

  /* Settings Page Styles */
  .settings-stack-glass {
    display: flex;
    flex-direction: column;
    gap: 24px;
    animation: fadeInSettings 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes fadeInSettings {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .settings-group {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 16px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .settings-group-title {
    font-size: 0.85rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: rgba(255, 255, 255, 0.4);
    margin: 0 0 4px 0;
  }

  .settings-row, .settings-action-row-btn {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: none;
    border: none;
    padding: 6px 0;
    width: 100%;
    box-sizing: border-box;
    text-align: left;
  }

  .settings-action-row-btn {
    cursor: pointer;
    border-radius: 8px;
    transition: background 0.2s;
  }
  .settings-action-row-btn:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .settings-row-label {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }

  .settings-row-icon {
    font-size: 1.25rem;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .settings-text-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .settings-title {
    font-size: 0.92rem;
    font-weight: 600;
    color: #ffffff;
  }

  .settings-subtitle {
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.4);
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .settings-select {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #ffffff;
    font-size: 0.85rem;
    font-weight: 500;
    padding: 6px 10px;
    outline: none;
    cursor: pointer;
    transition: background 0.2s;
  }
  .settings-select:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .settings-value-text {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.6);
    font-weight: 500;
  }

  /* iOS Switch styling */
  .settings-switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
    flex-shrink: 0;
  }

  .settings-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .switch-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(255, 255, 255, 0.15);
    transition: .3s;
    border-radius: 34px;
  }

  .switch-slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: .3s;
    border-radius: 50%;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  }

  input:checked + .switch-slider {
    background-color: #34c759; /* Apple Switch green */
  }

  input:checked + .switch-slider:before {
    transform: translateX(20px);
  }

  /* Library Refactored Cards & Custom Playlists */
  .library-cards-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-bottom: 24px;
    animation: fadeInLibTab 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes fadeInLibTab {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .library-card {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    padding: 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .library-card:hover {
    background: rgba(255, 255, 255, 0.08);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  }

  .library-card:active {
    transform: scale(0.97);
  }

  .library-card-icon-wrapper {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: rgba(255, 45, 85, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .library-card-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .library-card-name {
    font-size: 0.95rem;
    font-weight: 700;
    color: #ffffff;
  }

  .library-card-count {
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.45);
    margin-top: 2px;
  }

  .playlists-shelf-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 16px;
    margin-bottom: 12px;
  }

  .playlist-create-btn {
    background: rgba(255, 45, 85, 0.1);
    border: 1px solid rgba(255, 45, 85, 0.2);
    color: #ff2d55;
    font-size: 0.8rem;
    font-weight: 700;
    padding: 6px 12px;
    border-radius: 100px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: all 0.2s;
  }

  .playlist-create-btn:hover {
    background: rgba(255, 45, 85, 0.2);
    transform: scale(1.05);
  }

  .playlists-cards-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-bottom: 24px;
  }

  .no-playlists-placeholder {
    grid-column: span 2;
    padding: 24px !important;
    cursor: pointer;
    transition: background 0.2s;
  }
  .no-playlists-placeholder:hover {
    background: rgba(255,255,255,0.06);
  }
  .placeholder-action-hint {
    font-size: 0.7rem;
    color: #ff2d55;
    font-weight: 600;
    margin-top: 6px;
  }

  .playlist-card {
    position: relative;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 16px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    cursor: pointer;
    min-width: 0;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .playlist-card:hover {
    background: rgba(255, 255, 255, 0.07);
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
  }

  .playlist-card-badge {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: flex-start;
  }

  .playlist-card-details {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .playlist-card-title {
    font-size: 0.9rem;
    font-weight: 700;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .playlist-card-count {
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.4);
    margin-top: 1px;
  }

  .playlist-delete-card-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.7rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
  }

  .playlist-delete-card-btn:hover {
    background: rgba(255, 45, 85, 0.2);
    color: #ff2d55;
    transform: scale(1.1);
  }

  /* Library Organized Subview Details */
  .library-subview-wrapper {
    animation: slideInSubView 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes slideInSubView {
    from { opacity: 0; transform: translateX(20px); }
    to { opacity: 1; transform: translateX(0); }
  }

  .subview-back-button {
    background: none;
    border: none;
    color: #ff2d55;
    font-size: 0.95rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    margin-bottom: 16px;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .subview-back-button:active {
    opacity: 0.6;
  }

  .subview-header-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 20px;
    gap: 16px;
  }

  .subview-header-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .subview-header-text .view-large-title {
    margin: 0;
    line-height: 1.1;
  }

  .subview-meta-text {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.45);
    margin-top: 4px;
    font-weight: 500;
  }

  .play-all-premium-btn {
    background: linear-gradient(135deg, #ff2d55 0%, #ec4899 100%);
    border: none;
    color: #ffffff;
    font-size: 0.85rem;
    font-weight: 700;
    padding: 8px 16px;
    border-radius: 100px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    box-shadow: 0 4px 15px rgba(255, 45, 85, 0.35);
    transition: transform 0.25s, box-shadow 0.2s;
    flex-shrink: 0;
  }

  .play-all-premium-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(255, 45, 85, 0.5);
  }

  .play-all-premium-btn:active {
    transform: scale(0.97);
  }

  .remove-playlist-track-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.8rem;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
  }
  .remove-playlist-track-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ff2d55;
  }

  /* Add to Playlist Glass Popup Overlay */
  .playlist-selector-overlay-glass {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    box-sizing: border-box;
  }

  .playlist-selector-modal {
    background: rgba(25, 25, 35, 0.75);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 24px;
    width: 100%;
    max-width: 380px;
    max-height: 80dvh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    animation: popModalUp 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes popModalUp {
    from { opacity: 0; transform: translateY(40px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .playlist-selector-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .playlist-selector-header h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: -0.3px;
  }

  .playlist-selector-close-btn {
    background: rgba(255, 255, 255, 0.08);
    border: none;
    color: #ffffff;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    cursor: pointer;
    font-size: 0.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  }
  .playlist-selector-close-btn:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .playlist-selector-scroll {
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .playlist-selector-create-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px dashed rgba(255, 255, 255, 0.15);
    color: #ffffff;
    font-size: 0.9rem;
    font-weight: 600;
    padding: 12px;
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
    text-align: center;
  }
  .playlist-selector-create-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: #ff2d55;
  }

  .playlist-selector-empty-text {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.4);
    text-align: center;
    margin: 20px 0;
  }

  .playlist-selector-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .playlist-selector-item {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 10px;
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
    text-align: left;
    width: 100%;
    box-sizing: border-box;
  }

  .playlist-selector-item:hover {
    background: rgba(255, 45, 85, 0.05);
    border-color: rgba(255, 45, 85, 0.2);
  }

  .playlist-selector-item-badge {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.95rem;
  }

  .playlist-selector-item-info {
    display: flex;
    flex-direction: column;
  }

  .playlist-selector-item-name {
    font-size: 0.88rem;
    font-weight: 700;
    color: #ffffff;
  }

  .playlist-selector-item-count {
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.4);
    margin-top: 1px;
  }

  /* ==========================================================================
     MOBILE RESPONSIVENESS AND MULTI-DEVICE ORIENTATION ADAPTATION
     Supports iPhone 5s/SE up to 17 Pro Max, and all Android Viewports
     ========================================================================== */

  /* 1. Small Devices & Shorter Viewports (Vertical orientation) */
  @media (max-height: 680px) and (orientation: portrait), (max-width: 360px) {
    .content-scrollable {
      padding: 16px 16px 110px 16px;
    }

    .view-large-title {
      font-size: 1.6rem;
      margin-bottom: 16px;
    }

    .shelf-title {
      font-size: 1.1rem;
      margin-bottom: 12px;
    }

    .home-shelf {
      margin-bottom: 20px;
    }

    /* Shrink bottom bar slightly */
    .bottom-tab-bar-glass {
      height: 52px;
    }
    
    .tab-item-label {
      font-size: 0.6rem;
    }

    /* Scaled down player for short vertical viewports */
    .expanded-player-sheet {
      padding: calc(6px + env(safe-area-inset-top, 0px)) 16px calc(16px + env(safe-area-inset-bottom, 0px)) 16px;
    }

    .expanded-center-viewport {
      min-height: unset;
      height: 180px;
      margin: 8px 0;
    }

    .expanded-art-wrapper {
      width: 170px;
      height: 170px;
      border-radius: 16px;
    }

    .expanded-meta-section {
      margin-bottom: 10px;
    }

    .expanded-meta-title {
      font-size: 1.1rem;
    }

    .expanded-meta-artist {
      font-size: 0.85rem;
    }

    .expanded-timeline-section {
      margin-bottom: 12px;
      gap: 4px;
    }

    .expanded-controls-section {
      margin-bottom: 12px;
    }

    .exp-main-play-btn {
      width: 52px;
      height: 52px;
    }

    .expanded-volume-section {
      margin-bottom: 12px;
      gap: 12px;
    }

    /* Compact Library view */
    .library-cards-grid, .playlists-cards-grid {
      gap: 8px;
    }

    .library-card, .playlist-card {
      padding: 10px 12px;
      gap: 8px;
      border-radius: 12px;
    }

    .library-card-icon-wrapper {
      width: 36px;
      height: 36px;
      border-radius: 8px;
    }

    .library-card-name {
      font-size: 0.85rem;
    }
  }

  /* 2. Landscape / Horizontal Viewport (All devices when rotated) */
  @media (max-height: 520px) {
    /* Main layout landscape rules */
    .content-scrollable {
      padding: 12px 16px 85px 16px !important;
    }

    .view-large-title {
      font-size: 1.4rem !important;
      margin-bottom: 10px !important;
    }

    .shelf-title {
      font-size: 1rem !important;
      margin-bottom: 8px !important;
    }

    .home-shelf {
      margin-bottom: 16px !important;
    }

    .bottom-tab-bar-glass {
      height: 48px !important;
    }

    .tab-item-label {
      font-size: 0.58rem !important;
    }

    .tab-bar-item svg {
      width: 18px;
      height: 18px;
    }

    .library-cards-grid, .playlists-cards-grid {
      grid-template-columns: repeat(2, 1fr);
      gap: 8px !important;
      margin-bottom: 16px !important;
    }

    .library-card, .playlist-card {
      padding: 8px 12px !important;
      gap: 8px !important;
      border-radius: 12px !important;
    }

    .library-card-icon-wrapper {
      width: 32px !important;
      height: 32px !important;
      border-radius: 8px !important;
    }

    .library-card-name, .playlist-card-title {
      font-size: 0.8rem !important;
    }

    .library-card-count, .playlist-card-count {
      font-size: 0.65rem !important;
    }

    /* Mini player landscape tuning */
    .floating-mini-player {
      bottom: 54px !important;
      height: 44px !important;
      padding: 0 12px !important;
    }

    .mini-art {
      width: 32px !important;
      height: 32px !important;
    }

    /* Transform Expanded Player Sheet into a 2-Column Dashboard Console */
    .expanded-player-sheet {
      display: grid !important;
      grid-template-columns: 1.1fr 1fr !important;
      grid-template-rows: auto auto repeat(5, auto) !important;
      column-gap: 20px !important;
      row-gap: 2px !important;
      padding: 4px 16px calc(4px + env(safe-area-inset-bottom, 0px)) 16px !important;
      overflow: hidden !important;
    }

    .swipe-dismiss-handle {
      grid-column: 1 / span 2 !important;
      grid-row: 1 !important;
      height: 6px !important;
      margin-bottom: 2px;
    }

    .expanded-player-header {
      grid-column: 1 / span 2 !important;
      grid-row: 2 !important;
      height: 24px !important;
    }

    /* Left Side: Art, Lyrics or Queue */
    .expanded-center-viewport {
      grid-column: 1 !important;
      grid-row: 3 / span 5 !important;
      min-height: unset !important;
      margin: 0 !important;
      height: 100% !important;
      align-items: center !important;
      justify-content: center !important;
    }

    .expanded-art-wrapper {
      width: 135px !important;
      height: 135px !important;
      border-radius: 12px !important;
    }

    /* Scale down lyrics scroll for landscape */
    .lyrics-scroll-box {
      font-size: 0.85rem !important;
      line-height: 1.35 !important;
      gap: 10px !important;
      padding: 10px 5px !important;
      height: 100% !important;
    }

    .queue-tracks-stack {
      max-height: 130px !important;
    }

    /* Right Side controls stack */
    .expanded-meta-section {
      grid-column: 2 !important;
      grid-row: 3 !important;
      margin-bottom: 2px !important;
      padding: 0 !important;
    }

    .expanded-meta-title {
      font-size: 0.95rem !important;
    }

    .expanded-meta-artist {
      font-size: 0.75rem !important;
      margin-top: 1px !important;
    }

    .expanded-timeline-section {
      grid-column: 2 !important;
      grid-row: 4 !important;
      margin-bottom: 2px !important;
      gap: 2px !important;
    }

    .time-readout-row {
      font-size: 0.65rem !important;
    }

    .expanded-controls-section {
      grid-column: 2 !important;
      grid-row: 5 !important;
      margin-bottom: 2px !important;
      padding: 0 !important;
    }

    .exp-main-play-btn {
      width: 44px !important;
      height: 44px !important;
    }

    .exp-nav-btn svg {
      width: 20px !important;
      height: 20px !important;
    }

    .exp-mode-btn svg {
      width: 16px !important;
      height: 16px !important;
    }

    .expanded-volume-section {
      grid-column: 2 !important;
      grid-row: 6 !important;
      margin-bottom: 2px !important;
      gap: 8px !important;
    }

    .volume-indicator-btn svg {
      width: 14px !important;
      height: 14px !important;
    }

    .expanded-player-footer-bar {
      grid-column: 2 !important;
      grid-row: 7 !important;
      margin-top: 4px !important;
      padding: 4px 0 0 0 !important;
      height: 32px !important;
      border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
    }

    .footer-toggle-btn svg {
      width: 16px !important;
      height: 16px !important;
    }

    .footer-mute-btn {
      font-size: 0.68rem !important;
      padding: 2px 6px !important;
    }
  }
</style>
