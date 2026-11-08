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

### Masalah multiplayer

Pill di bawah nama pulau menunjukkan kondisinya:

- **👥 mencari pemain…**: sedang mencari relay dan pemain lain.
- **👥 0 online**: terhubung ke jaringan pencarian, belum ada pemain di dekatmu.
- **👥 N online · M di dekat**: N pemain tersambung, M di pulau dekatmu.
- **👥 ⚠️ N pemain terdeteksi tapi gagal tersambung**: pemain ditemukan, tapi koneksi langsung gagal. Klik pill untuk penjelasan.
- **👥 offline**: tidak bisa mencari pemain sama sekali (misalnya tidak ada internet).

Koneksi langsung (P2P) kadang gagal di jaringan tertentu, misalnya jaringan kantor atau kampus dan beberapa VPN. Solusinya adalah server TURN sebagai perantara. Untuk menambahkannya, buat akun TURN (atau jalankan coturn sendiri), lalu di repo GitHub isi variabel `TURN_URLS` (contoh `turn:host:3478,turns:host:5349`) dan secret `TURN_USERNAME` serta `TURN_CREDENTIAL`. Catatan: kredensial di situs statis bisa dilihat siapa pun, jadi gunakan kredensial gratis atau yang dibatasi laju pemakaiannya. Untuk pengecekan, tambahkan `?netdebug` ke URL.

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

Players meet peer-to-peer over WebRTC. [Trystero](https://github.com/dmotz/trystero) uses the self-hosted Nostr relay and public fallback relays for discovery and signalling. Everyone is in one shared world. You see other robots on your island and on the islands next to it, with their names and chat bubbles. Type `/name NewName` in the chat box to change your name, or set it on the loading screen.

Add `?solo` to the URL to play offline with no networking. Strict networks (some corporate or school firewalls) may block direct connections, in which case you simply won't see other players and the HUD shows the count.

## Multiplayer troubleshooting

The pill under the island name shows the connection state:

- **👥 looking for players…**: searching the relays for other players.
- **👥 0 online**: connected to the search network, no other players yet.
- **👥 N online · M nearby**: N players connected, M on islands next to yours.
- **👥 ⚠️ N player(s) found but could not connect**: players were found, but the direct connection failed. Click the pill for an explanation.
- **👥 offline**: no way to search for players at all (for example, no internet).

Direct (P2P) connections sometimes fail on certain networks, such as some office, school or VPN networks. A TURN relay can carry the traffic instead. To add one, create a TURN account (or run coturn yourself), then set the repo variable `TURN_URLS` (for example `turn:host:3478,turns:host:5349`) and the secrets `TURN_USERNAME` and `TURN_CREDENTIAL`. Note that credentials in a static site are public to anyone who loads the page, so use a free-tier or rate-limited credential. Add `?netdebug` to the URL to see connection details.

### Self-hosted signalling relay

The game includes `wss://denizakya.xyz/nostr` alongside public fallback relays. The relay configuration and pinned Docker image are in `relay/`. On the Linux host, the container listens only on `127.0.0.1:18080`; nginx provides the public WebSocket endpoint. To create the container (skip `docker run` if it already exists):

```sh
docker build -t nongkrong-nostr-relay relay
docker run -d --name nongkrong-nostr-relay --restart unless-stopped \
  --memory 256m --cpus 1 --pids-limit 128 \
  -p 127.0.0.1:18080:8080 nongkrong-nostr-relay
```

To publish the game at `https://denizakya.xyz/nongkrong/`, install dependencies with `npm ci` and run as the normal project user:

```sh
./scripts/deploy.sh
```

The script runs tests, builds with `SELF_HOSTED=true`, and uses sudo to copy the build to `/var/www/nongkrong/` and restore SELinux labels when available. It retains old hashed assets for cached pages; remove obsolete files separately when appropriate. It does not configure nginx or restart the relay.

Add the contents of `relay/nginx-location.conf` **inside the existing HTTPS server block** in `/etc/nginx/conf.d/denizakya.xyz.conf`, preserving the other locations. Run `sudo nginx -t` and, only if it succeeds, `sudo systemctl reload nginx`. Repeat the build and copy after game updates; pushing to GitHub Pages does not update this self-hosted copy.

Check the container with `docker ps --filter name=nongkrong-nostr-relay` and `docker logs nongkrong-nostr-relay`. Open `https://denizakya.xyz/nongkrong/?netdebug` in two clients to check relay status and actual peer connectivity. A WebSocket opening alone does not prove event delivery or WebRTC connectivity. If `/nostr` serves the landing page instead of the relay, check the nginx location and reload. On SELinux hosts nginx may need `httpd_can_network_connect` enabled. Ensure Cloudflare WebSockets are enabled if the domain is proxied.

The relay is public, uses an in-memory database, and has global rate and container resource limits; monitor it for abuse. Restarting it loses stored events. This is signalling only, not a TURN server.

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
