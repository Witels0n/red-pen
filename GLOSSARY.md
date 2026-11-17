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

### PDF tools

**Part**:
One of the PDFs a split produces, named after the original with a number (for example `class-part-03.pdf`). All parts download together in one .zip.
_Avoid_: Chunk, piece, segment

**Range**:
A run of pages written as the teacher types it: a single page (`7`) or a first and last page (`4-6`), counted from 1. Custom ranges are separated by commas and each one becomes a part.
_Avoid_: Selection, interval

**Turn**:
A quarter rotation the teacher gives a page in Organise pages. It is added to the rotation the page already has and stored in the saved PDF, so the page itself is never redrawn.
_Avoid_: Re-render, flip

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
