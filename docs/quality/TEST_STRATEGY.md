# Product Assurance テスト戦略 (Test Strategy)

状態: 2026-09-09 制定
上位方針: `docs/12-test-plan.md`（テスト計画）を Gate 2〜5 の観点で拡張したもの。
既存テスト資産は置換せず、配置と追加検証を定義する。

## 1. 目的

「画面操作が成功する」ではなく「利用者が結果を信用できる」ことを Release 条件とする。
検証対象は Software / Logic / Data / Product / Security / Resilience / Fail-Safe / AI /
Human Acceptance の 9 領域とする。

## 2. Gate model and execution placement

| Gate | Area | Key checks | When | Implementation |
| --- | --- | --- | --- | --- |
| Gate 4 | Risk, Security, Resilience | AuthN, AuthZ, injection, session, rate limit, audit, recovery, backup-restore, fail-safe | merge + release candidate | tests/resilience plus Trivy and CodeQL |
| Gate 1 | Software Quality | see list below (run on every PR) | PR (blocking) | CI verify job |
| Gate 2 | Logic and Data Quality | golden dataset, expected result, boundary, invalid input, regression, tolerance, metamorphic, schema, null-duplicate-range, freshness-unit-source | PR (fast subset) + merge | tests/golden, tests/domain, tests/data-quality |
| Gate 3 | Product Quality | E2E, workflow, UI, responsive, a11y, performance, large data, concurrency | merge + nightly | tests/e2e, load-test.yml, production-smoke.yml |
| Gate 5 | AI and Agent | eval: correctness, groundedness, hallucination, safety, uncertainty | enabled only when AI ships | LLM unused today (see section 5) |
| Human | Human Acceptance | business usability, validity, no misleading output, traceability, safe failure | release candidate | docs/quality/RELEASE_CRITERIA.md section 5 |

Gate 1 breakdown:

| # | Check |
| --- | --- |
| 1 | Build and Lint |
| 2 | Type checking |
| 3 | Unit test |
| 4 | API contract checks (v1, docs, OpenAPI, Docker, Cloudflare, Actions) |
| 5 | DB migrate and seed smoke, duplicate check, standard record policy |
| 6 | Dependency audit and gitleaks scan |

Heavy suites (E2E, load, resilience drills, backup restore) stay off the PR path: PR runs fast Gate 1 plus the fast subset of Gate 2.

## 3. Priority criteria

| Rank | Criterion | Meaning in this product |
| --- | --- | --- |
| 1 | Business Risk | decision engine, terrain, weather feed field judgements directly |
| 2 | Result correctness | quality score, return period, slope, elevation, observed values |
| 3 | Security and Safety | admin auth, RBAC, URL guard, gitleaks scope |
| 4 | Failure impact | never return a wrong value as success on outages (fail-safe) |
| 5 | Regression risk | deterministic logic under src/lib that changes often |
| 6 | Usage frequency | ledger search, map, decision flows |
| 7 | Maintainability | no duplicated tests, shared fixtures |

Coverage rate and test count are not goals; no coverage threshold is set.

## 4. Test directory layout

```text
tests/
  unit/         existing  Gate 1 fast granular checks and regressions
  integration/  existing  real DB transaction checks (RUN_DB_INTEGRATION)
  e2e/          existing  Gate 3 user workflows
  golden/       Gate 2 known input -> expected result (reads testdata/golden)
  domain/       Gate 2 metamorphic and invariant tests (hard-to-specify results)
  data-quality/ Gate 2 schema, null, duplicate, range, freshness, unit, source
  resilience/   Gate 4 fail-safe invariants under dependency failures
testdata/
  golden/       versioned golden datasets
docs/quality/   this document set
```

UI component tests (component/) are substituted by e2e + unit for now; add a dedicated suite when UI complexity grows.

## 5. Gate 5 (AI / Agent) verdict

As of 2026-09-09 no LLM / OpenAI / Anthropic / embedding client exists under src/
(docs/10-ai-governance.md is the governance policy for future assistive AI, not an implementation).

**Verdict: Gate 5 is N/A today**, with these activation conditions:

| Trigger | Required response |
| --- | --- |
| LLM or agent introduced under src/ | add tests/ai-eval/ with a fixed eval dataset under testdata/ai-eval/; run regression evals on model, prompt, skill or tool changes |
| AI-generated metadata stored | verify the flags and review states of docs/10-ai-governance.md section 4 in schema and tests |
| AI output shown to users | independent verification via rules, DB, reference data or programmatic validators (never AI self-evaluation alone) |

## 6. Operating rules on change

1. Update the matching rows of docs/quality/TEST_MATRIX.md when behaviour changes (keep Requirement-Test ID mapping).
2. Amend docs/quality/TOLERANCE_SPEC.md first, then tests, when numeric specs change.
3. Bump datasetVersion of golden datasets and record the reason in docs/quality/TEST_EVIDENCE.md.
4. On product defects: fix safely, add a regression test, and record both; never weaken tests to pass.

## 7. Related documents

- docs/12-test-plan.md - command level test plan (extended by this doc)
- docs/quality/TEST_MATRIX.md - requirement to test mapping
- docs/quality/TOLERANCE_SPEC.md - numeric tolerance spec
- docs/quality/RELEASE_CRITERIA.md - release conditions incl. human acceptance
- docs/quality/TEST_EVIDENCE.md - evidence record format
- docs/08-data-quality-policy.md - quality score semantics
- docs/10-ai-governance.md - AI governance
