// Results: class summary, marksheet (sortable, XLSX and CSV), class heatmap, item analysis,
// Topics, and Memo correction that re-marks instantly from the stored reads.
import { classSummary, itemAnalysis, topicSummaries, type ItemStats } from '../core/analysis'
import type { LearnerMark } from '../core/marking'
import {
  flagText,
  itemAnalysisTable,
  marksheetCsv,
  marksheetRows,
  marksheetTable,
  type MarksheetRow,
} from '../core/marksheet'
import { formatNumber, letter, topicsOf, withQuestion } from '../core/model'
import { safeFileName } from '../core/questions-csv'
import { writeXlsx } from '../xlsx'
import { busy, clear, download, h, MIME, plural } from './dom'
import { memoEntry } from './memo-entry'
import { update, workspace, type ChangeInfo } from './state'

const ORIGIN = 'results'

type SortKey = 'name' | 'id' | 'version' | 'score' | `q${number}` | `t${number}`
let sort: { key: SortKey; dir: 1 | -1 } = { key: 'name', dir: 1 }

function pct(f: number | null): string {
  return f === null ? '-' : `${Math.round(f * 100)}%`
}

function displayName(r: Pick<MarksheetRow, 'name' | 'learnerId'>): string {
  return r.name || `Learner ID ${r.learnerId}`
}

function sortRows(rows: MarksheetRow[]): MarksheetRow[] {
  const value = (r: MarksheetRow): string | number => {
    const k = sort.key
    if (k === 'name') return displayName(r).toLowerCase()
    if (k === 'id') return r.learnerId
    if (k === 'version') return r.version
    if (k === 'score') return r.outOf ? r.score / r.outOf : 0
    if (k.startsWith('q')) return r.questions[Number(k.slice(1))]
    return r.topics[Number(k.slice(1))] ?? -1
  }
  return rows.slice().sort((x, y) => {
    const a = value(x)
    const b = value(y)
    const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
    return c * sort.dir || x.learnerId.localeCompare(y.learnerId)
  })
}

function rowsNow(): MarksheetRow[] {
  const { assessment: a, marks, names } = workspace()
  return marksheetRows(a, marks, names)
}

function summaryPanel(): HTMLElement {
  const { marks, collation, assessment: a } = workspace()
  const s = classSummary(marks)
  const tile = (label: string, value: string) =>
    h(
      'div',
      { class: 'tile' },
      h('span', { class: 'tile-value', text: value }),
      h('span', { class: 'tile-label', text: label }),
    )
  const left = collation.review.length
  return h(
    'section',
    { class: 'panel', 'aria-labelledby': 'summary-title' },
    h('h2', { id: 'summary-title', text: 'Class' }),
    h(
      'div',
      { class: 'tiles' },
      tile('learners', String(s.learners)),
      tile('average', pct(s.mean)),
      tile('median', pct(s.median)),
      tile('highest', pct(s.highest)),
      tile('lowest', pct(s.lowest)),
    ),
    left
      ? h(
          'p',
          { class: 'warning' },
          `${plural(left, 'item')} still to review: until then the reads are counted as read. `,
          h('a', { href: `#a/${encodeURIComponent(a.id)}/review`, text: 'Review now' }),
        )
      : null,
  )
}

function downloads(): HTMLElement {
  const status = h('p', { class: 'status', role: 'status', hidden: true })
  const xlsx = h('button', {
    type: 'button',
    class: 'primary',
    text: 'Download marksheet (Excel)',
    id: 'download-xlsx',
  })
  xlsx.addEventListener('click', () =>
    busy(xlsx, 'Making the file...', status, async () => {
      const { assessment: a, marks } = workspace()
      const rows = sortRows(rowsNow())
      const bytes = await writeXlsx([
        {
          name: 'Marksheet',
          rows: marksheetTable(a, rows),
          widths: [11, 26, 8, 7, 7, 11, ...a.questions.map(() => 5), ...topicsOf(a.questions).map(() => 12), 22],
        },
        {
          name: 'Item analysis',
          rows: itemAnalysisTable(a, itemAnalysis(a, marks)),
          widths: [9, 18, 7, 10, 5, 5, 5, 5, 5, 7, 9, 10, 40, 13, 24],
        },
      ])
      download(bytes, `${safeFileName(a.title)} marksheet.xlsx`, MIME.xlsx)
    }),
  )
  const csv = h('button', {
    type: 'button',
    text: 'Download marksheet (CSV)',
    id: 'download-csv',
    onclick: () => {
      const { assessment: a } = workspace()
      download(marksheetCsv(a, sortRows(rowsNow())), `${safeFileName(a.title)} marksheet.csv`, MIME.csv)
    },
  })
  return h('div', { class: 'toolbar results-downloads' }, xlsx, csv, status)
}

