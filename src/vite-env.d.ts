/// <reference types="vite/client" />

/** Optional TURN relay for multiplayer, read at build time. See README "Multiplayer troubleshooting". */
interface ImportMetaEnv {
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
