/** A group of tools on the landing page, in display order. */
export type ToolGroup = 'Marking' | 'PDF' | 'Classroom'

export const TOOL_GROUPS: readonly ToolGroup[] = ['Marking', 'PDF', 'Classroom']

/** One Tool: a single job on its own page, listed on the landing page. */
export interface Tool {
  name: string
  blurb: string
  /** Path relative to the site's base, ending in a slash, e.g. "mark/". */
  path: string
  group: ToolGroup
}

/** Every Tool on the site. Adding a Tool means adding an entry here and its page in vite.config.ts. */
export const TOOLS: readonly Tool[] = [
  {
    name: 'Mark a test',
    blurb: 'Ticks, crosses, subtotals and totals on a scanned PDF, then export a marked copy.',
    path: 'mark/',
    group: 'Marking',
  },
  {
    name: 'Combine PDFs',
    blurb: 'Join several PDFs into one, in the order you choose.',
    path: 'combine/',
    group: 'PDF',
  },
  {
    name: 'Split a PDF',
    blurb: 'Cut one PDF into smaller files: per page, every few pages (one per learner) or custom ranges.',
    path: 'split/',
    group: 'PDF',
  },
  {
    name: 'Organise pages',
    blurb: 'Rotate, reorder and delete pages of a PDF, then save a tidy copy.',
    path: 'organise/',
    group: 'PDF',
  },
  {
    name: 'QR codes',
    blurb: 'Codes for a link, your classroom Wi-Fi, an email or a contact card, with your colours and school logo.',
    path: 'qr/',
    group: 'Classroom',
  },
]

/** The groups that have at least one Tool, each with its Tools, in display order. */
export function groupTools(tools: readonly Tool[]): { group: ToolGroup; tools: Tool[] }[] {
  return TOOL_GROUPS.map((group) => ({ group, tools: tools.filter((t) => t.group === group) })).filter(
    (g) => g.tools.length > 0,
  )
}
