import './landing.css'
import { mountSiteHeader } from '../shared/site-header'
import { registerOffline, watchInstall } from '../shared/pwa'
import { TOOLS, groupTools } from './tools'

const header = mountSiteHeader()
registerOffline(header)

const TICK = '<svg class="tick" viewBox="0 0 30 30" aria-hidden="true"><path d="M5 16 L12 23 L26 5" /></svg>'

function renderTools(container: HTMLElement): void {
  for (const { group, tools } of groupTools(TOOLS)) {
    const section = document.createElement('section')
    section.className = 'tool-group'
    const heading = document.createElement('h3')
    heading.textContent = group
    const grid = document.createElement('div')
    grid.className = 'tool-grid'
    for (const tool of tools) {
      const card = document.createElement('a')
      card.className = 'tool-card'
      card.href = import.meta.env.BASE_URL + tool.path
      card.innerHTML = TICK
      const name = document.createElement('b')
      name.textContent = tool.name
      const blurb = document.createElement('span')
      blurb.textContent = tool.blurb
      card.append(name, blurb)
      grid.append(card)
    }
    section.append(heading, grid)
    container.append(section)
  }
}

renderTools(document.getElementById('tool-groups')!)

const installAvailable = document.getElementById('install-available')!
const installInstalled = document.getElementById('install-installed')!
const installManual = document.getElementById('install-manual')!
const installButton = document.getElementById('install-button')!
let runInstall: () => Promise<void> = async () => {}
installButton.addEventListener('click', () => void runInstall())

watchInstall((state, install) => {
  runInstall = install
  installAvailable.hidden = state !== 'available'
  installInstalled.hidden = state !== 'installed'
  installManual.hidden = state !== 'manual'
})
