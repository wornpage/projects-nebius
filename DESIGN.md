# Projects WebMCP extension design

This public extraction keeps five task routes—Guide, Work, Review, Next, and Priority—legible across its supported light and dark color schemes. It is a compact workflow surface: visible facts, bounded choices, and a person who retains approval authority.

## Surface language

- Use the existing Wornpage components and local route composition. Do not add a parallel component or compatibility styling path.
- Containers, receipts, alerts, cards, and workflow states use a complete 1px border. A state may tint that complete border and its background.
- Use labels, pills, copy, and background tint to communicate workflow meaning. Preserve existing focus rings and contrast semantics.
- Reserve neutral 1px separators for structure, such as table cells, scrollbar tracks, and the decision-workspace authority divider.

## Full Border Rule

Accents are full 1px borders or background tints, never a colored side stripe. Workflow state never thickens only one side. Do not use `border-left`, `border-right`, `border-inline-start`, or `border-inline-end` above 1px for authored decoration, and do not imitate a side rail with a horizontal inset shadow.

The source contract in `tests/full-border-webmcp-contract.test.mjs` enforces this across authored extension CSS and Svelte sources. It deliberately does not scan generated output or installed dependencies.
