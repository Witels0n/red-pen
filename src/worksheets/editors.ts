// The editor card for one activity. Typing changes the activity in place and calls `changed`;
// the card is only rebuilt when activities are added, removed or moved.
import { defaultInstructions, type GeneratedActivity } from './core/generate'
import { ACTIVITY_NAMES, type Activity, type LabellingActivity } from './core/model'
import { newSeed } from './core/random'
import { MAX_GRID, MIN_GRID, suggestedGridSize } from './core/wordsearch'
import { lines } from './core/text'
import { PictureError, readPicture } from './picture'

export interface CardHandlers {
  /** The activity changed; `rebuild` asks for its card to be drawn again (for example after Shuffle). */
  changed(a: Activity): void
  move(a: Activity, delta: -1 | 1): void
  remove(a: Activity): void
}

export interface ActivityCard {
  element: HTMLElement
  /** Shows the latest number, marks and warnings without touching what the teacher is typing. */
  update(g: GeneratedActivity, index: number, count: number): void
}

let uid = 0
const nextId = (prefix: string) => `${prefix}-${++uid}`

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  Object.assign(e, props)
  e.append(...children)
  return e
}

function textField(
  label: string,
  value: string,
  onInput: (v: string) => void,
  o: { multiline?: boolean; rows?: number; placeholder?: string; help?: string; maxLength?: number } = {},
): { wrap: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const input = o.multiline
    ? el('textarea', { rows: o.rows ?? 4, value, placeholder: o.placeholder ?? '', spellcheck: true })
    : el('input', { type: 'text', value, placeholder: o.placeholder ?? '' })
  if (o.maxLength) input.maxLength = o.maxLength
  input.addEventListener('input', () => onInput(input.value))
  const wrap = el('label', { className: 'field' }, [el('span', { textContent: label }), input])
  if (o.help) {
    const help = el('p', { className: 'help', id: nextId('help'), textContent: o.help })
    input.setAttribute('aria-describedby', help.id)
    return { wrap: el('div', { className: 'field-group' }, [wrap, help]), input }
  }
  return { wrap, input }
}

function checkField(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = el('input', { type: 'checkbox', checked })
  input.addEventListener('change', () => onChange(input.checked))
  return el('label', { className: 'check' }, [input, ` ${label}`])
}

function selectField(
  label: string,
  options: [string, string][],
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const select = el('select')
  select.append(...options.map(([v, t]) => new Option(t, v)))
  select.value = value
  select.addEventListener('change', () => onChange(select.value))
  return el('label', { className: 'field' }, [el('span', { textContent: label }), select])
}

function iconButton(label: string, symbol: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button', className: 'icon', title: label, textContent: symbol })
  b.setAttribute('aria-label', label)
  b.addEventListener('click', onClick)
  return b
}

const HAS_SHUFFLE = new Set<Activity['type']>([
  'wordsearch',
  'crossword',
  'match',
  'blanks',
  'unscramble',
  'vocabulary',
  'labelling',
])

export function activityCard(a: Activity, h: CardHandlers): ActivityCard {
  const changed = () => h.changed(a)
  const number = el('span', { className: 'activity-number' })
  const marks = el('span', { className: 'marks-badge' })
  const typeName = el('span', { textContent: ACTIVITY_NAMES[a.type] })
  const title = el('h3', {}, [number, typeName])
  const up = iconButton('Move up', '↑', () => h.move(a, -1))
  const down = iconButton('Move down', '↓', () => h.move(a, 1))
  const remove = iconButton(`Remove this ${ACTIVITY_NAMES[a.type].toLowerCase()}`, '✕', () => h.remove(a))
  const tools = el('div', { className: 'activity-tools' }, [up, down, remove])
  if (HAS_SHUFFLE.has(a.type)) {
    const shuffle = el('button', { type: 'button', className: 'small shuffle', textContent: 'Shuffle' })
    shuffle.title = 'Make a new arrangement'
    shuffle.addEventListener('click', () => {
      a.seed = newSeed()
      changed()
    })
    tools.prepend(shuffle)
  }
  const head = el('div', { className: 'activity-head' }, [title, marks, tools])

  const heading = textField('Heading', a.heading, (v) => ((a.heading = v), changed()), {
    placeholder: ACTIVITY_NAMES[a.type],
    maxLength: 100,
  })
  const marksEach = el('input', { type: 'number', min: '0', max: '20', step: '1', value: String(a.marksEach) })
  marksEach.inputMode = 'numeric'
  marksEach.addEventListener('input', () => {
    const n = Math.round(Number(marksEach.value))
    if (!Number.isFinite(n) || marksEach.value === '') return
    a.marksEach = Math.max(0, Math.min(20, n))
    changed()
  })
  const marksField = el('label', { className: 'field marks-field' }, [
    el('span', { textContent: 'Marks each' }),
    marksEach,
  ])
  const instructions = textField('Instructions', a.instructions, (v) => ((a.instructions = v), changed()), {
    multiline: true,
    rows: 2,
  })
  const warnings = el('ul', { className: 'warnings' })
  warnings.setAttribute('role', 'status')

  const body = el('div', { className: 'activity-body' })
  body.append(...typeFields(a, changed))

  const element = el('section', { className: 'panel activity' }, [
    head,
    el('div', { className: 'row' }, [heading.wrap, marksField]),
    instructions.wrap,
    body,
    warnings,
  ])
  element.dataset.id = a.id
  element.dataset.type = a.type
  element.setAttribute('aria-label', ACTIVITY_NAMES[a.type])

  return {
    element,
    update(g, index, count) {
      number.textContent = `${index + 1}. `
      marks.textContent = `[${g.marks}]`
      marks.title = `${g.marks} ${g.marks === 1 ? 'mark' : 'marks'}`
      up.disabled = index === 0
      down.disabled = index === count - 1
      instructions.input.placeholder = defaultInstructions(a)
      warnings.replaceChildren(...g.warnings.map((w) => el('li', { textContent: w })))
      warnings.hidden = g.warnings.length === 0
    },
  }
}

