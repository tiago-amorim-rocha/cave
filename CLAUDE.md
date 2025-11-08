# Carvable Caves PWA

## Overview
A Progressive Web App for carving smooth 2D caves using Marching Squares algorithm. Built with TypeScript + Vite, optimized for iOS devices. Works offline and can be installed via "Add to Home Screen".

<!-- Test deployment workflow -->

## Tech Stack
- **Build**: Vite 5 + TypeScript
- **PWA**: vite-plugin-pwa with Workbox
- **Rendering**: Canvas2D with device-pixel-ratio awareness
- **Deployment**: GitHub Pages with GitHub Actions

## Architecture

### World Units
- All spatial coordinates in **metres** (world units)
- Grid pitch `h = 0.1m`
- World size: 200m × 120m (2000 × 1200 grid)
- Camera zoom in **pixels-per-metre (PPM)**

### Core Modules

#### `src/types.ts`
Shared TypeScript types and interfaces.

#### `src/Camera.ts`
- World-space camera with pan/zoom
- Screen ↔ world coordinate conversion
- Zoom invariant brush sizing

#### `src/DensityField.ts`
- Uint8Array density grid (0-255)
- ISO value = 128
- Dirty region tracking (AABB)
- Brush application (carve/add)

#### `src/MarchingSquares.ts`
- Contour generation from density field
- Linear edge interpolation
- Asymptotic decider for ambiguous cases 5/10
- Polyline stitching for closed contours

#### `src/InputHandler.ts`
- Touch: single-finger carve, two-finger pinch zoom
- Mouse: left-click carve, right-click pan, wheel zoom
- Modifier keys (Shift/Alt/Ctrl) for add mode
- Carving throttled to ~30 Hz

#### `src/Renderer.ts`
- Device-pixel-ratio aware Canvas2D
- Polyline rendering (fill + stroke)
- Dirty region updates

#### `src/main.ts`
- Application entry point
- Render loop with FPS tracking
- UI controls integration
- Service worker registration

## GitHub Workflows

### 1. Autopromote (`autopromote.yml`)
- Automatically merges `claude/**` branches to `main`
- Triggers on push to `claude/**` branches

### 2. Branch Cleanup (`cleanup-old-branches.yml`)
- Runs daily at 3am UTC
- Deletes `claude/**` branches older than 24 hours

### 3. Deploy to Pages (`deploy-pages.yml`)
- Triggers on push to `main`
- Builds the app with `npm run build`
- Deploys `dist/` to GitHub Pages

## Cache Busting Strategy

**Vite handles this automatically:**
- Content-hashed filenames (e.g., `index-iwrH0seV.js`)
- Hash changes when content changes
- No manual cache busting needed

**Service Worker:**
- Workbox precaches all assets
- `registerType: 'autoUpdate'` for automatic updates
- PWA updates when new service worker detected

## Deployment

### Automatic (Recommended)
1. Push to `claude/**` branch
2. Autopromote merges to `main`
3. Deploy workflow builds and publishes to Pages
4. Live at: `https://tiago-amorim-rocha.github.io/cave/`

### Manual Fallback
```bash
npm run deploy
```

Uses `gh-pages` to deploy `dist/` directly.

## Development

### Install dependencies
```bash
npm install
```

### Dev server
```bash
npm run dev
```

### Build for production
```bash
npm run build
```

### Preview production build
```bash
npm run preview
```

## PWA Installation (iOS)
1. Open app in Safari
2. Tap Share → Add to Home Screen
3. Launch from home screen for fullscreen experience

## Configuration

### Vite (`vite.config.ts`)
- Base path: `/cave/` (for GitHub Pages)
- PWA manifest with start_url and scope
- Service worker generation with Workbox

### TypeScript (`tsconfig.json`)
- Target: ES2020
- Strict mode enabled
- Module resolution: bundler

## File Structure
```
.
├── .github/workflows/
│   ├── autopromote.yml           # Auto-merge claude branches
│   ├── cleanup-old-branches.yml  # Cleanup old branches
│   └── deploy-pages.yml          # Deploy to GitHub Pages
├── src/
│   ├── types.ts                  # TypeScript types
│   ├── Camera.ts                 # Camera with pan/zoom
│   ├── DensityField.ts           # Density grid + carving
│   ├── MarchingSquares.ts        # Contour generation
│   ├── InputHandler.ts           # Touch/mouse input
│   ├── Renderer.ts               # Canvas2D rendering
│   └── main.ts                   # App entry point
├── index.html                    # HTML entry point
├── icon-512.svg                  # PWA icon
├── vite.config.ts                # Vite + PWA config
├── tsconfig.json                 # TypeScript config
├── package.json                  # Dependencies + scripts
├── .gitignore                    # Git ignore patterns
└── CLAUDE.md                     # This file

# Build outputs (gitignored)
dist/                             # Vite build output
node_modules/                     # Dependencies
```

## Implementation Details

### Marching Squares
- **Cases**: 16 possible configurations (2^4 corners)
- **Ambiguous cases** (5, 10): resolved with asymptotic decider
- **Edge interpolation**: Linear between corner densities
- **Stitching**: Edges connected into closed polylines

### Performance
- **Dirty region tracking**: Only remesh changed areas
- **Throttled carving**: ~30 Hz during drag, final remesh on pointerup
- **Minimal rendering**: Only draw updated contours
- **Target**: 60 fps on modern iPhone

### iOS Optimizations
- Safe area handling with `env(safe-area-inset-*)`
- Fixed viewport prevents keyboard resize
- Touch action manipulation (no double-tap zoom)
- Disabled text selection and callouts
- Standalone display mode for fullscreen

## Future Enhancements (Optional)
- [ ] Brush preview circle
- [ ] Undo/redo system
- [ ] Color/texture variations
- [ ] Chunking for larger worlds
- [ ] Web Worker for background meshing
- [ ] Physics simulation
- [ ] Multiple brush shapes
- [ ] Save/load caves