function memoPanel(): HTMLElement {
  const { assessment: a } = workspace()
  return h(
    'details',
    { class: 'panel memo-correction' },
    h(
      'summary',
      {},
      h('span', { class: 'summary-title', text: 'Correct the Memo' }),
      h('span', { class: 'meta', text: ' Everything re-marks at once from the saved reads, with no rescan.' }),
    ),
    h('p', {
      class: 'help',
      text: 'The letters are the original order (Version A). Type a letter to change an answer.',
    }),
    memoEntry({
      questions: a.questions,
      label: 'Memo correction',
      onSet: (i, answer) => {
        update((x) => withQuestion(x, i, { answer }), { origin: ORIGIN })
        renderOutputs()
      },
    }),
  )
}

function sortButton(label: string, key: SortKey, cls = ''): HTMLTableCellElement {
  const active = sort.key === key
  return h(
    'th',
    {
      scope: 'col',
      class: cls,
      'data-sort': key,
      'aria-sort': active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined,
    },
    h('button', {
      type: 'button',
      class: 'sort',
      text: label,
      onclick: () => {
        sort = {
          key,
          dir: active ? (sort.dir === 1 ? -1 : 1) : key === 'name' || key === 'id' || key === 'version' ? 1 : -1,
        }
        renderOutputs()
        root?.querySelector<HTMLElement>(`[data-sort="${key}"] button`)?.focus()
      },
    }),
  )
}

function marksheet(rows: MarksheetRow[]): HTMLElement {
  const { assessment: a } = workspace()
  const topics = topicsOf(a.questions)
  const head = h(
    'tr',
    {},
    sortButton('Learner', 'name', 'sticky-col'),
    sortButton('ID', 'id'),
    a.versions.count > 1 ? sortButton('Version', 'version') : null,
    sortButton('Total', 'score', 'num'),
    h('th', { scope: 'col', class: 'num', text: '%' }),
    a.questions.map((_, i) => sortButton(`Q${i + 1}`, `q${i}`, 'num q')),
    topics.map((t, i) => sortButton(t, `t${i}`, 'num topic')),
  )
  const body = sortRows(rows).map((r) =>
    h(
      'tr',
      {},
      h('th', { scope: 'row', class: 'sticky-col', text: displayName(r) }),
      h('td', { class: 'id', text: r.learnerId }),
      a.versions.count > 1 ? h('td', { text: r.version }) : null,
      h('td', { class: 'num strong', text: `${formatNumber(r.score)} / ${formatNumber(r.outOf)}` }),
      h('td', { class: 'num strong', text: `${r.percent}%` }),
      r.questions.map((m, i) =>
        h('td', { class: `num q ${r.outcomes[i]}`, text: r.outcomes[i] === 'unmarked' ? '' : formatNumber(m) }),
      ),
      r.topics.map((t) =>
        h('td', { class: `num topic${t !== null && t < 50 ? ' low' : ''}`, text: t === null ? '-' : `${t}%` }),
      ),
    ),
  )
  return h(
    'section',
    { class: 'panel', id: 'marksheet', 'aria-labelledby': 'marksheet-title' },
    h('h2', { id: 'marksheet-title', text: 'Marksheet' }),
    downloads(),
    rows.some((r) => r.note)
      ? h('p', {
          class: 'help',
          text: rows
            .filter((r) => r.note)
            .map((r) => `${displayName(r)}: ${r.note}.`)
            .join(' '),
        })
      : null,
    h(
      'div',
      { class: 'table-wrap scroll-x' },
      h(
        'table',
        { class: 'data-table marksheet', id: 'marksheet-table' },
        h('caption', { class: 'visually-hidden', text: 'Marksheet. Select a column heading to sort.' }),
        h('thead', {}, head),
        h('tbody', {}, body),
      ),
    ),
  )
}

const SYMBOL = { correct: '✓', blank: '○', multiple: 'M', missing: '·', unmarked: '' } as const

