// The only marking data kept in browser storage (besides the Reasons list): the last
// out-of value the teacher used, to pre-fill the next Total. Never the PDF or its annotations.

const KEY = 'pdf-marker.lastOutOf'

export function getLastOutOf(): number | undefined {
  try {
    const n = Number(localStorage.getItem(KEY))
    return Number.isFinite(n) && n > 0 ? n : undefined
  } catch {
    return undefined
  }
}

export function setLastOutOf(value: number): void {
  try {
    localStorage.setItem(KEY, String(value))
  } catch {
    // Storage unavailable: the value just isn't remembered.
  }
}
