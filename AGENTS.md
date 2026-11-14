# AGENTS.md — Token-Efficient Execution Protocol

> **Prime Directive**: Minimize context-window consumption and tool round-trips. Maximize information density per token.

---

## 1. Zero-Discovery Architecture Map

Skip `find`/`list_dir` exploration. Jump directly to target files:

| Layer | Key Files & Approximate Size | Purpose |
| :--- | :--- | :--- |
| **Server / API** | `server.ts` (~860L), `api/index.ts` | Express 5, CSP/security headers, rate limiters, `/api/*` Gemini proxy |
| **App Shell** | `src/App.tsx` (~1950L), `src/main.tsx`, `src/index.css` | Root navigation, reader state, theme tokens, dock |
| **Views** | `src/components/AllNotesView.tsx` (~1410L), `ReadingPlansView.tsx` (~1190L), `SettingsView.tsx` (~1130L) | Notes stream + summaries, plans, settings |
| **Core Reader** | `src/components/VerseRow.tsx` (~290L), `NoteField.tsx` (~325L), `NotesFilterToolbar.tsx` (~420L) | Verse rendering, inline note editor, filters |
| **Services** | `src/services/db.ts`, `bibleStorage.ts` (~605L), `readingPlanEngine.ts` (~620L), `supabaseSync.ts` (~835L) | Dexie IndexedDB, NET Bible cache, plan logic, RLS sync |
| **Skills / AI** | `src/skills/runtimeSkills.ts`, `src/utils/synthesisText.ts` | Authoritative summary prompt rules & citation cleaner |
| **Utils / PWA** | `src/utils/usePWAUpdate.ts`, `devSimulation.ts`, `sanitizeHtml.ts`, `referenceParser.ts` | Release tag/SW updates, QA sims, XSS sanitizer |
| **Data / Types** | `src/types/bible.ts`, `readingPlan.ts`, `src/data/canonicalBooks.ts`, `netBibleCorpus.ts` | Static types & Bible metadata |
| **Infra / Docs** | `package.json`, `vite.config.ts`, `vercel.json`, `supabase/schema.sql`, `.github/workflows/release.yml` | Build, PWA, deploy, PostgreSQL RLS, CI/CD |

**Never Read**: `node_modules/`, `dist/`, `dev-dist/`, `package-lock.json`, `bun.lock`, `public/`, `assets/`.

---

## 2. Token-Conservation Imperatives

1. **Grep-First on Large Files (>300 lines)**:
   - NEVER read `App.tsx`, `AllNotesView.tsx`, `ReadingPlansView.tsx`, `SettingsView.tsx`, `server.ts`, or `supabaseSync.ts` in full.
   - Run ONE compound `grep -rnE 'symbolA|symbolB|pattern' src server.ts` to pinpoint line numbers, then read ONLY the needed ±40-line slice.
2. **Batch Parallel Tool Calls**:
   - Group independent searches, file reads, and writes into the same turn. Avoid sequential one-file-at-a-time round-trips.
3. **Surgical Edits Only**:
   - Use line-targeted search/replace diffs on existing files. NEVER rewrite an entire file to modify a small block.
   - Keep edits strictly scoped to the request. Do not refactor, reformat, or clean up untouched code.
4. **Zero Redundant Reads**:
   - Do NOT re-read files you just wrote or edited unless an edit failed.
   - Rely on compiler/linter output rather than reading files to "double-check".
5. **Single-Pass Verification**:
   - Complete ALL planned edits before running checks.
   - Verify once at the end in a single command: `npm run lint && npm run build` (plus `npm audit --audit-level=high` only if `package.json` changed).
   - Never run `vite dev` or redundant intermediate builds unless diagnosing a runtime bug.
6. **Compressed Output**:
   - Zero conversational preamble ("Sure, I can help...", "Let me inspect...").
   - Never echo back unchanged file contents, large diffs, or raw command logs.
   - Report completion in terse bullets: modified files/symbols + verification pass/fail.

---

## 3. Hard Project Invariants

- **Commands**: `npm run lint` (`tsc --noEmit`), `npm run build` (`vite build`), `npm run dev` / `npm start` (`tsx server.ts`).
- **Stack**: React 19, TypeScript 5.8, Tailwind CSS v4 (`@import "tailwindcss";` in `src/index.css` — no inline styles or extra CSS files), Vite 6, Dexie, Express 5.
- **Security**:
  - Preserve CSP, `trust proxy`, rate limiters, and `sanitizeVerseHtml` (`VerseRow.tsx`).
  - Guest notes/settings MUST stay local in Dexie; never push to Supabase without an authenticated `userId`.
- **Terminology**: Always use **"Intelligent Summaries"** in UI/user-facing copy (never "synthesis engine" or "thematic synthesis").
- **Versioning**: `usePWAUpdate.ts` & `server.ts` render `Dev` in dev mode and GitHub release tags (`vX.Y.Z`) in production.
