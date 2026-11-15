import { CANONICAL_BOOKS, getBookById } from '../data/canonicalBooks';
import { ThemeMode } from '../types/bible';

// Book abbreviation lookup map
const BOOK_ALIAS_MAP: Record<string, number> = {};

CANONICAL_BOOKS.forEach((book) => {
  const normName = book.name.toLowerCase().replace(/\s+/g, '');
  const code = book.code.toLowerCase();
  BOOK_ALIAS_MAP[normName] = book.id;
  BOOK_ALIAS_MAP[code] = book.id;
});

const EXTRA_ALIASES: Record<string, number> = {
  gen: 1, ge: 1, gn: 1,
  exo: 2, ex: 2, exod: 2,
  lev: 3, le: 3, lv: 3,
  num: 4, nu: 4, nm: 4, nb: 4,
  deut: 5, dt: 5, de: 5,
  josh: 6, jos: 6, jsh: 6,
  judg: 7, jdg: 7, jg: 7, jdgs: 7,
  ruth: 8, rth: 8, ru: 8,
  '1sam': 9, '1sa': 9, '1s': 9, '1samuel': 9,
  '2sam': 10, '2sa': 10, '2s': 10, '2samuel': 10,
  '1kings': 11, '1ki': 11, '1k': 11, '1kgs': 11,
  '2kings': 12, '2ki': 12, '2k': 12, '2kgs': 12,
  '1chron': 13, '1ch': 13, '1chr': 13, '1chronicles': 13,
  '2chron': 14, '2ch': 14, '2chr': 14, '2chronicles': 14,
  ezra: 15, ezr: 15,
  neh: 16, ne: 16,
  esth: 17, est: 17,
  job: 18, jb: 18,
  psalm: 19, psalms: 19, psa: 19, ps: 19, pss: 19,
  prov: 20, pro: 20, pr: 20, prv: 20,
  eccl: 21, ecc: 21, ec: 21, qoh: 21,
  song: 22, sng: 22, sos: 22, canticles: 22, songofsolomon: 22, songofsongs: 22,
  isa: 23, is: 23, isaiah: 23,
  jer: 24, je: 24, jr: 24, jeremiah: 24,
  lam: 25, la: 25, lamentations: 25,
  ezek: 26, eze: 26, ezk: 26, ezekiel: 26,
  dan: 27, da: 27, dn: 27, daniel: 27,
  hos: 28, ho: 28, hosea: 28,
  joel: 29, jl: 29,
  amos: 30, am: 30,
  obad: 31, ob: 31, obadiah: 31,
  jonah: 32, jon: 32, jnh: 32,
  mic: 33, mc: 33, micah: 33,
  nah: 34, na: 34, nahum: 34,
  hab: 35, hb: 35, habakkuk: 35,
  zeph: 36, zep: 36, zp: 36, zephaniah: 36,
  hag: 37, hg: 37, haggai: 37,
  zech: 38, zec: 38, zc: 38, zechariah: 38,
  mal: 39, ml: 39, malachi: 39,
  matt: 40, mat: 40, mt: 40, matthew: 40,
  mark: 41, mrk: 41, mk: 41,
  luke: 42, luk: 42, lk: 42,
  john: 43, jhn: 43, jn: 43,
  acts: 44, act: 44, ac: 44,
  rom: 45, ro: 45, rm: 45, romans: 45,
  '1cor': 46, '1co': 46, '1corinthians': 46,
  '2cor': 47, '2co': 47, '2corinthians': 47,
  gal: 48, ga: 48, galatians: 48,
  eph: 49, ep: 49, ephesians: 49,
  phil: 50, php: 50, philippians: 50,
  col: 51, colossians: 51,
  '1thess': 52, '1th': 52, '1thessalonians': 52,
  '2thess': 53, '2th': 53, '2thessalonians': 53,
  '1tim': 54, '1ti': 54, '1timothy': 54,
  '2tim': 55, '2ti': 55, '2timothy': 55,
  titus: 56, tit: 56, ti: 56,
  philm: 57, phm: 57, philemon: 57,
  heb: 58, hebrews: 58,
  james: 59, jas: 59, jm: 59,
  '1pet': 60, '1pe': 60, '1pt': 60, '1peter': 60,
  '2pet': 61, '2pe': 61, '2pt': 61, '2peter': 61,
  '1john': 62, '1jn': 62, '1j': 62,
  '2john': 63, '2jn': 63, '2j': 63,
  '3john': 64, '3jn': 64, '3j': 64,
  jude: 65, jud: 65, jd: 65,
  rev: 66, revelation: 66, apocalypse: 66
};

