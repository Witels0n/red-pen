# Moderation forms (J1, J2, J3)

Three Tools in a new **Moderation** group on the landing page. Each is a form to fill in that
downloads a PDF laid out like the official Gauteng Department of Education annexure. Teachers fill
in many of these a year, so details typed once are remembered.

| Tool                      | Form                                                 | Page                         |
| ------------------------- | ---------------------------------------------------- | ---------------------------- |
| J1 Pre-moderation         | Pre-assessment moderation tool                       | A4 portrait, one page blank  |
| J2 Post-moderation        | Post assessment moderation tool                      | A4 portrait, three pages blank |
| J3 Evidence of moderation | Evidence of school moderation, up to six SBA tasks   | A4 landscape, always one page |

The wording of every criterion and heading comes from the source documents and lives in
`src/moderation/core/forms.ts`.

## Naming

The source file `J1_J3_Pre_Post_moderation_tools.doc` holds the pre-assessment tool (labelled
"Annexure J 1") and the evidence of school moderation page, which is labelled "Annexure J 2" in
that file even though the post assessment tool in `J2_Post_moderation_tools.doc` is also "Annexure
J 2". The evidence page is treated as J3 and prints "Annexure J 3". The label at the top right of
each form can be changed on the page.

## Filling in

- Every field is optional. A form can be downloaded half filled, or blank ("Download a blank
  form") to complete by hand.
- Dates are picked with a date field and print as "18 November 2026" ("18 Nov 2026" on J3).
- Choices that the paper form asks you to circle (YES or NO, approved / conditionally approved /
  disapproved, circuit / district / provincial) are drawn circled.
- Signature lines and boxes are always left empty.
- J1 has no place for the task's name on the official form. A "Task, for your own records" field
  is used for the file name and the saved form's name only.

## Layout rules

- J1 and J2: a row grows to fit its comment, a row never splits across pages, a section heading
  stays with its first row, and pages are numbered when there is more than one. J1's decision and
  signature block stays together.
- J2's table of poorly answered questions prints the rows that are used, and at least five.
  The overall impression box is ruled for handwriting when nothing was typed in it.
- J3 never runs past one page: names, tasks and marks shrink and are then cut short with "...",
  and comments are held to five lines.
- Text is set in Helvetica (pdf-lib's standard fonts, metric-compatible with the Arial of the
  official forms). Characters those fonts cannot draw are dropped rather than failing the PDF.

## Logo

The official forms carry the department's logo. It is not bundled with Red Pen. A teacher adds it
once as a PNG or JPEG; it is shrunk, kept in `localStorage` (`red-pen.moderation.logo`) and printed
on all three forms.

## Storage

All in `localStorage`, never uploaded:

- `red-pen.moderation.details`: the School details shared by the three forms.
- `red-pen.moderation.<form>.draft`: the form being filled in, so a reload loses nothing.
- `red-pen.moderation.<form>.saved`: forms saved by name, to open again.

Unlike the Markbook and Rubric builders, these do hold learner names (J2 and J3 list the learners
whose work was moderated), which is why they stay on the device like Class lists do.

## Not in this version

- A preview of the PDF on the page.
- Picking the learners from a Class list.
- A Word (.docx) download.
