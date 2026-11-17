// The bundled fonts as bytes for drawing outlines. They are built into this module (base64), because
// the page may not fetch anything, not even its own files (connect-src 'none', ADR 0001).
// Loaded with a dynamic import, so the fonts arrive only when the first PDF is drawn.
import displayUrl from '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff?inline'
import sansItalicUrl from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-italic.woff?inline'
import sansUrl from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff?inline'
import sansBoldUrl from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff?inline'
import scriptUrl from '@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff?inline'
import type { OutlineFonts } from '../draw'
import { OutlineFont } from './outline-font'

function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function bundledFonts(): OutlineFonts {
  return {
    script: new OutlineFont(bytesOf(scriptUrl)),
    display: new OutlineFont(bytesOf(displayUrl)),
    sans: new OutlineFont(bytesOf(sansUrl)),
    sansBold: new OutlineFont(bytesOf(sansBoldUrl)),
    sansItalic: new OutlineFont(bytesOf(sansItalicUrl)),
  }
}