function heatmap(marks: LearnerMark[], stats: ItemStats[]): HTMLElement {
  const { assessment: a, names } = workspace()
  const sorted = marks.slice().sort((x, y) => y.fraction - x.fraction || x.learnerId.localeCompare(y.learnerId))
  const head = h(
    'tr',
    {},
    h('th', { scope: 'col', class: 'sticky-col', text: 'Learner' }),
    a.questions.map((_, i) =>
      h(
        'th',
        { scope: 'col', class: 'q' },
        h('span', { text: `Q${i + 1}` }),
        h('span', { class: 'col-pct', text: pct(stats[i].pCorrect) }),
      ),
    ),
  )
  const body = sorted.map((m) =>
    h(
      'tr',
      {},
      h(
        'th',
        { scope: 'row', class: 'sticky-col' },
        displayName({ name: names.get(m.learnerId) ?? '', learnerId: m.learnerId }),
        h('span', { class: 'meta', text: ` ${Math.round(m.fraction * 100)}%` }),
      ),
      m.perQuestion.map((q, i) => {
        const text = q.outcome === 'wrong' ? letter(q.response as number) : SYMBOL[q.outcome]
        const words = q.outcome === 'wrong' ? `wrong, chose ${text}` : q.outcome
        return h('td', {
          class: `cell ${q.outcome}`,
          title: `Q${i + 1}: ${words}`,
          'aria-label': `Q${i + 1} ${words}`,
          text,
        })
      }),
    ),
  )
  return h(
    'section',
    { class: 'panel', id: 'heatmap', 'aria-labelledby': 'heatmap-title' },
    h('h2', { id: 'heatmap-title', text: 'Class heatmap' }),
    h(
      'ul',
      { class: 'legend' },
      h('li', {}, h('span', { class: 'cell correct', text: '✓' }), ' correct'),
      h('li', {}, h('span', { class: 'cell wrong', text: 'B' }), ' wrong (the letter chosen)'),
      h('li', {}, h('span', { class: 'cell blank', text: '○' }), ' blank'),
      h('li', {}, h('span', { class: 'cell multiple', text: 'M' }), ' more than one'),
      h('li', {}, h('span', { class: 'cell missing', text: '·' }), ' page not scanned'),
    ),
    h('p', {
      class: 'help',
      text: 'Learners from highest to lowest. Letters are the original order (Version A). The percentage under each question is the class correct.',
    }),
    h(
      'div',
      { class: 'table-wrap scroll-x' },
      h(
        'table',
        { class: 'heatmap' },
        h('caption', { class: 'visually-hidden', text: 'Class heatmap: learners by questions' }),
        h('thead', {}, head),
        h('tbody', {}, body),
      ),
    ),
  )
}

function bar(f: number | null, cls = ''): HTMLElement {
  const outer = h('span', { class: `bar ${cls}`, 'aria-hidden': 'true' })
  const inner = h('span', { class: 'bar-fill' })
  inner.style.width = `${Math.round((f ?? 0) * 100)}%`
  outer.append(inner)
  return outer
}

function itemPanel(stats: ItemStats[]): HTMLElement {
  const { assessment: a } = workspace()
  const flagged = stats.filter((s) => s.flags.length).length
  const rows = stats.map((s) => {
    const q = a.questions[s.question]
    const total = Math.max(1, s.answered)
    const dist = h(
      'span',
      { class: 'dist' },
      q.options.map((_, k) => {
        const d = h(
          'span',
          { class: `dist-item${k === q.answer ? ' memo' : ''}`, title: `${letter(k)}: ${s.counts[k]}` },
          h('span', { class: 'dist-letter', text: letter(k) }),
          bar(s.counts[k] / total, k === q.answer ? 'good' : ''),
          h('span', { class: 'dist-count', text: String(s.counts[k]) }),
        )
        return d
      }),
      s.blank ? h('span', { class: 'dist-extra', text: `${s.blank} blank` }) : null,
      s.multiple ? h('span', { class: 'dist-extra', text: `${s.multiple} more than one` }) : null,
    )
    return h(
      'tr',
      { class: s.flags.length ? 'flagged' : '' },
      h('th', { scope: 'row', text: `Q${s.question + 1}` }),
      h('td', { text: q.topic || '-' }),
      h('td', { class: 'strong', text: q.answer === null ? '-' : letter(q.answer) }),
      h(
        'td',
        { class: 'pct-cell' },
        bar(s.pCorrect, s.pCorrect !== null && s.pCorrect < 0.3 ? 'bad' : 'good'),
        h('span', { text: pct(s.pCorrect) }),
      ),
      h('td', {}, dist),
      h(
        'td',
        { class: 'wrong-cell' },
        s.topWrong ? h('strong', { text: `${letter(s.topWrong.option)} (${s.topWrong.count})` }) : '-',
        s.topWrong?.misconception ? h('span', { class: 'misconception', text: s.topWrong.misconception }) : null,
      ),
      h('td', { class: 'num', text: s.discrimination === null ? '-' : s.discrimination.toFixed(2) }),
      h(
        'td',
        {},
        s.flags.map((f) => h('span', { class: `chip ${f === 'too-easy' ? 'info' : 'warn'}`, text: flagText(f) })),
      ),
    )
  })
  return h(
    'section',
    { class: 'panel', id: 'item-analysis', 'aria-labelledby': 'items-title' },
    h('h2', { id: 'items-title', text: 'Item analysis' }),
    h('p', {
      class: 'help',
      text: `${flagged ? `${plural(flagged, 'question')} flagged. ` : ''}Too easy: over 90% correct. Too hard: under 30%. "Top third did worse": the strongest third of the class (by total) got it right less often than the weakest third, which usually means the question or the Memo needs a second look. Discrimination is the share correct in the top third minus the bottom third.`,
    }),
    h(
      'div',
      { class: 'table-wrap scroll-x' },
      h(
        'table',
        { class: 'data-table items' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            [
              'Question',
              'Topic',
              'Memo',
              'Correct',
              'Answers chosen',
              'Most chosen wrong',
              'Discrimination',
              'Flags',
            ].map((t) => h('th', { scope: 'col', text: t })),
          ),
        ),
        h('tbody', {}, rows),
      ),
    ),
  )
}

