// The results: one assessment on its own, or an Overview tab and a tab per assessment.
import { hasNames, insightsFor, shown, type AnalysedColumn, type Analysis } from '../core/analysis'
import {
  changes,
  defaultPair,
  needsSupport,
  outlierLearners,
  topLearners,
  type Change,
  type RankedLearner,
} from '../core/compare'
import { MAX_INSIGHTS, singleInsights, type Insight } from '../core/insights'
import { oneDp, pct, type Summary } from '../core/stats'
import { bandChart, boxPlot } from '../chart/model'
import { chartSvg } from '../chart/svg'
import { clear, h, plural } from './dom'
import { state } from './state'

type Shown = AnalysedColumn & { summary: Summary }

function tile(label: string, value: string): HTMLElement {
  return h(
    'div',
    { class: 'tile' },
    h('span', { class: 'tile-value', text: value }),
    h('span', { class: 'tile-label', text: label }),
  )
}

function headline(s: Summary): HTMLElement {
  return h(
    'div',
    { class: 'tiles' },
    tile('mean', pct(s.mean)),
    tile('median', pct(s.median)),
    tile('SD', oneDp(s.sd)),
    tile('pass rate', pct(s.passRate)),
    tile('highest', pct(s.max)),
    tile('lowest', pct(s.min)),
  )
}

function panel(title: string, ...children: (Node | null | false)[]): HTMLElement {
  return h('section', { class: 'panel result-panel' }, h('h3', { text: title }), ...children)
}

function insightList(insights: Insight[]): HTMLElement {
  return h(
    'ul',
    { class: 'insights' },
    insights.slice(0, MAX_INSIGHTS).map((i) => h('li', { 'data-kind': i.kind, text: i.text })),
  )
}

function bandTable(c: Shown, analysis: Analysis): HTMLElement {
  return h(
    'details',
    { class: 'band-table' },
    h('summary', { text: 'Learners per band as a table' }),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'data-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ['Band', 'Range', 'Learners', '%'].map((t) => h('th', { scope: 'col', text: t })),
          ),
        ),
        h(
          'tbody',
          {},
          analysis.scheme.bands.map((b, i) =>
            h(
              'tr',
              {},
              h('td', { text: b.label }),
              h('td', { text: `${b.range}%` }),
              h('td', { class: 'num', text: String(c.summary.bands[i].count) }),
              h('td', { class: 'num', text: pct(c.summary.bands[i].share) }),
            ),
          ),
        ),
      ),
    ),
  )
}

function moreStats(s: Summary): HTMLElement {
  const row = (label: string, value: string) => [h('dt', { text: label }), h('dd', { text: value })]
  return h(
    'dl',
    { class: 'stat-list' },
    row('Marks', String(s.count)),
    row('Absent', String(s.absent)),
    row('Unreadable', String(s.unreadable)),
    row('Range', oneDp(s.range)),
    row('Lower quartile', pct(s.q1)),
    row('Upper quartile', pct(s.q3)),
    row('Outliers', String(s.outliers.length)),
    row('Passed', `${s.passCount} of ${s.count}`),
  )
}

function learnerList(items: RankedLearner[], empty: string, cls = ''): HTMLElement {
  if (items.length === 0) return h('p', { class: 'empty', text: empty })
  return h(
    'ol',
    { class: `learner-list ${cls}` },
    items.map((l) =>
      h(
        'li',
        {},
        h('span', { class: 'who', text: l.label }),
        h('span', { class: 'mark', text: `${pct(l.value)}${l.joint ? ' (joint)' : ''}` }),
      ),
    ),
  )
}