Object.assign(BOOK_ALIAS_MAP, EXTRA_ALIASES);

export function lookupBookId(rawBookName: string): number | null {
  const clean = rawBookName.trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
  if (BOOK_ALIAS_MAP[clean]) {
    return BOOK_ALIAS_MAP[clean];
  }
  const found = CANONICAL_BOOKS.find((b) =>
    b.name.toLowerCase().replace(/\s+/g, '').startsWith(clean)
  );
  return found ? found.id : null;
}

export interface NavigationTarget {
  bookId: number;
  chapter: number;
  verse?: number;
}

export function parseOmnibarCommand(
  rawInput: string,
  currentBookId: number,
  currentChapter: number
): NavigationTarget | null {
  const input = rawInput.trim();
  if (!input) return null;

  const lower = input.toLowerCase();

  // 1. Next / Prev chapter command
  if (lower === 'next' || lower === 'n' || lower === '+') {
    const currentBook = getBookById(currentBookId);
    if (currentChapter < currentBook.chapterCount) {
      return { bookId: currentBookId, chapter: currentChapter + 1 };
    }
    if (currentBookId < CANONICAL_BOOKS.length) {
      return { bookId: currentBookId + 1, chapter: 1 };
    }
    return null;
  }

  if (lower === 'prev' || lower === 'previous' || lower === 'p' || lower === '-') {
    if (currentChapter > 1) {
      return { bookId: currentBookId, chapter: currentChapter - 1 };
    }
    if (currentBookId > 1) {
      const prevBook = getBookById(currentBookId - 1);
      return { bookId: currentBookId - 1, chapter: prevBook.chapterCount };
    }
    return null;
  }

  // 2. Pure number: e.g. "12" -> chapter 12 in current book
  if (/^\d+$/.test(input)) {
    const ch = parseInt(input, 10);
    const currentBook = getBookById(currentBookId);
    if (ch >= 1 && ch <= currentBook.chapterCount) {
      return { bookId: currentBookId, chapter: ch };
    }
  }

  // 3. Book + Chapter [: Verse]: e.g. "1 Corinthians 13:4", "Song of Songs 2", "John 3", "Gen 1:1", "Jn. 1:1", "1 Cor 13:4-7"
  const matchWithVerse = input.match(/^([1-3]?\s*[A-Za-z\s.]+?)\s+(\d+)[:.](\d+)(?:[a-zA-Z]|\s*-\s*\d+)?$/i);
  if (matchWithVerse) {
    const bId = lookupBookId(matchWithVerse[1]);
    if (bId) {
      const ch = parseInt(matchWithVerse[2], 10);
      const vs = parseInt(matchWithVerse[3], 10);
      const book = getBookById(bId);
      const safeCh = Math.max(1, Math.min(ch, book.chapterCount));
      return { bookId: bId, chapter: safeCh, verse: vs };
    }
  }

  const matchChapter = input.match(/^([1-3]?\s*[A-Za-z\s.]+?)\s+(\d+)$/i);
  if (matchChapter) {
    const bId = lookupBookId(matchChapter[1]);
    if (bId) {
      const ch = parseInt(matchChapter[2], 10);
      const book = getBookById(bId);
      const safeCh = Math.max(1, Math.min(ch, book.chapterCount));
      return { bookId: bId, chapter: safeCh };
    }
  }

  // 4. Just Book Name: e.g. "Romans" -> Romans 1
  const bIdOnly = lookupBookId(input);
  if (bIdOnly) {
    return { bookId: bIdOnly, chapter: 1 };
  }

  return null;
}

