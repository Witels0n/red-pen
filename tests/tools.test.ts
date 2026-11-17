import { describe, expect, it } from 'vitest'
import { TOOLS, groupTools, type Tool } from '../src/landing/tools'
import { PAGES } from '../vite.config'

const tool = (name: string, group: Tool['group']): Tool => ({ name, blurb: '', path: `${name}/`, group })

describe('groupTools', () => {
  it('keeps the display order of groups and leaves out empty groups', () => {
    const groups = groupTools([tool('qr', 'Classroom'), tool('mark', 'Marking'), tool('split', 'Classroom')])
    expect(groups.map((g) => g.group)).toEqual(['Marking', 'Classroom'])
    expect(groups[1].tools.map((t) => t.name)).toEqual(['qr', 'split'])
  })
})

describe('TOOLS', () => {
  it('every Tool has a page in the build', () => {
    const built = Object.values(PAGES)
    for (const t of TOOLS) expect(built).toContain(`${t.path}index.html`)
  })
})
