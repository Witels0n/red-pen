// Shapes shared by the on-screen annotation layer and the PDF export, so what the teacher sees
// is what the Learner gets. Pure data: points are offsets in PDF page units from the
// annotation's (x, y), top-left origin, y down.

/** Annotation ink colour (red only; see spec). */
export const INK = { r: 0.85, g: 0.1, b: 0.1 }
export const INK_CSS = `rgb(${Math.round(INK.r * 255)}, ${Math.round(INK.g * 255)}, ${Math.round(INK.b * 255)})`

/** Stroke width in PDF units. */
export const STROKE_WIDTH = 2

/** An X centred on the click point: two strokes, each a [start, end] pair of offsets. */
export const CROSS_STROKES: ReadonlyArray<readonly [readonly [number, number], readonly [number, number]]> = [
  [[-7, -7], [7, 7]],
  [[-7, 7], [7, -7]],
]

/** A check mark centred on the click point, as a polyline. */
export const TICK_POINTS: ReadonlyArray<readonly [number, number]> = [
  [-7, 0],
  [-2, 6],
  [8, -8],
]

/** Text size, in PDF units, for Subtotals, the Total and Text notes. */
export const FONT_SIZE = 14

/** Subtotals are a bare number inside a circle of this radius. */
export const SUBTOTAL_RADIUS = 13

/** The Total is a box around "count / outOf"; Text notes are drawn without a box. */
export const BOX_HEIGHT = 22
export const BOX_PADDING = 7

/** Width of the Total's box. An estimate shared by screen and export (Helvetica averages ~0.56 em). */
export function boxWidth(label: string): number {
  return label.length * FONT_SIZE * 0.56 + 2 * BOX_PADDING
}

/** Colour of a Total with more Ticks than its out-of value (on screen only). */
export const WARNING_CSS = 'rgb(217, 119, 6)'
