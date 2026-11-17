import { describe, expect, it } from 'vitest'
import { applyHomography, homographyFrom } from '../src/shared/omr/homography'
import { detectPaper, otsu } from '../src/scan/detect'
import { adaptiveThreshold, applyFilter, enhanceColour, luma, percentile } from '../src/scan/filters'
import {
  addTurn,
  FULL_QUAD,
  isConvexQuad,
  orderCorners,
  polygonArea,
  straightenedSize,
  turnedSize,
  type Point,
  type Quad,
} from '../src/scan/geometry'
import { describeBytes, estimatePdfBytes, placeImage, PT_PER_MM } from '../src/scan/layout'
import { parseSettings, DEFAULT_SETTINGS } from '../src/scan/settings'
import { everyNStarts, learnerLabel, planScanSplit } from '../src/scan/split-plan'
import { blankImage, turnImage, warpQuad, type RgbaImage } from '../src/scan/warp'

/** A greyscale RGBA image drawn by `shade(x, y)`. */
function image(width: number, height: number, shade: (x: number, y: number) => number): RgbaImage {
  const img = blankImage(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = shade(x, y)
      img.data[i + 3] = 255
    }
  }
  return img
}

const at = (img: RgbaImage, x: number, y: number) => img.data[(y * img.width + x) * 4]

function inside(p: Point, quad: readonly Point[]): boolean {
  let sign = 0
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i]
    const b = quad[(i + 1) % quad.length]
    const c = Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x))
    if (c === 0) continue
    if (sign === 0) sign = c
    else if (c !== sign) return false
  }
  return true
}

describe('orderCorners', () => {
  const tl = { x: 10, y: 12 }
  const tr = { x: 90, y: 8 }
  const br = { x: 95, y: 120 }
  const bl = { x: 5, y: 110 }

  it('puts corners in the order top left, top right, bottom right, bottom left, whatever order they came in', () => {
    for (const shuffled of [
      [br, tl, bl, tr],
      [bl, br, tr, tl],
      [tr, bl, tl, br],
    ]) {
      expect(orderCorners(shuffled)).toEqual([tl, tr, br, bl])
    }
  })

  it('handles a page turned almost 45 degrees', () => {
    const diamond = [
      { x: 50, y: 2 },
      { x: 98, y: 50 },
      { x: 50, y: 98 },
      { x: 2, y: 52 },
    ]
    const q = orderCorners([diamond[2], diamond[0], diamond[3], diamond[1]])
    expect(isConvexQuad(q)).toBe(true)
    expect(q[0]).toEqual(diamond[0]) // smallest x + y
  })

  it('needs exactly four points', () => {
    expect(() => orderCorners([tl, tr, br])).toThrow()
  })
})

describe('corner geometry', () => {
  it('tells a crossed shape from a convex one', () => {
    expect(isConvexQuad(FULL_QUAD)).toBe(true)
    const crossed: Quad = [FULL_QUAD[0], FULL_QUAD[2], FULL_QUAD[1], FULL_QUAD[3]]
    expect(isConvexQuad(crossed)).toBe(false)
    const flat: Quad = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]
    expect(isConvexQuad(flat)).toBe(false)
  })

  it('measures the straightened page from its edges, capped on the longer side', () => {
    const q: Quad = [
      { x: 0, y: 0 },
      { x: 2100, y: 0 },
      { x: 2100, y: 2970 },
      { x: 0, y: 2970 },
    ]
    expect(straightenedSize(q, 5000)).toEqual({ width: 2100, height: 2970 })
    expect(straightenedSize(q, 2400)).toEqual({ width: 1697, height: 2400 })
    expect(polygonArea(q)).toBe(2100 * 2970)
  })

  it('counts quarter turns round the clock', () => {
    expect(addTurn(3, 1)).toBe(0)
    expect(addTurn(0, -1)).toBe(3)
    expect(turnedSize(30, 40, 1)).toEqual({ width: 40, height: 30 })
    expect(turnedSize(30, 40, 2)).toEqual({ width: 30, height: 40 })
  })
})

