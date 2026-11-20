# Commit and publish pending non-Markdown changes

## Authorization and scope
User explicitly authorized commits and push, then selected ALL pending changes except every .md. Destination origin/framework_react (git@github.com:ggabrielgp/orderexpenses.git). Keep all Markdown local/untracked and out of index/commits. No force push, reset, merge, PR or new source changes authorized. Preserve existing no-tests constraint: no suites run or new test edits.

## Work units and delivery
1. fix(ui): avoid case-colliding component filenames — three rename pairs, FinancialCycleEditDialog import, Dashboard import hunks only, existing foundation reference changes.
2. feat(demo): enrich example financial activity — public/demo-data.json, new test/demo-fixture.test.js, Dashboard demo sorting/render hunks.
3. feat(landing): add floating iPhone preview and unified info cards — LandingHero.tsx and styles.css.
Observed: casing20 authored lines plus three100% LF-normalized renames; demo391 lines including118-line existing new test; landing293 lines. Total704 authored lines, three coherent commits (20/391/293); no PR requested. Rollback each unit separately, no Markdown inclusion.

## Tasks
- [x] PB-1: Delegated gentle-ai-verify: build/diff-check passed, three normalized renames identical,164 exact-case imports resolve, no unrelatedCSS changes, bounded secret scan zero matches, fixture parsed37 movements, source/status hashes unchanged. Remote and HEAD bothfea295d5b46355cfc5c94977c758793cf65e1c5d. Tests skipped; two static reveal assertions incompatible, not executed failures.
- [x] PB-2: Parent created44ec8d88b30fd56e73f7e840f11e57a4d1d7f2e6(casing),2b94683d799344da713a5359811b5ab2f9bf1688(demo),f8bac811f4c0d276dbbf6518a08d8aa338fe2ba3(landing). Dashboard import/demo hunks separated; all three commits exclude Markdown. Landing native medium review approved/acknowledged and authority burned for exact candidate; non-blocking R3-001 WARNING styles.css:180 remains follow-up. Committed assessment failed on untracked declaration for each range; independent PB-1 checks stand. Casing committed START refused retained-selection mismatch, no authority mutation; no native approval for casing/demo.
- [x] PB-3: git push origin HEAD:refs/heads/framework_react succeeded without force. git ls-remote confirmsf8bac811f4c0d276dbbf6518a08d8aa338fe2ba3; ahead/behind0/0. Only five local untracked odd/tasks/*.md remain. No Markdown files in three-commit delivery range.

## Known limitations
No tests executed. Explorer identified preexisting foundation assertions around lines200-201 requiring translateY20px and old reduced-motion formatting, whereas current landing uses28px and extended selectors; cannot claim test-green. Existing build chunk-size and demo-data CRLF warnings. Earlier workspace native review blocked on mixed/untracked scope; committed-range assessment will be used if available. Prior homepage browser verification passed; no new UI changes in this delivery task.

## Next step
Delivery completed: three commits pushed to origin/framework_react, all Markdown excluded and retained locally. Future work may reconcile two stale reveal test assertions and informational native warning; no tests executed and no test-green claim.
