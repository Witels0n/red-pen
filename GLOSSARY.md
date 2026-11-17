# Red Pen

A site of tools for teachers. Every tool runs entirely in the browser. The first tool is the marker: teachers place annotations on the pages of a scanned test and export a marked copy. The PDF tools combine, split and organise PDFs.

## Language

### The site

**Red Pen**:
The whole site: the landing page plus every tool.
_Avoid_: App, platform, PDF Marker (the old name of the site)

**Tool**:
One job on its own page (for example "Mark a test"), listed on the landing page.
_Avoid_: App, feature, module

### Marking

**Test**:
One learner's scanned work, supplied as a single PDF.
_Avoid_: Paper, script, exam, document

**Learner**:
The person whose work is being marked.
_Avoid_: Student, pupil

**Annotation**:
Anything a teacher places on a page of a test: a tick, cross, subtotal, total or text note.
_Avoid_: Marker, stamp, item

**Mark**:
One point of credit. A tick is worth one mark; a cross is worth none.
_Avoid_: Point, score (for a single tick)

**Tick**:
An annotation that awards one mark. Placed by clicking.
_Avoid_: Check, checkmark

**Cross**:
An annotation indicating an incorrect answer; worth no marks. Placed by right-clicking.
_Avoid_: X mark, error mark

**Reason**:
An optional label attached to a cross saying why the answer was wrong, chosen from a list (for example "Factual error", "RTQ", "Repeated fact").
_Avoid_: Error code, comment

**Subtotal**:
An annotation showing the number of ticks since the previous subtotal, counted in reading order (page, then top to bottom, then left to right). Recalculates live as ticks change.
_Avoid_: Running total, section total

**Total**:
An annotation showing the number of ticks in the whole test out of a maximum the teacher enters (for example 17 / 40). Counts every tick, whether or not a subtotal follows it.
_Avoid_: Grand total, final score

**Text note**:
A free-text annotation the teacher drags onto a page and types into.
_Avoid_: Comment, label

**Ink colour**:
The single colour in which every annotation of a test is drawn, on screen and in the exported copy. Chosen by the teacher from a fixed set (red by default); changing it recolours all annotations, including those already placed. Remembered in the browser between tests.
_Avoid_: Pen colour, marker colour, annotation colour

### MCQ assessments

**Assessment**:
The questions, options, pictures, marks, Memo, Topics and Versions of one multiple-choice test, its Learner list or Class list link, plus its results (the reads and Review decisions, never the scans). Saved in the browser and exportable as an Assessment file (JSON).
_Avoid_: Quiz, test (a Test is one learner's scanned work in the marker), exam

**Memo**:
The correct option for each question. Correcting it re-marks every learner at once from the stored reads.
_Avoid_: Answer key, key, solutions

**Topic**:
An optional tag on a question (for example "Fractions"), used for per-learner and class breakdowns and for "Topics to revise". Questions without one count only toward the total; an Assessment without any Topics shows no Topic columns, sections or slip parts.
_Avoid_: Category, tag, skill

**Shared paper**:
The one question paper every learner gets by default (Version A). Its questions are in the order the teacher entered them, and each question's options are shuffled once, the same for everyone, so the correct answers spread across the letters. The teacher types the Memo in their own (entered) order; Build shows where each correct answer is "Printed as", and marking maps the printed letters back. With no question text or pictures (the teacher's own paper), the options print in the entered order.
_Avoid_: Master copy, form

**Version**:
A shuffled order of questions and options (A, B, C, D), an advanced option for 2 to 4 different papers. Version A is the shared paper; marking maps answers on every Version back to the entered order. The shuffle is seeded and stored, so a reprint matches.
_Avoid_: Variant, form, paper

**Learner list**:
The learners an Assessment is written by when they do not come from a saved Class list: pasted names, a number of learners (IDs only) or an imported CSV or Excel file. Stored with the Assessment (and in its Assessment file, names included), used for printing, marking and results exactly like a Class list, and can be saved as a Class list for reuse.
_Avoid_: Roster, embedded class

**Picture**:
An optional image in a question or in one of its options, added in Build and printed in the question booklet. Stored in the Assessment as a downscaled PNG or JPEG; it follows its option through any shuffle. Not in the questions CSV.
_Avoid_: Image (in UI text), attachment