export type OmnibarAction =
  | { type: 'navigate'; target: NavigationTarget }
  | { type: 'theme'; theme: ThemeMode };

export function parseOmnibarAction(
  rawInput: string,
  currentBookId: number,
  currentChapter: number
): OmnibarAction | null {
  const input = rawInput.trim();
  if (!input) return null;
  const lower = input.toLowerCase();

  if (lower === 'parchment' || lower === 'theme parchment') {
    return { type: 'theme', theme: 'parchment' };
  }
  if (lower === 'white' || lower === 'light' || lower === 'theme white' || lower === 'theme light') {
    return { type: 'theme', theme: 'white' };
  }
  if (lower === 'black' || lower === 'dark' || lower === 'theme black' || lower === 'theme dark') {
    return { type: 'theme', theme: 'black' };
  }

  const nav = parseOmnibarCommand(rawInput, currentBookId, currentChapter);
  if (nav) {
    return { type: 'navigate', target: nav };
  }

  return null;
}

export function formatNavigationLabel(target: NavigationTarget): string {
  const book = getBookById(target.bookId);
  const name = book?.name || 'Genesis';
  return target.verse ? `${name} ${target.chapter}:${target.verse}` : `${name} ${target.chapter}`;
}

export interface OmnibarSuggestion {
  id: string;
  label: string;
  sublabel: string;
  target: NavigationTarget;
  score: number;
}

interface BookSearchEntry {
  id: number;
  name: string;
  lowerName: string;
  normName: string;
  words: string[];
  aliases: string[];
  chapterCount: number;
  testamentLabel: string;
}

const BOOK_SEARCH_INDEX: BookSearchEntry[] = CANONICAL_BOOKS.map((book) => {
  const aliases = Object.entries(BOOK_ALIAS_MAP)
    .filter(([, id]) => id === book.id)
    .map(([alias]) => alias);
  const lowerName = book.name.toLowerCase();
  return {
    id: book.id,
    name: book.name,
    lowerName,
    normName: lowerName.replace(/\s+/g, ''),
    words: lowerName.split(/\s+/),
    aliases: Array.from(new Set(aliases)),
    chapterCount: book.chapterCount,
    testamentLabel: book.testament === 'OT' ? 'Old Testament' : 'New Testament',
  };
});

/**
 * Optimal string alignment / Damerau-Levenshtein distance for fast typo tolerance.
 */
function damerauLevenshtein(a: string, b: string): number {
  const alen = a.length;
  const blen = b.length;
  if (alen === 0) return blen;
  if (blen === 0) return alen;

  const dp: number[][] = Array.from({ length: alen + 1 }, () => new Array<number>(blen + 1).fill(0));
  for (let i = 0; i <= alen; i++) dp[i][0] = i;
  for (let j = 0; j <= blen; j++) dp[0][j] = j;

  for (let i = 1; i <= alen; i++) {
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + cost);
      }
      dp[i][j] = val;
    }
  }
  return dp[alen][blen];
}

function subsequenceGapScore(query: string, target: string): number | null {
  if (query.length < 2 || query.length > target.length) return null;
  let qi = 0;
  let lastMatch = -1;
  let totalGap = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      if (lastMatch !== -1) {
        totalGap += ti - lastMatch - 1;
      } else {
        totalGap += ti * 2;
      }
      lastMatch = ti;
      qi++;
    }
  }
  return qi === query.length ? totalGap : null;
}

