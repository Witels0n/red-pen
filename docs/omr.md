# The sheet engine (OMR)

`src/shared/omr/` prints Answer sheets and Cover sheets and reads them back from copier scans and phone
photos, entirely in the browser. It has no page of its own: the MCQ Tool (Part C of
`docs/specs/2026-11-17-mcq-assessments.md`) and Split a PDF (Part D) use it. Decisions are in
`docs/adr/0003-omr-in-the-browser.md`.

## Public API

Import from `src/shared/omr` (the barrel). The worker imports `read.ts` directly.

```ts
// Layout: the single source of truth, pure, all positions in PDF points (origin top left, y down)
layoutSheet(spec: SheetSpec): SheetGeometry[]          // one per page, or only spec.page
layoutCoverSheet(cover: CoverSpec): SheetGeometry
questionRect(q: QuestionGeometry): Rect                // for Review crops
pageCount(questions: number): number                   // 50 questions per page

// QR payload
encodeSheetQr(qr: SheetQr): string                     // throws on anything that would not decode
decodeSheetQr(text: string): SheetQr | null            // strict; null for anything else
assessmentCodeFrom(id: string): string                 // 6 characters, stable

// Printing (pdf-lib, standard Helvetica, nothing remote)
renderAnswerSheetsPdf(specs: SheetSpec[]): Promise<Uint8Array>
renderCoverSheetsPdf(covers: CoverSpec[]): Promise<Uint8Array>

// Reading in a Web Worker (main thread)
createOmrReader(): OmrReader
  reader.read(image: ImageData | ImageBitmap, { templates: SheetSpec[], debug?: boolean }): Promise<SheetRead>
  reader.identify(image): Promise<IdentifyResult>      // corners and QR only (Cover sheets)
  reader.terminate(): void

// Turning uploads into pixels (main thread)
pdfPagesToImageData(bytes: Uint8Array, dpi = 200): AsyncGenerator<{ page, pages, image: ImageData }>
pageToImageData(pdf: PdfDocument, pageNumber: number, dpi = 200): Promise<ImageData>
photoToImageData(file: Blob, maxSide = 2600): Promise<ImageData>   // EXIF-upright; throws PhotoDecodeError
isReadableUpload(file: File): 'pdf' | 'photo' | null

// The same reader synchronously (tests, or a caller's own worker)
readSheet(image: RgbaImage, opts: ReadOptions): SheetRead
identifySheet(image: RgbaImage, qrHints?: string[]): IdentifyResult

// Review
REVIEW_THRESHOLD = 0.7
rectifyRegion(image: RgbaImage, homography: number[], rect: Rect, pxPerPt = 3): RgbaImage
```

`read()` transfers the image to the worker, so the caller's ImageData or ImageBitmap is unusable
afterwards. Keep the File (or a copy) if Review needs to show a crop; `SheetRead.homography` maps
layout points to that image's pixels, and `rectifyRegion(image, read.homography, questionRect(q))`
gives a straightened crop of a question.

### Templates

`readSheet` needs to know what was printed. `templates` holds one `SheetSpec` per Version, exactly as
printed (question count and options per question in that Version's order, the identity mode and
digit count). Learner fields are ignored. The QR chooses the template by Version and checks the
Assessment code; without a readable QR the first template is used and the result says the Version is
unknown when there is more than one.

### SheetRead