**Answer sheet**:
The A4 bubble sheet a learner fills in, with corner squares and a QR code holding the Assessment code, the Version, the Learner ID and the page. Never a name.
_Avoid_: Bubble sheet, OMR form, script

**Sheet identity**:
How a scanned Answer sheet is matched to a learner. One of: **Named QR** (a sheet per learner, QR holds the Learner ID, name printed on it), **ID-only QR** (the same, with no name anywhere) or **Bubbled ID** (one identical sheet for everyone; the learner fills in their Learner ID in a digit grid).
_Avoid_: ID mode, matching

**Review**:
The step where the teacher confirms uncertain reads: light, erased or double marks, unknown or spare sheets, duplicates and unread Versions, each shown beside the straightened scan.
_Avoid_: Verification, checking, moderation

**Item analysis**:
Per question: the percentage correct, how answers spread across the options, the most-chosen wrong option with its misconception note, and flags for too easy (over 90%), too hard (under 30%) and negative discrimination (the top third of the class did worse than the bottom third).
_Avoid_: Question stats, psychometrics

### Markbooks

**Markbook**:
A spreadsheet of learners' marks per assessment, made by the Markbook builder as an .xlsx with live Excel formulas for percentages, Category averages, the weighted mark, levels and a class summary. Its design (assessments, weights, options) is saved in the browser without learner names.
_Avoid_: Mark sheet, gradebook, register

**Category**:
A group of assessments in a Markbook (for example Tests or Exam) with its own weight. Its average weighs its assessments; the weighted mark weighs the Category averages. A blank mark or ABS is left out and the other weights share its place.
_Avoid_: Section, component (Topic is the MCQ term for a question tag)
### Question paper grids

**Grid**:
The analysis of one test or exam paper that an HoD asks for: each question's marks, Cognitive level and topic, with totals and shares against targets. Saved in the browser and exported as a one-page PDF or an Excel file.
_Avoid_: Analysis grid (in UI text), blueprint, spec

