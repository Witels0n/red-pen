import { describe, expect, it } from 'vitest'
import { colourWarnings, contrastRatio, luminance, parseHex } from '../src/qr/contrast'
import { byteLength, makeMatrix, matrixFromRows, MAX_BYTES, type QrMatrix } from '../src/qr/matrix'
import {
  buildPayload,
  escapeVCard,
  escapeWifi,
  exportFileName,
  mailtoPayload,
  normaliseUrl,
  slugify,
  vCardPayload,
  wifiPayload,
} from '../src/qr/payload'
import { alignmentCentres, qrGeometry, renderSvg, type QrStyle } from '../src/qr/render'
import { DEFAULT_SETTINGS, loadSettings, sanitiseSettings, saveSettings, STORAGE_KEY } from '../src/qr/settings'

describe('normaliseUrl', () => {
  it('adds https:// when there is no scheme', () => {
    expect(normaliseUrl('example.com')).toBe('https://example.com')
    expect(normaliseUrl('  www.example.com/notes?x=1 ')).toBe('https://www.example.com/notes?x=1')
    expect(normaliseUrl('example.com:8080/a')).toBe('https://example.com:8080/a')
  })

  it('keeps an explicit scheme', () => {
    expect(normaliseUrl('http://example.com')).toBe('http://example.com')
    expect(normaliseUrl('HTTPS://Example.com')).toBe('HTTPS://Example.com')
    expect(normaliseUrl('mailto:a@b.co.za')).toBe('mailto:a@b.co.za')
    expect(normaliseUrl('tel:+27215550123')).toBe('tel:+27215550123')
  })

  it('leaves empty input empty', () => {
    expect(normaliseUrl('   ')).toBe('')
    expect(buildPayload({ type: 'link', url: '' })).toBe('')
  })
})

describe('Wi-Fi payload', () => {
  it('escapes backslash, semicolon, comma, colon and double quote', () => {
    expect(escapeWifi('a\\b;c,d:e"f')).toBe('a\\\\b\\;c\\,d\\:e\\"f')
  })

  it('builds the WIFI: format', () => {
    expect(wifiPayload({ ssid: 'Room 12', password: 'p;ss:word', security: 'WPA', hidden: false })).toBe(
      'WIFI:T:WPA;S:Room 12;P:p\\;ss\\:word;;',
    )
  })

  it('marks hidden networks and leaves out the password on open ones', () => {
    expect(wifiPayload({ ssid: 'Guest', password: 'ignored', security: 'nopass', hidden: true })).toBe('WIFI:T:nopass;S:Guest;H:true;;')
    expect(wifiPayload({ ssid: 'Lab', password: 'abc', security: 'WEP', hidden: false })).toBe('WIFI:T:WEP;S:Lab;P:abc;;')
  })

  it('needs a network name', () => {
    expect(buildPayload({ type: 'wifi', ssid: ' ', password: 'x', security: 'WPA', hidden: false })).toBe('')
  })
})

describe('mailto payload', () => {
  it('percent-encodes the subject and body, with CRLF line breaks', () => {
    expect(mailtoPayload({ address: 'teacher@school.co.za', subject: 'Homework & tests', body: 'Line 1\nLine 2' })).toBe(
      'mailto:teacher@school.co.za?subject=Homework%20%26%20tests&body=Line%201%0D%0ALine%202',
    )
  })

  it('leaves out empty fields', () => {
    expect(mailtoPayload({ address: ' a@b.za ', subject: '', body: '' })).toBe('mailto:a@b.za')
    expect(mailtoPayload({ address: 'a@b.za', subject: '', body: 'hi' })).toBe('mailto:a@b.za?body=hi')
  })

  it('encodes characters that would break the address', () => {
    expect(mailtoPayload({ address: 'a?b@c.za', subject: '', body: '' })).toBe('mailto:a%3Fb@c.za')
  })
})

