// Coordinates background download and IndexedDB persistence of the full NET Bible for installed PWA offline use.
import { CANONICAL_BOOKS } from '../data/canonicalBooks';
import type { BibleBook, ChapterData, VerseToken } from '../types/bible';
import { db } from './db';
import { checkSimulateOffline } from '../utils/devSimulation';

export type OfflineBibleSyncStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'paused_offline'
  | 'complete'
  | 'error';

export interface OfflineBibleProgress {
  status: OfflineBibleSyncStatus;
  cachedChapters: number;
  totalChapters: number;
  currentBookName: string | null;
  error: string | null;
}

const VALID_CHAPTER_KEYS: Set<string> = (() => {
  const keys = new Set<string>();
  for (const book of CANONICAL_BOOKS) {
    for (let ch = 1; ch <= book.chapterCount; ch += 1) {
      keys.add(`${book.id}-${ch}`);
    }
  }
  return keys;
})();

export const TOTAL_NET_CHAPTERS = VALID_CHAPTER_KEYS.size;

const DOWNLOAD_CONCURRENCY = 2;
const RANGE_FALLBACK_SIZE = 20;

let snapshot: OfflineBibleProgress = {
  status: 'idle',
  cachedChapters: 0,
  totalChapters: TOTAL_NET_CHAPTERS,
  currentBookName: null,
  error: null,
};

const listeners = new Set<(progress: OfflineBibleProgress) => void>();
let activeSyncPromise: Promise<OfflineBibleProgress> | null = null;
let persistenceRequested = false;

function emit(partial: Partial<OfflineBibleProgress>): OfflineBibleProgress {
  snapshot = { ...snapshot, ...partial };
  for (const listener of listeners) {
    listener(snapshot);
  }
  return snapshot;
}

function isBrowserOffline(): boolean {
  if (typeof window === 'undefined') return false;
  if (checkSimulateOffline()) return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

async function requestPersistentStorage(): Promise<void> {
  if (persistenceRequested || typeof navigator === 'undefined') return;
  persistenceRequested = true;
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      const alreadyPersisted =
        typeof navigator.storage.persisted === 'function'
          ? await navigator.storage.persisted()
          : false;
      if (!alreadyPersisted) {
        await navigator.storage.persist();
      }
    }
  } catch {
    // Storage persistence API is optional and may decline silently
  }
}

async function getExistingValidChapterKeys(): Promise<Set<string>> {
  const keys = await db.chapters.toCollection().primaryKeys();
  const valid = new Set<string>();
  for (const key of keys) {
    if (typeof key === 'string' && VALID_CHAPTER_KEYS.has(key)) {
      valid.add(key);
    }
  }
  return valid;
}

