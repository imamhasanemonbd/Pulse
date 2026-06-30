# Pulse — Music Without Ads

Pulse is a premium, ad-free web application for streaming music. Designed with an elegant, responsive "liquid glass" aesthetic inspired by Apple Music, Pulse delivers a seamless streaming experience using Svelte on the frontend and Fastify on the backend.

---

## 🌟 Key Features

* 🚀 **100% Ad-Free**: Enjoy your favorite tracks streamed directly from YouTube audio endpoints without any commercial interruptions.
* 🎨 **Liquid Glass Aesthetics**: An immersive interface featuring dynamic backdrop blurs that adapt in real time to the active track's thumbnail colors.
* 🔍 **Smooth Expanding Search**: A top header search bar that slides smoothly to span the full navbar width, with an iOS-style `Cancel` option.
* 📁 **Organized Library Sub-Views**: 
  * Clean, glassmorphic cards for **Liked Songs** and **Recent History** with live track counters.
  * Individual sub-views for each collection with a back button, title details, and a glowing pink gradient **Play All** button.
* 🎶 **Custom Playlists**:
  * Create, view, and delete playlists dynamically.
  * Contextual **"Add to Playlist"** option in three-dot menus that triggers a premium blur dialog overlay to choose or create playlists on the fly.
* 📱 **Perfect Screen Fitting & Notch Adaptation**:
  * Utilizes dynamic viewport heights (`dvh`) to guarantee content is always contained within screen limits.
  * Notch and Safe-Area boundary protections (`env(safe-area-inset-top/bottom)`) protect layout headers on newer mobile devices.
* 🚗 **Landscape CarPlay-Style Console**: Rotating your mobile device horizontally automatically transforms the player sheet into a premium two-column dashboard grid console.
* 🎤 **Interactive Synced Lyrics**: Apple Music style synchronized lyric seeker box. Tap on any lyric line to jump directly to that part of the song.
* ⚙️ **Dedicated Settings Panel**: Manage audio streaming resolution, background lockscreen tasking, and clean cached history/liked local data with a single click.
* 📦 **PWA Ready**: Installable as a standalone app on iOS (Safari) and Android (Chrome) with custom home screen icons, favicons, and background service workers.

---

## 🛠️ Technology Stack

* **Frontend**: Svelte (v4), Vite, Vanilla CSS.
* **Backend**: Node.js, Fastify, dynamic stream resolver.
* **Storage**: LocalStorage for persistent client data (history, liked songs, playlists).

---

## 📂 Project Structure

```text
├── backend/            # Fastify backend server
│   ├── src/
│   │   ├── server.js   # Fastify application entry & stream routing
│   │   └── services/
│   │       └── youtube.js # YouTube scraper & stream source extractor
│   └── package.json
│
├── frontend/           # Vite + Svelte frontend client
│   ├── public/
│   │   ├── icon.jpg    # Custom iOS Home/PWA App Icon
│   │   ├── manifest.json # PWA configuration manifesto
│   │   └── sw.js       # Background Service Worker
│   ├── src/
│   │   ├── App.svelte  # Svelte views and UI stylesheet
│   │   ├── main.js     # Client bootstrapping
│   │   └── player.js   # HTML5 audio playback engine wrapper
│   ├── index.html      # Root document, favicon links & safe-area configurations
│   └── package.json
│
├── LICENSE             # Pulse Non-Commercial License details
├── package.json        # Root npm workspaces configuration
└── README.md           # Documentation guide
```

---

## 🚀 Getting Started

### Prerequisites
* [Node.js](https://nodejs.org/) (v18 or higher recommended)
* npm (comes bundled with Node.js)

### Installation
1. Clone this repository:
   ```bash
   git clone https://github.com/imamhasanemonbd/Pulse.git
   cd Pulse
   ```

2. Install all monorepo workspace dependencies:
   ```bash
   npm install
   ```

### Running the Application (Development)
You can run both the frontend and backend development servers concurrently from the root directory using the workspace scripts:

```bash
# Run both frontend and backend dev servers
npm run dev
```

* **Frontend (Vite)** will run on: `http://localhost:5173`
* **Backend (Fastify)** will run on: `http://localhost:3000`

### Building for Production
To package the frontend Svelte client for production distribution:

```bash
npm run build -w frontend
```

The compiled assets will be bundled inside `frontend/dist/`.

---

## 📄 License

This project is licensed under the **Pulse Non-Commercial License**. You are free to run, copy, modify, and share this software under the conditions that:
1. You include the copyright notice in all copies or derivatives (giving attribution to the original creators).
2. **The software CANNOT be sold, licensed, or used for any commercial purposes.**

See [LICENSE](file:///LICENSE) for the full license text.
