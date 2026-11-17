// Date stamps in the two formats South African schools use.
export type DateStyle = 'long' | 'iso'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** "17 November 2026" (long) or "2026-11-17" (iso), in local time. */
export function formatDate(date: Date, style: DateStyle): string {
  if (style === 'iso') {
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${mm}-${dd}`
  }
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}
