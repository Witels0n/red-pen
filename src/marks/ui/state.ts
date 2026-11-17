// The page's state for this visit only. Marks and names live here and nowhere else: only the band
// scheme and pass mark are saved (settings.ts).
import { analyse, type Analysis, type ColumnChoice } from '../core/analysis'
import { detectLayout, parsePasted, toPasteText, type TableLayout } from '../core/parse'
import { loadSettings, saveSettings, type MarksSettings } from '../core/settings'

export interface State {
  text: string
  /** The teacher's answers to "First row is headings" and "First column is names", if changed. */
  layout: Partial<TableLayout>
  /** Per assessment card, by column. */
  choices: ColumnChoice[]
  settings: MarksSettings
  /** The results tab: 'overview' or a column index. */
  tab: 'overview' | number
  /** The two columns compared for improved and dropped, when chosen. */
  pair: [number, number] | null
}

export const state: State = {
  text: '',
  layout: {},
  choices: [],
  settings: loadSettings(),
  tab: 'overview',
  pair: null,
}

export function rows(): string[][] {
  return parsePasted(state.text)
}

export function layout(r = rows()): TableLayout {
  return { ...detectLayout(r), ...state.layout }
}

export function current(): Analysis {
  const r = rows()
  return analyse(r, layout(r), state.choices, state.settings)
}

/** New marks from a paste, a file, the sample or a hand-off: earlier choices no longer apply. */
export function setSource(text: string): void {
  state.text = text
  state.layout = {}
  state.choices = []
  state.tab = 'overview'
  state.pair = null
}

export function setChoice(index: number, change: ColumnChoice): void {
  state.choices[index] = { ...state.choices[index], ...change }
}

export function setSettings(change: Partial<MarksSettings>): void {
  state.settings = { ...state.settings, ...change }
  saveSettings(state.settings)
}

/** Corrects one cell in place (learner row r, assessment column c of the analysis). */
export function correctCell(analysis: Analysis, r: number, c: number, value: string): void {
  const table = rows()
  const row = analysis.rowNumbers[r] - 1
  const col = (layout(table).namesColumn ? 1 : 0) + c
  if (!table[row]) return
  // Keep the headings and names choices as they are, whatever the correction looks like.
  state.layout = layout(table)
  table[row][col] = value
  state.text = toPasteText(table)
}
