# Nongkrong 3D — Project Summary

**Play:** https://denizak.github.io/nongkrong-3d/ · **Repo:** https://github.com/denizak/nongkrong-3d
**Hosting:** GitHub Pages, plus a self-hosted deployment at https://denizakya.xyz/nongkrong/ (see deployment instructions below).
**Status:** live at commit `28fc6cf` (10 Nov 2026).

A cozy, low-poly 3D island game that runs in the browser. You play a small robot and explore a tropical archipelago of 50 islands joined by wooden bridges. You can shake mango trees, fish, harvest rice, poke scarecrows and relax by the campfire. Through peer-to-peer multiplayer you also see and chat with other players, and talk to nearby players with proximity voice chat. The interface is in Bahasa Indonesia by default, and English is available.

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
| **Multiplayer** | P2P (WebRTC). See other players' robots, names, poses and chat bubbles (**Enter** to chat, `/nama` or `/name` to rename). A connection pill under the island name shows searching, online, nearby, or "found but could not connect" (click it for help). `?solo` plays offline; `?netdebug` shows connection diagnostics. An optional TURN relay can be configured (see Deployment) |
| **Voice chat** | Hold **V** or the touch 🎤 button to talk (open-mic mode: press V to start and stop). Only players within 20 m hear you, with volume fading from 2 m to 20 m and left/right panning. Speaking icons appear above name tags, and tapping a name tag mutes that player. The mic is requested on first use only. The voice menu has hold or open mic, mute all and volume, and is separate from **M** |
| **Graphics quality** | High, Medium and Low tiers. Change with **Q** or the ⚙️ menu. The tier is picked automatically from the device, and drops one step if the frame rate stays under 40 fps. `?q=high`, `?q=medium` or `?q=low` overrides it. `?perf` shows an fps and draw-call panel. Phones start on Medium |
| **Audio** | Ambient sounds (waves, breeze, birds, crickets, rain and thunder), footsteps on grass, sand, wood and paddy mud, and effects including steel-drum catch jingles. No background music. **M** mutes ambient sounds and effects only, not voice chat |
| **Saving** | Position, island, robot, name, inventory, Fishpedia, per-island tree and rice state, time of day. Saved automatically in localStorage |

---

## Tech stack

- **Three.js r187** with `WebGPURenderer`, which falls back to WebGL2 automatically. Shaders use TSL node materials. On weak touch devices (the Low tier) WebGL2 is used first, unless `?webgpu` is given.
- **TypeScript + Vite 8.** The entry bundle is about 130 KB. three.js and Rapier are split into their own chunks and load in parallel.
- **Rapier** (`@dimforge/rapier3d-compat`): kinematic character controller, terrain trimesh, prop and bridge colliders. Loaded dynamically.
- **Trystero** (Nostr signalling, WebRTC data channels and audio streams): P2P multiplayer, loaded after the game starts. Signalling uses an explicit list of nine Nostr relays: the self-hosted one plus eight public ones. Voice chat sends microphone audio as WebRTC media streams over the same peer links. TURN servers are optional and come from build-time settings.
- **Quality system** (`src/core/Quality.ts`): three tiers (High, Medium, Low) read from one knob table, covering pixel ratio, shadows, lights, proxy range and vegetation density.
- **Web Audio API**: all ambience and synth effects are generated in code, alongside a few CC0 samples.
- **simplex-noise**: terrain generation.

## Architecture highlights

- **Floating origin.** The game always runs in the current island's local coordinates. Crossing a bridge past an island's region re-centres everything seamlessly (player, camera, state).
- **Island registry.** A deterministic, seeded Poisson-disc layout (`LAYOUT_SEED = 20261108`) means every player shares the same world. Islands are found with a Voronoi lookup, and the main island has a larger region.
- **Planar bridge network.** A Gabriel graph, reduced to the minimum spanning tree plus short extra edges, with crossing checks. Bridges can run at any angle and have oriented colliders.
- **Proxies.** Only the current island is live. Neighbours within about 320 m are baked static copies with shared geometry, no lights and no shadows. Fog hides everything farther away.
- **Two island kinds.** "Normal" and "main" islands each have their own terrain generator, zones, props and interactables. Per-island state is keyed by island id.
- **Quality tiers.** High, Medium and Low change pixel ratio, antialiasing, shadow map, torch lights, proxy range, vegetation, rain, fireflies and fog from one knob table. `FrameMonitor` steps the tier down after three 3 s windows under 40 fps.
- **Proximity voice.** Microphone audio is sent only to peers within 20 m (a peer already receiving keeps it until 24 m), at most 6 peers (4 on the Low tier). Each received voice has a gain that falls off from 2 m to 20 m and a stereo pan. It runs on a voice bus that bypasses the master gain, so **M** does not mute it.
- **Network messages.** Messages are compact and validated: `st` (state at about 10 Hz), `hi` (name and look), `ch` (chat, rate-limited, rendered as text only), `vc` (speaking flag for voice).
- **i18n.** One dictionary file (`src/i18n.ts`) holds 100+ keys. The language comes from `?lang=`, then localStorage, then the default (Indonesian).