describe('vCard payload', () => {
  it('escapes text values', () => {
    expect(escapeVCard('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
  })

  it('builds a vCard 3.0 with CRLF line endings', () => {
    const card = vCardPayload({ name: 'Thandi van der Merwe', phone: '082 555 0123', email: 'thandi@school.co.za', organisation: 'Hill School, Grade 7' })
    expect(card).toBe(
      [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'N:Merwe;Thandi van der;;;',
        'FN:Thandi van der Merwe',
        'ORG:Hill School\\, Grade 7',
        'TEL;TYPE=CELL:082 555 0123',
        'EMAIL;TYPE=INTERNET:thandi@school.co.za',
        'END:VCARD',
      ].join('\r\n'),
    )
  })

  it('leaves out empty fields and still has an FN', () => {
    const card = vCardPayload({ name: '', phone: '', email: '', organisation: 'Office' })
    expect(card).toBe(['BEGIN:VCARD', 'VERSION:3.0', 'N:;;;;', 'FN:Office', 'ORG:Office', 'END:VCARD'].join('\r\n'))
  })

  it('is empty when nothing is filled in', () => {
    expect(buildPayload({ type: 'contact', name: '', phone: ' ', email: '', organisation: '' })).toBe('')
  })
})

describe('file names', () => {
  it('slugifies', () => {
    expect(slugify('Hello, Wörld!')).toBe('hello-world')
    expect(slugify('!!!')).toBe('')
    expect(slugify('a'.repeat(60))).toHaveLength(40)
  })

  it('names the export after the content', () => {
    expect(exportFileName({ type: 'link', url: 'www.example.com/notes' }, 'png')).toBe('qr-example-com-notes.png')
    expect(exportFileName({ type: 'wifi', ssid: 'Room 12', password: '', security: 'WPA', hidden: false }, 'svg')).toBe('qr-wifi-room-12.svg')
    expect(exportFileName({ type: 'text', text: '' }, 'png')).toBe('qr-code.png')
  })
})

describe('contrast', () => {
  it('parses hex colours', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255])
    expect(parseHex('#1B2330')).toEqual([27, 35, 48])
    expect(parseHex('red')).toBeNull()
  })

  it('computes WCAG luminance and contrast', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBeCloseTo(1)
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21)
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21)
  })

  it('is quiet for a dark code on a light background', () => {
    expect(colourWarnings('#000000', '#ffffff')).toEqual([])
    expect(colourWarnings('#1b2330', '#fdfdfb')).toEqual([])
  })

  it('warns when the code is lighter than the background', () => {
    expect(colourWarnings('#ffffff', '#000000').join(' ')).toMatch(/lighter than the background/)
  })

  it('warns about low contrast and light codes', () => {
    expect(colourWarnings('#999999', '#ffffff').join(' ')).toMatch(/Low contrast/)
    expect(colourWarnings('#c8c8ff', '#ffffff')).toEqual([expect.stringMatching(/quite light/), expect.stringMatching(/Low contrast/)])
  })
})

describe('matrix', () => {
  it('chooses the smallest version that fits', () => {
    const r = makeMatrix('HELLO', 'M')
    expect(r.ok && r.matrix.size).toBe(21)
  })

  it('reports empty and too-long content', () => {
    expect(makeMatrix('', 'M')).toEqual({ ok: false, reason: 'empty' })
    expect(makeMatrix('x'.repeat(MAX_BYTES.H + 1), 'H')).toEqual({ ok: false, reason: 'too-long' })
    expect(makeMatrix('x'.repeat(MAX_BYTES.H), 'H').ok).toBe(true)
  })

  it('measures UTF-8 bytes', () => {
    expect(byteLength('Mōrena ✓')).toBe(11)
  })
})

const style = (over: Partial<QrStyle> = {}): QrStyle => ({
  foreground: '#000000',
  background: '#ffffff',
  moduleShape: 'square',
  eyeStyle: 'square',
  margin: 4,
  ...over,
})

/** Dark modules drawn one by one: everything except the eyes and alignment patterns. */
function darkOutsideEyes(m: QrMatrix): number {
  const centres = alignmentCentres(m.size)
  let count = 0
  for (let r = 0; r < m.size; r++)
    for (let c = 0; c < m.size; c++) {
      const eye = (r < 7 && c < 7) || (r < 7 && c >= m.size - 7) || (r >= m.size - 7 && c < 7)
      const alignment = centres.some(([ar, ac]) => Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2)
      if (!eye && !alignment && m.isDark(r, c)) count++
    }
  return count
}

/** Three eyes and every alignment pattern, three subpaths each. */
const patternSubpaths = (m: QrMatrix) => 3 * (3 + alignmentCentres(m.size).length)

/** Dark modules outside the eyes and alignment pattern of https://example.com at M (version 2). */
const MODULES_FOR_EXAMPLE_COM = 203

