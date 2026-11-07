# Nongkrong 3D — Game Plan

A cozy, low-poly 3D web game in the spirit of life-sim "village" games (original art and design, not a copy of any specific game).
You control one character wandering a small tropical island: grassland, a pond, palm and fruit trees, a rice paddy with a scarecrow.

---

## 1. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Renderer | **Three.js** (`WebGPURenderer`, which falls back to WebGL2 automatically) | Biggest ecosystem, loads glTF models, and one codebase covers both WebGPU and WebGL |
| Language / build | **TypeScript + Vite** | Instant dev server, simple static build you can host anywhere |
| Physics / collision | **Rapier** (`@dimforge/rapier3d-compat`) | Character controller, terrain collider, trigger zones for interactions |
| Audio | Three.js `AudioListener` / `PositionalAudio` (or **Howler.js**) | Background music plus positional sounds (water, birds) |
| UI | Plain HTML/CSS overlay | Prompts ("Press E to shake tree"), inventory, dialog bubbles |
| Debug | `lil-gui`, `stats.js` | Tweak lighting, water, and camera live |

Alternative: **Babylon.js** is also a solid all-in-one choice (physics, audio, and inspector built in). Three.js is recommended because there are more examples and the community assets work with it out of the box.

---

## 2. Art direction: "cozy tropical low-poly"

- Flat or toon shading (`MeshToonMaterial` or a simple custom shader), soft and saturated colors.
- A bright warm sun, a hemisphere light (sky blue / grass green) and soft shadows.
- A third-person camera that follows from slightly above, with a gentle tilt.
- Optional "curved world" effect: bend the world down at the edges in the vertex shader. This gives a storybook look.
- Tropical palette: turquoise water, lime and emerald grass, sandy shores, coconut palms, banana and mango trees, hibiscus flowers.

---

## 3. Free assets

All of these are free. **CC0** means public domain, so no credit is required (crediting is still nice). Always check the license file in each pack.

### 3D models
| Source | What's useful | License |
|---|---|---|
| **Kenney.nl** — *Nature Kit*, *Survival Kit*, *Farm/Food kits* | Trees, rocks, plants, fences, crops, tools, fishing rod | CC0 |
| **Quaternius** (quaternius.com) — *Ultimate Nature Pack*, *Stylized Nature MegaKit*, *Farm Animals*, *Ultimate Animated Character Pack* | Palms, bushes, flowers, **rigged and animated characters** (idle/walk/run) | CC0 |
| **KayKit** by Kay Lousberg (itch.io) — *Adventurers*, *Forest Nature Pack* | Cute rigged characters, nature props | CC0 |
| **Poly Pizza** (poly.pizza) | Search engine for low-poly models: "scarecrow", "palm tree", "fish", "rice" | Mostly CC0 / CC-BY (check each model) |
| **Mixamo** (Adobe, free account) | Extra animations: fishing cast, wave, pick up, shake | Free to use in projects (cannot redistribute raw files) |
| **ambientCG / Poly Haven** | Textures and HDRI skies, if we want non-flat surfaces | CC0 |

### Music and sound effects
| Source | What's useful | License |
|---|---|---|
| **OpenGameArt.org** (Music → "cozy", "village", "tropical", "ukulele") | Looping background tracks | Mostly CC0 / CC-BY |
| **Kevin MacLeod — incompetech.com** | Easy-going tracks (ukulele, island vibes) | CC-BY 4.0 (credit required) |
| **Pixabay Music / Pixabay Sound Effects** | Ambient music, birds, water, footsteps | Pixabay License (free, no credit) |
| **Freesound.org** | Water splash, reel click, rustling leaves, crickets | Per sound: CC0 / CC-BY |
| **Kenney Audio packs** (*RPG Audio*, *Interface Sounds*) | UI clicks, footsteps, pickups | CC0 |

We will keep a `CREDITS.md` that lists every asset, its author, link, and license.

---

## 4. World layout (first map, about 120 × 120 m)

