import { getBookById } from '../data/canonicalBooks';
import { db } from '../services/db';
import { isNoteDeleted, isSynthesisRetained } from '../services/bibleStorage';
import type { CommentaryNote } from '../types/bible';

export interface SynthesisPayloadNote {
  id: string;
  reference: string;
  content: string;
  verseContext?: string;
  isSynthesis: boolean;
  isPlainNote: boolean;
  title?: string;
  updatedAt?: number;
}

const STOPWORDS = new Set([
  'that', 'this', 'with', 'from', 'have', 'your', 'they', 'will', 'what', 'when',
  'where', 'about', 'into', 'more', 'than', 'then', 'them', 'their', 'there',
  'been', 'were', 'would', 'could', 'should', 'just', 'also', 'only', 'very',
  'much', 'some', 'such', 'even', 'here', 'most', 'because', 'through', 'while',
  'being', 'which', 'these', 'those', 'does', 'doing', 'done', 'make', 'made',
  'like', 'over', 'still', 'both', 'each', 'other', 'after', 'before', 'between',
]);

function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z]{4,}/g) || [];
  const keywords = new Set<string>();
  for (const w of words) {
    if (!STOPWORDS.has(w)) {
      keywords.add(w);
    }
  }
  return keywords;
}

function getNoteTimestamp(note: CommentaryNote): number {
  return note.updatedAt || note.createdAt || 0;
}

function getNoteTextForSimilarity(note: CommentaryNote): string {
  if (note.isSynthesis) {
    return `${note.title || ''} ${note.synthesisQuote || ''} ${note.content || ''} ${note.trajectorySummary || ''}`;
  }
  return `${note.title || ''} ${note.content || ''}`;
}

function scoreRelation(anchor: CommentaryNote, anchorKeywords: Set<string>, candidate: CommentaryNote): number {
  let score = 0;
  const candidateKeywords = extractKeywords(getNoteTextForSimilarity(candidate));

  let sharedCount = 0;
  for (const kw of candidateKeywords) {
    if (anchorKeywords.has(kw)) {
      sharedCount += 1;
      if (sharedCount >= 4) break;
    }
  }
  score += sharedCount * 3;

  if (!anchor.isPlainNote && !candidate.isPlainNote && anchor.bookId > 0 && candidate.bookId > 0) {
    if (anchor.bookId === candidate.bookId) {
      score += 3;
    } else {
      const anchorBook = getBookById(anchor.bookId);
      const candBook = getBookById(candidate.bookId);
      if (anchorBook && candBook && anchorBook.section === candBook.section) {
        score += 1.5;
      }
    }
  }

  // Reward longitudinal span across days so trajectory reflects growth or change over time
  const hoursApart = Math.abs(getNoteTimestamp(anchor) - getNoteTimestamp(candidate)) / (1000 * 60 * 60);
  if (hoursApart >= 24) {
    score += 2;
  }

  return score;
}

/**
 * Selects a trajectory-coherent sample of notes (2 to targetCount) anchored on a recent note,
 * paired with thematically/canonically related reflections (plus at most 1 retained synthesis)
 * and 1 contrasting wildcard note when room permits, ordered chronologically oldest -> newest.
 */
