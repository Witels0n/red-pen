import { FORMS, J1_DECISIONS, J1_LEAD, J1_NOTE, J1_QUESTION, J1_SECTIONS, commentKey } from './core/forms'
import { choice, el, field, marked, panel, startFormPage } from './page'
import { buildJ1 } from './pdf/j1'

startFormPage({
  form: FORMS.j1,
  toolName: 'J1 Pre-moderation',
  build: buildJ1,
  fileParts: (v) => [v.subject, v.ref],
  render(root) {
    root.append(
      panel(
        'Task and school',
        el(
          'div',
          { className: 'grid-2' },
          field('Name of centre or school', 'school'),
          field('District', 'district'),
          field('Subject', 'subject'),
          field('Name of DH or Subject Specialist', 'specialist'),
        ),
        field('Task, for your own records (not printed on the form)', 'ref', {
          placeholder: 'Grade 10 Term 2 test',
        }),
        el('p', { className: 'help' }, J1_NOTE),
      ),
      ...J1_SECTIONS.map((section, s) =>
        panel(
          section.title,
          ...(s === 0 ? [el('p', { className: 'help' }, J1_LEAD)] : []),
          el(
            'ol',
            { className: 'criteria' },
            ...section.rows.map((row, i) =>
              el(
                'li',
                {},
                field(el('span', {}, row.no ? el('b', {}, `${row.no} `) : '', marked(row.text)), commentKey(s, i), {
                  type: 'textarea',
                  placeholder: 'Comment',
                }),
              ),
            ),
          ),
        ),
      ),
      panel(
        'Decision',
        choice(J1_QUESTION, 'meets', [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ]),
        field('Date of resubmission', 'resubmission', { type: 'date', className: 'narrow' }),
        choice(
          'The task is',
          'decision',
          J1_DECISIONS.map((d) => ({ value: d.id, label: d.word.charAt(0).toUpperCase() + d.word.slice(1) })),
        ),
        el(
          'div',
          { className: 'grid-2' },
          field('Name of moderator', 'moderator'),
          field('Date', 'date', { type: 'date' }),
        ),
        el('p', { className: 'help' }, 'The signature line is left empty, to sign by hand or with Sign a PDF.'),
      ),
    )
  },
})
