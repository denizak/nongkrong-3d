import './i18n.css';

/**
 * Tiny i18n: `t(key, params)` looks up the active language, falls back to English, and fills `{name}`
 * placeholders. Language comes from `?lang=en|id` in the URL, then localStorage, then Indonesian.
 * All player-facing text lives in the two dictionaries below.
 */

export type Lang = 'id' | 'en';

const STORE_KEY = 'nongkrong.lang';

const en = {
  // Loading overlay
  'loading.sub': 'a cozy island hangout',
  'loading.start': 'Click to start',
  'loading.starting': 'Starting…',
  'loading.shuffle': '🎲 Shuffle',
  'loading.edit': '✏️ Edit',
  'loading.playingAs': 'Playing as {name} · {lookName}',
  'loading.name': 'Name',
  'loading.namePlaceholder': 'Your name',
  'loading.renderer': 'Starting renderer',
  'loading.physics': 'Loading physics and terrain',
  'loading.physicsReady': 'Physics ready',
  'loading.models': 'Loading models ({done}/{total})',
  'loading.world': 'Building the world',
  'loading.almost': 'Almost there',
  'loading.ready': 'Ready',
  'backend.starting': 'starting…',
  'backend.renderer': 'Renderer: {name}',
  'backend.fallback': 'WebGL 2 (fallback)',
  'backend.failed': 'Failed to start: {msg}',

  // HUD help line and its appended parts
  'help.base': 'WASD / arrows — move · Shift — run · E — interact · C — sit · Z — lie down · F — Fishpedia · P — map · drag — orbit camera · scroll — zoom',
  'help.chat': ' · Enter — chat',
  'help.robot': ' · K — new robot',
  'help.time': ' · T — +1 hour · R — rain',
  'help.mute': ' · M — mute',
  'help.quality': ' · Q — graphics',

  // Graphics quality
  'quality.title': 'Graphics quality (Q)',
  'quality.menu': 'Graphics',
  'quality.high': 'High',
  'quality.medium': 'Medium',
  'quality.low': 'Low',
  'quality.set': 'Graphics: {tier}',
  'quality.lowered': 'Graphics lowered to {tier} for smoother play',
  'webgl.hint': 'Try ?webgl if it feels heavy',
  'quality.reload': 'Reload',
  'quality.reloadHint': 'Reload the page to apply everything.',
  'touch.hint': 'Drag left to move · drag right to look',

  // Touch buttons
  'touch.chat': 'Chat',
  'touch.fish': 'Fish',
  'touch.sit': 'Sit',
  'touch.lie': 'Lie',
  'touch.action': 'Action',
  'touch.map': 'Map',

  // Pills
  'island.pill': '🏝️ {name}',
  'island.progress': ' · {n}/{total} visited',
  'island.arrive': 'Welcome to {name}',
  'island.new': 'New!',
  'map.title': 'Map',
  'map.legend': '● You  ● Other players  ▢ Not visited yet',
  'map.you': 'You',
  'map.close': 'Close map',
  'net.connecting': '👥 looking for players…',
  'net.offline': '👥 offline',
  'net.online': '👥 {online} online · {nearby} nearby',
  'net.zero': '👥 0 online',
  'net.failed': '👥 ⚠️ {n} player(s) found but could not connect (network)',
  'net.failedHelp': "Your network or the other player's blocks direct (P2P) connections. Try another network or turn off your VPN.",
  'audio.title': 'Sound on or off (M)',
  'lang.title': 'Switch language',

  // Voice chat
  'help.voice': ' · V — talk',
  'voice.title': 'Voice chat (V)',
  'voice.menu': 'Voice',
  'voice.hintHold': 'Hold V to talk',
  'voice.hintOpen': 'Press V to start or stop talking',
  'voice.hold': 'Hold',
  'voice.open': 'Open mic',
  'voice.muteAll': 'Mute all voices',
  'voice.volume': 'Volume',
  'voice.range': 'Heard within 20 m',
  'voice.peerHint': "Tap a player's name to mute them",
  'voice.blocked': 'Microphone blocked or unavailable',
  'voice.blockedToast': 'Microphone blocked. Allow the mic in your browser to talk.',
  'voice.touch': 'Talk',

  // Chat and names
  'chat.placeholder': 'Say something…',
  'chat.aria': 'Chat message',
  'name.usage': 'Usage: /name NewName',
  'name.set': 'Name: {name}',
  'net.pal': 'Pal {n}',
  'net.friend': 'Friend',

  // Fishpedia
  'pedia.title': 'Fishpedia',
  'pedia.new': 'New in your Fishpedia!',
  'pedia.pond': 'Pond',
  'pedia.sea': 'Sea',
  'pedia.unknown': 'not caught yet',
  'pedia.stats': '×{count} · biggest {cm} cm',
  'pedia.caught': 'You caught a {name}! {cm} cm',

  // Fishing
  'fish.fish': 'Fish',
  'fish.reelIn': 'Reel in',
  'fish.hook': 'Hook it!',
  'fish.tooEarly': 'Too early!',
  'fish.escaped': 'It got away…',

  // Species
  'fish.tilapia': 'Tilapia',
  'fish.catfish': 'Catfish',
  'fish.carp': 'Carp',
  'fish.gourami': 'Gourami',
  'fish.koi': 'Koi',
  'fish.golden-koi': 'Golden Koi',
  'fish.sardine': 'Sardine',
  'fish.red-snapper': 'Red Snapper',
  'fish.clownfish': 'Clownfish',
  'fish.pufferfish': 'Pufferfish',
  'fish.tuna': 'Tuna',
  'fish.mahi-mahi': 'Mahi-mahi',

  // Inventory and prompts
  'item.mango': 'Mango',
  'item.rice': 'Rice',
  'toast.gain': '+{n} {item}',
  'prompt.shake': 'Shake tree',
  'prompt.harvest': 'Harvest rice',
  'prompt.poke': 'Poke scarecrow',

  // Robot looks
  'look.you': 'You are now: {name}',
  'look.new': 'New robot',
  'look.name': '{color} {type}',
  'robot.classic': 'Classic',
  'robot.sprout': 'Sprout',
  'robot.antenna': 'Antenna',
  'robot.captain': 'Captain',
  'robot.explorer': 'Explorer',
  'color.custom': 'Custom',
  'color.Coral': 'Coral',
  'color.Mint': 'Mint',
  'color.Sky': 'Sky',
  'color.Lilac': 'Lilac',
  'color.Sunflower': 'Sunflower',
  'color.Tangerine': 'Tangerine',
  'color.Teal': 'Teal',
  'color.Rose': 'Rose',
  'color.Lime': 'Lime',
  'color.Peach': 'Peach',
  'color.Cobalt': 'Cobalt',
  'color.Plum': 'Plum',
  'color.Sand': 'Sand',
  'color.Cherry': 'Cherry',
  'color.Jade': 'Jade',
  'color.Slate': 'Slate',

  // Scarecrow
  'scarecrow.0': "Hey! I'm on duty!",
  'scarecrow.1': "The birds don't respect me…",
  'scarecrow.2': "Nice hat. Mine's better.",
  'scarecrow.3': "Shoo! Oh wait, you're not a bird.",
  'scarecrow.4': "I've been standing here since spring.",
  'scarecrow.5': 'Do you think the crows like me?',
  'scarecrow.6': 'Rice is nice!',
  'scarecrow.7': 'Tickles!',
  'scarecrow.8': "Careful, I'm stuffed with straw, not patience.",
  'scarecrow.9': 'Psst… harvest the golden ones.',
};

