// A hand-drawn SVG bar chart: each share of the paper as a bar, with its target as a line inside a
// shaded tolerance band. Colours come from CSS classes, so the chart follows the light or dark theme.
import { formatNumber } from './core/model'
import type { Share } from './core/summary'

const SVG = 'http://www.w3.org/2000/svg'
const WIDTH = 320
const ROW = 34
const BAR = 12

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  if (text !== undefined) node.textContent = text
  return node
}

/** The scale's right end: a little past the largest bar or band, never past 100%. */
export function chartMax(shares: readonly Pick<Share, 'percent' | 'target'>[], tolerance: number): number {
  const top = Math.max(10, ...shares.map((s) => Math.max(s.percent, (s.target ?? 0) + tolerance)))
  return Math.min(100, Math.ceil((top + 5) / 10) * 10)
}

export function shareChart(shares: readonly Share[], tolerance: number, title: string): SVGSVGElement {
  const height = Math.max(1, shares.length) * ROW + 18
  const root = svg('svg', {
    viewBox: `0 0 ${WIDTH} ${height}`,
    class: 'share-chart',
    role: 'img',
    'aria-label': title,
  })
  const max = chartMax(shares, tolerance)
  const x = (p: number) => (Math.max(0, Math.min(max, p)) / max) * (WIDTH - 2)

  // Grid lines every 10 (or 20) percent.
  const step = max > 50 ? 20 : 10
  for (let p = 0; p <= max; p += step) {
    root.append(svg('line', { x1: x(p) + 1, x2: x(p) + 1, y1: 0, y2: height - 16, class: 'chart-grid' }))
    root.append(
      svg(
        'text',
        {
          x: x(p) + 1,
          y: height - 4,
          class: 'chart-axis',
          'text-anchor': p === 0 ? 'start' : p + step > max ? 'end' : 'middle',
        },
        `${p}%`,
      ),
    )
  }

  shares.forEach((s, i) => {
    const top = i * ROW
    const label = `${s.name}: ${formatNumber(s.percent)}%${s.target === null ? '' : ` (target ${formatNumber(s.target)}%)`}`
    root.append(svg('text', { x: 1, y: top + 11, class: 'chart-label' }, label))
    const barY = top + 15
    root.append(svg('rect', { x: 1, y: barY, width: WIDTH - 2, height: BAR, rx: 2, class: 'chart-track' }))
    if (s.target !== null) {
      const lo = x(s.target - tolerance)
      const hi = x(s.target + tolerance)
      root.append(
        svg('rect', { x: lo + 1, y: barY - 2, width: Math.max(1, hi - lo), height: BAR + 4, class: 'chart-band' }),
      )
    }
    root.append(
      svg('rect', {
        x: 1,
        y: barY + 2,
        width: Math.max(0, x(s.percent)),
        height: BAR - 4,
        rx: 1,
        class: `chart-bar flag-${s.flag}`,
      }),
    )
    if (s.target !== null) {
      const tx = x(s.target) + 1
      root.append(svg('line', { x1: tx, x2: tx, y1: barY - 3, y2: barY + BAR + 3, class: 'chart-target' }))
    }
  })
  return root
}
