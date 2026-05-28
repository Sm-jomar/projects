/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend Worker endpoint for flag commits. Empty = download-only. */
  readonly VITE_FLAG_ENDPOINT?: string;
  /** Optional shared secret sent as X-Flag-Secret to the Worker. */
  readonly VITE_FLAG_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