describe('homography', () => {
  it('maps each corner onto its target and straight lines stay straight', () => {
    const src = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]
    const dst = [
      { x: 12, y: 20 },
      { x: 180, y: 5 },
      { x: 200, y: 260 },
      { x: 3, y: 240 },
    ]
    const h = homographyFrom(src, dst)
    src.forEach((p, i) => {
      const q = applyHomography(h, p.x, p.y)
      expect(q.x).toBeCloseTo(dst[i].x, 6)
      expect(q.y).toBeCloseTo(dst[i].y, 6)
    })
    // The middle of the top edge lands on the line between the top corners.
    const m = applyHomography(h, 50, 0)
    const cross = (dst[1].x - dst[0].x) * (m.y - dst[0].y) - (dst[1].y - dst[0].y) * (m.x - dst[0].x)
    expect(Math.abs(cross)).toBeLessThan(1e-6)
  })
})

describe('warpQuad', () => {
  it('with the whole image as the quad, gives the image back', () => {
    const src = image(20, 10, (x, y) => (x * 13 + y * 7) % 256)
    const out = warpQuad(
      src,
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 0, y: 10 },
      ],
      20,
      10,
    )
    for (const [x, y] of [
      [0, 0],
      [7, 3],
      [19, 9],
    ]) {
      expect(Math.abs(at(out, x, y) - at(src, x, y))).toBeLessThanOrEqual(1)
    }
  })

  it('straightens a tilted dark sheet into a full rectangle', () => {
    // A dark quadrilateral on a white photo; after the warp every pixel is dark.
    const quad: Quad = [
      { x: 30, y: 20 },
      { x: 160, y: 35 },
      { x: 150, y: 190 },
      { x: 20, y: 170 },
    ]
    const photo = image(200, 220, (x, y) => (inside({ x: x + 0.5, y: y + 0.5 }, quad) ? 20 : 250))
    const out = warpQuad(photo, quad, 60, 80)
    let light = 0
    for (let y = 2; y < 78; y++) for (let x = 2; x < 58; x++) if (at(out, x, y) > 128) light++
    expect(light).toBe(0)
    expect(out.data[3]).toBe(255)
  })

  it('reads points outside the photo as white', () => {
    const photo = image(10, 10, () => 0)
    const out = warpQuad(
      photo,
      [
        { x: -10, y: -10 },
        { x: 20, y: -10 },
        { x: 20, y: 20 },
        { x: -10, y: 20 },
      ],
      30,
      30,
    )
    expect(at(out, 0, 0)).toBe(255)
    expect(at(out, 15, 15)).toBe(0)
  })
})

describe('turnImage', () => {
  const src = image(3, 2, (x, y) => y * 3 + x) // 0 1 2 / 3 4 5

  it('turns a quarter clockwise', () => {
    const out = turnImage(src, 1)
    expect([out.width, out.height]).toEqual([2, 3])
    // The bottom left pixel (3) moves to the top left.
    expect([at(out, 0, 0), at(out, 1, 0), at(out, 0, 2), at(out, 1, 2)]).toEqual([3, 0, 5, 2])
  })

  it('turns half way and three quarters', () => {
    expect(at(turnImage(src, 2), 0, 0)).toBe(5)
    const three = turnImage(src, 3)
    expect([three.width, at(three, 0, 0), at(three, 1, 0)]).toEqual([2, 2, 5])
  })
})

