# Nongkrong 3D

A cozy low-poly island hangout built with Three.js, TypeScript and Vite. Explore the island, sit down, chat, fish, and watch the day turn into night.

**Play it:** https://denizak.github.io/nongkrong-3d/

## Controls

| Key | Action |
|---|---|
| WASD / arrows | Move |
| Shift | Run |
| E | Interact |
| C | Sit |
| Z | Lie down |
| F | Fishpedia |
| M | Mute / unmute sound |
| T | Skip time forward one hour |
| R | Toggle rain |
| K | Reroll your character's look |
| Enter | Chat bubble |

Drag to orbit the camera and scroll to zoom.

## Running locally

Requires Node 22 or newer.

```sh
npm install
npm run dev
```

Then open http://localhost:5173.

To build for production:

```sh
npm run build
```

For a GitHub Pages build with the `/nongkrong-3d/` base path, use `GITHUB_PAGES=true npm run build`.

## Credits

Models, sounds and other third-party assets are listed in [CREDITS.md](CREDITS.md).

Code: MIT. Third-party assets in public/: CC0, see CREDITS.md.
