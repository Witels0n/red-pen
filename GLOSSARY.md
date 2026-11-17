# Red Pen

A site of tools for teachers. Every tool runs entirely in the browser. The first tool is the marker: teachers place annotations on the pages of a scanned test and export a marked copy.

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
