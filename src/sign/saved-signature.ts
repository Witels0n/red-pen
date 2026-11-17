// Signatures and initials remembered on this device, only when the teacher ticks
// "Remember on this device" (opt-in, see docs/adr/0001-client-only-processing.md).
// Stored in this browser's local storage and nowhere else.

export type SignatureKind = 'signature' | 'initials'

export const STORAGE_KEYS: Record<SignatureKind, string> = {
  signature: 'red-pen.sign.signature',
  initials: 'red-pen.sign.initials',
}

export interface SavedSignatures {
  load(kind: SignatureKind): string | null
  save(kind: SignatureKind, src: string): boolean
  forget(kind: SignatureKind): void
}

export function createSavedSignatures(storage: () => Storage | null = () => window.localStorage): SavedSignatures {
  const get = () => {
    try {
      return storage()
    } catch {
      return null
    }
  }
  return {
    load(kind) {
      try {
        const v = get()?.getItem(STORAGE_KEYS[kind]) ?? null
        return v && v.startsWith('data:image/png;base64,') ? v : null
      } catch {
        return null
      }
    },
    save(kind, src) {
      try {
        const s = get()
        if (!s) return false
        s.setItem(STORAGE_KEYS[kind], src)
        return true
      } catch {
        return false // full or blocked: the signature still works for this session
      }
    },
    forget(kind) {
      try {
        get()?.removeItem(STORAGE_KEYS[kind])
      } catch {
        // nothing to do
      }
    },
  }
}
