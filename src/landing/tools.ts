/** A group of tools on the landing page, in display order. */
export type ToolGroup = 'Set and mark' | 'Marks and results' | 'PDF basics' | 'Print and share' | 'Classroom'

export const TOOL_GROUPS: readonly ToolGroup[] = [
  'Set and mark',
  'Marks and results',
  'PDF basics',
  'Print and share',
  'Classroom',
]

/** One Tool: a single job on its own page, listed on the landing page. */
export interface Tool {
  name: string
  blurb: string
  /** Path relative to the site's base, ending in a slash, e.g. "mark/". */
  path: string
  group: ToolGroup
  /** The "How it works" steps and questions the build writes onto the Tool's page, for readers and search engines. */
  help: ToolHelp
}

export interface ToolHelp {
  steps: readonly [string, string, string]
  questions: readonly { q: string; a: string }[]
}

/** Every Tool on the site. Adding a Tool means adding an entry here and its page in vite.config.ts. */
export const TOOLS: readonly Tool[] = [
  {
    name: 'Question paper grid',
    blurb:
      'The analysis grid for a test or exam: marks per cognitive level and topic against your targets, with a one-page PDF for your HoD.',
    path: 'grid/',
    group: 'Set and mark',
    help: {
      steps: [
        "Type each question's marks, cognitive level and topic, or paste the rows from Excel.",
        'See at once whether the paper matches your targets per level and topic.',
        'Download a one-page PDF or an Excel file for your HoD and moderator.',
      ],
      questions: [
        {
          q: 'Which taxonomies can I use?',
          a: "Bloom's revised taxonomy, Barrett's taxonomy for comprehension, or the four CAPS Mathematics levels. You can also set your own levels and target percentages.",
        },
        { q: 'Is my paper saved?', a: 'Grids are saved in this browser only and never uploaded.' },
      ],
    },
  },
  {
    name: 'MCQ assessments',
    blurb:
      'Build a multiple-choice test, print answer sheets, scan them and get a marksheet with item analysis per Topic.',
    path: 'mcq/',
    group: 'Set and mark',
    help: {
      steps: [
        'Build the questions and memo, with pictures and Topics if you like.',
        'Print a question paper and an answer sheet for each learner.',
        'Scan the sheets on a copier or photograph them, and get a marksheet, item analysis and feedback slips.',
      ],
      questions: [
        {
          q: 'Do I need special answer sheets or a scanner?',
          a: 'No. Print the sheets on ordinary paper and scan them on the school copier, or take photos with your phone.',
        },
        {
          q: "Are learners' names in the QR code?",
          a: 'No. A QR code on a sheet holds only a code and the Learner ID, never a name.',
        },
      ],
    },
  },
  {
    name: 'Cover sheets',
    blurb: 'A QR cover sheet for each learner, so one batch scan of the class splits into a PDF per learner.',
    path: 'covers/',
    group: 'Set and mark',
    help: {
      steps: [
        'Print a Cover sheet for each learner from one of your Class lists.',
        "Staple each one to the front of the learner's test and scan the whole class in one batch.",
        'Open the scan in Split a PDF and choose At cover sheets to get one PDF per learner.',
      ],
      questions: [
        {
          q: 'Why use Cover sheets?',
          a: 'One scan of the whole class splits itself into a file per learner, named after the learner, with no sorting by hand.',
        },
        {
          q: "Is the learner's name in the QR code?",
          a: 'No. The code holds only the Learner ID, and you can leave names off the printed sheet too.',
        },
      ],
    },
  },
  {
    name: 'Mark a test',
    blurb: 'Ticks, crosses, subtotals and totals on a scanned PDF, then export a marked copy.',
    path: 'mark/',
    group: 'Set and mark',
    help: {
      steps: [
        'Open a scanned test (PDF).',
        'Click to place ticks and crosses, and drag on subtotals and totals.',
        'Export a marked copy to return to the learner.',
      ],
      questions: [
        {
          q: "Is the learner's work uploaded?",
          a: 'No. The PDF is processed only in your browser and is never stored on a server.',
        },
        { q: 'Can I mark without internet?', a: 'Yes. Once the page has loaded, it works offline.' },
      ],
    },
  },
  {
    name: 'Photos to PDF',
    blurb: 'Photograph pages with your phone, straighten and clean them up, and get one PDF or a PDF per learner.',
    path: 'scan/',
    group: 'Set and mark',
    help: {
      steps: [
        'Take a photo of each page with your phone, or add photos you already have.',
        'Crop, straighten and clean up each page, and drag them into order.',
        'Download one PDF, or a PDF per learner in a .zip.',
      ],
      questions: [
        { q: 'Do I need a scanning app?', a: "No. It works in your phone's browser." },
        { q: 'Are my photos uploaded?', a: 'No. They are processed in your browser and never uploaded.' },
      ],
    },
  },
  {
    name: 'Marks analysis',
    blurb:
      "Paste a class's marks and see the spread, bands, pass rate and plain-language insights, with a one-page report.",
    path: 'marks/',
    group: 'Marks and results',
    help: {
      steps: [
        'Paste marks from Excel or Google Sheets, or import a CSV or Excel file.',
        'See the spread, the CAPS levels or bands, the pass rate and plain-language insights.',
        'Download a one-page A4 report for your HoD.',
      ],
      questions: [
        {
          q: 'Which bands can I use?',
          a: 'The 7 CAPS levels, 10% bands, symbols A to H, or your own cut-offs, with a pass mark you choose.',
        },
        {
          q: "Are learners' marks saved anywhere?",
          a: 'No. They are worked out in your browser and gone when you close the page.',
        },
      ],
    },
  },
  {
    name: 'Rubric builder',
    blurb:
      'Build an analytic, holistic, single-point or checklist rubric with weighted criteria, then download an Excel file that marks itself.',
    path: 'rubric/',
    group: 'Set and mark',
    help: {
      steps: [
        'Choose a style and a set of levels, such as four levels, CAPS codes, SOLO or a Marzano scale.',
        'Write the criteria and descriptors, and weigh each criterion in marks or percentages.',
        'Download an Excel file with the rubric to print and a sheet per learner to mark with an x.',
      ],
      questions: [
        {
          q: 'How do I mark with it in Excel?',
          a: 'Type an x in the box beside the level a learner reached. The sheet works out the weighted mark, total, percentage and level, and a Summary sheet shows the class average and the criterion that needs the most work.',
        },
        {
          q: 'Which taxonomies can I use?',
          a: "For the levels: SOLO, Marzano's proficiency scale, the CAPS achievement levels or your own. To tag each criterion: Bloom's revised taxonomy, Marzano's New Taxonomy, Webb's Depth of Knowledge, SOLO or the CAPS cognitive levels.",
        },
      ],
    },
  },
  {
    name: 'Markbook builder',
    blurb:
      'Design a markbook with weights, Categories and CAPS levels, then download an Excel file with live formulas.',
    path: 'markbook/',
    group: 'Marks and results',
    help: {
      steps: [
        'Add your assessments, Categories (such as Tests, Assignments and Exam) and their weights.',
        'Add learners from a Class list, paste names, or leave blank rows.',
        'Download an Excel markbook with live formulas.',
      ],
      questions: [
        {
          q: 'What does the markbook work out?',
          a: 'Percentages, Category averages, the weighted mark, CAPS achievement levels (1 to 7) and a class summary, as live Excel formulas.',
        },
        {
          q: "Are learners' names saved?",
          a: 'No. Names go into the download only and are not saved with your design.',
        },
      ],
    },
  },
  {
    name: 'Combine PDFs',
    blurb: 'Join several PDFs into one, in the order you choose.',
    path: 'combine/',
    group: 'PDF basics',
    help: {
      steps: ['Choose or drag in the PDFs.', 'Drag them into the order you want.', 'Combine and download one PDF.'],
      questions: [
        {
          q: 'Are my files uploaded?',
          a: 'No. They are joined in your browser, so learner work never leaves your computer.',
        },
        { q: 'Can I add more files after I start?', a: 'Yes. Add more PDFs at any time and drag them into place.' },
      ],
    },
  },
  {
    name: 'Split a PDF',
    blurb:
      'Cut one PDF into smaller files: per page, every few pages, at cover sheets (one per learner) or custom ranges.',
    path: 'split/',
    group: 'PDF basics',
    help: {
      steps: [
        'Open the PDF.',
        'Choose how to split it: per page, every few pages, at Cover sheets, or custom ranges such as 1-3, 4-6.',
        'Download the files as a .zip.',
      ],
      questions: [
        {
          q: 'Can I split a class scan into one file per learner?',
          a: 'Yes. Split every few pages if each test is the same length, or at Cover sheets to name each file after its learner.',
        },
        { q: 'Is my PDF uploaded?', a: 'No. It is processed in your browser and never uploaded.' },
      ],
    },
  },
  {
    name: 'Organise pages',
    blurb: 'Rotate, reorder and delete pages of a PDF, then save a tidy copy.',
    path: 'organise/',
    group: 'PDF basics',
    help: {
      steps: [
        'Open the PDF.',
        "Turn pages, drag them into order, and delete the ones you don't need.",
        'Save a tidy copy.',
      ],
      questions: [
        {
          q: 'Can I fix pages that were scanned upside down?',
          a: 'Yes. Turn one page at a time, or every page at once.',
        },
        { q: 'Is my PDF uploaded?', a: 'No. It is processed in your browser and never uploaded.' },
      ],
    },
  },
  {
    name: 'Compress a PDF',
    blurb: 'Shrink scanned PDFs to fit email and upload limits, with an optional target size.',
    path: 'compress/',
    group: 'PDF basics',
    help: {
      steps: [
        'Add one or more scanned PDFs.',
        'Choose the resolution and quality, or set a size each file must fit under.',
        'Compress and download.',
      ],
      questions: [
        {
          q: 'Can I get a PDF under 2 MB?',
          a: 'Yes. Type 2 MB as the target and lower settings are tried until each file fits.',
        },
        {
          q: 'Does it suit typed documents?',
          a: 'It works best on scans. Every page becomes a picture, so text can no longer be selected or searched.',
        },
      ],
    },
  },
  {
    name: 'Sign and fill',
    blurb: 'Fill in a PDF form or permission slip, add the date and your signature, then download it.',
    path: 'sign/',
    group: 'PDF basics',
    help: {
      steps: [
        'Open the form, permission slip or letter.',
        'Add text, ticks, the date, your initials and your signature.',
        'Download the signed PDF.',
      ],
      questions: [
        { q: 'Do I need to print and scan it?', a: 'No. You fill it in and sign it on screen.' },
        { q: 'Is my signature stored online?', a: 'No. It stays on this device, and the PDF is never uploaded.' },
      ],
    },
  },
  {
    name: 'Booklet printing',
    blurb: 'Turn A4 pages into a folded A5 booklet, fit several pages on a sheet, or print copies of a slip to cut.',
    path: 'booklet/',
    group: 'Print and share',
    help: {
      steps: [
        'Open the PDF.',
        'Choose a folded booklet, several pages per sheet, or copies of a page to cut into slips.',
        'Download the PDF and print it double-sided.',
      ],
      questions: [
        {
          q: 'Which way does the printer flip the pages?',
          a: 'Most booklets print with short-edge flipping. You can change this if your printer differs.',
        },
        {
          q: 'Can I print a thick booklet?',
          a: 'Yes. Set a little creep (about 0.1 mm per sheet) to keep the inner pages clear. Above about 12 sheets, consider two booklets.',
        },
      ],
    },
  },
  {
    name: 'Stamp and number',
    blurb: 'Add a MEMO or DRAFT watermark, page numbers, a header and footer with your logo and the date to PDFs.',
    path: 'stamp/',
    group: 'Print and share',
    help: {
      steps: [
        'Add one or more PDFs.',
        'Choose a watermark such as MEMO or DRAFT, page numbers, and a header or footer with your logo and the date.',
        'Preview it and download.',
      ],
      questions: [
        { q: 'Can I stamp only some pages?', a: 'Yes. Choose every page, odd or even pages, or a range such as 2-9.' },
        { q: 'Are my files uploaded?', a: 'No. They are processed in your browser and never uploaded.' },
      ],
    },
  },
  {
    name: 'Redact and anonymise',
    blurb:
      'Black out names for a moderation sample, on one test or a whole class set, and rename the files to Learner 01, 02 and so on.',
    path: 'redact/',
    group: 'Print and share',
    help: {
      steps: [
        'Add one test or a whole class set of PDFs.',
        'Draw boxes over names and other details, on one page or on every page.',
        'Download the files renamed Learner 01, 02 and so on, with a key that lists the original names.',
      ],
      questions: [
        {
          q: 'Is the redaction permanent?',
          a: 'Yes. Each page with a box becomes a picture with the box painted on, so the words under it are gone from the file, not just covered.',
        },
        { q: 'Can I shuffle the order?', a: 'Yes, so the numbers do not follow the class list.' },
      ],
    },
  },
  {
    name: 'QR codes',
    blurb: 'Codes for a link, your classroom Wi-Fi, an email or a contact card, with your colours and school logo.',
    path: 'qr/',
    group: 'Print and share',
    help: {
      steps: [
        'Choose a link, text, Wi-Fi network, email or contact card.',
        'Pick your colours and style, and add your school logo.',
        'Download a PNG or SVG, or copy the image.',
      ],
      questions: [
        { q: 'Do the codes expire?', a: 'No. The code holds your link or details directly, so it keeps working.' },
        { q: 'Is what I type sent anywhere?', a: 'No. The code is made in your browser.' },
      ],
    },
  },
  {
    name: 'Class lists',
    blurb: 'Keep your classes with a Learner ID for each learner, ready for answer sheets. Names stay on this device.',
    path: 'classes/',
    group: 'Classroom',
    help: {
      steps: [
        'Make a class and paste names, import a CSV or Excel file, or use numbers only.',
        'Each learner gets a Learner ID.',
        'Use the class in MCQ assessments, Cover sheets, the Markbook builder, the Class picker and Certificates.',
      ],
      questions: [
        { q: 'Where are the names kept?', a: 'Only in this browser. They are never uploaded.' },
        { q: 'Can I use numbers instead of names?', a: 'Yes. Each learner gets a number and no name.' },
      ],
    },
  },
  {
    name: 'Class picker',
    blurb: 'Spin a wheel to pick a learner fairly, or make random groups with keep-apart and keep-together rules.',
    path: 'picker/',
    group: 'Classroom',
    help: {
      steps: [
        'Add learners from a Class list, paste names, or use numbers.',
        'Untick anyone who is away today.',
        'Spin the wheel, or make random groups.',
      ],
      questions: [
        {
          q: 'Can I keep certain learners apart?',
          a: 'Yes. Set keep-apart and keep-together rules when you make groups.',
        },
        { q: 'Can I show it on the projector?', a: 'Yes. Use full screen, and press the space bar to spin.' },
      ],
    },
  },
  {
    name: 'Worksheet maker',
    blurb: 'Word searches, crosswords, matching, fill in the blanks and more, printed as a worksheet with its memo.',
    path: 'worksheets/',
    group: 'Classroom',
    help: {
      steps: [
        'Add activities: word searches, crosswords, matching, fill in the blanks, true or false, unscramble and more.',
        'Preview the worksheet.',
        'Print it or download the worksheet and memo as a PDF.',
      ],
      questions: [
        { q: 'Is the memo made for me?', a: 'Yes. Every worksheet comes with its memo.' },
        { q: 'Are my worksheets saved?', a: 'Yes, in this browser only.' },
      ],
    },
  },
  {
    name: 'Certificates and labels',
    blurb: 'Certificates, desk name cards, name labels, book labels and award slips for every learner on a list.',
    path: 'certificates/',
    group: 'Classroom',
    help: {
      steps: [
        'Add learners from a Class list, paste names, or import a CSV or Excel file.',
        'Choose certificates, desk name cards, name labels, book labels or award slips.',
        'Set the wording and design, and download one PDF.',
      ],
      questions: [
        {
          q: 'Can each certificate say something different?',
          a: 'Yes. Add columns such as Award, then put {Award} in the wording.',
        },
        { q: 'Are names and logos uploaded?', a: 'No. The PDF is made on this device.' },
      ],
    },
  },
]

/** The groups that have at least one Tool, each with its Tools, in display order. */
export function groupTools(tools: readonly Tool[]): { group: ToolGroup; tools: Tool[] }[] {
  return TOOL_GROUPS.map((group) => ({ group, tools: tools.filter((t) => t.group === group) })).filter(
    (g) => g.tools.length > 0,
  )
}
