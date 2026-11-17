// Unscramble the words: shuffles a word's letters so the result is never the word itself (unless every
// letter is the same, when no scramble exists).
import { shuffled, type Rng } from './random'

export function scramble(word: string, rng: Rng): string {
  const letters = [...word.normalize('NFC').toLocaleUpperCase('en-ZA').replace(/\s+/g, '')]
  const original = letters.join('')
  if (new Set(letters).size < 2) return original
  for (let i = 0; i < 20; i++) {
    const s = shuffled(letters, rng).join('')
    if (s !== original) return s
  }
  // A rotation by one differs from the word whenever two letters differ.
  return original.slice(1) + original[0]
}
