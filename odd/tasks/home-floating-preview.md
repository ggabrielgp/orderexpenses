# Adapt the homepage with a floating mobile preview

## Objective and rationale
Adapt the existing home toward https://inspectra-lovat-xi-52.vercel.app/: floating product phone, curved surfaces and refined motion, not a full redesign. User approved the result but found the phone too tall, then selected a modern iPhone-inspired illustration instead of an unverified iPhone 18 replica.

## Scope and constraints
- Source: src/client/components/landing/LandingHero.tsx and landing-only selectors in src/client/styles.css. Preserve identity, Spanish copy, example values/caption, sections, routes and blue palette. No dependencies/backend/shared tokens.
- Preview remains illustrative/noninteractive; preserve panels, floating/reveal motion and reduced-motion fallbacks. Protect all unrelated dirty demo/dashboard/casing/test/task work.
- User explicitly requested SIN TESTS for this adaptation: no automated tests added/modified/run; build and browser inspection allowed. TDD exception, not a test pass.
- Branch framework_react. No staging/commit/push/PR authorized; work-unit commits pending explicit authorization. Delivery ask-on-risk. Initial feature: 217 authored lines; refinement forecast 60-160, observed 95 (67 additions/28 deletions). Rollback only incremental changes in the two source files.
- Modern-phone goal: fixed width:height approximately 1:2.05, slim graphite frame, Dynamic Island, side details and readable compact dashboard; not official hardware dimensions.

## Tasks
- [x] HP-1: Initial home adaptation. Delegated gentle-ai-worker (two non-trivial files); build/diff/source checks passed, no tests or commit.
- [x] HP-2: Initial independent verification. Delegated gentle-ai-verify (native assessment unavailable); builds and actual browser observations passed, no tests or commit.
- [x] HP-3: Modern iPhone refinement. Delegated gentle-ai-worker (two source files/write preparation); fixed 20/41 ratio, inset screen, frame/Island/side controls and compact spacing implemented. Source readback, git diff --check and independent npm run build passed. No commit.
- [x] HP-4: Independent build/browser verification at 390/768/1024/1440px and true 320px mobile passed for scoped phone changes. Actual ratio, unclipped content, no page/text overflow or panel/text overlap, normal/reduced motion verified. Delegated gentle-ai-verify for external browser checks and native-unavailable fallback. Preexisting header crowding remains a follow-up. No commit.

## Historical HP-1/HP-2 evidence
- Reference HTML/CSS fetched HTTP200; reference not visually rendered. Observed 300x616 phone, 44/34px radii and floating cards.
- npm run build and git diff --check passed twice; existing chunk-size and demo-data CRLF warnings.
- Chrome/CDP preview observations at 390/768/1024/1440px and true320px mobile: no horizontal overflow, text spill or panel/text overlap. Four decorative animations active; ten reveal wrappers visible after scrolling. Reduced motion: zero animations, all reveals visible without transforms and no hover displacement.
- Parent viewed 1440px desktop and 390px reduced-motion screenshots. Evidence: C:/Users/Guzman/AppData/Local/Temp/hp2-home-5oF0Q9/observations.json and screenshots. Owned preview/CDP processes cleaned.
- Optional 320px desktop with scrollbar (305px content) had crowded KPIs/slight spill; true320 mobile readable. No JS exceptions; unrelated favicon404. Authenticated/CTA navigation and rendered reference comparison not exercised. Historical evidence does not verify the refinement.

## HP-3/HP-4 progress and review limitations
- HP-3: 95 incremental authored lines. Only the two authorized source files edited. Spanish copy/amounts/routes/caption/motion preserved by source readback. git diff --check passed, existing demo-data CRLF warning.
- Build moved from writer to independent verifier because it generates dist/ and node_modules/.tmp artifacts beyond source-only edit surfaces. Independent npm run build and git diff --check exited0, existing chunk-size/CRLF warnings. Parent git diff --check also passed and dirty-path inventory unchanged.
- Final Chrome/CDP evidence: five widths normal/reduced with fonts loaded; phone328x672.391 (~2.05), true320 mobile280x574. Both movements and home indicator visible, zero cropped pixels; no page/internal text overflow, panel/text intersections or JS exceptions. Four normal floating animations; zero reduced-motion animations; ten reveals visible after scrolling, reduced reveals without transforms. Decorative stage/side-control overflow only.
- Existing768px header crowding:689px content, scrollWidth717; outside changed phone scope, no automatic fix. Evidence: C:/Users/Guzman/AppData/Local/Temp/hp4-home-YO1gNm/recapture-observations.json and screenshots. Parent viewed desktop1440 stage and final mobile390 reduced stage. Recaptures removed CDP offscreen-fixed-link screenshot artifact without style changes. Owned Chrome/preview terminated; ports4179/9339 had no listeners afterward.
- No unexpected repository mutations or tracked build outputs. Two preliminary script-preparation attempts failed before browser execution and changed no repository files; final observation scripts completed. Automated tests skipped by user instruction. Authenticated navigation and official hardware accuracy not verified.
- Native assess: unassessable due intended-untracked declaration, plan requires independent verification. Native inspect: blocked on intended-untracked selection and workspace includes unrelated edits. No selection/START/authority mutation performed; native review pending an isolated home-only candidate. Do not exclude required unrelated new modules simply to start review.

## Next step
User can inspect the refined local home `/`. Scoped implementation and independent verification completed. Optional existing768px header-crowding fix requires a new authorized request. Native review and commit remain pending isolation/explicit authorization; no publication.