describe('adaptiveThreshold', () => {
  it('keeps dark writing black and paper white, even across a shadow', () => {
    const w = 120
    const h = 40
    // Paper fades from bright (left) to a deep shadow (right); a dark stroke crosses both.
    const grey = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const paper = 230 - x // 230 down to 111
        grey[y * w + x] = y >= 18 && y <= 21 ? paper * 0.4 : paper
      }
    }
    const out = adaptiveThreshold(grey, w, h, { window: 15 })
    expect(out[5 * w + 5]).toBe(255) // bright paper
    expect(out[5 * w + 115]).toBe(255) // shadowed paper stays white
    expect(out[19 * w + 5]).toBe(0) // stroke in the light
    expect(out[19 * w + 115]).toBe(0) // stroke in the shadow
  })

  it('leaves flat paper without speckles', () => {
    const grey = new Uint8Array(50 * 50).map((_, i) => 200 + (i % 3))
    expect(adaptiveThreshold(grey, 50, 50).every((v) => v === 255)).toBe(true)
  })
})

describe('filters', () => {
  const colour = blankImage(2, 1)
  colour.data.set([200, 40, 40, 255, 40, 200, 40, 255])

  it('greyscale gives equal channels', () => {
    const out = applyFilter(colour, 'grey')
    expect(out.data[0]).toBe(out.data[1])
    expect(out.data[1]).toBe(out.data[2])
    expect(applyFilter(colour, 'original')).toBe(colour)
  })

  it('black and white has only black and white pixels', () => {
    const img = image(40, 40, (x, y) => (x > 18 && x < 22 && y > 5 && y < 35 ? 30 : 220))
    const out = applyFilter(img, 'bw')
    const levels = new Set<number>()
    for (let i = 0; i < out.data.length; i += 4) levels.add(out.data[i])
    expect([...levels].sort((a, b) => a - b)).toEqual([0, 255])
  })

  it('enhanced colour stretches dull paper to white and keeps ink dark', () => {
    const dull = image(50, 50, (x) => (x < 5 ? 70 : 170))
    const out = enhanceColour(dull)
    expect(at(out, 30, 30)).toBe(255)
    expect(at(out, 2, 2)).toBeLessThan(20)
  })

  it('enhanced colour evens out a shadow across the paper', () => {
    // Paper fades from 230 to 120 across the photo, with a dark stroke in the shadowed half.
    const shaded = image(200, 100, (x, y) => {
      const paper = 230 - (x * 110) / 199
      return y > 48 && y < 52 && x > 150 && x < 190 ? paper * 0.3 : paper
    })
    const out = enhanceColour(shaded)
    expect(at(out, 10, 20)).toBeGreaterThan(235)
    expect(at(out, 190, 20)).toBeGreaterThan(235) // the shadowed paper is white too
    expect(at(out, 170, 50)).toBeLessThan(90) // the ink stays dark
  })

  it('percentile and luma', () => {
    const grey = new Uint8Array(100).map((_, i) => i)
    expect(percentile(grey, 0.5)).toBe(50)
    expect(luma(colour)[0]).toBe((200 * 77 + 40 * 150 + 40 * 29) >> 8)
  })
})

describe('detectPaper', () => {
  it('finds the corners of a bright sheet on a dark desk', () => {
    const quad: Quad = [
      { x: 90, y: 60 },
      { x: 520, y: 100 },
      { x: 480, y: 720 },
      { x: 60, y: 680 },
    ]
    const photo = image(600, 800, (x, y) => (inside({ x, y }, quad) ? 235 : ((x * 3 + y) % 40) + 40))
    const found = detectPaper(photo)
    expect(found).not.toBeNull()
    found!.forEach((p, i) => {
      expect(Math.abs(p.x * 600 - quad[i].x)).toBeLessThan(12)
      expect(Math.abs(p.y * 800 - quad[i].y)).toBeLessThan(12)
    })
  })

  it('suggests nothing when the sheet fills the photo or there is no contrast', () => {
    expect(detectPaper(image(300, 400, () => 230))).toBeNull()
    expect(detectPaper(image(300, 400, (x) => 120 + (x % 10)))).toBeNull()
    const fills = image(300, 400, (x, y) => (x < 2 || y < 2 ? 30 : 230))
    expect(detectPaper(fills)).toBeNull()
  })

  it('otsu splits two levels between them', () => {
    const r = otsu([...Array(50).fill(40), ...Array(50).fill(220)])
    expect(r.threshold).toBeGreaterThanOrEqual(40)
    expect(r.threshold).toBeLessThan(220)
    expect(r.darkMean).toBe(40)
    expect(r.brightMean).toBe(220)
  })
})

