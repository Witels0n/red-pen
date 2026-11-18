import {
  FORMS,
  J2_LEARNERS_LINE,
  J2_LEVELS,
  J2_MODERATORS,
  J2_OVERALL,
  J2_POOR_AFTER,
  J2_POOR_COLUMNS,
  J2_POOR_ROWS,
  J2_POOR_TITLE,
  J2_SECTIONS,
  J3_LEARNERS,
  commentKey,
} from './core/forms'
import { choice, el, field, marked, panel, startFormPage } from './page'
import { buildJ2 } from './pdf/j2'

function poorTable(): HTMLElement {
  const head = el('tr', {}, ...J2_POOR_COLUMNS.map((c) => el('th', { scope: 'col' }, c.head)))
  const rows = Array.from({ length: J2_POOR_ROWS }, (_, r) =>
    el(
      'tr',
      {},
      ...J2_POOR_COLUMNS.map((c) =>
        el(
          'td',
          {},
          field(`${c.head}, row ${r + 1}`, `p${r + 1}.${c.key}`, {
            type: c.key === 'q' ? 'text' : 'textarea',
            quiet: true,
            maxLength: c.key === 'q' ? 30 : 300,
          }),
        ),
      ),
    ),
  )
  return panel(
    'Poorly answered questions',
    el('p', { className: 'help' }, J2_POOR_TITLE),
    el(
      'div',
      { className: 'sheet-scroll', tabIndex: 0 },
      el('table', { className: 'entry-table' }, el('thead', {}, head), el('tbody', {}, ...rows)),
    ),
    el('p', { className: 'help' }, 'Rows you leave empty are not printed, beyond the five the form always has.'),
  )
}

startFormPage({
  form: FORMS.j2,
  toolName: 'J2 Post-moderation',
  build: buildJ2,
  fileParts: (v) => [v.subject, v.grade ? `Grade ${v.grade}` : '', v.task],
  render(root) {
    const sections = J2_SECTIONS.flatMap((section, s) => {
      const block = panel(
        section.title,
        ...(s === 0 ? [el('p', { className: 'help' }, 'Comment on each quality indicator in a full sentence.')] : []),
        el(
          'ol',
          { className: 'criteria' },
          ...section.rows.map((row, i) =>
            el(
              'li',
              {},
              field(el('span', {}, el('b', {}, `${row.no} `), marked(row.text)), commentKey(s, i), {
                type: 'textarea',
                placeholder: 'Comment',
              }),
            ),
          ),
        ),
      )
      return s === J2_POOR_AFTER ? [block, poorTable()] : [block]
    })
    root.append(
      panel(
        'Task and school',
        el(
          'div',
          { className: 'grid-2' },
          field('Name of school', 'school'),
          field('District', 'district'),
          field('Subject', 'subject'),
          field('Grade', 'grade', { maxLength: 20 }),
          field('Task moderated', 'task'),
          field('Name of moderator', 'moderator'),
        ),
      ),
      ...sections,
      panel(
        'Overall impression by the moderator',
        el(
          'div',
          { className: 'grid-3' },
          ...J2_OVERALL.map((c) => field(c.head, c.key, { type: 'textarea', rows: 5, maxLength: 700 })),
        ),
      ),
      panel(
        'Learners whose files were moderated',
        el('p', { className: 'help' }, J2_LEARNERS_LINE),
        choice(
          'Moderated at',
          'level',
          J2_LEVELS.map((l) => ({ value: l, label: l.charAt(0).toUpperCase() + l.slice(1) })),
        ),
        el(
          'div',
          { className: 'grid-2' },
          ...Array.from({ length: J3_LEARNERS }, (_, i) => field(`Learner ${i + 1}`, `l${i + 1}`)),
        ),
      ),
      panel(
        'Moderators',
        ...J2_MODERATORS.map((m) =>
          el(
            'div',
            { className: 'grid-2' },
            field(`${m.label}: name`, `${m.key}.name`),
            field('Date', `${m.key}.date`, { type: 'date' }),
          ),
        ),
        el('p', { className: 'help' }, 'The signature boxes are left empty, to sign by hand or with Sign a PDF.'),
      ),
    )
  },
})
