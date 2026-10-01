// The currently opened Test: its original bytes and file name, kept untouched in memory
// so the export ticket can draw annotations over the original. Never persisted (ADR 0001).
export interface OpenedTest {
  /** Original file name, e.g. "learner-12.pdf". */
  readonly name: string
  /** The original, unmodified file bytes. Do not mutate. */
  readonly bytes: Uint8Array
}

let current: OpenedTest | null = null

export function setOpenedTest(test: OpenedTest): void {
  current = test
}

export function getOpenedTest(): OpenedTest | null {
  return current
}