export type Key = keyof typeof en;

const id: Record<Key, string> = {
  'loading.sub': 'tempat nongkrong santai di pulau',
  'loading.start': 'Klik untuk mulai',
  'loading.starting': 'Memulai…',
  'loading.shuffle': '🎲 Acak',
  'loading.edit': '✏️ Ubah',
  'loading.playingAs': 'Main sebagai {name} · {lookName}',
  'loading.name': 'Nama',
  'loading.namePlaceholder': 'Namamu',
  'loading.renderer': 'Menyiapkan renderer',
  'loading.physics': 'Memuat fisika dan medan',
  'loading.physicsReady': 'Fisika siap',
  'loading.models': 'Memuat model ({done}/{total})',
  'loading.world': 'Membangun dunia',
  'loading.almost': 'Hampir siap',
  'loading.ready': 'Siap',
  'backend.starting': 'memulai…',
  'backend.renderer': 'Renderer: {name}',
  'backend.fallback': 'WebGL 2 (cadangan)',
  'backend.failed': 'Gagal memulai: {msg}',

  'help.base': 'WASD / panah — jalan · Shift — lari · E — interaksi · C — duduk · Z — rebahan · F — Fishpedia · P — peta · seret — putar kamera · scroll — zoom',
  'help.chat': ' · Enter — ngobrol',
  'help.robot': ' · K — robot baru',
  'help.time': ' · T — +1 jam · R — hujan',
  'help.mute': ' · M — bisu',
  'help.quality': ' · Q — grafis',

  // Graphics quality
  'quality.title': 'Kualitas grafis (Q)',
  'quality.menu': 'Grafis',
  'quality.high': 'Tinggi',
  'quality.medium': 'Sedang',
  'quality.low': 'Rendah',
  'quality.set': 'Grafis: {tier}',
  'quality.lowered': 'Kualitas grafis diturunkan ke {tier} agar lancar',
  'webgl.hint': 'Coba ?webgl jika terasa berat',
  'quality.reload': 'Muat ulang',
  'quality.reloadHint': 'Muat ulang halaman agar semuanya berlaku.',
  'touch.hint': 'Seret ke kiri untuk jalan · seret ke kanan untuk melihat',

  'touch.chat': 'Ngobrol',
  'touch.fish': 'Ikan',
  'touch.sit': 'Duduk',
  'touch.lie': 'Rebahan',
  'touch.action': 'Aksi',
  'touch.map': 'Peta',

  'island.pill': '🏝️ {name}',
  'island.progress': ' · {n}/{total} dikunjungi',
  'island.arrive': 'Selamat datang di {name}',
  'island.new': 'Baru!',
  'map.title': 'Peta',
  'map.legend': '● Kamu  ● Pemain lain  ▢ Belum dikunjungi',
  'map.you': 'Kamu',
  'map.close': 'Tutup peta',
  'net.connecting': '👥 mencari pemain…',
  'net.offline': '👥 offline',
  'net.online': '👥 {online} online · {nearby} di dekat',
  'net.zero': '👥 0 online',
  'net.failed': '👥 ⚠️ {n} pemain terdeteksi tapi gagal tersambung (jaringan)',
  'net.failedHelp': 'Jaringanmu atau jaringan pemain lain memblokir koneksi langsung (P2P). Coba jaringan/Wi-Fi lain atau matikan VPN.',
  'audio.title': 'Suara nyala atau mati (M)',

  // Voice chat
  'help.voice': ' · V — bicara',
  'voice.title': 'Obrolan suara (V)',
  'voice.menu': 'Suara',
  'voice.hintHold': 'Tekan V untuk bicara',
  'voice.hintOpen': 'Tekan V untuk mulai atau berhenti bicara',
  'voice.hold': 'Tekan & tahan',
  'voice.open': 'Mic terbuka',
  'voice.muteAll': 'Bisukan semua suara',
  'voice.volume': 'Volume',
  'voice.range': 'Terdengar sejauh 20 m',
  'voice.peerHint': 'Ketuk nama pemain untuk membisukannya',
  'voice.blocked': 'Mikrofon diblokir atau tidak tersedia',
  'voice.blockedToast': 'Mikrofon diblokir. Izinkan mikrofon di browser untuk bicara.',
  'voice.touch': 'Bicara',
  'lang.title': 'Ganti bahasa',

  'chat.placeholder': 'Ketik sesuatu…',
  'chat.aria': 'Pesan chat',
  'name.usage': 'Cara pakai: /nama NamaBaru',
  'name.set': 'Nama: {name}',
  'net.pal': 'Teman {n}',
  'net.friend': 'Teman',

  'pedia.title': 'Fishpedia',
  'pedia.new': 'Baru di Fishpedia-mu!',
  'pedia.pond': 'Kolam',
  'pedia.sea': 'Laut',
  'pedia.unknown': 'belum tertangkap',
  'pedia.stats': '×{count} · terbesar {cm} cm',
  'pedia.caught': 'Kamu dapat {name}! {cm} cm',

  'fish.fish': 'Mancing',
  'fish.reelIn': 'Gulung tali',
  'fish.hook': 'Tarik!',
  'fish.tooEarly': 'Kecepetan!',
  'fish.escaped': 'Ikannya kabur…',

  'fish.tilapia': 'Nila',
  'fish.catfish': 'Lele',
  'fish.carp': 'Ikan Mas',
  'fish.gourami': 'Gurame',
  'fish.koi': 'Koi',
  'fish.golden-koi': 'Koi Emas',
  'fish.sardine': 'Sarden',
  'fish.red-snapper': 'Kakap Merah',
  'fish.clownfish': 'Ikan Badut',
  'fish.pufferfish': 'Buntal',
  'fish.tuna': 'Tuna',
  'fish.mahi-mahi': 'Lemadang',

  'item.mango': 'Mangga',
  'item.rice': 'Padi',
  'toast.gain': '+{n} {item}',
  'prompt.shake': 'Goyang pohon',
  'prompt.harvest': 'Panen padi',
  'prompt.poke': 'Colek orang-orangan sawah',

  'look.you': 'Sekarang kamu: {name}',
  'look.new': 'Robot baru',
  'look.name': '{type} {color}',
  'robot.classic': 'Klasik',
  'robot.sprout': 'Tunas',
  'robot.antenna': 'Antena',
  'robot.captain': 'Kapten',
  'robot.explorer': 'Penjelajah',
  'color.custom': 'Kustom',
  'color.Coral': 'Koral',
  'color.Mint': 'Mint',
  'color.Sky': 'Langit',
  'color.Lilac': 'Ungu Muda',
  'color.Sunflower': 'Bunga Matahari',
  'color.Tangerine': 'Jeruk',
  'color.Teal': 'Hijau Toska',
  'color.Rose': 'Mawar',
  'color.Lime': 'Limau',
  'color.Peach': 'Persik',
  'color.Cobalt': 'Kobalt',
  'color.Plum': 'Plum',
  'color.Sand': 'Pasir',
  'color.Cherry': 'Ceri',
  'color.Jade': 'Giok',
  'color.Slate': 'Batu',

  'scarecrow.0': 'Hei! Aku lagi jaga nih!',
  'scarecrow.1': 'Burung-burung nggak takut sama aku…',
  'scarecrow.2': 'Topimu bagus. Punyaku lebih keren.',
  'scarecrow.3': 'Hush! Eh, kamu bukan burung ya.',
  'scarecrow.4': 'Aku udah berdiri di sini dari musim tanam.',
  'scarecrow.5': 'Gagak-gagak itu suka sama aku nggak sih?',
  'scarecrow.6': 'Padi itu enak banget, lho!',
  'scarecrow.7': 'Hihi, geli!',
  'scarecrow.8': 'Hati-hati, aku isinya jerami, bukan kesabaran.',
  'scarecrow.9': 'Psst… panen yang kuning-kuning ya.',
};

