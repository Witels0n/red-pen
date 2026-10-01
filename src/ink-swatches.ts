import { INK_PRESETS, inkCss, type Ink, type InkName } from './ink'

// The toolbar's colour swatches. Also keeps the `--ink` CSS variable in step with the Ink
// colour: every on-screen Annotation (and the Text note editor) draws with `var(--ink)`, so a
// change recolours them all at once without re-rendering.

export function attachInkSwatches(container: HTMLElement, ink: Ink): void {
  const buttons = new Map<InkName, HTMLButtonElement>()
  for (const name of Object.keys(INK_PRESETS) as InkName[]) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'swatch'
    b.dataset.ink = name
    b.setAttribute('role', 'radio')
    b.setAttribute('aria-label', `Ink colour: ${name}`)
    b.title = name[0].toUpperCase() + name.slice(1)
    b.style.setProperty('--swatch', inkCss(INK_PRESETS[name]))
    b.addEventListener('click', () => ink.set(name))
    container.append(b)
    buttons.set(name, b)
  }
  const sync = () => {
    document.documentElement.style.setProperty('--ink', ink.css())
    for (const [name, b] of buttons) b.setAttribute('aria-checked', String(name === ink.get()))
  }
  ink.subscribe(sync)
  sync()
}