async function fetchPassageRange(
  book: BibleBook,
  startChapter: number,
  endChapter: number
): Promise<Array<ChapterData & { id: string }>> {
  const bookNameSafe = encodeURIComponent(book.name);
  const rangeExpr =
    startChapter === endChapter ? `${startChapter}` : `${startChapter}-${endChapter}`;
  const res = await fetch(
    `https://labs.bible.org/api/?passage=${bookNameSafe}%20${rangeExpr}&type=json`
  );

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${book.name} ${rangeExpr}`);
  }

  const apiData: unknown = await res.json();
  if (!Array.isArray(apiData) || apiData.length === 0) {
    throw new Error(`Empty response for ${book.name} ${rangeExpr}`);
  }

  const versesByChapter = new Map<number, VerseToken[]>();

  for (const item of apiData) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as { chapter?: string | number; verse?: string | number; text?: string };
    const chNum = Number(raw.chapter);
    const vNum = Number(raw.verse);
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';

    if (
      !Number.isInteger(chNum) ||
      chNum < startChapter ||
      chNum > endChapter ||
      !Number.isInteger(vNum) ||
      vNum <= 0 ||
      !text
    ) {
      continue;
    }

    let list = versesByChapter.get(chNum);
    if (!list) {
      list = [];
      versesByChapter.set(chNum, list);
    }

    list.push({
      id: `${book.code}.${chNum}.${vNum}`,
      bookId: book.id,
      bookName: book.name,
      chapter: chNum,
      verse: vNum,
      text,
    });
  }

  const records: Array<ChapterData & { id: string }> = [];
  for (let ch = startChapter; ch <= endChapter; ch += 1) {
    const verses = versesByChapter.get(ch);
    if (verses && verses.length > 0) {
      records.push({
        id: `${book.id}-${ch}`,
        bookId: book.id,
        bookName: book.name,
        chapter: ch,
        verses,
      });
    }
  }

  return records;
}

async function cacheMissingBookChapters(
  book: BibleBook,
  existingKeys: Set<string>
): Promise<void> {
  const missingChapters: number[] = [];
  for (let ch = 1; ch <= book.chapterCount; ch += 1) {
    if (!existingKeys.has(`${book.id}-${ch}`)) {
      missingChapters.push(ch);
    }
  }
  if (missingChapters.length === 0) return;

  const saveRecords = async (records: Array<ChapterData & { id: string }>) => {
    const toSave = records.filter((rec) => !existingKeys.has(rec.id));
    if (toSave.length === 0) return;
    await db.chapters.bulkPut(toSave);
    for (const rec of toSave) {
      existingKeys.add(rec.id);
    }
  };

  // Try whole-book batch request first (fast path: 1 request per book)
  try {
    const firstMissing = missingChapters[0];
    const lastMissing = missingChapters[missingChapters.length - 1];
    const records = await fetchPassageRange(book, firstMissing, lastMissing);
    await saveRecords(records);

    const remainingAfterWholeBook = missingChapters.filter(
      (ch) => !existingKeys.has(`${book.id}-${ch}`)
    );
    if (remainingAfterWholeBook.length === 0) return;
  } catch {
    if (isBrowserOffline()) {
      throw new Error('OFFLINE_PAUSED');
    }
  }

  // Fallback: fetch in smaller chapter chunks if whole-book failed or missed any chapters
  for (let ch = 1; ch <= book.chapterCount; ch += RANGE_FALLBACK_SIZE) {
    if (isBrowserOffline()) {
      throw new Error('OFFLINE_PAUSED');
    }
    const endCh = Math.min(book.chapterCount, ch + RANGE_FALLBACK_SIZE - 1);
    const hasMissingInChunk = missingChapters.some(
      (m) => m >= ch && m <= endCh && !existingKeys.has(`${book.id}-${m}`)
    );
    if (!hasMissingInChunk) continue;

    try {
      const records = await fetchPassageRange(book, ch, endCh);
      await saveRecords(records);
    } catch {
      if (isBrowserOffline()) {
        throw new Error('OFFLINE_PAUSED');
      }
      // Final per-chapter fallback for any remaining chapters in this chunk
      for (let singleCh = ch; singleCh <= endCh; singleCh += 1) {
        if (existingKeys.has(`${book.id}-${singleCh}`)) continue;
        if (isBrowserOffline()) {
          throw new Error('OFFLINE_PAUSED');
        }
        const singleRecords = await fetchPassageRange(book, singleCh, singleCh);
        await saveRecords(singleRecords);
      }
    }
  }
}

export function getOfflineBibleProgress(): OfflineBibleProgress {
  return snapshot;
}

export function subscribeOfflineBibleProgress(
  listener: (progress: OfflineBibleProgress) => void
): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}

export async function refreshOfflineBibleProgress(): Promise<OfflineBibleProgress> {
  if (activeSyncPromise) return snapshot;

  const existingKeys = await getExistingValidChapterKeys();
  const cachedChapters = existingKeys.size;
  const isComplete = cachedChapters >= TOTAL_NET_CHAPTERS;

  return emit({
    cachedChapters,
    totalChapters: TOTAL_NET_CHAPTERS,
    status: isComplete
      ? 'complete'
      : isBrowserOffline()
      ? 'paused_offline'
      : snapshot.status === 'error'
      ? 'error'
      : 'idle',
    currentBookName: null,
  });
}

export function ensureFullNetBibleCached(): Promise<OfflineBibleProgress> {
  if (activeSyncPromise) return activeSyncPromise;

  activeSyncPromise = (async (): Promise<OfflineBibleProgress> => {
    void requestPersistentStorage();
    emit({ status: 'checking', error: null, currentBookName: null });

    try {
      const existingKeys = await getExistingValidChapterKeys();
      const initialCount = existingKeys.size;

      if (initialCount >= TOTAL_NET_CHAPTERS) {
        return emit({
          status: 'complete',
          cachedChapters: TOTAL_NET_CHAPTERS,
          totalChapters: TOTAL_NET_CHAPTERS,
          currentBookName: null,
          error: null,
        });
      }

      if (isBrowserOffline()) {
        return emit({
          status: 'paused_offline',
          cachedChapters: initialCount,
          totalChapters: TOTAL_NET_CHAPTERS,
          currentBookName: null,
          error: null,
        });
      }

      const missingBooks = CANONICAL_BOOKS.filter((book) => {
        for (let ch = 1; ch <= book.chapterCount; ch += 1) {
          if (!existingKeys.has(`${book.id}-${ch}`)) return true;
        }
        return false;
      });

      emit({
        status: 'downloading',
        cachedChapters: initialCount,
        totalChapters: TOTAL_NET_CHAPTERS,
        currentBookName: missingBooks[0]?.name ?? null,
        error: null,
      });

      let cursor = 0;
      let pausedOffline = false;
      let lastError: string | null = null;

      const worker = async () => {
        while (cursor < missingBooks.length && !pausedOffline) {
          if (isBrowserOffline()) {
            pausedOffline = true;
            break;
          }

          const book = missingBooks[cursor];
          cursor += 1;
          if (!book) break;

          emit({
            status: 'downloading',
            currentBookName: book.name,
          });

          try {
            await cacheMissingBookChapters(book, existingKeys);
            emit({
              cachedChapters: existingKeys.size,
            });
          } catch (err) {
            if ((err as Error)?.message === 'OFFLINE_PAUSED' || isBrowserOffline()) {
              pausedOffline = true;
              break;
            }
            lastError =
              err instanceof Error ? err.message : `Failed caching ${book.name}`;
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, missingBooks.length) }, () =>
          worker()
        )
      );

      const finalKeys = await getExistingValidChapterKeys();
      const finalCount = finalKeys.size;

      if (finalCount >= TOTAL_NET_CHAPTERS) {
        return emit({
          status: 'complete',
          cachedChapters: TOTAL_NET_CHAPTERS,
          totalChapters: TOTAL_NET_CHAPTERS,
          currentBookName: null,
          error: null,
        });
      }

      if (pausedOffline || isBrowserOffline()) {
        return emit({
          status: 'paused_offline',
          cachedChapters: finalCount,
          totalChapters: TOTAL_NET_CHAPTERS,
          currentBookName: null,
          error: null,
        });
      }

      return emit({
        status: lastError ? 'error' : 'idle',
        cachedChapters: finalCount,
        totalChapters: TOTAL_NET_CHAPTERS,
        currentBookName: null,
        error:
          'Some chapters couldn’t finish saving—your connection or the Scripture service may have timed out. Retry download when online, or report persistent issues in About Reneu.',
      });
    } catch {
      return emit({
        status: isBrowserOffline() ? 'paused_offline' : 'error',
        currentBookName: null,
        error:
          'Couldn’t finish saving the NET Bible locally—your connection or browser storage may be restricted. Try again, or report persistent issues in About Reneu.',
      });
    } finally {
      activeSyncPromise = null;
    }
  })();

  return activeSyncPromise;
}