- `ok`: false when the page could not be read at all (no corner squares, a Cover sheet, another
  assessment's sheet). `problems[0]` says why, in words for the teacher.
- `answers[i]` is the option index (0 is A), `null` for blank, or `'multiple'`, for question
  `questionStart + i` (0-based). Page 2 has `questionStart` 50.
- `confidences[i]` is 0 to 1; `flags[i]` lists `light`, `erasure`, `multiple` or `misaligned`.
- `needsReview` is true when any question has a flag or a confidence below `REVIEW_THRESHOLD`, when
  the Learner ID is uncertain, or when the Version, page or orientation is in doubt. Anything marked
  `'multiple'` (including a crossed-out answer) always needs Review, as the spec requires.
- `identity.source` is `qr` when the QR names the learner, `bubbles` for the Bubbled ID grid.
  `idConfidence` is 1 for a QR and the weakest digit's confidence for bubbles.

## Sheet format

A4 portrait. Everything below is in `layout.ts`; the numbers here are for orientation only.

| Part | Where | Why |
| --- | --- | --- |
| Corner squares | 8 mm solid black, outer edge 9 mm from each page edge | Finding and straightening the page |
| Orientation mark | 8 x 3 mm bar, 3 mm right of the top-left square | Tells upright from upside down; the same spot by the bottom-right square is always blank |
| Sheet QR | 26 mm, top right, version 2, error correction M, about 1 mm modules | Assessment code, Version, Learner ID, page |
| Header | Title, name (named QR only), Learner ID, Version, page, three lines of instructions | For people; not read |
| Bubbled ID grid | Bubbled ID only: one column per digit, write-in box, circles 0 to 9 | Identity without a QR per learner |
| Answer grid | Up to 50 questions per page in 3 columns of up to 17 rows; gap after every 5 rows | The answers |
| Bubbles | 4.6 mm across, 7 mm apart, 6.6 to 8.5 mm between rows, letter inside in light grey | Big enough for a pencil, far enough apart to read |
| Footer | Assessment code, Version, page | For people |

The QR payload:

```
Answer sheet: RP1|<assessment code>|<version>|<learner id or ->|<page>/<pages>    RP1|K7QM2X|B|0042|1/2
Cover sheet:  RP1|COVER|-|<learner id>|1/1                                        RP1|COVER|-|0042|1/1
```

The Assessment code uses `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0, O, 1 or I). A Learner ID is 1 to 4
digits. Version is A to D; pages are 1 to 9. A QR never holds a name. Spare sheets in a QR mode
(no `learnerId`) carry `-` and a blank Learner ID line, so they come back with an unknown learner.

Cover sheets use the same corner squares, orientation mark and QR position, so one locator reads both.

## How a page is read

1. **Greyscale** (Rec. 601 luma) and, above 2600 pixels on the longer side, downscale by an integer
   factor. Copier PDFs are rendered at 200 dpi (A4: 1654 x 2339).
2. **Find the corner squares** on a copy about 1100 pixels long: adaptive threshold (local mean over a
   window of 1/14 of the image), 4-connected components, and per component a rotation-free squareness
   test. A solid square fills its convex hull (solidity above 0.88) and also the quadrilateral of its
   four extreme points (area ratio 0.85 to 1.22); a filled circle overflows that quadrilateral by about
   57%, rings fail solidity and bars fail the side ratio.
3. **Pick the best four**: every set of four among the 28 largest squares is scored on the area they
   enclose, similar sizes, the right size for the distance between them, and an aspect near A4's.
   Each centre is then refined at full resolution (flood fill at the midpoint between paper and ink).
4. **Verify and orient**: for each candidate set and each of the four rotations, compute the
   homography from layout points to image pixels, and require every corner to be solid dark inside
   with bare paper in a ring 1.6 mm outside it. This rejects a QR finder pattern posing as a corner.
   The rotation is chosen by the orientation mark (dark) against its blank twin, plus the page's aspect.
   If that is unsure the QR decides. No valid set: "All four corner squares must be in the photo".
5. **QR**: jsQR on a straightened crop of the QR area (at two resolutions, plain and contrast
   stretched), then jsQR on the whole image, then BarcodeDetector results passed as hints (the client
   runs BarcodeDetector on the main thread, and the worker tries it too, where the browser has it).
   The QR picks the template and page; with no QR a multi-page template's page is guessed from which
   page's bubble outlines fit the image best, and flagged.
6. **Paper and ink**: a paper map (90th percentile brightness per block of 1/40 of the image, dilated
   and smoothed) gives darkness relative to the paper under the same light, so shadows cancel out.
   The corner squares give the sheet's own printed black.
7. **Local alignment**: four points cannot describe a bent page or a wide lens, so each column of
   questions is shifted (up to 3 mm) and then each group of five rows (a further 1.5 mm, starting from
   the group above) to where the printed outlines line up best. How well they line up (the fit) is kept.
8. **Sample**: mean darkness inside 58% of each bubble's radius (inside the outline). Subtract the
   empty-bubble level (25th percentile per option letter, since letters differ in ink) and divide by
   the printed black: 0 is an empty bubble, 1 is as dark as the corner squares.
9. **Classify** (`classify.ts`): thresholds follow the learner's own pencil, from the median of each
   question's darkest bubble (`mark` is 45% of it, `faint` 20%, both clamped). Blank below `faint`;
   one answer when exactly one bubble reaches `mark`; `multiple` when two do (crossed-out answers land
   here); a light mark between the two thresholds (low confidence); a second bubble between them is
   flagged as a possible erasure. Groups whose outline fit is under half the sheet's best fit are
   flagged `misaligned` and capped at confidence 0.4.
10. **Bubbled ID**: the same sampling and classification per digit column, with the median of all ID
    bubbles as the empty level.

## Measured accuracy

`tests/omr/synthetic.test.ts` prints sheets with the real printer, rasterises them with pdf.js, fills
them with pencil-like marks (wobbly fills of varying darkness, partial fills, light marks, erasures,
crossed-out answers, ticks, double answers, stray scribbles) and distorts them. Run
`OMR_REPORT=1 npx vitest run tests/omr/synthetic.test.ts --silent=false` for the table.

On 2026-11-17, 50 distortion cases over three sheets (50 questions named QR, 30 questions Bubbled ID,
page 2 of a 72-question ID-only QR sheet), 2336 questions:

- **99.9% read exactly as expected; 0 silent errors** (a wrong answer not sent to Review). The two
  wrong reads were both flagged, under a hard-edged shadow across a row of bubbles.
- About 12.6% of questions go to Review, almost all of them the deliberately awkward marks
  (6 in every 50 questions: crossed out, double, light), as intended.
- Every case passes: copier scans at 100, 150 and 200 dpi, rotations of plus or minus 5 degrees, 177,
  180 and landscape (90 and 270), keystone up to 18% plus side tilt, the page filling 55% of the frame,
  1200 to 4000 pixel photos, blur up to 2.5 pixels, JPEG quality 30, noise up to 18 levels, shadow
  ramps of 45%, low contrast (90 to 200), dim warm light, overexposure, white and black tables, lens
  barrel 2%, paper curl, and phone combinations of all of these.
- Without a readable QR: Bubbled ID sheets still read fully; QR sheets read their answers with the
  learner unknown; page 2 is recognised from its layout; all flagged for Review.

Beyond the matrix (one-off probes, same sheet):

| Condition | Result |
| --- | --- |
| Rotation 10, 20, 30 degrees | All correct |
| Rotation 45 degrees with the corners out of frame | Rejected (corner squares missing) |
| Keystone 25 to 38% | All correct |
| Page only 28% of a 2400 pixel frame | All correct |
| Blur 3.5 and 5 pixels | Answers correct; at 5 pixels the QR fails, so the learner is unknown |
| Noise 45, JPEG quality 8, contrast squeezed to 130 to 175, shadow ramp 75% | All correct |
| Hard shadow edge across bubbles (55%) | Two questions wrong but sent to Review |
| Lens barrel 5% / 8% / 12% | 10 / 27 / 31 questions sent to Review as misaligned, 0 silent errors |
| Paper curl 35 pixels | 5 questions sent to Review, 0 silent errors |

### Speed

About 120 to 370 ms per page in Node (median 250 ms) on this machine, and 280 to 430 ms through the
real worker in Chromium (including the transfer). Rendering a PDF page at 200 dpi costs a little more.

### Limits and what is not tested

- **Synthetic only.** No real paper, pencils, copiers or phone cameras have been through it yet. The
  pencil model is a grey fill with a wobbly edge. Calibrate `deriveThresholds` and `REVIEW_THRESHOLD`
  on real sheets before trusting the Review rate.
- Only grey pencil marks are modelled. Blue, black and red pens should read as dark (luma), but are untested.
- A hard shadow edge running across a row can push a read wrong (it is flagged, not silent).
- The Bubbled ID grid is aligned like the answers but has no misalignment flag of its own; a bad
  read there usually shows as a blank or multiple digit, which lowers `idConfidence`.
- Live camera scanning, HEIC on browsers that cannot decode it, and sheets not printed at 100% scale
  (for example "fit to page" with a large shrink) are out of scope. Mild scaling is harmless since
  the corners define the scale.
- One page per image. Two sheets in one photo are not supported.

## Tests

- `tests/omr/layout.test.ts`: layout invariants (no overlaps, inside the printable area, 50 per
  page, multi-page split, every option count, the blank orientation twin, QR content).
- `tests/omr/payload-and-maths.test.ts`: QR round trips and rejections, classification maths,
  homography, square detection.
- `tests/omr/synthetic.test.ts` with `tests/omr/harness.ts`: the distortion matrix above (Node,
  pdf.js legacy build and `@napi-rs/canvas`).
- `smoke/omr.spec.ts`: the real worker in Chromium on the production code and CSP, through the
  test-only page `smoke/omr-harness/`, which exists only in `npm run build:smoke` (`SMOKE_PAGES` in
  `vite.config.ts`). `tests/build-output.test.ts` checks the production build does not contain it.
