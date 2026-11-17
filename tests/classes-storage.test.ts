import { IDBFactory } from 'fake-indexeddb'
import writeXlsxFile from 'write-excel-file/node'
import { beforeEach, describe, expect, it } from 'vitest'
import { newClassList } from '../src/shared/classes/class-list'
import { SpreadsheetError, cellText, importSpreadsheet, normaliseRows } from '../src/shared/classes/spreadsheet'
import {
  ClassStorageError,
  deleteClass,
  getClass,
  indexedDbStorage,
  listClasses,
  memoryStorage,
  saveClass,
  setClassStorage,
  type ClassStorage,
} from '../src/shared/classes/storage'

describe.each([
  ['IndexedDB', () => indexedDbStorage(new IDBFactory())],
  ['memory', () => memoryStorage()],
])('class storage in %s', (_, make: () => ClassStorage) => {
  beforeEach(() => setClassStorage(make()))

  it('saves, lists newest first, gets and deletes', async () => {
    const a = newClassList('Grade 8A', 2, [{ id: '01', name: 'Ann' }], 1000)
    const b = newClassList('Grade 8B', 1, [{ id: '1' }], 1000)
    const savedA = await saveClass(a, 2000)
    await saveClass(b, 3000)
    expect(savedA.updatedAt).toBe(2000)
    expect((await listClasses()).map((c) => c.name)).toEqual(['Grade 8B', 'Grade 8A'])

    await saveClass({ ...a, name: 'Grade 8A Maths' }, 4000)
    const list = await listClasses()
    expect(list.map((c) => c.name)).toEqual(['Grade 8A Maths', 'Grade 8B'])
    expect(await getClass(a.id)).toEqual({ ...a, name: 'Grade 8A Maths', updatedAt: 4000 })

    await deleteClass(a.id)
    expect(await getClass(a.id)).toBeUndefined()
    expect(await listClasses()).toHaveLength(1)
  })

  it('stores a copy, so later changes to the object are not saved by accident', async () => {
    const a = newClassList('Grade 9', 2, [{ id: '01', name: 'Ann' }])
    await saveClass(a)
    a.learners.push({ id: '02' })
    expect((await getClass(a.id))!.learners).toHaveLength(1)
  })

  it('refuses an invalid Class list with the reasons', async () => {
    const bad = newClassList('Grade 9', 2, [{ id: '1' }])
    await expect(saveClass(bad)).rejects.toThrow(new ClassStorageError('"1" is not a 2-digit Learner ID.'))
    expect(await listClasses()).toEqual([])
  })
})

describe('when the browser blocks storage', () => {
  it('rejects with a clear ClassStorageError instead of crashing', async () => {
    const blocked = {
      open() {
        throw new DOMException('The user denied permission to access the database.', 'SecurityError')
      },
    } as unknown as IDBFactory
    setClassStorage(indexedDbStorage(blocked))
    const error = await listClasses().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ClassStorageError)
    expect((error as Error).message).toMatch(/not letting Red Pen save class lists/)
    await expect(saveClass(newClassList('X', 1, []))).rejects.toBeInstanceOf(ClassStorageError)
  })
})

function fileOf(name: string, data: Uint8Array | string) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return {
    name,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  }
}

describe('importSpreadsheet', () => {
  it('reads a CSV as one sheet named after the file, padded to an even width', async () => {
    const result = await importSpreadsheet(fileOf('Grade 8A.csv', 'Name;Surname\r\nThandi;Mokoena;extra\r\n;\r\n\r\n'))
    expect(result.sheets).toEqual([
      {
        name: 'Grade 8A',
        rows: [
          ['Name', 'Surname', ''],
          ['Thandi', 'Mokoena', 'extra'],
        ],
      },
    ])
  })

  it('reads a Windows-1252 CSV', async () => {
    const bytes = new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x52, 0xe9, 0x6e, 0xe9]) // "Name\nRéné"
    expect((await importSpreadsheet(fileOf('old.csv', bytes))).sheets[0].rows).toEqual([['Name'], ['Réné']])
  })

  it('reads every sheet of an .xlsx, with numbers as plain text', async () => {
    const buffer = await writeXlsxFile([
      {
        sheet: 'Grade 8A',
        data: [
          ['First name', 'Surname', 'Number'],
          ['Thandi', 'Mokoena', 3],
          ['Sipho', null, 12],
        ],
      },
      { sheet: 'Grade 8B', data: [['Ayesha']] },
    ]).toBuffer()
    const bytes = new Uint8Array(buffer)
    const result = await importSpreadsheet(fileOf('classes.xlsx', bytes))
    expect(result.sheets).toEqual([
      {
        name: 'Grade 8A',
        rows: [
          ['First name', 'Surname', 'Number'],
          ['Thandi', 'Mokoena', '3'],
          ['Sipho', '', '12'],
        ],
      },
      { name: 'Grade 8B', rows: [['Ayesha']] },
    ])
  })

  it('explains files it cannot read', async () => {
    await expect(importSpreadsheet(fileOf('old.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0])))).rejects.toThrow(
      /Old \.xls files/,
    )
    await expect(
      importSpreadsheet(fileOf('broken.xlsx', new Uint8Array([0x50, 0x4b, 1, 2, 3]))),
    ).rejects.toBeInstanceOf(SpreadsheetError)
    await expect(importSpreadsheet(fileOf('empty.csv', '\r\n'))).rejects.toThrow('This spreadsheet is empty.')
    await expect(importSpreadsheet(fileOf('photo.csv', new Uint8Array([0xff, 0xd8, 0, 0])))).rejects.toThrow(
      /not a spreadsheet/,
    )
  })

  it('turns cells into text', () => {
    expect(cellText(null)).toBe('')
    expect(cellText(12)).toBe('12')
    expect(cellText(true)).toBe('TRUE')
    expect(cellText(new Date(Date.UTC(2026, 10, 17)))).toBe('2026-11-17')
    expect(normaliseRows([['a'], ['b', 'c'], [' ', '']])).toEqual([
      ['a', ''],
      ['b', 'c'],
    ])
  })
})
