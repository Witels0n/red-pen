import { readFileSync } from 'node:fs'
import type { OutlineFonts } from '../../src/certificates/draw'
import { OutlineFont } from '../../src/certificates/font/outline-font'

// The same bundled font files the page uses, read from node_modules.
const file = (p: string) => new OutlineFont(new Uint8Array(readFileSync(`node_modules/@fontsource/${p}`)))

export const testFonts: OutlineFonts = {
  script: file('great-vibes/files/great-vibes-latin-400-normal.woff'),
  display: file('bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff'),
  sans: file('atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff'),
  sansBold: file('atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff'),
  sansItalic: file('atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-italic.woff'),
}
