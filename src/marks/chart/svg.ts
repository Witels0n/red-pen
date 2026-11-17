// Draws a chart model as inline SVG. Colours come from CSS classes (styles.css), so charts follow
// the light and dark themes.
import type { Chart } from './model'

const NS = 'http://www.w3.org/2000/svg'

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

const r1 = (n: number) => Math.round(n * 10) / 10

export function chartSvg(chart: Chart): SVGSVGElement {
  const root = svg('svg', {
    viewBox: `0 0 ${chart.width} ${chart.height}`,
    class: 'chart',
    role: 'img',
    'aria-label': chart.label,
    preserveAspectRatio: 'xMidYMid meet',
  })
  const title = svg('title', {})
  title.textContent = chart.label
  root.append(title)
  for (const m of chart.marks) {
    const cls = `c-${m.role}`
    if (m.kind === 'rect')
      root.append(svg('rect', { x: r1(m.x), y: r1(m.y), width: r1(m.w), height: r1(m.h), class: cls }))
    else if (m.kind === 'line')
      root.append(
        svg('line', {
          x1: r1(m.x1),
          y1: r1(m.y1),
          x2: r1(m.x2),
          y2: r1(m.y2),
          class: m.dashed ? `${cls} dashed` : cls,
        }),
      )
    else if (m.kind === 'circle') root.append(svg('circle', { cx: r1(m.cx), cy: r1(m.cy), r: m.r, class: cls }))
    else {
      const t = svg('text', {
        x: r1(m.x),
        y: r1(m.y),
        'font-size': m.size,
        'text-anchor': m.anchor,
        class: m.bold ? `${cls} bold` : cls,
        'aria-hidden': 'true',
      })
      t.textContent = m.text
      root.append(t)
    }
  }
  return root
}
