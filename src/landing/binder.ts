/**
 * The landing page's dividers, turned into a ring binder you flip through by its tabs.
 *
 * In the HTML every divider is a section with its own tab, one under another, so the page still
 * works (and every tool link is still there) without JavaScript. This gathers the tabs into one
 * row across the top and shows a single divider at a time, as a tablist.
 */

const HINT_SEEN_KEY = 'red-pen:binder-hint-seen'

function calmMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function rememberHintSeen(): void {
  try {
    localStorage.setItem(HINT_SEEN_KEY, '1')
  } catch {
    // Private windows may refuse storage; the hint simply shows again next time.
  }
}

export function startBinder(): void {
  const binder = document.getElementById('binder')
  const tablist = document.getElementById('binder-tabs')
  const hint = document.getElementById('tab-hint')
  if (!binder || !tablist) return

  const dividers = [...binder.querySelectorAll<HTMLElement>('.divider[id]')]
  if (dividers.length === 0) return

  const tabs = dividers.map((divider, i) => {
    const label = divider.querySelector('.tab')?.textContent?.trim() ?? divider.id
    const colour = [...divider.classList].find((c) => c.startsWith('tab-')) ?? ''
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.id = `tab-for-${divider.id}`
    tab.className = `binder-tab ${colour}`
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-controls', divider.id)
    tab.style.setProperty('--n', String(i))
    const slip = document.createElement('span')
    slip.textContent = label
    tab.append(slip)
    tablist.append(tab)

    divider.setAttribute('role', 'tabpanel')
    if (!divider.hasAttribute('aria-labelledby')) divider.setAttribute('aria-labelledby', tab.id)
    return tab
  })

  // A note at the foot of each divider, so the next one is a click away after reading to the end.
  dividers.forEach((divider, i) => {
    const next = (i + 1) % dividers.length
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `next-divider handwritten ${tabs[next].classList[1] ?? ''}`
    button.textContent = next === 0 ? `Back to ${tabs[0].textContent} ↺` : `Next: ${tabs[next].textContent} →`
    button.addEventListener('click', () => select(next, { focus: true, scroll: true }))
    divider.append(button)
  })

  let current = -1

  function select(index: number, opts: { focus?: boolean; scroll?: boolean; animate?: boolean } = {}): void {
    if (index === current) return
    const previous = current
    current = index
    tabs.forEach((tab, i) => {
      const on = i === index
      tab.setAttribute('aria-selected', String(on))
      tab.tabIndex = on ? 0 : -1
      dividers[i].hidden = !on
    })
    const divider = dividers[index]
    if (opts.animate !== false && previous !== -1 && !calmMotion()) {
      divider.classList.remove('is-flipping', 'is-flipping-back')
      void divider.offsetWidth // restart the animation
      divider.classList.add(index > previous ? 'is-flipping' : 'is-flipping-back')
    }
    if (previous !== -1) history.replaceState(null, '', `#${divider.id}`)
    if (opts.focus) tabs[index].focus({ preventScroll: true })
    if (opts.scroll && binder!.getBoundingClientRect().top < 0) {
      binder!.scrollIntoView({ block: 'start', behavior: calmMotion() ? 'auto' : 'smooth' })
    }
  }

  function dismissHint(): void {
    if (!hint || hint.hidden) return
    hint.hidden = true
    rememberHintSeen()
  }

  tablist.addEventListener('click', (event) => {
    const tab = (event.target as Element).closest('.binder-tab')
    if (!tab) return
    select(tabs.indexOf(tab as HTMLButtonElement))
    dismissHint()
  })

  tablist.addEventListener('keydown', (event) => {
    const last = tabs.length - 1
    const moves: Record<string, number> = {
      ArrowRight: current === last ? 0 : current + 1,
      ArrowLeft: current === 0 ? last : current - 1,
      Home: 0,
      End: last,
    }
    if (!(event.key in moves)) return
    event.preventDefault()
    select(moves[event.key], { focus: true })
    dismissHint()
  })

  const fromHash = (): number => dividers.findIndex((d) => `#${d.id}` === location.hash)
  window.addEventListener('hashchange', () => {
    const i = fromHash()
    if (i !== -1) select(i, { scroll: true })
  })

  binder.classList.add('is-tabbed')
  tablist.hidden = false
  const start = fromHash()
  select(Math.max(0, start), { animate: false })
  if (start !== -1) binder.scrollIntoView({ block: 'start' })
  if (hint && !hintSeen()) hint.hidden = false
}
