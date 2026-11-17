# Marks analysis

A Tool that takes a set of marks for one or more assessments and shows a distribution, summary
statistics and plain-language insights, with a one-page report for the HoD.

## Input

- Paste from Excel (one or more columns), or import CSV or XLSX.
- "First row is headings" and "First column is names" tick boxes, each auto-detected and editable.
  The names column is detected when the first column is mostly text.
- An "Analyse these marks" button in MCQ results hands over percentages and names via
  `sessionStorage`.
- Each column becomes an **assessment card** with a name, an editable "out of", a "calculated" tag
  and counts for marks, absent and unreadable. A card can be included or excluded.

### Out of

- Header `Test 1 (40)`, `Test 1 /40` or `Test 1 - 40`: raw, out of 40.
- Cell `34/50`: 34 out of 50, which overrides the column's "out of" for that cell. Cell `68%` is a
  percentage.
- No total and every value 0 to 100: percentages are assumed, with a visible prompt
  "Assumed percentages. Is this out of something else?"
- Any value above 100 and no total: the column is not analysed until an "out of" is entered.
- A header containing Average, Avg, Total or Term mark: tagged **calculated**. Still analysed, but
  left out of improved and dropped lists.

### Cells

- `34`, `34.5`, `34,5`: a mark.
- Blank, `ABS`, `A`, `AB`, `-`, `X` (any case): absent. Counted, left out of stats.
- Anything else, a negative number, or a mark above its "out of": **unreadable**. Left out of stats and
  listed under the card by row and name. Cells can be corrected in place.

## Settings

- Band scheme: CAPS 7 levels (default: 0-29, 30-39, 40-49, 50-59, 60-69, 70-79, 80-100),
  10% bands, IEB-style symbols, or custom cut-offs.
- Pass mark: default 50%, quick picks 30, 40, 50, or custom.
- Settings persist in `localStorage` under `red-pen.marks.`. Marks and names are never stored; a
  `beforeunload` prompt warns when data has been pasted.

## Stats

Count, absent, mean, median, SD (population, in percentage points), min, max, range, quartiles,
outliers (1.5 x IQR), pass rate, count and percentage per band. All in percentages, shown to one
decimal place. Bands use the exact percentage, **before rounding** (29.6% is Level 1).

Learners are matched across assessments by row. Names are labels only.

## Results view

Single column on a phone, two columns from tablet width.

- One assessment: headline row (mean, median, SD, pass rate, highest, lowest), band chart with the
  pass mark line, box plot with outlier dots, three to six insights, and (with names) all learners
  below the pass mark ("needs support"), top five and outliers. Ties broken by row order, marked
  "joint".
- Two or more: an Overview tab first (comparison table, band charts as small multiples on a shared
  scale, box plots side by side, comparison insights, improved most and dropped most between two
  chosen assessments, defaulting to the last two non-calculated ones, only learners with both
  marks, with a "left out" count), then a tab per assessment.

## Insights

Thresholds live in `src/marks/core/insights.ts`. Wording stays tentative, and the page has a short
"How these are worked out" note.

| Insight      | Rule                                                      |
| ------------ | --------------------------------------------------------- |
| Spread       | SD < 10 tight, 10 to 18 typical, > 18 wide                |
| Skew         | mean minus median ≤ -5 or ≥ +5                            |
| Two groups   | at least 15 marks and two peaks in 10% bins with a clear gap |
| Ceiling      | over 30% in the top band                                  |
| Floor        | over 30% in the bottom band                               |
| Pass rate    | always                                                    |
| Absentees    | any absent                                                |
| Mean change  | difference ≥ 5 between consecutive assessments            |
| Spread change | SD difference ≥ 5 between consecutive assessments        |

Fewer than 5 marks: spread, skew and two groups are hidden ("Too few marks for reliable patterns").
SD of 0: "Every learner got the same mark."

## Report

One A4 page via pdf-lib: title, optional class and subject (typed on export, not stored), date,
summary table, band chart (small multiples up to 4 assessments, otherwise table and box plots only),
top 4 insights, and an editable comments box (about 600 characters). No names by default; a tick box
adds a second page listing learners below the pass mark. CSV exports of the summary and of
per-learner percentages.

## Structure

```
marks/index.html
src/marks/core/{parse,stats,insights,compare}.ts   pure, Vitest-tested
src/marks/chart/{model,svg}.ts                      one chart model, SVG on screen
src/marks/report/pdf.ts                             pdf-lib report from the same chart model
src/marks/ui/
```

The pdf-lib layout helpers move from `src/mcq/pdf/layout.ts` to `src/shared/` so both tools use them.

## Testing

Vitest for parse, stats, insights (each threshold, small-class suppression), compare and the chart
model; a one-page report test; Playwright smoke tests at desktop and phone sizes, exports, and the
MCQ hand-off.

## Out of scope

Saving analyses, per-question analysis, grade-wide comparisons, markbook building.
