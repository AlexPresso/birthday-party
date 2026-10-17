---
name: code-simplifier
description: >-
  Simplify Go and React/TypeScript code for readability and maintainability while
  preserving behavior. Use for explicit cleanup requests and a focused review of
  code changed during an implementation task. Keep the review within the requested
  feature; interface copy and visual design use their own skills.
license: Apache-2.0
metadata:
  source: anthropics/claude-plugins-official
---

# Code Simplifier

Adapted from Anthropic's code-simplifier agent for this repository's Go and React
code. This file changes the upstream instructions to respect project scope,
language conventions and verification requirements. Attribution, the pinned
upstream version and the original agent are in [SOURCE.md](SOURCE.md).

Improve code a contributor needs to read or change. Favor explicit control flow,
meaningful names and cohesive responsibilities over compressed expressions or
extra layers. A simpler result may have more lines.

## Scope and behavior

- Read the root and relevant scoped `AGENTS.md`; their requirements take precedence.
  Use the local Go Style Guide or Vercel React Best Practices for the affected stack.
- Start with the requested files or the current task's diff. Follow callers and
  tests to understand contracts; do not expand a cleanup into an architecture
  rewrite or an unrelated bug fix.
- Preserve observable behavior, including API shapes, error precedence, empty
  values, ordering, bounds and side effects. Preserve privacy checks, transaction
  and lock boundaries, cancellation, retries and resource cleanup.
- Keep public names, routes, translations and authored content stable. Leave
  applied migrations and existing user work untouched.
- Require a concrete readability benefit for each edit. Leave already clear code
  alone. Do not invent abstractions to meet a line-count or duplication target.

## Readability decisions

- Name non-obvious values and predicates. Split dense expressions when intermediate
  names explain their steps; avoid replacing straightforward code with clever chains.
- Consolidate genuinely repeated rules. Keep helpers local to a feature until
  multiple features need the same semantics; do not build a generic framework
  for superficially similar code.
- Keep useful declaration documentation and comments explaining contracts,
  privacy, ownership or concurrency. Remove filler and obvious narration.
- Retain purposeful boundaries, such as private records versus public responses.
  Do not remove safeguards simply because they look repetitive.

## Go

- Name ambiguous interface parameters and distinguish IDs from complete objects.
  Expand crowded literals and SQL queries so their fields and conditions are easy
  to compare. Name policy limits where their meaning is otherwise hidden.
- Keep normal Go error handling, small constructors and consumer-owned ports.
  Do not add config structs, interfaces, getters or wrappers for stylistic symmetry.
- Keep business rules in feature packages and infrastructure in adapters. Preserve
  the instant at which time-sensitive authorization is checked under locks.

## React and TypeScript

- Keep state ownership and data flow visible. Extract a component or hook when it
  isolates a coherent responsibility, rather than merely relocating a long block.
- Derive values from existing state when possible. Preserve intentional drafts,
  hydration behavior, stable keys and stale-response protection.
- Prefer named predicates or explicit branches for complex conditions. Keep
  local event handlers direct and retain accessible interaction behavior.
- Do not add memoization or change caching, request ordering or effect lifetimes
  just to make a cleanup appear faster. Keep shared uploads and realtime lifetimes.

## Finish

Review the actual diff for changed semantics and accidental scope growth. Run the
relevant available format, static and behavior checks. Add tests when a changed
algorithm or boundary needs meaningful coverage; cosmetic changes do not need
tests that duplicate the implementation. Report the concrete improvements and
checks actually run, including any limitation. Do not claim a performance gain
without measuring it.