function scoreBookQuery(rawBookQuery: string, entry: BookSearchEntry): number {
  const lowerQuery = rawBookQuery.trim().toLowerCase();
  const normQuery = lowerQuery.replace(/[\s.]+/g, '');
  if (!normQuery) return 0;

  if (entry.normName === normQuery || entry.aliases.includes(normQuery)) {
    return 1000;
  }

  if (entry.normName.startsWith(normQuery)) {
    return 920 - (entry.normName.length - normQuery.length);
  }

  // Word prefix match (e.g. "cor" -> "1 Corinthians", "songs" -> "Song of Songs")
  for (let i = 0; i < entry.words.length; i++) {
    const w = entry.words[i];
    if (w.startsWith(normQuery)) {
      return 840 - i * 20 - (w.length - normQuery.length);
    }
  }

  // Alias prefix match (e.g. "jn" -> John, "ps" -> Psalms)
  for (const alias of entry.aliases) {
    if (alias.startsWith(normQuery)) {
      return 800 - (alias.length - normQuery.length);
    }
  }

  // Substring match
  const containsIdx = entry.normName.indexOf(normQuery);
  if (containsIdx !== -1 && normQuery.length >= 2) {
    return 680 - containsIdx * 10 - (entry.normName.length - normQuery.length);
  }

  if (normQuery.length < 3) {
    // Allow ordered subsequence for 2-char abbreviations like "jn" -> John
    const gap = subsequenceGapScore(normQuery, entry.normName);
    if (gap !== null && gap <= 3) {
      return 520 - gap * 25;
    }
    return 0;
  }

  const maxDist = normQuery.length <= 4 ? 1 : normQuery.length <= 7 ? 2 : 3;
  let bestFuzzy = 0;

  // Check edit distance against full canonical name
  if (Math.abs(entry.normName.length - normQuery.length) <= maxDist + 2) {
    const dist = damerauLevenshtein(normQuery, entry.normName);
    if (dist <= maxDist) {
      bestFuzzy = Math.max(bestFuzzy, 640 - dist * 110 - Math.abs(entry.normName.length - normQuery.length) * 5);
    }
  }

  // Check edit distance against prefix of canonical name (for partial typos like "gnes" -> "genesis")
  if (entry.normName.length > normQuery.length) {
    const prefixSlice = entry.normName.slice(0, normQuery.length);
    const prefixDist = damerauLevenshtein(normQuery, prefixSlice);
    if (prefixDist <= Math.min(2, maxDist)) {
      bestFuzzy = Math.max(bestFuzzy, 610 - prefixDist * 110 - (entry.normName.length - normQuery.length) * 2);
    }
  }

  // Check edit distance against word tokens (e.g. "corintians" -> "1 Corinthians", "samuel" typos)
  for (const w of entry.words) {
    if (w.length >= 3 && Math.abs(w.length - normQuery.length) <= maxDist) {
      const wDist = damerauLevenshtein(normQuery, w);
      if (wDist <= maxDist) {
        bestFuzzy = Math.max(bestFuzzy, 590 - wDist * 110);
      }
    }
  }

  // Check edit distance against common aliases (length >= 3)
  for (const alias of entry.aliases) {
    if (alias.length >= 3 && Math.abs(alias.length - normQuery.length) <= 1) {
      const aDist = damerauLevenshtein(normQuery, alias);
      if (aDist <= 1) {
        bestFuzzy = Math.max(bestFuzzy, 575 - aDist * 100);
      }
    }
  }

  if (bestFuzzy > 0) return bestFuzzy;

  // Ordered subsequence fallback (e.g. "gnsis" -> "genesis")
  const subseqGap = subsequenceGapScore(normQuery, entry.normName);
  if (subseqGap !== null && subseqGap <= 5) {
    return 440 - subseqGap * 20;
  }

  return 0;
}