function single(c: Shown, analysis: Analysis, width: number): HTMLElement {
  const s = c.summary
  const names = hasNames(analysis)
  const chart = bandChart(s, analysis.scheme, {
    width,
    height: 230,
    compact: analysis.scheme.bands.length > 9 && width < 420,
  })
  const plot = boxPlot([{ label: c.column.name, summary: s }], analysis.passMark, { width, rowHeight: 40 })
  const outliers = outlierLearners(c.column, s, analysis)
  return h(
    'div',
    { class: 'results-grid' },
    h('section', { class: 'panel result-panel wide' }, h('h3', { text: c.column.name }), headline(s)),
    panel('Learners per band', h('div', { class: 'chart-wrap' }, chartSvg(chart)), bandTable(c, analysis)),
    panel('Spread of marks', h('div', { class: 'chart-wrap' }, chartSvg(plot)), moreStats(s)),
    panel('What stands out', insightList(singleInsights(s, c.percents, analysis.scheme))),
    names
      ? panel(
          'Learners',
          h('h4', { text: `Needs support (below ${analysis.passMark}%)` }),
          learnerList(
            needsSupport(c.column, analysis.passMark, analysis),
            'Everyone reached the pass mark.',
            'support',
          ),
          h('h4', { text: 'Top five' }),
          learnerList(topLearners(c.column, analysis), 'No marks.', 'top'),
          h('h4', { text: 'Outliers' }),
          outliers.length
            ? h(
                'ol',
                { class: 'learner-list outliers' },
                outliers.map((o) =>
                  h(
                    'li',
                    {},
                    h('span', { class: 'who', text: o.label }),
                    h('span', { class: 'mark', text: `${pct(o.value)} (${o.side})` }),
                  ),
                ),
              )
            : h('p', { class: 'empty', text: 'No outliers.' }),
        )
      : panel(
          'Learners',
          h('p', {
            class: 'empty',
            text: 'Add a names column (and tick "First column is names") to see who needs support, the top five and outliers.',
          }),
        ),
  )
}

function comparisonTable(cols: Shown[]): HTMLElement {
  const heads = ['Assessment', 'Out of', 'Marks', 'Absent', 'Mean', 'Median', 'SD', 'Lowest', 'Highest', 'Pass rate']
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'data-table', id: 'comparison-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          heads.map((t, i) => h('th', { scope: 'col', class: i ? 'num' : '', text: t })),
        ),
      ),
      h(
        'tbody',
        {},
        cols.map(({ column, summary: s }) =>
          h(
            'tr',
            {},
            h(
              'th',
              { scope: 'row' },
              column.name,
              column.calculated ? h('span', { class: 'tag', text: 'calculated' }) : null,
            ),
            [
              column.outOf === null ? '%' : String(column.outOf),
              String(s.count),
              String(s.absent),
              pct(s.mean),
              pct(s.median),
              oneDp(s.sd),
              pct(s.min),
              pct(s.max),
              pct(s.passRate),
            ].map((v) => h('td', { class: 'num', text: v })),
          ),
        ),
      ),
    ),
  )
}

function changeList(items: Change[], empty: string): HTMLElement {
  if (items.length === 0) return h('p', { class: 'empty', text: empty })
  return h(
    'ol',
    { class: 'learner-list' },
    items.map((c) =>
      h(
        'li',
        {},
        h('span', { class: 'who', text: c.label }),
        h('span', {
          class: 'mark',
          text: `${pct(c.from)} to ${pct(c.to)} (${c.change > 0 ? '+' : ''}${oneDp(c.change)})${c.joint ? ' joint' : ''}`,
        }),
      ),
    ),
  )
}

function changesPanel(cols: Shown[], analysis: Analysis, refresh: () => void): HTMLElement | null {
  const plain = cols.filter((c) => !c.column.calculated)
  const fallback = defaultPair(cols.map((c) => c.column))
  if (plain.length < 2 || !fallback) return null
  const valid = (i: number) => plain.some((c) => c.index === i)
  let [from, to] =
    state.pair && valid(state.pair[0]) && valid(state.pair[1])
      ? state.pair
      : [cols[fallback[0]].index, cols[fallback[1]].index]
  const select = (id: string, label: string, value: number, onChange: (v: number) => void) => {
    const s = h(
      'select',
      { id },
      plain.map((c) => h('option', { value: String(c.index), text: c.column.name, selected: c.index === value })),
    )
    s.addEventListener('change', () => {
      onChange(Number(s.value))
      refresh()
      document.getElementById(id)?.focus()
    })
    return h('label', { class: 'field grow' }, h('span', { text: label }), s)
  }
  const a = analysis.columns[from].column
  const b = analysis.columns[to].column
  const result = changes(a, b, analysis)
  return h(
    'section',
    { class: 'panel result-panel wide', id: 'changes' },
    h('h3', { text: 'Improved and dropped most' }),
    h(
      'div',
      { class: 'row-fields' },
      select('compare-from', 'From', from, (v) => (state.pair = [v, to])),
      select('compare-to', 'To', to, (v) => (state.pair = [from, v])),
    ),
    from === to
      ? h('p', { class: 'empty', text: 'Choose two different assessments.' })
      : h(
          'div',
          { class: 'two-lists' },
          h('div', {}, h('h4', { text: 'Improved most' }), changeList(result.improved, 'Nobody improved.')),
          h('div', {}, h('h4', { text: 'Dropped most' }), changeList(result.dropped, 'Nobody dropped.')),
        ),
    from === to
      ? null
      : h('p', {
          class: 'help',
          text: `Change in percentage points, for the ${plural(result.matched, 'learner')} with both marks. ${plural(result.leftOut, 'learner')} with only one of the two left out.`,
        }),
  )
}

