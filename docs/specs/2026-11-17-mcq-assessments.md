# MCQ assessments, class lists and QR cover sheets

Status: agreed in conversation on 2026-11-17. Built as four parts (A to D, below).

## Goal

A teacher builds a multiple-choice Assessment, prints an Answer sheet per learner, scans the completed
sheets (copier PDF or phone photos), checks anything uncertain, and gets a marksheet plus diagnostic
analysis back. Everything runs in the browser (ADR 0001). Version 1 includes topic tags and the
diagnostic breakdown.

## Words

- **Assessment**: the questions, options, marks, Memo, Topics and Versions. Saved in the browser and
  exportable as an Assessment file.
- **Memo**: the correct option for each question.
- **Topic**: a tag on a question (for example "Fractions"), used for per-learner and class breakdowns.
- **Version**: a shuffled order of questions and options (A, B, C...). Marking maps answers back to the
  original order.
- **Class list**: a named list of learners, each with a Learner ID and optionally a name.
- **Learner ID**: a short number (1 to 4 digits, chosen per class list) that identifies a learner
  without a name.
- **Answer sheet**: the A4 bubble sheet a learner fills in.
- **Sheet identity**: how a scanned Answer sheet is matched to a learner. One of:
  1. **Named QR**: a printed sheet per learner, QR holds the Learner ID; name printed on the sheet.
  2. **ID-only QR**: a printed sheet per learner, QR holds the Learner ID; no name anywhere.
  3. **Bubbled ID**: one identical sheet for everyone (photocopy a master); the learner fills in their
     Learner ID in a digit grid. No class list or names needed.
- **Cover sheet**: a page with a learner's name and QR, stapled to the front of a written test, used to
  split a batch scan per learner.
- **Review**: the step where the teacher confirms uncertain reads.

## Privacy

Names never leave the device. A QR on paper holds only the Assessment code, the Version and the
Learner ID, never a name. Class lists and Assessments are stored in IndexedDB, with export and import
as files for backup or moving devices. Scans are never stored after the session unless the teacher
saves the results file.

## Sheet design (the contract between printing and reading)

- A4 portrait. Four solid square corner markers (fiducials) for finding and straightening the page.
- A sheet QR (top right) holding `RP1|<assessment code>|<version>|<learner id or ->|<page>/<pages>`.
  The assessment code is 6 characters derived from the Assessment's id. For Bubbled ID sheets the
  learner field is `-`.
- For Bubbled ID: a digit grid (columns = digits in the Learner ID, rows 0 to 9).
- Answer grid: up to 50 questions per page in columns, options A to E (fewer per question allowed).
  More than 50 questions continue on a second page with the same header and QR (page 2/2).
