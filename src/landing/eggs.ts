import { quoteDealer } from './quotes'

/**
 * Little surprises on the landing page. None of them carries information anyone needs, so each
 * one quietly does nothing if its markup is missing.
 */

const PERSISTENCE_CLICKS = 10

function calmMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Hover, focus or tap the 10/10 for a line from a scholar of teaching. Click for another. */
function startScore(): void {
  const score = document.getElementById('score')
  const note = document.getElementById('score-note')
  const text = note?.querySelector('blockquote')
  const credit = note?.querySelector('figcaption')
  if (!score || !note || !text || !credit) return

  const deal = quoteDealer()
  let clicks = 0

  const write = (): void => {
    const quote = deal()
    text.textContent = quote.text
    credit.textContent = `${quote.who}, ${quote.source}`
  }
  const show = (): void => {
    if (!note.hidden) return
    write()
    note.hidden = false
    score.setAttribute('aria-expanded', 'true')
  }
  const hide = (): void => {
    note.hidden = true
    score.setAttribute('aria-expanded', 'false')
  }

  score.addEventListener('mouseenter', show)
  score.addEventListener('mouseleave', () => {
    if (document.activeElement !== score) hide()
  })
  score.addEventListener('focus', show)
  score.addEventListener('blur', hide)
  score.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide()
  })
  document.addEventListener('pointerdown', (event) => {
    if (!score.contains(event.target as Node)) hide()
  })

  score.addEventListener('click', () => {
    clicks++
    if (clicks === PERSISTENCE_CLICKS) {
      text.textContent = 'Ten out of ten for persistence.'
      credit.textContent = 'Red Pen'
      burstTicks(score)
    } else {
      write()
    }
    note.hidden = false
    score.setAttribute('aria-expanded', 'true')
    if (!calmMotion()) {
      // Stamp it again.
      score.animate(
        [
          { transform: 'scale(1.35) rotate(-6deg)' },
          { transform: 'scale(0.96) rotate(9deg)', offset: 0.7 },
          { transform: 'scale(1) rotate(8deg)' },
        ],
        { duration: 320, easing: 'ease-out' },
      )
    }
  })
}

/** A handful of red ticks fly out of the stamp. */
function burstTicks(from: HTMLElement): void {
  if (calmMotion()) return
  const box = from.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  const count = 16
  for (let i = 0; i < count; i++) {
    const tick = document.createElement('span')
    tick.className = 'burst-tick handwritten'
    tick.textContent = '✓'
    tick.setAttribute('aria-hidden', 'true')
    document.body.append(tick)
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4
    const reach = 110 + Math.random() * 120
    const dx = Math.cos(angle) * reach
    const dy = Math.sin(angle) * reach
    const spin = Math.round(Math.random() * 80 - 40)
    tick
      .animate(
        [
          { transform: `translate(${x}px, ${y}px) scale(0.4)`, opacity: 1 },
          { transform: `translate(${x + dx}px, ${y + dy}px) scale(1.2) rotate(${spin}deg)`, opacity: 1, offset: 0.7 },
          { transform: `translate(${x + dx * 1.1}px, ${y + dy * 1.1 + 40}px) scale(1) rotate(${spin}deg)`, opacity: 0 },
        ],
        { duration: 900 + Math.random() * 400, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
      )
      .finished.finally(() => tick.remove())
  }
}

/** The privacy section dares you to switch off the Wi-Fi. Do it and the page notices. */
function startOfflineNote(): void {
  const note = document.getElementById('offline-note')
  if (!note) return
  const update = (): void => {
    note.hidden = navigator.onLine
  }
  addEventListener('offline', update)
  addEventListener('online', update)
  update()
}

/** Teachers mark at unreasonable hours. Between 22:00 and 04:00 the page says so. */
function startNightNote(now: Date = new Date()): void {
  const note = document.getElementById('night-note')
  if (!note) return
  const hour = now.getHours()
  note.hidden = !(hour >= 22 || hour < 4)
}

export function startEggs(): void {
  startScore()
  startOfflineNote()
  startNightNote()
}