function overview(cols: Shown[], analysis: Analysis, width: number, refresh: () => void): HTMLElement {
  const maxCount = Math.max(...cols.map((c) => Math.max(...c.summary.bands.map((b) => b.count))))
  const small = cols.map((c) =>
    h(
      'div',
      { class: 'chart-wrap small' },
      chartSvg(
        bandChart(c.summary, analysis.scheme, {
          width: 300,
          height: 190,
          maxCount,
          compact: true,
          title: c.column.name,
        }),
      ),
    ),
  )
  const plot = boxPlot(
    cols.map((c) => ({ label: c.column.name, summary: c.summary })),
    analysis.passMark,
    { width: Math.max(width, 320), rowHeight: 34 },
  )
  return h(
    'div',
    { class: 'results-grid' },
    h('section', { class: 'panel result-panel wide' }, h('h3', { text: 'Comparison' }), comparisonTable(cols)),
    h(
      'section',
      { class: 'panel result-panel wide' },
      h('h3', { text: 'Learners per band' }),
      h('p', { class: 'help', text: 'Every chart uses the same scale.' }),
      h('div', { class: 'multiples' }, small),
    ),
    panel('Spread of marks', h('div', { class: 'chart-wrap' }, chartSvg(plot))),
    panel('What stands out', insightList(insightsFor(analysis))),
    changesPanel(cols, analysis, refresh),
  )
}

/** Draws the results for the current analysis into `host`. */
export function renderResults(host: HTMLElement, analysis: Analysis, refresh: () => void): void {
  const cols = shown(analysis)
  // Charts are drawn at about the width they will show, so text stays readable on a phone.
  const width = Math.round(
    Math.min(520, Math.max(300, host.clientWidth > 760 ? host.clientWidth / 2 - 40 : host.clientWidth - 34)),
  )
  if (cols.length === 0) {
    const waiting = analysis.columns.some((c) => c.included && !c.column.analysed)
    clear(
      host,
      h('p', {
        class: 'empty panel',
        text: waiting
          ? 'Type what each assessment is out of above to see the results.'
          : 'No marks to analyse yet. Include at least one assessment with marks.',
      }),
    )
    return
  }
  if (cols.length === 1) {
    clear(host, single(cols[0], analysis, width))
    return
  }
  if (state.tab !== 'overview' && !cols.some((c) => c.index === state.tab)) state.tab = 'overview'
  const tabs: { key: 'overview' | number; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    ...cols.map((c) => ({ key: c.index, label: c.column.name })),
  ]
  const tabId = (k: 'overview' | number) => `results-tab-${k}`
  const list = h(
    'div',
    { class: 'tabs', role: 'tablist', 'aria-label': 'Results' },
    tabs.map((t) =>
      h('button', {
        type: 'button',
        role: 'tab',
        id: tabId(t.key),
        'aria-selected': String(state.tab === t.key),
        'aria-controls': 'results-panel',
        tabindex: state.tab === t.key ? '0' : '-1',
        text: t.label,
        onclick: () => {
          state.tab = t.key
          refresh()
          document.getElementById(tabId(t.key))?.focus()
        },
      }),
    ),
  )
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = tabs.findIndex((t) => t.key === state.tab)
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    state.tab = next.key
    refresh()
    document.getElementById(tabId(next.key))?.focus()
  })
  const active = cols.find((c) => c.index === state.tab)
  clear(
    host,
    list,
    h(
      'div',
      { id: 'results-panel', role: 'tabpanel', 'aria-labelledby': tabId(state.tab) },
      active ? single(active, analysis, width) : overview(cols, analysis, width, refresh),
    ),
  )
}