- A printed header: assessment title, learner name (named QR only), Learner ID, Version letter, and
  short filling instructions ("Fill the circle completely. To change an answer, cross it out and fill
  another.").
- Layout is computed by one pure function `layoutSheet(spec) -> geometry` (all positions in PDF points)
  used by BOTH the PDF printer and the reader, so they can never disagree.

## Reading a sheet (OMR)

1. Input: copier PDF pages (rendered with pdf.js at about 200 dpi) or phone photos (JPG/PNG/HEIC where
   the browser can decode it).
2. Find the four corner markers; compute a perspective transform to the layout's coordinates. Photos
   with a marker missing are rejected with a clear reason.
3. Decode the QR (BarcodeDetector where available, jsQR otherwise). If unreadable, fall back to the
   Bubbled ID grid or send to Review.
4. Sample each bubble's darkness relative to the sheet's own paper and ink levels. Classify each
   question as one answer, blank, or multiple. Crossed-out answers count as multiple and go to Review.
5. Every read carries a confidence; anything below the threshold goes to Review.

## Parts

### A. Class lists (`classes/`, shared module `src/shared/classes/`)
A Tool to create and manage Class lists: type or paste names, or import CSV/XLSX and pick the name
column(s) (for example First name + Surname) and optionally an ID column. Assign Learner IDs
automatically (1, 2, 3... with the chosen digit count) or keep imported ones. Saved in IndexedDB;
export/import as CSV. The shared module exposes a small API (`listClasses`, `getClass`, `saveClass`,
`importSpreadsheet`) used by B, C and D. Spreadsheet reading: `read-excel-file` (pin a release at least
two weeks old); CSV parsed in-house.

### B. Sheet engine (`src/shared/omr/`), no page of its own
`layoutSheet`, `renderAnswerSheetsPdf` (pdf-lib), `renderCoverSheetsPdf`, and `readSheet(image) ->
{ identity, version, page, answers[], confidences[], problems[] }`, plus QR encode/decode helpers.
Heavy work runs in a Web Worker. Tested with synthetic sheets: generate the PDF, rasterise it, fill
bubbles programmatically, add rotation, skew, perspective, blur, noise and uneven lighting, and assert
the reads.

### C. MCQ assessments (`mcq/`)
- **Build**: title, number of questions, options per question (2 to 5), marks per question, Memo,
  optional question text and option text, Topic per question, optional "misconception" note per wrong
  option. CSV export and import of questions (documented columns). Question bank: reuse questions from
  past Assessments, searchable by Topic.
- **Versions**: 1 to 4, shuffling question order and/or option order.
- **Print**: Answer sheets in the chosen Sheet identity mode (from a Class list for QR modes, plus N
  spare sheets with a blank name line); question booklet per Version (if question text exists); Memo.
- **Mark**: upload PDFs and/or photos; reads run in the worker with progress; Review screen for
  uncertain reads, unknown IDs and duplicates (side by side crop of the bubbles).
- **Results**: marksheet (per learner total, percentage, per question, per Topic) downloadable as XLSX
  and CSV; class heatmap (learners by questions); item analysis (percentage correct, most-chosen wrong
  option with its misconception note, flags for too easy, too hard, and questions the top third got
  wrong more than the bottom third); re-mark instantly after a Memo correction.
- **Return**: feedback slips PDF (score, Topic breakdown, Topics to revise), and marked answer sheets
  PDF split per learner (zip), reusing the marker's tick and cross drawing.
- **Assessment file**: save and load the Assessment, Class list link and results as one JSON file.

### D. QR cover sheets (`covers/`) and "split at cover sheets" in Split a PDF
Print Cover sheets from a Class list (name, Learner ID, QR, space for the test title). In Split a PDF,
a new mode detects Cover sheet pages, starts a new part at each one, and names parts after the learner
(name if the Class list is on this device, otherwise the Learner ID).

## Order

A and B in parallel (B needs only the Learner ID type from A). Then C and D in parallel.

## Out of scope for version 1

Live camera scanning inside the page (photos are taken with the phone's own camera app and uploaded),
handwriting recognition, sharing results online, maths typesetting in questions.

## Changes after first release

Asked for by teachers after the first release (2026-11-17):

1. **Learners without a saved Class list.** Print asks "Who is writing?": a saved Class list, pasted
   names (one per line, Learner IDs 1, 2, 3... with a digit count that fits), numbers only ("How many
   learners?") or an imported CSV or Excel file (sheet, header row, name columns in order, optional
   ID column, preview with row problems). The result is a **Learner list** stored with the
   Assessment and used for printing, marking, Review, results and returns exactly like a Class list.
   "Save as a Class list" keeps it for reuse. Bubbled ID still works with no list; a list adds names.
   Note: a Learner list's names are in the Assessment file, unlike a Class list's.
2. **Pictures in questions.** A picture per question and per option: added by file picker, drag and
   drop or paste, downscaled to at most 1000 px on the longer side and re-encoded (PNG with
   transparency, otherwise JPEG at 0.85). Stored as data URLs; the Assessment file carries them and
   checks them on import (PNG or JPEG only, at most 3 MB each). The question booklet embeds them
   (options with pictures in two columns, kept together across page breaks; picture-only options
   allowed). They follow their option through any shuffle. The questions CSV has no pictures: on
   import the teacher chooses whether to keep the pictures by question number.
3. **One shared, shuffled paper by default.** New Assessments have 1 Version, 4 options and
   "Shuffle the options once (same for everyone)" on: Version A (the **shared paper**) keeps the
   question order and shuffles each question's options with a stored seed, chosen so the correct
   answers spread evenly across the letters. The Memo stays in the teacher's entered order; Build
   shows a "Printed as" letter per question, the Memo PDF shows both letters, and marking maps back
   as for Versions. "Shuffle again" warns when results exist. Without question text or pictures,
   the shuffle is off and explained. Versions (2 to 4) remain under an advanced section.
4. **Topics are optional everywhere.** With no Topics, the marksheet, its exports, the item
   analysis, the Memo PDF, the results and the feedback slips leave out every Topic part.

**Assessment file schema 2.** Adds `versions.shuffleShared`, `print.learnerSource`
(`none`, `class`, `pasted`, `numbers` or `imported`), `assessment.learnerList` and optional
`questions[].image` and `questions[].optionImages`. A schema 1 file (and an Assessment saved in the
browser before this change) is read with the shared shuffle off and its learners from its Class
list (or none, for Bubbled ID without one), so sheets printed before still mark correctly.