function topicsPanel(marks: LearnerMark[]): HTMLElement | null {
  const { assessment: a, names } = workspace()
  const topics = topicSummaries(a, marks)
  if (topics.length === 0) return null
  const who = (id: string) => names.get(id) ?? `Learner ID ${id}`
  return h(
    'section',
    { class: 'panel', id: 'topics', 'aria-labelledby': 'topics-title' },
    h('h2', { id: 'topics-title', text: 'Topics' }),
    h('p', {
      class: 'help',
      text: "The class share of the marks per Topic, and the learners under 50% in it. Each learner's Topic percentages are in the marksheet.",
    }),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'data-table topics' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ['Topic', 'Questions', 'Class', 'Learners to revise'].map((t) => h('th', { scope: 'col', text: t })),
          ),
        ),
        h(
          'tbody',
          {},
          topics.map((t) =>
            h(
              'tr',
              {},
              h('th', { scope: 'row', text: t.topic }),
              h('td', { text: t.questions.map((q) => q + 1).join(', ') }),
              h(
                'td',
                { class: 'pct-cell' },
                bar(t.classFraction, t.classFraction !== null && t.classFraction < 0.5 ? 'bad' : 'good'),
                h('span', { text: pct(t.classFraction) }),
              ),
              h('td', { text: t.learnersToRevise.length ? t.learnersToRevise.map(who).join(', ') : 'None' }),
            ),
          ),
        ),
      ),
    ),
  )
}

let root: HTMLElement | null = null

function renderOutputs(): void {
  const host = root?.querySelector<HTMLElement>('#results-outputs')
  if (!host) return
  const { assessment: a, marks } = workspace()
  const stats = itemAnalysis(a, marks)
  clear(host, summaryPanel(), marksheet(rowsNow()), heatmap(marks, stats), itemPanel(stats), topicsPanel(marks))
}

function render(target: HTMLElement): void {
  root = target
  const { marks, assessment: a } = workspace()
  if (marks.length === 0) {
    clear(
      target,
      h(
        'section',
        { class: 'panel' },
        h('h2', { text: 'Results' }),
        h(
          'p',
          { class: 'empty' },
          'No marked sheets yet. ',
          h('a', { href: `#a/${encodeURIComponent(a.id)}/mark`, text: 'Scan the answer sheets' }),
          ' first.',
        ),
      ),
    )
    return
  }
  clear(
    target,
    h(
      'nav',
      { class: 'jump', 'aria-label': 'Results sections' },
      [
        ['Marksheet', 'marksheet'],
        ['Heatmap', 'heatmap'],
        ['Item analysis', 'item-analysis'],
        ['Topics', 'topics'],
      ].map(([label, id]) =>
        h('a', {
          href: `#a/${encodeURIComponent(a.id)}/results`,
          text: label,
          onclick: (e: Event) => {
            e.preventDefault()
            document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          },
        }),
      ),
    ),
    memoPanel(),
    h('div', { id: 'results-outputs' }),
  )
  renderOutputs()
}

export const resultsStep = {
  show: render,
  refresh(target: HTMLElement, _info: ChangeInfo) {
    render(target)
  },
}