function typeFields(a: Activity, changed: () => void): HTMLElement[] {
  switch (a.type) {
    case 'wordsearch': {
      const sizes: [string, string][] = []
      for (let n = MIN_GRID; n <= MAX_GRID; n++) sizes.push([String(n), `${n} × ${n}`])
      const size = selectField('Grid size', sizes, String(a.size), (v) => {
        a.size = Number(v)
        changed()
      })
      const words = textField(
        'Words',
        a.words,
        (v) => {
          a.words = v
          // Grow the grid to fit a longer word, never shrink it behind the teacher's back.
          const need = suggestedGridSize(lines(v).map((l) => l.text))
          if (need > a.size) {
            a.size = need
            size.querySelector('select')!.value = String(need)
          }
          changed()
        },
        { multiline: true, rows: 6, help: 'One word per line.' },
      )
      const directions = el('fieldset', { className: 'checks' }, [
        el('legend', { textContent: 'Words can go' }),
        checkField('Across', a.across, (v) => ((a.across = v), changed())),
        checkField('Down', a.down, (v) => ((a.down = v), changed())),
        checkField('Diagonally', a.diagonal, (v) => ((a.diagonal = v), changed())),
        checkField('Backwards too', a.backwards, (v) => ((a.backwards = v), changed())),
      ])
      return [
        words.wrap,
        el('div', { className: 'row' }, [size]),
        directions,
        checkField('Lower-case letters', a.lowerCase, (v) => ((a.lowerCase = v), changed())),
      ]
    }
    case 'crossword':
      return [
        textField('Answers and clues', a.clues, (v) => ((a.clues = v), changed()), {
          multiline: true,
          rows: 6,
          help: 'One per line: the answer, a colon, then the clue. For example Sun: The star at the centre of our solar system',
        }).wrap,
        checkField(
          'Show the number of letters after each clue',
          a.showLengths,
          (v) => ((a.showLengths = v), changed()),
        ),
      ]
    case 'match':
      return [
        textField('Pairs', a.pairs, (v) => ((a.pairs = v), changed()), {
          multiline: true,
          rows: 6,
          help: 'One pair per line, split with a colon. For example Herbivore: Eats only plants. Column B is shuffled so no pair lines up.',
        }).wrap,
      ]
    case 'blanks':
      return [
        textField('Text', a.text, (v) => ((a.text = v), changed()), {
          multiline: true,
          rows: 6,
          help: 'Put each missing word in [square brackets], for example The [Sun] is a star.',
        }).wrap,
        checkField('Word bank', a.wordBank, (v) => ((a.wordBank = v), changed())),
      ]
    case 'truefalse':
      return [
        textField('Statements', a.statements, (v) => ((a.statements = v), changed()), {
          multiline: true,
          rows: 6,
          help: 'One per line, starting with T: or F:. For the memo, add the correct version after a |, for example F: The Sun goes around the Earth. | The Earth goes around the Sun.',
        }).wrap,
        checkField(
          'Learners correct the false statements (extra marks each)',
          a.corrections,
          (v) => ((a.corrections = v), changed()),
        ),
      ]
    case 'unscramble':
      return [
        textField('Words', a.words, (v) => ((a.words = v), changed()), {
          multiline: true,
          rows: 6,
          help: 'One word per line. Add a hint after a colon if you like, for example Glacier: A river of ice.',
        }).wrap,
      ]
    case 'vocabulary':
      return [
        textField('Words and meanings', a.terms, (v) => ((a.terms = v), changed()), {
          multiline: true,
          rows: 6,
          help: 'One per line: the word, a colon, then its meaning. Learners write the word next to each meaning.',
        }).wrap,
        checkField('Word bank', a.wordBank, (v) => ((a.wordBank = v), changed())),
      ]
    case 'labelling':
      return labellingFields(a, changed)
  }
}