export function sampleThreadAwareNotes(allNotes: CommentaryNote[], targetCount: number): CommentaryNote[] {
  const standardNotes = allNotes.filter(
    (n) => !isNoteDeleted(n) && !n.isSynthesis && n.content.trim().length > 0
  );
  if (standardNotes.length < 2) return [];

  const desiredCount = Math.max(2, Math.min(targetCount, 5));
  const sortedNewest = [...standardNotes].sort((a, b) => getNoteTimestamp(b) - getNoteTimestamp(a));

  // Weighted pick among top 3 newest reflections so consecutive syntheses feel fresh yet grounded
  const anchorPool = sortedNewest.slice(0, Math.min(3, sortedNewest.length));
  const roll = Math.random();
  const anchorIndex = anchorPool.length === 1 ? 0 : roll < 0.6 ? 0 : roll < 0.85 || anchorPool.length < 3 ? 1 : 2;
  const anchor = anchorPool[anchorIndex];
  const anchorKeywords = extractKeywords(getNoteTextForSimilarity(anchor));

  const remainingStandard = sortedNewest.filter((n) => n.id !== anchor.id);
  const scoredStandard = remainingStandard
    .map((note) => ({
      note,
      score: scoreRelation(anchor, anchorKeywords, note) + Math.random() * 0.75,
    }))
    .sort((a, b) => b.score - a.score);

  const retainedSyntheses = allNotes.filter(
    (n) =>
      !isNoteDeleted(n) &&
      n.isSynthesis &&
      isSynthesisRetained(n) &&
      (n.synthesisQuote || n.content).trim().length > 0 &&
      !(n.sourceNoteIds || []).includes(anchor.id)
  );
  const scoredSyntheses = retainedSyntheses
    .map((note) => ({
      note,
      score: scoreRelation(anchor, anchorKeywords, note),
    }))
    .sort((a, b) => b.score - a.score);

  const selected: CommentaryNote[] = [anchor];
  const selectedIds = new Set<string>([anchor.id]);

  // Reserve 1 slot for a contrasting wildcard when sampling >= 3 and enough standard notes exist
  const reserveWildcard = desiredCount >= 3 && remainingStandard.length >= 2;
  const relatedQuota = reserveWildcard ? desiredCount - 2 : desiredCount - 1;

  let relatedAdded = 0;
  for (const item of scoredStandard) {
    if (relatedAdded >= relatedQuota) break;
    selected.push(item.note);
    selectedIds.add(item.note.id);
    relatedAdded += 1;
  }

  // Optionally include 1 relevant retained synthesis if space remains and standard notes >= 2
  const hasTwoStandard = selected.filter((n) => !n.isSynthesis).length >= 2;
  if (
    hasTwoStandard &&
    selected.length < desiredCount - (reserveWildcard ? 1 : 0) &&
    scoredSyntheses[0] &&
    scoredSyntheses[0].score >= 3
  ) {
    selected.push(scoredSyntheses[0].note);
    selectedIds.add(scoredSyntheses[0].note.id);
  }

  // Add a contrasting/older wildcard note from unselected standard notes
  if (selected.length < desiredCount) {
    const unselectedStandard = remainingStandard.filter((n) => !selectedIds.has(n.id));
    if (unselectedStandard.length > 0) {
      const contrasting = unselectedStandard.filter(
        (n) => n.bookId !== anchor.bookId || n.isPlainNote !== anchor.isPlainNote
      );
      const pool = contrasting.length > 0 ? contrasting : unselectedStandard;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      selected.push(pick);
      selectedIds.add(pick.id);
    }
  }

  // Fill any remaining gap with next-best standard notes
  for (const item of scoredStandard) {
    if (selected.length >= desiredCount) break;
    if (!selectedIds.has(item.note.id)) {
      selected.push(item.note);
      selectedIds.add(item.note.id);
    }
  }

  // Order chronologically oldest -> newest so the model reads the real progression of thought
  return selected.sort((a, b) => getNoteTimestamp(a) - getNoteTimestamp(b));
}

function stripVerseHtml(raw: string): string {
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function getSurroundingVerseContext(note: CommentaryNote): Promise<string | undefined> {
  if (note.isSynthesis || note.isPlainNote || note.bookId <= 0 || note.chapter <= 0) {
    return undefined;
  }
  try {
    const chapterData = await db.chapters.get(`${note.bookId}-${note.chapter}`);
    if (!chapterData || !Array.isArray(chapterData.verses) || chapterData.verses.length === 0) {
      return undefined;
    }

    const start = Math.max(1, note.startVerse - 2);
    const end = (note.endVerse || note.startVerse) + 2;
    const windowVerses = chapterData.verses.filter((v) => v.verse >= start && v.verse <= end);
    if (windowVerses.length === 0) return undefined;

    const formatted = windowVerses
      .map((v) => {
        const isNoted = v.verse >= note.startVerse && v.verse <= (note.endVerse || note.startVerse);
        const cleanText = stripVerseHtml(v.text);
        return `v${v.verse}${isNoted ? ' (noted)' : ''}: ${cleanText}`;
      })
      .join(' | ');

    return formatted.slice(0, 750);
  } catch {
    return undefined;
  }
}

export async function buildSynthesisPayloadNotes(sampled: CommentaryNote[]): Promise<SynthesisPayloadNote[]> {
  return Promise.all(
    sampled.map(async (n) => {
      if (n.isSynthesis) {
        const ref = `Synthesis: ${n.title?.trim() || 'Reflection'}`;
        const quote = (n.synthesisQuote || '').trim();
        const reply = n.content.trim();
        const combinedContent = reply ? `${quote}\nUser reply: ${reply}` : quote;
        return {
          id: n.id,
          reference: ref,
          content: combinedContent,
          isSynthesis: true,
          isPlainNote: false,
          title: n.title,
          updatedAt: n.updatedAt || n.createdAt,
        };
      }

      if (n.isPlainNote || n.bookId === 0) {
        return {
          id: n.id,
          reference: n.title?.trim() || 'Reflection Note',
          content: n.content,
          isSynthesis: false,
          isPlainNote: true,
          title: n.title,
          updatedAt: n.updatedAt || n.createdAt,
        };
      }

      const book = getBookById(n.bookId);
      const verseRange =
        n.endVerse && n.endVerse > n.startVerse ? `${n.startVerse}-${n.endVerse}` : `${n.startVerse}`;
      const reference = `${book?.name || 'Scripture'} ${n.chapter}:${verseRange}`;
      const verseContext = await getSurroundingVerseContext(n);

      return {
        id: n.id,
        reference,
        content: n.content,
        verseContext,
        isSynthesis: false,
        isPlainNote: false,
        title: n.title,
        updatedAt: n.updatedAt || n.createdAt,
      };
    })
  );
}
