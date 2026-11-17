// Made-up marks for "Try sample marks": invented names, so a teacher can see the tool work before
// pasting their own class.

const FIRST = [
  'Thandi',
  'Sipho',
  'Ayesha',
  'Lerato',
  'Pieter',
  'Naledi',
  'Kagiso',
  'Zanele',
  'Ruan',
  'Fatima',
  'Bongani',
  'Chloe',
]
const LAST = ['Mokoena', 'Dlamini', 'Patel', 'Khumalo', 'van Wyk', 'Nkosi', 'Molefe', 'Botha']

/** A small seeded random number generator, so the sample is the same every time. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

export function sampleRows(): string[][] {
  const rand = seeded(17)
  const rows: string[][] = [['Name', 'Term 1 test (40)', 'Assignment (50)', 'June exam (%)']]
  for (let i = 0; i < 24; i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 5 + 3) % LAST.length]}`
    const ability = 0.25 + rand() * 0.7
    const mark = (outOf: number, lift: number) =>
      Math.max(0, Math.min(outOf, Math.round((ability + lift + (rand() - 0.5) * 0.25) * outOf)))
    const test = i === 6 ? 'ABS' : String(mark(40, 0))
    const assignment =
      i === 11
        ? 'sick'
        : String(mark(50, 0.08)).replace(/^(\d+)$/, (m) => (i % 4 === 0 && Number(m) < 50 ? `${m},5` : m))
    const exam = i === 19 ? 'ABS' : String(mark(100, -0.04))
    rows.push([name, test, assignment, exam])
  }
  return rows
}
