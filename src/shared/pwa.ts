import { registerSW } from 'virtual:pwa-register'
import { showUpdateNote } from './site-header'

/**
 * Registers the service worker so the whole site works offline after one visit.
 * A new version never reloads the page by itself (that could wipe a test halfway
 * through marking); the header offers a Reload button instead.
 */
export function registerOffline(header: HTMLElement): void {
  if (!('serviceWorker' in navigator)) return
  const update = registerSW({
    onNeedRefresh() {
      showUpdateNote(header, () => void update(true))
    },
  })
}

/** The browser's install prompt event (not yet in TypeScript's DOM types). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallState = 'available' | 'installed' | 'manual'

/**
 * Tracks whether Red Pen can be installed from this browser.
 * 'available': the browser offers an install prompt, so show a button.
 * 'installed': already running as an installed app.
 * 'manual': no prompt (for example iPhone Safari), so show Add to Home Screen steps.
 */
export function watchInstall(onChange: (state: InstallState, install: () => Promise<void>) => void): void {
  let deferred: BeforeInstallPromptEvent | null = null
  const install = async () => {
    if (!deferred) return
    const prompt = deferred
    deferred = null
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    onChange(outcome === 'accepted' ? 'installed' : 'manual', install)
  }

  const standalone = window.matchMedia('(display-mode: standalone)').matches
  onChange(standalone ? 'installed' : 'manual', install)

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    onChange('available', install)
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    onChange('installed', install)
  })
}
