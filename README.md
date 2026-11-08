# Nongkrong 3D

## Bahasa Indonesia

### Tentang

Tempat nongkrong santai di pulau kecil, dibuat dengan Three.js, TypeScript dan Vite. Jelajahi pulau, duduk, ngobrol, mancing, dan lihat hari berubah jadi malam.

**Main:** https://denizak.github.io/nongkrong-3d/

### Kontrol

| Tombol | Aksi |
|---|---|
| WASD / panah | Jalan |
| Shift | Lari |
| E | Interaksi |
| C | Duduk |
| Z | Rebahan |
| F | Fishpedia |
| M | Bisukan / nyalakan suara |
| T | Maju satu jam |
| R | Nyalakan / matikan hujan |
| K | Acak tampilan robotmu |
| Enter | Ngobrol |

Seret untuk memutar kamera dan scroll untuk zoom. Ganti bahasa lewat tombol EN/ID di kanan atas, atau tambahkan `?lang=en` atau `?lang=id` ke URL.

### Main

- Goyang pohon mangga untuk menjatuhkan buah, dan panen padi di sawah.
- Mancing di kolam atau laut. Tekan E saat ikan menggigit, lalu lihat koleksimu di Fishpedia.
- Colek orang-orangan sawah, dan ajak temanmu ngobrol. Ketik `/nama NamaBaru` untuk ganti nama.

---

## English

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

## Multiplayer

Players meet peer-to-peer: WebRTC connections, with public Nostr relays used only to find each other (via [Trystero](https://github.com/dmotz/trystero)). Everyone is in one shared world. You see other robots on your island and on the islands next to it, with their names and chat bubbles. Type `/name NewName` in the chat box to change your name, or set it on the loading screen.

Add `?solo` to the URL to play offline with no networking. Strict networks (some corporate or school firewalls) may block direct connections, in which case you simply won't see other players and the HUD shows the count.

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
