/** A group of tools on the landing page, in display order. */
export type ToolGroup = 'Assessments and marking' | 'PDF' | 'Useful stuff'

export const TOOL_GROUPS: readonly ToolGroup[] = ['Assessments and marking', 'PDF', 'Useful stuff']

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
    group: 'Assessments and marking',
  },
  {
    name: 'MCQ assessments',
    blurb:
      'Build a multiple-choice test, print answer sheets, scan them and get a marksheet with item analysis per Topic.',
    path: 'mcq/',
    group: 'Assessments and marking',
  },
  {
    name: 'Cover sheets',
    blurb: 'A QR cover sheet for each learner, so one batch scan of the class splits into a PDF per learner.',
    path: 'covers/',
    group: 'Assessments and marking',
  },
  {
    name: 'Markbook builder',
    blurb:
      'Design a markbook with weights, Categories and CAPS levels, then download an Excel file with live formulas.',
    path: 'markbook/',
    name: 'Question paper grid',
    blurb:
      'The analysis grid for a test or exam: marks per cognitive level and topic against your targets, with a one-page PDF for your HoD.',
    path: 'grid/',
    name: 'Marks analysis',
    blurb:
      "Paste a class's marks and see the spread, bands, pass rate and plain-language insights, with a one-page report.",
    path: 'marks/',
    group: 'Assessments and marking',
  },
  {
    name: 'Combine PDFs',
    blurb: 'Join several PDFs into one, in the order you choose.',
    path: 'combine/',
    group: 'PDF',
  },
  {
    name: 'Split a PDF',
    blurb:
      'Cut one PDF into smaller files: per page, every few pages, at cover sheets (one per learner) or custom ranges.',
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
    name: 'Photos to PDF',
    blurb: 'Photograph pages with your phone, straighten and clean them up, and get one PDF or a PDF per learner.',
    path: 'scan/',
    group: 'PDF',
  },
  {
    name: 'Sign and fill',
    blurb: 'Fill in a PDF form or permission slip, add the date and your signature, then download it.',
    path: 'sign/',
    group: 'PDF',
  },
  {
    name: 'Booklet printing',
    blurb: 'Turn A4 pages into a folded A5 booklet, fit several pages on a sheet, or print copies of a slip to cut.',
    path: 'booklet/',
    group: 'PDF',
  },
  {
    name: 'Compress a PDF',
    blurb: 'Shrink scanned PDFs to fit email and upload limits, with an optional target size.',
    path: 'compress/',
    name: 'Stamp and number',
    blurb: 'Add a MEMO or DRAFT watermark, page numbers, a header and footer with your logo and the date to PDFs.',
    path: 'stamp/',
    group: 'PDF',
  },
  {
    name: 'Redact and anonymise',
    blurb:
      'Black out names for a moderation sample, on one test or a whole class set, and rename the files to Learner 01, 02 and so on.',
    path: 'redact/',
    group: 'PDF',
  },
  {
    name: 'QR codes',
    blurb: 'Codes for a link, your classroom Wi-Fi, an email or a contact card, with your colours and school logo.',
    path: 'qr/',
    group: 'Useful stuff',
  },
  {
    name: 'Class lists',
    blurb: 'Keep your classes with a Learner ID for each learner, ready for answer sheets. Names stay on this device.',
    path: 'classes/',
    group: 'Useful stuff',
  },
  {
    name: 'Class picker',
    blurb: 'Spin a wheel to pick a learner fairly, or make random groups with keep-apart and keep-together rules.',
    path: 'picker/',
    name: 'Worksheet maker',
    blurb: 'Word searches, crosswords, matching, fill in the blanks and more, printed as a worksheet with its memo.',
    path: 'worksheets/',
    name: 'Certificates and labels',
    blurb: 'Certificates, desk name cards, name labels, book labels and award slips for every learner on a list.',
    path: 'certificates/',
    group: 'Useful stuff',
  },
]

/** The groups that have at least one Tool, each with its Tools, in display order. */
export function groupTools(tools: readonly Tool[]): { group: ToolGroup; tools: Tool[] }[] {
  return TOOL_GROUPS.map((group) => ({ group, tools: tools.filter((t) => t.group === group) })).filter(
    (g) => g.tools.length > 0,
  )
}
