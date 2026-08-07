# Writing Style 2.0 Annotation Rubric

Version: `writing-style-rubric@2.0.0`

This rubric is for the synthetic, redistributable candidate corpus only. It never accepts user
project text. The checked-in corpus is a development artifact until two independent human
annotators and the editorial quality owner complete the fields recorded by the manifest.

## Labels

- `stacked-simile`: two or more `像` constructions in one sentence, excluding dialogue, quotation,
  factual lists, and quoted material.
- `explanatory-contrast`: an emotional or thematic `不是...是...` explanation, excluding factual
  corrections, dialogue, quotation, and ordinary classification.
- `mechanical-emotion`: `呼吸一滞`, `指尖发紧`, or `心口一沉`; one isolated occurrence is `low`,
  while repetition or a cluster within 96 UTF-16 code units is `medium`.
- `direct-realization`: an unquoted direct-realization phrase such as `终于明白` or
  `终于意识到`.
- `none`: clean or explicitly exempt text.

`冷冷` and `压下去` are guidance-only and must never be emitted as detector labels. Every span uses
UTF-16 offsets, an inclusive start and exclusive end, and a short rationale. A prediction matches a
gold label only when `ruleId` and the exact UTF-16 span agree. Precision is computed only over
medium/high predictions in the qualification split; fixed negatives must have zero predictions.

## Review protocol

Each sample requires independent labels from annotators A and B, followed by a blind quality-owner
decision for disagreements. The generated candidate corpus records `provisional` labels and is not
release-qualified until those statuses are replaced by signed human records.