**Cognitive level**:
How demanding a question is, from a chosen taxonomy (CAPS levels, Bloom's revised, Barrett's, or the teacher's own levels). Each level has a target percentage of the paper, remembered per teacher.
_Avoid_: Bloom level (unless the taxonomy is Bloom's), difficulty (a separate, optional column)

**Tolerance**:
How many percentage points a level's or topic's share may be off its target before the Grid flags it as over or under (5 by default).
_Avoid_: Margin, allowance
### Marks analysis

**Assessment card**:
One column of pasted or imported marks in Marks analysis, with its name, "out of", counts of marks, absent and unreadable cells, and a tick box to include it. Not saved: marks and names are kept only while the page is open.
_Avoid_: Assessment (that is an MCQ assessment), series, column (in UI text)

**Out of**:
The total a column's raw marks are out of, from its heading (`Test 1 (40)`), typed on the card, or per cell (`34/50`). Without one, values from 0 to 100 are assumed to be percentages.
_Avoid_: Maximum, total (that is the marker's annotation)

**Unreadable mark**:
A cell that is not a mark or an absence (a word, a negative number, or more than its "out of"). Left out of the figures and listed under its card to correct in place.
_Avoid_: Error, invalid value

**Calculated column**:
A column whose heading says Average, Avg, Total or Term mark. Analysed like any other, but left out of improved and dropped.
_Avoid_: Formula column, derived column

**Band scheme**:
How percentages are grouped for the band chart: CAPS 7 levels (the default), 10% bands, symbols (A to H) or custom cut-offs. A mark is banded by its exact percentage, before rounding.
_Avoid_: Grade scale, levels (unless CAPS)

**Insight**:
A short, tentatively worded observation worked out from the figures (for example a wide spread or a ceiling), with its thresholds fixed in code and explained on the page.
_Avoid_: Finding, diagnosis

### PDF tools

**Part**:
One of the PDFs a split produces, named after the original with a number (for example `class-part-03.pdf`), or after the learner when split at Cover sheets (for example `Thandi Mokoena.pdf`). All parts download together in one .zip.
_Avoid_: Chunk, piece, segment

**Range**:
A run of pages written as the teacher types it: a single page (`7`) or a first and last page (`4-6`), counted from 1. Custom ranges are separated by commas and each one becomes a part.
_Avoid_: Selection, interval

**Turn**:
A quarter rotation the teacher gives a page in Organise pages. It is added to the rotation the page already has and stored in the saved PDF, so the page itself is never redrawn.
_Avoid_: Re-render, flip

**Crop corners**:
The four handles the teacher places on the corners of the sheet in a photo, in Photos to PDF. The page inside them is straightened (perspective corrected) into a rectangle. Suggested automatically when the sheet stands out from the background, otherwise the whole photo.
_Avoid_: Crop box, selection

**Look**:
How a photographed page is finished in Photos to PDF: Original, Greyscale, Black and white (crisp text, judged against each pixel's surroundings) or Enhanced colour (even light, white paper). Called a filter in code.
_Avoid_: Effect, mode

**First page**:
In Photos to PDF, a page the teacher marks as the start of a learner's work. Page 1 and each First page start a new Part.
_Avoid_: Divider, separator
**Booklet**:
A4 pages laid out two to a side on landscape sheets, in the order that makes an A5 booklet once the sheets are printed double-sided, stacked, folded and stapled along the fold. Padded with blank pages to a multiple of 4.
_Avoid_: Brochure, pamphlet

**Sheet**:
One piece of paper that comes out of the printer. A booklet sheet has a front and a back, each carrying two pages.
_Avoid_: Page (a page is one page of the original PDF)

**Creep**:
How far the inner sheets of a folded booklet stick out past the outer ones. Booklet printing can move the inner pages towards the fold to allow for it, or ignore it (the default).
_Avoid_: Shingling

**Target size**:
The size each compressed PDF must be under (for example 2 MB, for an email). Compress a PDF tries lower resolutions and picture quality until each file fits, or says it could not.
_Avoid_: Limit, quota
**Watermark**:
Large, faint words (for example MEMO or DRAFT) that Stamp and number draws across a page, diagonally or straight across, as real text in the PDF.
_Avoid_: Background, overlay

**Stamped page**:
A page that Stamp and number adds its watermark, page number, header and footer to: every page, odd or even pages, or custom pages. Page numbers count only stamped pages, so a cover page can be left out.
_Avoid_: Marked page, selected page

**Redaction box**:
A black or white box the teacher draws over something that must not be seen (usually a learner's name), on one page or on every page. Saving turns each page with a box into a picture with the box painted on, so what was under it is gone from the file. One box layout applies to every file in a batch.
_Avoid_: Mask, cover, blackout

**Anonymised name**:
The name a redacted file is given in place of the learner's, such as "Learner 07", also written in labelled Redaction boxes. Numbers are given out in a shuffled order by default, so they do not follow the class list.
_Avoid_: Code name, alias

**Anonymisation key**:
The CSV that links each original file name to its Anonymised name. Downloaded separately from the redacted files and kept apart from them.
_Avoid_: Mapping, lookup

### QR codes

**Content type**:
What a QR code holds: a link, plain text, Wi-Fi details, an email or a contact card. Each has its own fields.
_Avoid_: Mode, format

**Payload**:
The exact text a QR code carries, built from the content (for example `WIFI:T:WPA;S:Room 12;P:secret;;`). Its length in bytes decides whether it fits.
_Avoid_: Data, value

**Module**:
One dark or light square of a QR code's grid. Drawn as a square, rounded shape or dot.
_Avoid_: Pixel, dot (except as the shape name)

**Eye**:
One of the three large squares in the corners of a QR code (the finder patterns) that scanners look for first.
_Avoid_: Corner, anchor

**Quiet zone**:
The empty border around a QR code, measured in modules. Scanners need it to find the code.
_Avoid_: Padding, margin (in UI text)

**Error correction**:
How much of a QR code can be covered or damaged and still scan: L, M, Q or H. Adding a logo sets it to H.
_Avoid_: Redundancy, quality

### Signing and filling

**Form field**:
A fillable field built into a PDF (an AcroForm text box, checkbox, radio button or dropdown). Sign and fill shows each one as an input over the page, writes the values in on save and then flattens the form.
_Avoid_: Widget, input (outside code)

**Detected box**:
A place on a flat or scanned page that looks like it is meant to be filled in, found by image processing (no OCR): a line to write on, a box or table cell, or a small tick box. Shown as a dashed outline; clicking one places text sized to fit, or ticks the tick box. A helper only: the teacher can click anywhere.
_Avoid_: Field (that is a form field), zone, hotspot

**Signature**:
The teacher's (or parent's) handwritten name as an image with a transparent background, made by drawing, typing in a script font or uploading a picture. **Initials** are made the same way. Kept only for the current visit unless the teacher ticks "Remember on this device".
_Avoid_: E-signature, digital signature (Red Pen does not add cryptographic signatures)

### Classes

**Class list**:
A named list of learners, each with a Learner ID and optionally a name. Stored only in the browser it was made in; exported and imported as a class file (CSV with the columns `Learner ID,Name`) for backup or moving devices.
_Avoid_: Roster, register, class (on its own, in UI text about the list)

**Learner ID**:
A short number (1 to 4 digits, chosen per Class list) that identifies a learner without a name, always written with leading zeros to the list's digit count (for example `07`). A QR on paper holds the Learner ID, never a name. It stays with the learner when the list is reordered or sorted.
_Avoid_: Student number, learner number, index

**Cover sheet**:
An A4 page with a learner's name (optional), Learner ID and a QR code holding only the Learner ID, stapled to the front of a written test. A class's tests are scanned in one batch, and Split a PDF starts a new part at each Cover sheet, named after the learner when the Class list is on the device. Printed by the Cover sheets Tool.
_Avoid_: Title page, front page, separator sheet

### Class picker

**Wheel**:
The spinning wheel in the Class picker. Its slices are the learners who are here today, or the options of a custom wheel (for example topics, or Yes and No), saved on the device. The winner is chosen first with the browser's secure random numbers, then the wheel spins to land on it. Long lists show as a ticker instead.
_Avoid_: Spinner, randomiser

**After picked**:
Whether a picked learner comes off the wheel ("Remove") or stays on for another turn ("Keep in"). Set for the whole wheel, and optionally per learner. Undo puts a removed learner back.
_Avoid_: Replacement, elimination

**Group rule**:
A rule for random groups: keep apart (these learners are all in different groups) or keep together (all in one group). Rules are always kept; when they cannot be, the Class picker says why instead of making groups.
_Avoid_: Constraint (in UI text), condition

**Locked group**:
A group kept exactly as it is when the others are re-shuffled.
_Avoid_: Fixed group, pinned group
### Worksheets

**Worksheet**:
A printable page or pages made in the Worksheet maker: a heading (title, instructions, optional Name, Class and Date lines, and the total marks, added up automatically) and one or more Activities. Printed as a PDF with its Memo pages after it. Saved in the browser on this device only (localStorage), with any pictures downscaled.
_Avoid_: Handout, activity sheet

**Activity**:
One numbered section of a Worksheet, of one type: word search, crossword, match the columns, fill in the blanks, true or false, unscramble the words, vocabulary or label the diagram. Each shows its marks (marks each item times the number of items). Its shuffles and layout come from a stored seed, so a saved Worksheet prints the same every time; Shuffle picks a new seed.
_Avoid_: Section, exercise, question (in UI text about the whole block)

**Word bank**:
A box of the answers in shuffled order, printed above a fill in the blanks, vocabulary or labelling Activity when the teacher ticks it.
_Avoid_: Word list (that is the list of words to find in a word search)
### Certificates and labels

**Recipient list**:
The people a batch of certificates or labels is made for, one row each, from a Class list, pasted rows or a CSV/XLSX file. Each column is a merge field. Never stored by the Tool.
_Avoid_: Mailing list, data source (in UI text)

**Merge field**:
A placeholder in braces, such as `{Name}`, `{Award}` or `{Date}`, filled in per learner from the column with that title (case does not matter). A field no column has prints as typed, so a typo shows on the preview. `{{` and `}}` print a literal brace.
_Avoid_: Tag, variable, placeholder (in UI text)

**Product**:
What Certificates and labels prints: certificates, desk name cards (folded tent cards, two per A4 sheet), name labels (sticker sheets), book labels or award slips (four per A4 page).
_Avoid_: Template, output
