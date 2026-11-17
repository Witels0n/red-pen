// Where Question paper grids are kept: IndexedDB in this browser (its own database), never
// anywhere else. Falls back to memory when the browser blocks storage, and tests use memory directly.
import { upgradeGrid, type Grid } from './core/model'

export interface GridStorage {
  list(): Promise<Grid[]>
  get(id: string): Promise<Grid | undefined>
  put(g: Grid): Promise<void>
  delete(id: string): Promise<void>
}

export class GridStorageError extends Error {
  override name = 'GridStorageError'
}

const BLOCKED =
  'This browser is not letting Red Pen save grids. Private browsing, or settings that block site data, can do this.'

const DB_NAME = 'red-pen-grid'
const DB_VERSION = 1
const STORE = 'grids'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function indexedDbGrids(factory?: IDBFactory): GridStorage {
  let opening: Promise<IDBDatabase> | null = null
  const open = (): Promise<IDBDatabase> => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const idb = factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB)
      if (!idb) throw new GridStorageError(BLOCKED)
      const req = idb.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => {
          db.close()
          opening = null
        }
        resolve(db)
      }
      req.onerror = () => reject(req.error)
      req.onblocked = () =>
        reject(new GridStorageError('Grids are open in another Red Pen tab. Close it and try again.'))
    }).catch((error) => {
      opening = null
      throw error
    })
    return opening
  }

  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open()
    const tx = db.transaction(STORE, mode)
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new GridStorageError('Saving was cancelled.'))
    })
    const result = request(work(tx.objectStore(STORE)))
    await Promise.all([result, done])
    return result
  }

  return {
    list: () => run('readonly', (s) => s.getAll() as IDBRequest<Grid[]>),
    get: (id) => run('readonly', (s) => s.get(id) as IDBRequest<Grid | undefined>),
    put: async (g) => {
      await run('readwrite', (s) => s.put(g))
    },
    delete: async (id) => {
      await run('readwrite', (s) => s.delete(id))
    },
  }
}

export function memoryGrids(): GridStorage {
  const items = new Map<string, Grid>()
  return {
    list: async () => [...items.values()].map((g) => structuredClone(g)),
    get: async (id) => {
      const g = items.get(id)
      return g && structuredClone(g)
    },
    put: async (g) => {
      items.set(g.id, structuredClone(g))
    },
    delete: async (id) => {
      items.delete(id)
    },
  }
}

let active: GridStorage | null = null

export function setGridStorage(storage: GridStorage): void {
  active = storage
}

function storage(): GridStorage {
  return (active ??= indexedDbGrids())
}

function describe(error: unknown): GridStorageError {
  if (error instanceof GridStorageError) return error
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new GridStorageError('This device is out of space for Red Pen. Free some space and try again.')
  }
  return new GridStorageError(BLOCKED)
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw describe(error)
  }
}

/** Every saved grid, most recently changed first. */
export function listGrids(): Promise<Grid[]> {
  return guarded(async () => (await storage().list()).map(upgradeGrid).sort((a, b) => b.updatedAt - a.updatedAt))
}

export async function getGrid(id: string): Promise<Grid | undefined> {
  const g = await guarded(() => storage().get(id))
  return g && upgradeGrid(g)
}

/** Saves (adds or replaces) and returns what was stored, with `updatedAt` set to now. */
export async function saveGrid(g: Grid, now = Date.now()): Promise<Grid> {
  const stored = { ...g, updatedAt: Math.max(now, g.createdAt) }
  await guarded(() => storage().put(stored))
  return stored
}

export function deleteGrid(id: string): Promise<void> {
  return guarded(() => storage().delete(id))
}
