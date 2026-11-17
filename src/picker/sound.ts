// Spin sounds, generated with Web Audio (no sound files): a short click per slice and a chime at the end.

let context: AudioContext | null = null
let lastTick = 0

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume()
    return context
  } catch {
    return null
  }
}

/** Call from a click or key press so the browser lets the page play sound. */
export function unlockSound(): void {
  audio()
}

function blip(
  ctx: AudioContext,
  frequency: number,
  start: number,
  length: number,
  volume: number,
  type: OscillatorType,
): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(frequency, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
  osc.connect(gain).connect(ctx.destination)
  osc.start(start)
  osc.stop(start + length + 0.02)
}

/** One click as a slice edge passes the pointer. Very fast ticks are thinned so they do not blur together. */
export function tick(): void {
  const ctx = audio()
  if (!ctx) return
  const now = ctx.currentTime
  if (now - lastTick < 0.035) return
  lastTick = now
  blip(ctx, 1500 + Math.random() * 120, now, 0.035, 0.18, 'square')
}

/** A bright two-note chime for the winner. */
export function chime(): void {
  const ctx = audio()
  if (!ctx) return
  const now = ctx.currentTime
  blip(ctx, 784, now, 0.25, 0.22, 'triangle')
  blip(ctx, 1175, now + 0.12, 0.45, 0.22, 'triangle')
}