const dicts: Record<Lang, Record<Key, string>> = { id, en };

function detectLang(): Lang {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'id') return q;
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'en' || saved === 'id') return saved;
  } catch {
    // Storage blocked: fall through to the default.
  }
  return 'id';
}

export const lang: Lang = detectLang();

/** Looks up a string in the active language (English fallback) and fills `{name}` placeholders. */
export function t(key: Key | string, params?: Record<string, string | number>): string {
  let s: string = (dicts[lang] as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
  return s;
}

/** Saves the language, puts it in the URL so it wins over the saved value, and reloads. */
export function setLang(next: Lang) {
  try {
    localStorage.setItem(STORE_KEY, next);
  } catch {
    // Storage blocked: the URL still carries the choice.
  }
  const url = new URL(location.href);
  url.searchParams.set('lang', next);
  location.href = url.toString();
}

/** Fills static markup marked with data-i18n, and sets <html lang>. */
function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n!);
  });
}

applyStatic();

/** Small EN/ID pill next to the sound toggle. Switching reloads the page. */
function mountLangToggle() {
  const b = document.createElement('button');
  b.id = 'lang-toggle';
  b.type = 'button';
  b.textContent = 'EN/ID';
  b.title = t('lang.title');
  b.setAttribute('aria-label', t('lang.title'));
  b.addEventListener('click', () => setLang(lang === 'id' ? 'en' : 'id'));
  document.body.append(b);
}

mountLangToggle();
