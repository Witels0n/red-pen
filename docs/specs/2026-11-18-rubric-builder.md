# Rubric builder

A Tool for building a Rubric, weighing its criteria and downloading it as an Excel file: the rubric
to print, and (optionally) a sheet per learner that works out the mark, plus a class summary.

## Styles

| Style        | Shape                                                              | Marks                                |
| ------------ | ------------------------------------------------------------------ | ------------------------------------ |
| Analytic     | Criteria down the side, levels across, a descriptor in every box   | A mark per criterion, weighted       |
| Holistic     | One scale for the whole piece, a descriptor per level              | One mark, from the level reached     |
| Single-point | Only the expected standard per criterion, space for "not yet" and "beyond" | A typed mark per criterion, or none |
| Checklist    | Items that are there or not                                        | The marks of each item ticked        |

A new rubric of each style opens on a small worked example to write over.

## Levels

Analytic and holistic rubrics have 2 to 8 levels. Each level is worth a share of a criterion's
marks, in percent, so a criterion out of 8 gives 6 at a level worth 75%.

Ready-made scales, all editable afterwards: four levels (Advanced to Beginning), three levels, the
CAPS achievement levels 7 to 1, the SOLO taxonomy and Marzano's proficiency scale 4.0 to 0.0. Each
scale carries a general prompt per level, shown as the placeholder of empty descriptor boxes.
Changing scale keeps descriptors by position.

**Bands.** With "Give each level a band of marks" on, each level's share is rounded to whole marks
and the level runs from one mark above the level below it; the lowest level starts at 0 (a
criterion out of 10 on the CAPS scale: 9-10, 8, 7, 6, 5, 4, 0-3). The builder warns when a
criterion has too few marks for every level to have its own band.

## Criteria and weights

- Weights are entered in marks, or in percentages of a stated rubric total. Switching keeps what
  each criterion is worth.
- **Share evenly** gives every criterion the same weight. **Scale to a total** rescales all
  weights in proportion. Both keep whole numbers and add up to exactly the total (largest
  remainder).
- A warning shows when percentages do not add up to 100.
- Optionally each criterion is tagged with a cognitive level from Bloom's revised taxonomy,
  Marzano's New Taxonomy, Webb's Depth of Knowledge, SOLO or the CAPS cognitive levels. The builder
  and the printed rubric show the share of the marks at each level.

At most 30 criteria.

## The workbook

Sheets, in order: **Rubric**, **Summary**, **Levels** (rubrics with levels), one sheet per learner
(`01 Thandi Mokoena`, numbered so names never clash), **Notes**. Without marking, or without
learners, it is the Rubric sheet alone. At most 120 learner sheets. Learners come from a Class
list, pasted names or a number of blank sheets.

Every rubric-shaped sheet prints on one page across (`fitToWidth`, added to the sheet XML by a
write-excel-file feature, since the library only sets orientation).

### Marking

A learner sheet is marked by typing `x` in a yellow tick-box cell. Plain cells are used, not
Excel's tick-box control, which only works in recent Excel 365 and not in Google Sheets or
LibreOffice.

- Analytic and holistic: one box per level. `x` gives the level's mark (the top of its band). A
  number typed instead of `x` is taken as the mark if it fits the level (0 to the criterion's marks
  without bands, within the band with them).
- More than one box, or a mark that does not fit, shows **Check**.
- Single-point: a typed mark per criterion, checked against its maximum; or, without marks, a box
  for "met".
- Checklist: `x` per item. A typed `0` marks work that has none of the items.
- The chosen level is shaded by conditional formatting.

Each learner sheet has a **Status**: "Not marked yet", "n still to mark", a Check message, or
**Marked**. The total, percentage, optional "mark out of N" (to one decimal) and optional CAPS
level (1 to 7, on the unrounded percentage) appear only on a complete sheet.

On an analytic sheet the formulas read the criterion's marks and the level's share from cells, so
both can be adjusted in Excel for one learner. The marks in brackets inside each descriptor are
plain text.

### Summary

One row per learner, filled in only once that learner's Status is Marked, so half-marked work and
learners who did not hand in never pull the averages down. Below: class average, average as a
percentage of each criterion, highest, lowest, learners marked, the strongest criterion and the one
that needs the most work, and (rubrics with levels) the number of learners at each level per
criterion, counted from the Levels sheet.

## Storage

The rubric being built is kept in `localStorage` under `red-pen.rubric.current`, and named rubrics
under `red-pen.rubric.saved`. Learner names are never stored: pasted names go into the download
only.

## Not in this version

- A PDF of the rubric (the Rubric sheet prints from Excel).
- Marking inside the browser.
- Dropdowns or protected cells in the workbook.