describe('placeImage', () => {
  it('fits a portrait photo inside A4 margins and centres it', () => {
    const p = placeImage(1000, 2000, 'a4', 10)
    expect(p.pageWidth).toBeCloseTo(595.28)
    expect(p.pageHeight).toBeCloseTo(841.89)
    expect(p.height).toBeCloseTo(841.89 - 20 * PT_PER_MM)
    expect(p.x).toBeCloseTo((595.28 - p.width) / 2)
  })

  it('turns Letter landscape for a landscape photo', () => {
    const p = placeImage(3000, 2000, 'letter', 0)
    expect([p.pageWidth, p.pageHeight]).toEqual([792, 612])
    expect(p.height).toBeCloseTo(528)
  })

  it('makes the page the shape of the photo for Fit to photo', () => {
    const p = placeImage(1000, 500, 'fit', 0)
    expect(p.pageWidth).toBeCloseTo(841.89)
    expect(p.pageHeight).toBeCloseTo(420.945)
    expect([p.x, p.y]).toEqual([0, 0])
  })
})

describe('size estimate', () => {
  it('scales the sample up by pixel count and describes it', () => {
    const bytes = estimatePdfBytes([{ bytes: 100_000, pixels: 1_000_000, fullPixels: 1_000_000 }], 3)
    expect(bytes).toBe(3 * 100_400 + 1000)
    expect(estimatePdfBytes([], 3)).toBe(0)
    expect(describeBytes(900 * 1024)).toBe('about 900 KB')
    expect(describeBytes(3.42 * 1024 * 1024)).toBe('about 3.4 MB')
    expect(describeBytes(25 * 1024 * 1024)).toBe('about 25 MB')
  })
})

describe('split planning', () => {
  const pages = (marks: string) => [...marks].map((c) => ({ first: c === '|', name: '' }))

  it('starts a part at page 1 and at every marked page', () => {
    const parts = planScanSplit(pages('.|..|.'), 'Grade 8.pdf')
    expect(parts.map((p) => [p.start, p.end])).toEqual([
      [1, 1],
      [2, 4],
      [5, 6],
    ])
    expect(parts.map((p) => p.fileName)).toEqual(['Grade 8-part-01.pdf', 'Grade 8-part-02.pdf', 'Grade 8-part-03.pdf'])
  })

  it('names parts after learners, safely and without clashes', () => {
    const p = pages('..|..|.')
    p[0].name = 'Thandi Mokoena'
    p[2].name = 'Thandi Mokoena'
    p[5].name = ' Pieter/van Wyk '
    const parts = planScanSplit(p, 'scan.pdf')
    expect(parts.map((x) => x.fileName)).toEqual(['Thandi Mokoena-1.pdf', 'Thandi Mokoena-2.pdf', 'Pieter van Wyk.pdf'])
    expect(parts[2].name).toBe('Pieter/van Wyk')
    expect(parts[1].firstIndex).toBe(2)
  })

  it('works out every N pages with the Split tool planner', () => {
    expect(everyNStarts(7, 3)).toEqual([0, 3, 6])
    expect(everyNStarts(4, 0)).toBeNull()
  })

  it('labels learners from a Class list', () => {
    expect(learnerLabel({ id: '07', name: ' Ayesha Patel ' })).toBe('Ayesha Patel')
    expect(learnerLabel({ id: '07' })).toBe('Learner 07')
  })
})

describe('parseSettings', () => {
  it('falls back to the defaults for missing, damaged or odd values', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('{oops')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('{"pageSize":"a3","quality":200,"filter":"bw","marginMm":5}')).toEqual({
      pageSize: 'a4',
      quality: 95,
      filter: 'bw',
      marginMm: 5,
    })
  })
})