```
      ~~~~~~~~~~~~ ocean / beach edge ~~~~~~~~~~~~
    ~   palms     sand            palms            ~
    ~        +-----------+                         ~
    ~        |  PADDY    |   scarecrow             ~
    ~        |  FIELD    |      (+)                ~
    ~        +-----------+                         ~
    ~   fruit trees        SPAWN *       flowers   ~
    ~      (T) (T)                                 ~
    ~               +--------+    rocks            ~
    ~   bamboo      |  POND  |  <- fishing spot    ~
    ~               +--------+                     ~
      ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

- **Terrain:** a heightmap plane built from noise (simplex), flattened where the paddy, pond and spawn are, with a falloff at the edges so it becomes an island. Vertex colors paint grass, sand and dirt.
- **Water:** a flat plane with an animated toon shader (scrolling normals, foam at the shore through a depth comparison).
- **Vegetation:** instanced meshes (`InstancedMesh`) for grass tufts, flowers and small rocks, so thousands of them render cheaply. Grass sways in the wind in the vertex shader.

---

## 5. Gameplay features

### Core
1. **Movement:** WASD / arrow keys / gamepad left stick; Shift to run. The character turns smoothly toward the direction it moves. Idle, walk and run animations blend together.
2. **Camera:** a smooth follow camera; mouse drag or right stick to orbit a little; scroll to zoom.
3. **Collision:** you can't walk through trees or rocks or into deep water.
4. **Interaction system:** every interactable object has a trigger radius. The closest one shows a prompt ("E — Shake tree"), and pressing E runs its action.

### Interactions
| Object | Action | Result |
|---|---|---|
| **Fruit tree** (mango, coconut, banana) | Shake | The tree wobbles and fruit drops and bounces; walk over it to collect. It regrows after a few minutes. |
| **Pond / lake** | Fish | A cast animation, then a bobber on the water and a shadow that swims to it. Press E when the bobber dips (a timing window). You catch a fish of a random species and size (tilapia, catfish, koi, carp…), shown in a "You caught a…!" popup. |
| **Paddy field** | Walk through it / plant / harvest | Rice stalks bend as you pass. Optional cycle: plant seedlings, they grow, then you harvest. |
| **Scarecrow** | Talk / poke / dress up | Speech bubbles with silly lines; it spins when poked; birds land in the paddy, and poking the scarecrow scares them off. |
| **Flowers, shells, bugs** | Pick up | Collectibles for the inventory. |

### Light progression (optional)
- An inventory bar (fruits, fish, rice, shells).
- A simple collection log ("Fishpedia"), saved to `localStorage`.
- A day/night cycle (sun moves, sky gradient, fireflies at night) and occasional tropical rain.

---

## 6. Project structure

```
nongkrong-3d/
├─ index.html
├─ vite.config.ts
├─ public/
│  ├─ models/        # .glb files (character, trees, scarecrow, props)
│  ├─ audio/         # music .ogg/.mp3, sfx
│  └─ textures/
├─ src/
│  ├─ main.ts               # boot, renderer (WebGPU → WebGL fallback), game loop
│  ├─ core/
│  │  ├─ Input.ts           # keyboard + gamepad
│  │  ├─ Loader.ts          # GLTF + audio loading with a progress screen
│  │  └─ Physics.ts         # Rapier world wrapper
│  ├─ world/
│  │  ├─ Terrain.ts         # noise heightmap, vertex colors, collider
│  │  ├─ Water.ts           # toon water shader
│  │  ├─ Vegetation.ts      # instanced grass/flowers
│  │  ├─ Sky.ts             # gradient sky, sun, day/night
│  │  └─ Placement.ts       # where trees/rocks/props go
│  ├─ player/
│  │  ├─ Player.ts          # character controller + animation mixer
│  │  └─ CameraRig.ts
│  ├─ interact/
│  │  ├─ Interactable.ts    # base class (radius, prompt, onInteract)
│  │  ├─ FruitTree.ts
│  │  ├─ FishingSpot.ts
│  │  ├─ PaddyField.ts
│  │  └─ Scarecrow.ts
│  ├─ ui/                   # HUD, prompts, inventory, popups
│  └─ audio/AudioManager.ts
├─ CREDITS.md
└─ PLAN.md
```

---

## 7. Milestones

| # | Milestone | Done when |
|---|---|---|
| **M0** | Setup | Vite + TS + Three.js running; WebGPU with WebGL fallback; a spinning cube, FPS counter |
| **M1** | Walkable world | Noise island terrain, sky, sun and shadows; a capsule player you can move with WASD; follow camera |
| **M2** | Real character | Animated glTF character (idle/walk/run) from Quaternius or KayKit; smooth turning; Rapier collisions |
| **M3** | Tropical dressing | Palms and fruit trees, rocks, instanced swaying grass and flowers, toon water pond, beach |
| **M4** | Interaction system + trees | Prompt UI, shaking trees, fruit drops and pickup, simple inventory |
| **M5** | Fishing | Cast, bobber, fish shadow, timing minigame, catch popup, Fishpedia |
| **M6** | Paddy + scarecrow | Rice field with bending stalks, scarecrow dialog and poke, birds |
| **M7** | Audio and polish | Background music loop, ambient sounds (birds, water, wind), footsteps, sound effects, loading screen, save to localStorage |
| **M8** (stretch) | Life | Day/night, rain, fireflies, mobile touch joystick, deploy (GitHub Pages / Netlify / Vercel) |

M0–M3 give you a "walking simulator" you can try out. Each milestone after that adds one interaction.

---

## 8. Risks and notes

- **WebGPU support:** Chrome/Edge have it; Safari supports it in recent versions; Firefox support is partial. The Three.js `WebGPURenderer` falls back to WebGL2, so every modern browser works.
- **Mixing asset packs:** packs from different artists can clash in style. Pick **one main pack** (for example the Quaternius nature and character packs) and fill gaps sparingly. A shared toon material and color palette also helps.
- **Performance:** use `InstancedMesh` for repeated foliage, compress models (`gltf-transform` with Draco/Meshopt), and keep shadow map sizes reasonable.
- **Licenses:** CC-BY assets need credit, so record every one in `CREDITS.md` as you add it.
