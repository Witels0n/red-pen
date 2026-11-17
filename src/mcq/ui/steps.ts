// The steps of an Assessment, in order, and the screen for each.
import { buildStep } from './build-view'
import { markStep, setUpScanIntake } from './mark-view'
import { printStep } from './print-view'
import { resultsStep } from './results-view'
import { returnStep } from './return-view'
import { reviewStep } from './review-view'
import type { ChangeInfo } from './state'

export const STEPS = ['build', 'print', 'mark', 'review', 'results', 'return'] as const
export type StepId = (typeof STEPS)[number]

export interface StepView {
  /** Draws the step from scratch. */
  show(root: HTMLElement): void
  /** The open Assessment changed somewhere else: bring the step up to date. */
  refresh?(root: HTMLElement, info: ChangeInfo): void
}

const views: Record<StepId, StepView> = {
  build: buildStep,
  print: printStep,
  mark: markStep,
  review: reviewStep,
  results: resultsStep,
  return: returnStep,
}

export function stepView(id: StepId): StepView {
  return views[id]
}

setUpScanIntake()
