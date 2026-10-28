import { create } from 'zustand';
import { readStorage, STORAGE_KEYS, writeStorage } from '../lib/storage';

interface SoundState {
  /** Chimes off on this device (a per-device choice, like the theme). */
  readonly muted: boolean;
  setMuted(muted: boolean): void;
}

export const useSoundStore = create<SoundState>()((set) => ({
  muted: readStorage(STORAGE_KEYS.soundMuted) === 'true',
  setMuted(muted) {
    writeStorage(STORAGE_KEYS.soundMuted, String(muted));
    set({ muted });
  },
}));
