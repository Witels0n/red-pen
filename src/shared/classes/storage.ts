import { classListProblems } from './class-list'
import type { ClassList } from './types'

/**
 * Where Class lists are kept: IndexedDB in this browser, never anywhere else.
 * Every function rejects with a ClassStorageError (never a raw DOMException) so a page can
 * show one clear message when the browser blocks storage, for example in private browsing.
 */

/** The storage behind listClasses, getClass, saveClass and deleteClass. */
export interface ClassStorage {
  list(): Promise<ClassList[]>
  get(id: string): Promise<ClassList | undefined>
  put(list: ClassList): Promise<void>
  delete(id: string): Promise<void>
}

export class ClassStorageError extends Error {
  override name = 'ClassStorageError'
}

const BLOCKED =
  'This browser is not letting Red Pen save class lists. Private browsing, or settings that block site data, can do this.'

const DB_NAME = 'red-pen-classes'
const DB_VERSION = 1
const STORE = 'classes'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Class lists in IndexedDB. Pass a factory (for example from fake-indexeddb) to use another one. */
export function indexedDbStorage(factory?: IDBFactory): ClassStorage {
  let opening: Promise<IDBDatabase> | null = null

  const open = (): Promise<IDBDatabase> => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const idb = factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB)
      if (!idb) throw new ClassStorageError(BLOCKED)
      const req = idb.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
      req.onsuccess = () => {
        const db = req.result
        // Another tab upgrading the database: step aside so it is not blocked.
        db.onversionchange = () => {
          db.close()
          opening = null
        }
        resolve(db)
      }
      req.onerror = () => reject(req.error)
      req.onblocked = () =>
        reject(new ClassStorageError('Class lists are open in another Red Pen tab. Close it and try again.'))
    }).catch((error) => {
      opening = null
      throw error
    })
    return opening
  }

  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open()
    const tx = db.transaction(STORE, mode)
    // A write only counts once the whole transaction has committed.
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new ClassStorageError('Saving was cancelled.'))
    })
    const result = request(work(tx.objectStore(STORE)))
    await Promise.all([result, done])
    return result
  }

  return {
    list: () => run('readonly', (s) => s.getAll() as IDBRequest<ClassList[]>),
    get: (id) => run('readonly', (s) => s.get(id) as IDBRequest<ClassList | undefined>),
    put: async (list) => {
      await run('readwrite', (s) => s.put(list))
    },
    delete: async (id) => {
      await run('readwrite', (s) => s.delete(id))
    },
  }
}

/** Class lists in memory only, gone when the page closes. For tests, or when IndexedDB is blocked. */
export function memoryStorage(): ClassStorage {
  const lists = new Map<string, ClassList>()
  return {
    list: async () => [...lists.values()].map((l) => structuredClone(l)),
    get: async (id) => {
      const l = lists.get(id)
      return l && structuredClone(l)
    },
    put: async (list) => {
      lists.set(list.id, structuredClone(list))
    },
    delete: async (id) => {
      lists.delete(id)
    },
  }
}

let active: ClassStorage | null = null

/** Replaces the storage the functions below use (tests pass memoryStorage()). */
export function setClassStorage(storage: ClassStorage): void {
  active = storage
}

function storage(): ClassStorage {
  return (active ??= indexedDbStorage())
}

function describe(error: unknown): ClassStorageError {
  if (error instanceof ClassStorageError) return error
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new ClassStorageError('This device is out of space for Red Pen. Free some space and try again.')
  }
  return new ClassStorageError(BLOCKED)
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw describe(error)
  }
}

/** Every saved Class list, most recently changed first. */
export function listClasses(): Promise<ClassList[]> {
  return guarded(async () => (await storage().list()).sort((a, b) => b.updatedAt - a.updatedAt))
}

export function getClass(id: string): Promise<ClassList | undefined> {
  return guarded(() => storage().get(id))
}

/**
 * Saves a Class list (adding or replacing it) and returns what was stored, with `updatedAt` set to now.
 * Rejects with a ClassStorageError listing the problems if the list is not valid.
 */
export async function saveClass(list: ClassList, now = Date.now()): Promise<ClassList> {
  const problems = classListProblems(list)
  if (problems.length > 0) throw new ClassStorageError(problems.join('\n'))
  const stored: ClassList = {
    id: list.id,
    name: list.name.trim(),
    idDigits: list.idDigits,
    learners: list.learners.map((l) => (l.name ? { id: l.id, name: l.name } : { id: l.id })),
    createdAt: list.createdAt,
    updatedAt: Math.max(now, list.createdAt),
  }
  await guarded(() => storage().put(stored))
  return stored
}

export function deleteClass(id: string): Promise<void> {
  return guarded(() => storage().delete(id))
}
