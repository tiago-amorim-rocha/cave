# Legacy Code Archive

This folder contains the original browser-based cave game code.

**Purpose**: Reference code for future feature migration to headless mode.

**Status**: Not part of the active build pipeline. Code here is for reference only.

## What's Here

- **main-browser.ts** - Original main.ts with full browser app (caves, balls, rendering, UI)
- Support modules will be moved here as needed

## Active Development

Active spider controller development happens in:
- `src/headless/` - Headless test environment
- `src/controllers/spider/` - Spider controller implementation (shared)
- `src/physics/` - Physics engine (shared)

## Migration Strategy

When a feature is needed in headless mode:
1. Extract the core logic from legacy code
2. Port it to headless-compatible format
3. Test in headless environment
4. Optionally backport improvements to browser version
