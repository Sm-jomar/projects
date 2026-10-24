import { useState } from "react";
import { clampVolume, type MediaRef, type TableMusic } from "../lib/media";

// State for the table-music player (see MediaPlayer): whether its window
// is open, and what this viewer hears.

const OPEN_KEY = "media.dock.open";
const MUTE_KEY = "media.muted";
const VOLUME_KEY = "media.volume";
const DEFAULT_VOLUME = 50;

function readVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    return raw == null ? DEFAULT_VOLUME : clampVolume(Number(raw));
  } catch { return DEFAULT_VOLUME; }
}

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}
function writeFlag(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* storage unavailable */ }
}

export type MediaToggle = { open: boolean; setOpen: (v: boolean) => void };

/** Open/closed state of the player window, remembered per app. */
export function useMediaToggle(app: string): MediaToggle {
  const key = `${OPEN_KEY}.${app}`;
  const [open, setOpenRaw] = useState(() => readFlag(key));
  return { open, setOpen: (v) => { setOpenRaw(v); writeFlag(key, v); } };
}

/** What this viewer hears: their own pick, the table's, or nothing (muted),
 * and how loud (this device's volume, remembered). */
export function useMediaPlayback(music: TableMusic | null) {
  const [mine, setMine] = useState<(MediaRef & { label: string; at: number }) | null>(null);
  const [muted, setMutedRaw] = useState(() => readFlag(MUTE_KEY));
  const setMuted = (v: boolean) => { setMutedRaw(v); writeFlag(MUTE_KEY, v); };
  const [volume, setVolumeRaw] = useState(readVolume);
  const setVolume = (v: number) => {
    const next = clampVolume(v);
    setVolumeRaw(next);
    try { localStorage.setItem(VOLUME_KEY, String(next)); } catch { /* storage unavailable */ }
  };
  const current = mine ?? music;
  const playing = muted ? null : current;
  return { mine, setMine, muted, setMuted, volume, setVolume, current, playing };
}

export type MediaPlayback = ReturnType<typeof useMediaPlayback>;

