import './styles.css'
import { mountSiteHeader } from '../shared/site-header'
import { registerOffline } from '../shared/pwa'
import { el, showMessage } from './dom'
import { flushSave, showEditor } from './editor'
import { showHome } from './home'
import { GridStorageError, listGrids, memoryGrids, setGridStorage } from './storage'

registerOffline(mountSiteHeader({ toolName: 'Question paper grid' }))

const views = { home: el('home-view'), edit: el('edit-view') }

let routing = Promise.resolve()

function route(): Promise<void> {
  routing = routing.then(async () => {
    await flushSave()
    const hash = location.hash.slice(1)
    const gridId = hash.startsWith('grid/') ? decodeURIComponent(hash.slice('grid/'.length)) : null
    views.home.hidden = gridId !== null
    views.edit.hidden = gridId === null
    if (gridId) await showEditor(gridId)
    else await showHome()
    window.scrollTo(0, 0)
  })
  return routing
}

/** When this browser refuses IndexedDB, keep working in memory for this visit and say so plainly. */
async function checkStorage(): Promise<void> {
  try {
    await listGrids()
  } catch (error) {
    if (!(error instanceof GridStorageError)) throw error
    setGridStorage(memoryGrids())
    showMessage(
      el('storage-error'),
      `${error.message} You can still make a grid now, but it will be gone when you close this page. Download the Excel file to keep it.`,
    )
  }
}

window.addEventListener('hashchange', () => void route())
void checkStorage().then(route)
