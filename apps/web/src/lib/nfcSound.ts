/**
 * Plays the demo Apple Pay–style tap confirmation.
 * Uses /sounds/apple-pay-tap.wav (synthesized stand-in, not Apple's asset).
 */

const SOUND_URL = "/sounds/apple-pay-tap.wav";

let audio: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio(SOUND_URL);
    audio.preload = "auto";
    audio.volume = 1;
  }
  return audio;
}

/** Call from a click/tap handler so a delayed play is allowed. */
export async function unlockNfcAudio(): Promise<void> {
  const el = getAudio();
  if (!el) return;
  try {
    // Prime the element under the user gesture (silent), then rewind.
    el.muted = true;
    await el.play();
    el.pause();
    el.currentTime = 0;
    el.muted = false;
  } catch {
    // Autoplay policy — delayed play may still work after this gesture.
    el.muted = false;
  }
}

export async function playNfcTapSound(): Promise<void> {
  const el = getAudio();
  if (!el) return;
  try {
    el.pause();
    el.currentTime = 0;
    el.muted = false;
    await el.play();
  } catch {
    // Fall back to a close Web Audio recreation if HTMLAudio is blocked.
    await playSynthFallback();
  }
}

async function playSynthFallback(): Promise<void> {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      return;
    }
  }
  const t0 = ctx.currentTime;
  bell(ctx, t0, 1174.66, 0.05, 0.14);
  bell(ctx, t0 + 0.09, 1760.0, 0.065, 0.3);
}

function bell(
  ctx: AudioContext,
  start: number,
  fundamental: number,
  peakGain: number,
  duration: number,
) {
  const partials: Array<[number, number]> = [
    [1, 1],
    [2.003, 0.28],
    [3.01, 0.12],
    [4.2, 0.05],
  ];
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, start);
  master.gain.exponentialRampToValueAtTime(peakGain, start + 0.006);
  master.gain.exponentialRampToValueAtTime(peakGain * 0.3, start + 0.05);
  master.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  master.connect(ctx.destination);
  for (const [ratio, amp] of partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(fundamental * ratio, start);
    gain.gain.setValueAtTime(amp, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }
}