Code size: 67 TypeScript files and about 13.6k lines under `src/`, in `src/{world, player, interact, net, ui, audio, core}` plus `i18n.ts`.

## Assets and licences

- **Code:** MIT (see `LICENSE`).
- **Character:** RobotExpressive by Tomás Laulhé (Quaternius), CC0.
- **Nature models:** Kenney Nature Kit (37 models), CC0.
- **Sounds:** Kenney Impact Sounds and Music Jingles (32 files), CC0.
- Full list in `CREDITS.md`.

## Deployment

- A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds with `GITHUB_PAGES=true` (base `/nongkrong-3d/`) and publishes to Pages on every push to `main`.
- The build reads optional TURN settings at build time: the repo variable `TURN_URLS` (comma-separated, for example `turn:host:3478,turns:host:5349`) and the secrets `TURN_USERNAME` and `TURN_CREDENTIAL`. They are passed to Vite as `VITE_TURN_*`. If `TURN_URLS` is unset, the game uses STUN only.
- Changes to the workflow file can only be pushed by a user whose GitHub token has the `workflow` scope.
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
| `e4264f9` | Project summary added |
| `94d5b51` | Multiplayer status fixes (per-peer failures no longer read as offline), optional TURN support, `?netdebug` diagnostics |
| `9c695ec` | Self-hosted Nostr relay files and deployment setup (by the owner) |
| `33b340c` | Island movement fix, deployment script, regression tests (by the owner) |
| `effe82e` | Player name shown in the HUD (by the owner) |
| `7665804` | Adaptive graphics quality tiers for phones, Q key and gear menu, `?perf` panel |
| `80c46cd` | `?perf` draw-call counter fix (per-frame counts instead of cumulative) |
| `e05d443` | Phones start on Medium; Low only on weak devices (measured: High 22 fps, Medium 60 fps on a OnePlus Nord) |
| `d5d59f3` | Proximity voice chat (20 m, push-to-talk, speaking icons, voice menu) |
| `075d017` | Background music removed; ambient sound and effects kept |
| `28fc6cf` | Voice chat no longer silenced by **M** or the speaker pill |

## Known limitations and ideas for next steps

- **Multiplayer:** a pure P2P mesh is practical for roughly 10–20 players. Strict networks can block direct WebRTC connections, and players behind them need a TURN relay to be reached. TURN is optional and configured through repo variables and secrets (see Deployment). Credentials in a static site are visible to anyone who loads the page, so use a free-tier or rate-limited credential. Fruit, rice and fish are per player, not shared.
- **Voice chat:** uses the same peer links as the game, so voice only reaches players whose direct connection works. It needs microphone permission, which the browser asks for on first use.
- **Poses:** the sit pose's feet sink about 0.37 m into the ground. Bench sitting and a campfire crackle sound aren't implemented.
- **Bridges:** Pulau Nongkrong connects through only a couple of bridges, because the nearest islands are about 370 m away.
- **Performance:** 60 fps on a MacBook. On a OnePlus Nord (Chrome), the High tier ran at 22 fps and Medium at 60 fps. Other low-end phones are not profiled. The rice paddy is the heaviest single item.
- **Not yet tested:** cross-device multiplayer on mobile data, migration of very old saves, the WebGL fallback after the latest changes.
- **CI:** the workflow builds with Node 22, but the action versions (`checkout@v4`, `setup-node@v4`, `configure-pages@v5`, `upload-pages-artifact@v3`, `deploy-pages@v4`) have not been bumped. GitHub warns that Node 20 actions are deprecated and that `ubuntu-latest` moves to Ubuntu 26 from Oct 2026. Bump the action versions.
- **Ideas:** push-to-talk polish (for example a clearer mic status and per-player volume), emotes, a default TURN relay so players behind strict networks connect without setup, more island variety (different seeds and biomes), shared world events (for example everyone sees the same rain), private DMs via the `ngobrol` messenger identity.
