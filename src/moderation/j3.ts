import { FORMS, J3_FOOTNOTE, J3_LEARNERS, J3_MODERATIONS, ORDINALS, type Values } from './core/forms'
import { el, field, panel, startFormPage } from './page'
import { buildJ3 } from './pdf/j3'

function moderation(m: number): HTMLElement {
  const key = (name: string) => `m${m}.${name}`
  const rows = Array.from({ length: J3_LEARNERS }, (_, i) =>
    el(
      'tr',
      {},
      el('th', { scope: 'row' }, String(i + 1)),
      el('td', {}, field(`Learner ${i + 1}`, key(`l${i + 1}`), { quiet: true, maxLength: 60 })),
      el('td', {}, field(`Teacher's mark, learner ${i + 1}`, key(`t${i + 1}`), { quiet: true, maxLength: 8 })),
      el('td', {}, field(`HOD's mark, learner ${i + 1}`, key(`h${i + 1}`), { quiet: true, maxLength: 8 })),
    ),
  )
  const block = el(
    'details',
    { className: 'moderation', open: m === 1 },
    el('summary', {}, `${m}${ORDINALS[m - 1]!.toLowerCase()} moderation`),
    el(
      'div',
      { className: 'grid-2' },
      field('Task moderated', key('task'), { maxLength: 40 }),
      field('Date of moderation', key('date'), { type: 'date' }),
      field('Date of pre-moderation of the task', key('premod'), { type: 'date' }),
      field('Correctness of record sheet', key('record'), { maxLength: 110 }),
    ),
    field('Pre-moderation comments', key('comments'), { type: 'textarea', maxLength: 200 }),
    el(
      'table',
      { className: 'entry-table marks' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { scope: 'col' }, 'No.'),
          el('th', { scope: 'col' }, 'Name of learner'),
          el('th', { scope: 'col' }, 'Teacher'),
          el('th', { scope: 'col' }, 'HOD'),
        ),
      ),
      el('tbody', {}, ...rows),
    ),
  )
  return block
}

startFormPage({
  form: FORMS.j3,
  toolName: 'J3 Evidence of moderation',
  build: buildJ3,
  fileParts: (v) => [v.subject, v.grade ? `Grade ${v.grade}` : '', v.year],
  render(root, page) {
    const copy = el('button', { type: 'button', textContent: "Use the 1st moderation's learners for every task" })
    copy.addEventListener('click', () => {
      const values = page.values()
      const changes: Values = {}
      for (let m = 2; m <= J3_MODERATIONS; m++) {
        for (let l = 1; l <= J3_LEARNERS; l++) changes[`m${m}.l${l}`] = values[`m1.l${l}`] ?? ''
      }
      page.set(changes)
    })
    root.append(
      panel(
        'Subject and school',
        el(
          'div',
          { className: 'grid-2' },
          field('Subject', 'subject'),
          field('Grade', 'grade', { maxLength: 20, placeholder: '12' }),
          field('Name of teacher', 'teacher'),
          field('Name of school', 'school'),
          field('Name of lead or senior teacher, or HOD', 'hod'),
          field('Year', 'year', { maxLength: 4, placeholder: String(new Date().getFullYear()) }),
        ),
      ),
      panel(
        'Moderations',
        el(
          'p',
          { className: 'help' },
          'One block per SBA task, up to six. Leave the ones you have not done yet empty.',
        ),
        ...Array.from({ length: J3_MODERATIONS }, (_, i) => moderation(i + 1)),
        el('div', { className: 'actions' }, copy),
        el('p', { className: 'help' }, J3_FOOTNOTE.replace(/^\*\* /, '')),
      ),
    )
  },
})