describe('renderer', () => {
  const result = makeMatrix('https://example.com', 'M')
  if (!result.ok) throw new Error('fixture did not encode')
  const matrix = result.matrix

  it('finds the alignment patterns for each version', () => {
    expect(alignmentCentres(21)).toEqual([])
    expect(alignmentCentres(25)).toEqual([[18, 18]])
    expect(alignmentCentres(45)).toHaveLength(6)
  })

  it('draws one square per dark module, plus the eyes and alignment patterns whole', () => {
    expect(matrix.size).toBe(25)
    const g = qrGeometry(matrix, style())
    const subpaths = g.path.match(/M/g)!.length
    expect(subpaths).toBe(darkOutsideEyes(matrix) + patternSubpaths(matrix))
    expect(darkOutsideEyes(matrix)).toBe(MODULES_FOR_EXAMPLE_COM)
  })

  it('draws a known tiny matrix exactly', () => {
    const rows = Array.from({ length: 21 }, () => '0'.repeat(21))
    rows[10] = '0'.repeat(10) + '1' + '0'.repeat(10)
    const g = qrGeometry(matrixFromRows(rows), style({ margin: 2 }))
    expect(g.view).toBe(25)
    expect(g.path.startsWith('M12 12h1v1h-1Z')).toBe(true)
  })

  it('draws one circle per dark module for dots', () => {
    const g = qrGeometry(matrix, style({ moduleShape: 'dots' }))
    expect(g.path.match(/a0\.45/g)!.length).toBe(darkOutsideEyes(matrix) * 2)
  })

  it('produces an SVG with the quiet zone in the viewBox and the chosen colours', () => {
    const svg = renderSvg(matrix, style({ foreground: '#123456', background: '#fedcba', margin: 3 }), undefined, { pixelSize: 512 })
    const view = matrix.size + 6
    expect(svg).toContain(`viewBox="0 0 ${view} ${view}"`)
    expect(svg).toContain('width="512" height="512"')
    expect(svg).toContain('fill="#123456"')
    expect(svg).toContain('fill="#fedcba"')
    expect(svg).not.toContain('style=')
  })

  it('never writes an unsafe colour into the SVG', () => {
    const svg = renderSvg(matrix, style({ foreground: '"><script>', background: 'nope' }))
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('fill="#000000"')
  })

  it('embeds the logo, clears the modules behind it and caps its size', () => {
    const big = { href: 'data:image/png;base64,AAAA', width: 100, height: 50, size: 0.5, padding: true }
    const g = qrGeometry(matrix, style(), big)
    expect(g.logo!.w).toBeCloseTo(matrix.size * 0.22)
    expect(g.logo!.h).toBeCloseTo(matrix.size * 0.11)
    expect(g.padding).toBeDefined()
    expect(g.path.match(/M/g)!.length).toBeLessThan(darkOutsideEyes(matrix) + patternSubpaths(matrix))
    const svg = renderSvg(matrix, style(), big)
    expect(svg).toContain('href="data:image/png;base64,AAAA"')
  })
})

describe('settings', () => {
  function memoryStorage() {
    const data = new Map<string, string>()
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
  }

  it('round-trips through storage under the red-pen.qr. prefix', () => {
    const storage = memoryStorage()
    const s = { ...DEFAULT_SETTINGS, foreground: '#112233', moduleShape: 'dots' as const, errorCorrection: 'Q' as const }
    saveSettings(s, storage)
    expect([...storage.data.keys()]).toEqual([STORAGE_KEY])
    expect(STORAGE_KEY.startsWith('red-pen.qr.')).toBe(true)
    expect(loadSettings(storage)).toEqual(s)
  })

  it('falls back to defaults for missing, invalid or unreadable settings', () => {
    expect(sanitiseSettings({ foreground: 'red', margin: 99, exportSize: 7, moduleShape: 'stars' })).toEqual({ ...DEFAULT_SETTINGS, margin: 10 })
    expect(loadSettings({ getItem: () => '{broken' })).toEqual(DEFAULT_SETTINGS)
    expect(
      loadSettings({
        getItem: () => {
          throw new Error('blocked')
        },
      }),
    ).toEqual(DEFAULT_SETTINGS)
    expect(() =>
      saveSettings(DEFAULT_SETTINGS, {
        setItem: () => {
          throw new Error('full')
        },
      }),
    ).not.toThrow()
  })
})
