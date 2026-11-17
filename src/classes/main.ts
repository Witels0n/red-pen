import './styles.css'
import { mountSiteHeader } from '../shared/site-header'
import { registerOffline } from '../shared/pwa'
import { ClassStorageError, listClasses, memoryStorage, setClassStorage } from '../shared/classes'
import { el, showMessage } from './dom'
import { showEdit } from './edit-class'
import { showHome } from './home'
import { showNew } from './new-class'

registerOffline(mountSiteHeader({ toolName: 'Class lists' }))

const views = { home: el('home-view'), new: el('new-view'), edit: el('edit-view') }

let routing = Promise.resolve()

function route(): Promise<void> {
  routing = routing.then(async () => {
    const hash = location.hash.slice(1)
    const classId = hash.startsWith('class/') ? decodeURIComponent(hash.slice('class/'.length)) : null
    const view: keyof typeof views = hash === 'new' ? 'new' : classId ? 'edit' : 'home'
    for (const [name, section] of Object.entries(views)) section.hidden = name !== view
    if (view === 'new') showNew()
    else if (view === 'edit') await showEdit(classId!)
    else await showHome()
    window.scrollTo(0, 0)
  })
  return routing
}

/**
 * When this browser refuses IndexedDB, keep working in memory for this visit and say so plainly,
 * rather than failing on every click.
 */
async function checkStorage(): Promise<void> {
  try {
    await listClasses()
  } catch (error) {
    if (!(error instanceof ClassStorageError)) throw error
    setClassStorage(memoryStorage())
    showMessage(
      el('storage-error'),
      `${error.message} You can still make classes now, but they will be gone when you close this page. Use Export CSV to keep them.`,
    )
  }
}

window.addEventListener('hashchange', () => void route())
void checkStorage().then(route)
