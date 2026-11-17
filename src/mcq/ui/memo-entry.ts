// Keyboard-friendly Memo entry: one small box per question. Type A to E to set the answer and move
// to the next question; Backspace clears; arrow keys move. Used in Build and for Memo correction.
import { letter, optionFromLetter, type Question } from '../core/model'
import { h } from './dom'

export interface MemoEntryOptions {
  questions: readonly Question[]
  onSet(index: number, answer: number | null): void
  /** Label prefix for screen readers, for example "Memo". */
  label?: string
}

export function memoEntry({ questions, onSet, label = 'Memo' }: MemoEntryOptions): HTMLElement {
  const inputs: HTMLInputElement[] = []
  const answers = questions.map((q) => q.answer)
  const grid = h('ol', { class: 'memo-grid', 'aria-label': label })

  const focus = (i: number) => {
    const target = inputs[Math.max(0, Math.min(inputs.length - 1, i))]
    target.focus()
    target.select()
  }

  const set = (i: number, answer: number | null) => {
    const input = inputs[i]
    answers[i] = answer
    input.value = answer === null ? '' : letter(answer)
    input.closest('li')!.classList.toggle('unset', answer === null)
    onSet(i, answer)
  }

  const flashInvalid = (i: number) => {
    const cell = inputs[i].closest('li')!
    cell.classList.remove('invalid')
    void cell.offsetWidth
    cell.classList.add('invalid')
  }

  const type = (i: number, ch: string): boolean => {
    const answer = optionFromLetter(ch)
    if (answer === null || answer >= questions[i].options.length) {
      flashInvalid(i)
      return false
    }
    set(i, answer)
    if (i < inputs.length - 1) focus(i + 1)
    else inputs[i].select()
    return true
  }

  questions.forEach((q, i) => {
    const letters = q.options.map((_, k) => letter(k)).join('')
    const input = h('input', {
      type: 'text',
      class: 'memo-input',
      maxlength: 1,
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      inputmode: 'text',
      'aria-label': `${label}: question ${i + 1}, ${letters[0]} to ${letters[letters.length - 1]}`,
      value: q.answer === null ? '' : letter(q.answer),
    })
    input.addEventListener('focus', () => input.select())
    input.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
        e.preventDefault()
        type(i, e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        if (input.value) set(i, null)
        else if (i > 0) {
          focus(i - 1)
          set(i - 1, null)
        }
      } else if (e.key === 'Delete' || e.key === ' ') {
        e.preventDefault()
        set(i, null)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        focus(i + 1)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        focus(i - 1)
      } else if (e.key === 'Home') {
        e.preventDefault()
        focus(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        focus(inputs.length - 1)
      } else if (e.key.length === 1) {
        e.preventDefault()
        flashInvalid(i)
      }
    })
    // Phone keyboards may not send usable key events: take whatever was typed.
    input.addEventListener('input', () => {
      const ch = input.value.slice(-1)
      const current = answers[i]
      if (!ch) set(i, null)
      else if (!type(i, ch)) input.value = current === null ? '' : letter(current)
    })
    inputs.push(input)
    grid.append(
      h(
        'li',
        { class: `memo-cell${q.answer === null ? ' unset' : ''}` },
        h('span', { class: 'memo-no', 'aria-hidden': 'true', text: String(i + 1) }),
        input,
      ),
    )
  })
  return grid
}
