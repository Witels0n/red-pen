import './landing.css'
import { mountSiteHeader } from '../shared/site-header'
import { registerOffline, watchInstall } from '../shared/pwa'
import { startEggs } from './eggs'
import { startBinder } from './binder'

const header = mountSiteHeader()
registerOffline(header)
startEggs()
startBinder()

// The tool cards are written into index.html at build time by the seo plugin (seo.ts).

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
