import { describe, expect, it } from 'vitest'
import { TOOLS, groupTools, type Tool } from '../src/landing/tools'
import { PAGES } from '../vite.config'

const help: Tool['help'] = { steps: ['a', 'b', 'c'], questions: [] }
const tool = (name: string, group: Tool['group']): Tool => ({ name, blurb: '', path: `${name}/`, group, help })

describe('groupTools', () => {
  it('keeps the display order of groups and leaves out empty groups', () => {
    const groups = groupTools([tool('qr', 'Classroom'), tool('mark', 'Set and mark'), tool('split', 'Classroom')])
    expect(groups.map((g) => g.group)).toEqual(['Set and mark', 'Classroom'])
    expect(groups[1].tools.map((t) => t.name)).toEqual(['qr', 'split'])
  })
})

describe('TOOLS', () => {
  it('every Tool has three steps and two questions for its page', () => {
    for (const t of TOOLS) {
      expect(
        t.help.steps.every((s) => s.trim().length > 0),
        t.name,
      ).toBe(true)
      expect(t.help.questions, t.name).toHaveLength(2)
    }
  })

  it('has no em dashes in any text', () => {
    expect(JSON.stringify(TOOLS)).not.toContain('\u2014')
  })

  it('every Tool has a page in the build', () => {
    const built = Object.values(PAGES)
    for (const t of TOOLS) expect(built).toContain(`${t.path}index.html`)
  })
})
