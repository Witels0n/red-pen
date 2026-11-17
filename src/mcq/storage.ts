// Where Assessments are kept: IndexedDB in this browser (its own database), never anywhere else.
// Falls back to memory when the browser blocks storage, and tests use memory directly.
import type { Assessment } from './core/model'

export interface AssessmentStorage {
  list(): Promise<Assessment[]>
  get(id: string): Promise<Assessment | undefined>
  put(a: Assessment): Promise<void>
  delete(id: string): Promise<void>
}

export class AssessmentStorageError extends Error {
  override name = 'AssessmentStorageError'
}

const BLOCKED =
  'This browser is not letting Red Pen save assessments. Private browsing, or settings that block site data, can do this.'

const DB_NAME = 'red-pen-mcq'
const DB_VERSION = 1
const STORE = 'assessments'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function indexedDbAssessments(factory?: IDBFactory): AssessmentStorage {
  let opening: Promise<IDBDatabase> | null = null
  const open = (): Promise<IDBDatabase> => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const idb = factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB)
      if (!idb) throw new AssessmentStorageError(BLOCKED)
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
        reject(new AssessmentStorageError('Assessments are open in another Red Pen tab. Close it and try again.'))
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
      tx.onabort = () => reject(tx.error ?? new AssessmentStorageError('Saving was cancelled.'))
    })
    const result = request(work(tx.objectStore(STORE)))
    await Promise.all([result, done])
    return result
  }

  return {
    list: () => run('readonly', (s) => s.getAll() as IDBRequest<Assessment[]>),
    get: (id) => run('readonly', (s) => s.get(id) as IDBRequest<Assessment | undefined>),
    put: async (a) => {
      await run('readwrite', (s) => s.put(a))
    },
    delete: async (id) => {
      await run('readwrite', (s) => s.delete(id))
    },
  }
}

export function memoryAssessments(): AssessmentStorage {
  const items = new Map<string, Assessment>()
  return {
    list: async () => [...items.values()].map((a) => structuredClone(a)),
    get: async (id) => {
      const a = items.get(id)
      return a && structuredClone(a)
    },
    put: async (a) => {
      items.set(a.id, structuredClone(a))
    },
    delete: async (id) => {
      items.delete(id)
    },
  }
}

let active: AssessmentStorage | null = null

export function setAssessmentStorage(storage: AssessmentStorage): void {
  active = storage
}

function storage(): AssessmentStorage {
  return (active ??= indexedDbAssessments())
}

function describe(error: unknown): AssessmentStorageError {
  if (error instanceof AssessmentStorageError) return error
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new AssessmentStorageError('This device is out of space for Red Pen. Free some space and try again.')
  }
  return new AssessmentStorageError(BLOCKED)
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw describe(error)
  }
}

/** Every saved Assessment, most recently changed first. */
export function listAssessments(): Promise<Assessment[]> {
  return guarded(async () => (await storage().list()).sort((a, b) => b.updatedAt - a.updatedAt))
}

export function getAssessment(id: string): Promise<Assessment | undefined> {
  return guarded(() => storage().get(id))
}

/** Saves (adds or replaces) and returns what was stored, with `updatedAt` set to now. */
export async function saveAssessment(a: Assessment, now = Date.now()): Promise<Assessment> {
  const stored = { ...a, updatedAt: Math.max(now, a.createdAt) }
  await guarded(() => storage().put(stored))
  return stored
}

export function deleteAssessment(id: string): Promise<void> {
  return guarded(() => storage().delete(id))
}