function labellingFields(a: LabellingActivity, changed: () => void): HTMLElement[] {
  const fileId = nextId('picture')
  const fileInput = el('input', { type: 'file', id: fileId, accept: 'image/*', hidden: true })
  const choose = el('label', { className: 'button', htmlFor: fileId, textContent: 'Choose a picture' })
  choose.tabIndex = 0
  choose.setAttribute('role', 'button')
  choose.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    fileInput.click()
  })
  const error = el('p', { className: 'error', hidden: true })
  error.setAttribute('role', 'alert')
  const empty = el('div', { className: 'diagram-empty' }, [
    choose,
    el('p', {
      className: 'help',
      textContent: 'A diagram or photo from this device. Then tap the picture where each numbered label should point.',
    }),
  ])

  const img = el('img', { alt: 'The picture to label. Tap to add a numbered label.', draggable: false })
  const stage = el('div', { className: 'diagram-stage' }, [img])
  const list = el('ol', { className: 'label-list' })
  const removePicture = el('button', { type: 'button', className: 'small', textContent: 'Remove picture' })
  const replace = el('label', { className: 'button small', htmlFor: fileId, textContent: 'Change picture' })
  const hint = el('p', {
    className: 'help',
    textContent: 'Tap the picture to add a label; drag a number to move it.',
  })
  const set = el('div', { className: 'diagram' }, [
    hint,
    stage,
    list,
    el('div', { className: 'actions' }, [replace, removePicture]),
  ])

  const pins: HTMLButtonElement[] = []

  function placePin(pin: HTMLElement, x: number, y: number) {
    // CSSOM, not a style attribute, so the page's Content Security Policy is happy.
    pin.style.left = `${x * 100}%`
    pin.style.top = `${y * 100}%`
  }

  function render(focusIndex?: number) {
    empty.hidden = !!a.picture
    set.hidden = !a.picture
    if (a.picture && img.src !== a.picture.dataUrl) img.src = a.picture.dataUrl
    // As wide as the card allows, but never taller than 28rem; the pins sit on the picture itself.
    if (a.picture) stage.style.maxWidth = `min(100%, ${(28 * a.picture.width) / a.picture.height}rem)`
    for (const p of pins) p.remove()
    pins.length = 0
    a.labels.forEach((l, i) => {
      const pin = el('button', { type: 'button', className: 'pin', textContent: String(i + 1) })
      pin.setAttribute('aria-label', `Label ${i + 1}${l.answer ? `: ${l.answer}` : ''}. Drag to move.`)
      placePin(pin, l.x, l.y)
      dragPin(pin, i)
      stage.append(pin)
      pins.push(pin)
    })
    list.replaceChildren(
      ...a.labels.map((l, i) => {
        const input = el('input', { type: 'text', value: l.answer, placeholder: 'Answer' })
        input.setAttribute('aria-label', `Label ${i + 1} answer`)
        input.addEventListener('input', () => {
          l.answer = input.value
          pins[i]?.setAttribute('aria-label', `Label ${i + 1}${l.answer ? `: ${l.answer}` : ''}. Drag to move.`)
          changed()
        })
        const del = iconButton(`Remove label ${i + 1}`, '✕', () => {
          a.labels.splice(i, 1)
          render()
          changed()
        })
        if (focusIndex === i) queueMicrotask(() => input.focus())
        return el('li', {}, [el('span', { className: 'label-number', textContent: String(i + 1) }), input, del])
      }),
    )
  }

  function fraction(e: PointerEvent): { x: number; y: number } {
    const r = stage.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }

  function dragPin(pin: HTMLElement, i: number) {
    let moved = false
    pin.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      moved = false
      pin.setPointerCapture(e.pointerId)
    })
    pin.addEventListener('pointermove', (e) => {
      if (!pin.hasPointerCapture(e.pointerId)) return
      const f = fraction(e)
      moved = true
      a.labels[i].x = f.x
      a.labels[i].y = f.y
      placePin(pin, f.x, f.y)
    })
    pin.addEventListener('pointerup', (e) => {
      e.stopPropagation()
      if (moved) changed()
      else list.querySelectorAll('input')[i]?.focus()
    })
  }

  // A tap (not a scroll or a drag) on the picture adds a label there.
  let start: { x: number; y: number; id: number } | null = null
  stage.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY, id: e.pointerId }
  })
  stage.addEventListener('pointerup', (e) => {
    if (!start || start.id !== e.pointerId) return
    const far = Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10
    start = null
    if (far || e.target !== img) return
    const f = fraction(e)
    a.labels.push({ x: f.x, y: f.y, answer: '' })
    render(a.labels.length - 1)
    changed()
  })
  stage.addEventListener('pointercancel', () => (start = null))

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    fileInput.value = ''
    if (!file) return
    error.hidden = true
    try {
      a.picture = await readPicture(file)
      render()
      changed()
    } catch (e) {
      error.textContent = e instanceof PictureError ? e.message : `"${file.name}" could not be opened as a picture.`
      error.hidden = false
    }
  })
  removePicture.addEventListener('click', () => {
    a.picture = null
    a.labels = []
    img.removeAttribute('src')
    render()
    changed()
  })

  render()
  return [fileInput, empty, set, error, checkField('Word bank', a.wordBank, (v) => ((a.wordBank = v), changed()))]
}
