# Nongkrong 3D — Project Summary

**Play:** https://denizak.github.io/nongkrong-3d/ · **Repo:** https://github.com/denizak/nongkrong-3d
**Hosting:** GitHub Pages, plus a self-hosted deployment at https://denizakya.xyz/nongkrong/ (see deployment instructions below).

A cozy, low-poly 3D island game that runs in the browser. You play a small robot and explore a tropical archipelago of 50 islands joined by wooden bridges. You can shake mango trees, fish, harvest rice, poke scarecrows and relax by the campfire. Through peer-to-peer multiplayer you also see and chat with other players. The interface is in Bahasa Indonesia by default, and English is available.

---

## What you can do

| Area | Features |
|---|---|
| **Character** | 5 robot types (Klasik, Tunas, Antena, Kapten, Penjelajah) with random body and trim colours. Saved per browser. Shuffle on the start screen or press **K** |
| **Movement** | Walk and run (WASD/arrows + Shift), orbit camera (drag), zoom (scroll), touch joystick on phones |
| **Relaxing** | Sit on the grass (**C**) or lie on your belly with your chin in your hands (**Z**) |
| **Fruit trees** | Shake trees (**E**) to drop mangoes, which you collect automatically. Trees regrow over time |
| **Fishing** | Cast at the pond or sea, wait through nibbles, then press E on the bite. 12 species (6 pond, 6 sea). **F** opens the Fishpedia |
| **Paddy field** | Flooded paddy with rice that bends as you walk through. Harvest the ripe rice. Talking scarecrow and birds that land and flee |
| **World** | 50 islands with real Indonesian island names, scattered organically, plus 70 non-crossing bridges. The big main island, **Pulau Nongkrong**, has a village plaza, stilt huts, a campfire, a beach and a fishing pier |
| **Time and weather** | 20-minute day/night cycle with dawn, golden hour, dusk and a moonlit night. Stars, fireflies, obor (tiki torches), random rain. **T** advances one hour, **R** toggles rain |
| **Map** | Minimap in the corner. The full map (**P**) shows islands, names, visited state, bridges and online players |
| **Multiplayer** | P2P (WebRTC). See other players' robots, names, poses and chat bubbles (**Enter** to chat, `/nama` to rename) |
| **Audio** | Original generated ukulele-style music, waves, breeze, birds, crickets, rain and thunder. Footsteps on grass, sand and wood. Steel-drum catch jingles. **M** mutes |
| **Saving** | Position, island, robot, name, inventory, Fishpedia, per-island tree and rice state, time of day. Saved automatically in localStorage |

---

## Tech stack

- **Three.js r187** with `WebGPURenderer`, which falls back to WebGL2 automatically. Shaders use TSL node materials.
- **TypeScript + Vite 8.** The entry bundle is about 130 KB. three.js and Rapier are split into their own chunks and load in parallel.
- **Rapier** (`@dimforge/rapier3d-compat`): kinematic character controller, terrain trimesh, prop and bridge colliders. Loaded dynamically.
- **Trystero** (Nostr signalling, WebRTC data channels): P2P multiplayer, loaded after the game starts. Discovery uses the self-hosted Nostr relay and public fallback relays.
- **Web Audio API**: all music and ambience are synthesized in code, alongside a few CC0 samples.
- **simplex-noise**: terrain generation.

## Architecture highlights

- **Floating origin.** The game always runs in the current island's local coordinates. Crossing a bridge past an island's region re-centres everything seamlessly (player, camera, state).
- **Island registry.** A deterministic, seeded Poisson-disc layout (`LAYOUT_SEED = 20261108`) means every player shares the same world. Islands are found with a Voronoi lookup, and the main island has a larger region.
- **Planar bridge network.** A Gabriel graph, reduced to the minimum spanning tree plus short extra edges, with crossing checks. Bridges can run at any angle and have oriented colliders.
- **Proxies.** Only the current island is live. Neighbours within about 320 m are baked static copies with shared geometry, no lights and no shadows. Fog hides everything farther away.
- **Two island kinds.** "Normal" and "main" islands each have their own terrain generator, zones, props and interactables. Per-island state is keyed by island id.
- **Network messages.** Messages are compact and validated: `st` (state at about 10 Hz), `hi` (name and look), `ch` (chat, rate-limited, rendered as text only).
- **i18n.** One dictionary file (`src/i18n.ts`) holds 100+ keys. The language comes from `?lang=`, then localStorage, then the default (Indonesian).

Code size: 59 TypeScript files and about 12.5k lines, in `src/{world, player, interact, net, ui, audio, core}`.

## Assets and licences

- **Code:** MIT (see `LICENSE`).
- **Character:** RobotExpressive by Tomás Laulhé (Quaternius), CC0.
- **Nature models:** Kenney Nature Kit (37 models), CC0.
- **Sounds:** Kenney Impact Sounds and Music Jingles (32 files), CC0.
- Full list in `CREDITS.md`.

## Deployment

- A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds with `GITHUB_PAGES=true` (base `/nongkrong-3d/`) and publishes to Pages on every push to `main`.
- Push to `main` to trigger the Pages workflow; check the Actions run for deployment status.
- Run `./scripts/deploy.sh` as the normal user to test, build with base `/nongkrong/`, and copy the self-hosted site to `/var/www/nongkrong/`. It is not updated by the Pages workflow.
- The Nostr relay runs in Docker on `127.0.0.1:18080`, with nginx proxying `wss://denizakya.xyz/nostr`. Configuration, nginx locations, SELinux notes and deployment commands are documented in `README.md` and `relay/`.

## Milestone history

| Commit | Milestone |
|---|---|
| `6e8b087` | M0–M6: island, robot, physics, Kenney props, interactions, fishing, paddy and scarecrow, chat bubble, poses |
| `ddf145e` | M7: audio, loading screen, save/restore, bundle split |
| `7a940a9` | M8: day/night, weather, torches, touch controls, robot looks, 50-island archipelago, GitHub Pages deploy |
| `b3fb793` | M9: P2P multiplayer, Bahasa Indonesia, bigger main island (architecture) |
| `dd2ffd1` | Island names, minimap and full map, Pulau Nongkrong plaza, beach and pier |
| `57853d3` | Organic island layout with non-crossing bridges |

## Known limitations and ideas for next steps

- **Multiplayer:** a pure P2P mesh is practical for roughly 10–20 players. Strict networks can block direct WebRTC; a TURN server may be needed. Nostr relays provide signalling, not a TURN fallback, and an open relay socket alone does not prove peer connectivity. Fruit, rice and fish are per player, not shared.
- **Poses:** the sit pose's feet sink about 0.37 m into the ground. Bench sitting and a campfire crackle sound aren't implemented.
- **Bridges:** Pulau Nongkrong connects through only a couple of bridges, because the nearest islands are about 370 m away.
- **Performance:** 60 fps on a MacBook. Not yet profiled on low-end phones. The rice paddy is the heaviest single item.
- **Not yet tested:** cross-device multiplayer on mobile data, migration of very old saves, the WebGL fallback after the latest changes.
- **CI:** GitHub warns that Node 20 actions are deprecated and that `ubuntu-latest` moves to Ubuntu 26 from Oct 2026. Bump the action versions.
- **Ideas:** shared world events (for example everyone sees the same rain), emotes, more island variety (different seeds and biomes), a TURN fallback, private DMs via the `ngobrol` messenger identity.
