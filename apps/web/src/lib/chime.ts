import { useSoundStore } from '../stores/sound-store';

/** Which sound: a new KOT on the KDS, an order ready for a captain, a token on the TV. */
export type ChimeKind = 'newKot' | 'ready' | 'token';

/** Notes (Hz) per chime: short, distinct, audible over a kitchen extractor fan. */
const NOTES: Readonly<Record<ChimeKind, readonly number[]>> = {
  newKot: [880, 1175],
  ready: [659, 880, 1047],
  token: [784, 1047, 784, 1047],
};
const NOTE_S = 0.16;

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (context !== null) return context;
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (Ctor === undefined) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

/**
 * Browsers start audio suspended until someone taps the page. Call from a
 * tap handler ("Turn sound on") to unlock it. Resolves whether sound can play.
 */
export async function unlockAudio(): Promise<boolean> {
  const ctx = audioContext();
  if (ctx === null) return false;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    return false;
  }
  return ctx.state === 'running';
}

/** Whether sound will actually play now (false until the page was tapped once). */
export function audioReady(): boolean {
  return context?.state === 'running';
}

/** Plays a short WebAudio chime unless this device is muted. Never throws. */
export function chime(kind: ChimeKind): void {
  if (useSoundStore.getState().muted) return;
  const ctx = audioContext();
  if (ctx === null) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const start = ctx.currentTime + 0.02;
    NOTES[kind].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      const at = start + i * NOTE_S;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_S);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + NOTE_S + 0.02);
    });
  } catch {
    // No audio device: the visual alert is enough.
  }
}