export function getOmnibarSuggestions(
  rawInput: string,
  currentBookId: number,
  currentChapter: number,
  limit = 7
): OmnibarSuggestion[] {
  const input = rawInput.trim();
  if (!input || input.startsWith('/')) return [];

  const lower = input.toLowerCase();
  const results: OmnibarSuggestion[] = [];
  const currentBook = getBookById(currentBookId);

  // Skip suggestions for exact theme keywords
  if (['parchment', 'white', 'light', 'black', 'dark'].includes(lower)) {
    return [];
  }

  // Next / Prev helpers
  if (lower === 'next' || lower === 'n' || lower === '+') {
    const next = parseOmnibarCommand('next', currentBookId, currentChapter);
    if (next) {
      const nextBook = getBookById(next.bookId);
      results.push({
        id: `next-${next.bookId}-${next.chapter}`,
        label: `${nextBook.name} ${next.chapter}`,
        sublabel: 'Next chapter',
        target: next,
        score: 990,
      });
    }
  } else if (lower === 'prev' || lower === 'previous' || lower === 'p' || lower === '-') {
    const prev = parseOmnibarCommand('prev', currentBookId, currentChapter);
    if (prev) {
      const prevBook = getBookById(prev.bookId);
      results.push({
        id: `prev-${prev.bookId}-${prev.chapter}`,
        label: `${prevBook.name} ${prev.chapter}`,
        sublabel: 'Previous chapter',
        target: prev,
        score: 990,
      });
    }
  }

  // Pure digit input (e.g. "2" -> Current Book Ch. 2 + numbered books "2 Samuel", etc.)
  if (/^\d+$/.test(input)) {
    const num = parseInt(input, 10);
    if (num >= 1 && num <= currentBook.chapterCount) {
      results.push({
        id: `curr-ch-${currentBookId}-${num}`,
        label: `${currentBook.name} ${num}`,
        sublabel: `Chapter ${num} of ${currentBook.chapterCount}`,
        target: { bookId: currentBookId, chapter: num },
        score: 960,
      });
    }
    if (num >= 1 && num <= 3) {
      for (const entry of BOOK_SEARCH_INDEX) {
        if (entry.normName.startsWith(String(num))) {
          results.push({
            id: `book-${entry.id}-1`,
            label: `${entry.name} 1`,
            sublabel: `${entry.testamentLabel} · ${entry.chapterCount} ${entry.chapterCount === 1 ? 'chapter' : 'chapters'}`,
            target: { bookId: entry.id, chapter: 1 },
            score: 850 - entry.id,
          });
        }
      }
    }
    return results.slice(0, limit);
  }

  // Parse "<bookPart> [chapter][:verse]"
  const refMatch = input.match(/^([1-3]?\s*[A-Za-z.\s']+?)\s*(?:(\d+)(?:[:.](\d+))?)?$/);
  if (!refMatch) {
    return results.slice(0, limit);
  }

  const rawBookPart = refMatch[1].trim();
  const parsedChapter = refMatch[2] ? parseInt(refMatch[2], 10) : null;
  const parsedVerse = refMatch[3] ? parseInt(refMatch[3], 10) : null;

  if (!rawBookPart) {
    return results.slice(0, limit);
  }

  const scored = BOOK_SEARCH_INDEX
    .map((entry) => ({
      entry,
      score: scoreBookQuery(rawBookPart, entry),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.id - b.entry.id;
    })
    .slice(0, limit);

  for (const { entry, score } of scored) {
    if (parsedChapter !== null) {
      const safeCh = Math.max(1, Math.min(parsedChapter, entry.chapterCount));
      const safeVs = parsedVerse !== null ? Math.max(1, parsedVerse) : undefined;
      const clamped = parsedChapter > entry.chapterCount || parsedChapter < 1;
      const target: NavigationTarget = {
        bookId: entry.id,
        chapter: safeCh,
        ...(safeVs ? { verse: safeVs } : {}),
      };
      results.push({
        id: `ref-${entry.id}-${safeCh}-${safeVs ?? 0}`,
        label: safeVs ? `${entry.name} ${safeCh}:${safeVs}` : `${entry.name} ${safeCh}`,
        sublabel: clamped
          ? `Clamped to max chapter (${entry.chapterCount})`
          : `Chapter ${safeCh} of ${entry.chapterCount} · ${entry.testamentLabel}`,
        target,
        score,
      });
    } else {
      results.push({
        id: `book-${entry.id}-1`,
        label: `${entry.name} 1`,
        sublabel: `${entry.testamentLabel} · ${entry.chapterCount} ${entry.chapterCount === 1 ? 'chapter' : 'chapters'}`,
        target: { bookId: entry.id, chapter: 1 },
        score,
      });
    }
  }

  return results.slice(0, limit);
}

export function parseScriptureReference(ref: string): NavigationTarget | null {
  const clean = ref.replace(/[\[\]()]/g, '').trim();
  return parseOmnibarCommand(clean, 1, 1);
}

export interface ExtractedScriptureToken {
  type: 'token';
  label: string;
  tokenTarget: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Automatically extracts verse tokens and common scripture references from note text.
 * Matches:
 * 1. Explicit markdown link tokens: [Jn 1:1](@v:1)
 * 2. Explicit verse tokens: @v:1, @v:43:1:1
 * 3. Natural Scripture references across common formats:
 *    - "Jn 1:1", "John 1:1", "Jn. 1:1", "Jn 1.1"
 *    - "1 Jn 1:9", "1Jn 1:9", "1 Cor 13:4", "1Cor 13:4-7"
 *    - "Gen 1:1", "Rom 8:28", "Song of Songs 2:4", "Ps 23:1"
 */
export function extractScriptureTokens(content: string): ExtractedScriptureToken[] {
  if (!content || !content.trim()) return [];

  const tokens: ExtractedScriptureToken[] = [];
  const occupiedRanges: Array<{ start: number; end: number }> = [];

  const isOverlapping = (start: number, end: number) => {
    return occupiedRanges.some((r) => Math.max(start, r.start) < Math.min(end, r.end));
  };

  // 1. Explicit Markdown Link or @v: token
  const explicitRegex = /(\[([^\]]+)\]\((@(v:[a-zA-Z0-9_.:]+))\)|@(v:[a-zA-Z0-9_.:]+))/g;
  let match: RegExpExecArray | null;

  while ((match = explicitRegex.exec(content)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const isMarkdown = Boolean(match[2] && match[3]);
    const label = isMarkdown ? match[2] : match[0];
    const tokenTarget = isMarkdown ? match[3] : match[0];

    tokens.push({
      type: 'token',
      label,
      tokenTarget,
      startIndex: start,
      endIndex: end,
    });
    occupiedRanges.push({ start, end });
  }

  // 2. Natural Scripture references across common formats
  const naturalRefRegex = /\b([1-3]?\s*[A-Za-z]+(?:\s+of\s+[A-Za-z]+)?\.?)\s*(\d+)[:.](\d+)(?:[a-zA-Z]|\s*-\s*\d+)?\b/gi;

  while ((match = naturalRefRegex.exec(content)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (isOverlapping(start, end)) {
      continue;
    }

    const rawBook = match[1].trim();
    const lowerBook = rawBook.toLowerCase().replace(/\./g, '');

    // Prevent matching common English words
    if (lowerBook === 'is' && !/^isa/i.test(rawBook)) {
      continue;
    }
    if (['in', 'at', 'to', 'as', 'or', 'so', 'by', 'of', 'on', 'if', 'we', 'he', 'me'].includes(lowerBook)) {
      continue;
    }

    const bId = lookupBookId(rawBook);
    if (!bId) continue;

    const ch = parseInt(match[2], 10);
    const vs = parseInt(match[3], 10);
    const book = getBookById(bId);

    // Validate that chapter is within canonical book count and verse is positive
    if (ch < 1 || ch > book.chapterCount || vs < 1) {
      continue;
    }

    const label = match[0];
    tokens.push({
      type: 'token',
      label,
      tokenTarget: label,
      startIndex: start,
      endIndex: end,
    });
    occupiedRanges.push({ start, end });
  }

  tokens.sort((a, b) => a.startIndex - b.startIndex);
  return tokens;
}

/**
 * Extracts canonical book IDs referenced by a synthesis note's citations and footnotes.
 */
export function getSynthesisReferencedBookIds(note: {
  sourceReferences?: string[];
  sourceFootnotes?: Array<{ ref: string }>;
}): number[] {
  const ids = new Set<number>();
  const refs = [
    ...(note.sourceReferences || []),
    ...(note.sourceFootnotes || []).map((f) => f.ref),
  ];
  for (const r of refs) {
    const parsed = parseScriptureReference(r);
    if (parsed) ids.add(parsed.bookId);
  }
  return Array.from(ids);
}

