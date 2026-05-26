/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DAMAGE_DETECTION_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
