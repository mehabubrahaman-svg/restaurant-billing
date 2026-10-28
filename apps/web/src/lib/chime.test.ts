import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSoundStore } from '../stores/sound-store';

/** Just enough of WebAudio to count the notes played. */
class FakeAudioContext {
  static oscillators = 0;
  state: AudioContextState = 'running';
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  createOscillator() {
    FakeAudioContext.oscillators += 1;
    return {
      type: 'sine',
      frequency: { value: 0 },
      connect: (n: unknown) => n,
      start() {},
      stop() {},
    };
  }
  createGain() {
    const gain = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    return { gain, connect: (n: unknown) => n };
  }
}

beforeEach(() => {
  vi.resetModules();
  FakeAudioContext.oscillators = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
});
afterEach(() => vi.unstubAllGlobals());

describe('chime', () => {
  it('plays a short WebAudio chime, and nothing while this device is muted', async () => {
    const { chime } = await import('./chime');
    const { useSoundStore: store } = await import('../stores/sound-store');
    store.getState().setMuted(true);
    chime('newKot');
    expect(FakeAudioContext.oscillators).toBe(0);
    store.getState().setMuted(false);
    chime('newKot');
    expect(FakeAudioContext.oscillators).toBe(2);
    expect(window.localStorage.getItem('restroos.sound-muted')).toBe('false');
  });

  it('remembers the mute choice per device', () => {
    useSoundStore.getState().setMuted(true);
    expect(window.localStorage.getItem('restroos.sound-muted')).toBe('true');
    useSoundStore.getState().setMuted(false);
  });
});
