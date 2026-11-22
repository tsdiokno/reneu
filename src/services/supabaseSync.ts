import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { CommentaryNote } from '../types/bible';
import type { ReadingPlan } from '../types/readingPlan';
import { db } from './db';
import {
  checkSimulateLoggedOut,
  isDummyDataEnabled,
  setSimulateLoggedOut,
} from '../utils/devSimulation';

const STORAGE_KEY_SUPABASE_URL = 'scripturepage_supabase_url';
const STORAGE_KEY_SUPABASE_ANON_KEY = 'scripturepage_supabase_anon_key';
const STORAGE_KEY_LAST_SYNCED = 'scripturepage_last_synced_at';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  isFromEnv: boolean;
}

export interface SupabaseUserProfile {
  id: string;
  email?: string;
  fullName?: string;
  avatarUrl?: string;
  provider?: string;
}

export interface SyncResult {
  success: boolean;
  notesPushed: number;
  notesPulled: number;
  error?: string;
  timestamp: number;
  userId?: string;
}

let cachedClient: SupabaseClient | null = null;
let cachedClientUrl = '';
let cachedClientKey = '';

/**
 * Returns current Supabase configuration. Checks localStorage override first,
 * falling back to Vite environment variables.
 */
export function getSupabaseConfig(): SupabaseConfig {
  if (typeof window !== 'undefined') {
    const localUrl = localStorage.getItem(STORAGE_KEY_SUPABASE_URL);
    const localKey = localStorage.getItem(STORAGE_KEY_SUPABASE_ANON_KEY);
    if (localUrl && localKey) {
      return {
        url: localUrl.trim(),
        anonKey: localKey.trim(),
        isFromEnv: false,
      };
    }
  }

  const envUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '';
  const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '';

  return {
    url: envUrl.trim(),
    anonKey: envKey.trim(),
    isFromEnv: Boolean(envUrl && envKey),
  };
}

export function isSupabaseConfigured(): boolean {
  const config = getSupabaseConfig();
  return Boolean(config.url && config.anonKey);
}

/**
 * Persists user-provided Supabase configuration in localStorage.
 */
export function saveSupabaseConfig(url: string, anonKey: string): void {
  const cleanUrl = url.trim();
  const cleanKey = anonKey.trim();
  if (typeof window !== 'undefined') {
    if (cleanUrl && cleanKey) {
      localStorage.setItem(STORAGE_KEY_SUPABASE_URL, cleanUrl);
      localStorage.setItem(STORAGE_KEY_SUPABASE_ANON_KEY, cleanKey);
    } else {
      localStorage.removeItem(STORAGE_KEY_SUPABASE_URL);
      localStorage.removeItem(STORAGE_KEY_SUPABASE_ANON_KEY);
    }
  }
  cachedClient = null;
  cachedClientUrl = '';
  cachedClientKey = '';
}

/**
 * Clears custom Supabase configuration from localStorage.
 */
export function clearSupabaseConfig(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY_SUPABASE_URL);
    localStorage.removeItem(STORAGE_KEY_SUPABASE_ANON_KEY);
  }
  cachedClient = null;
  cachedClientUrl = '';
  cachedClientKey = '';
}

/**
 * Returns an active Supabase client instance or null if unconfigured.
 */
export function getSupabaseClient(): SupabaseClient | null {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    return null;
  }

  if (cachedClient && cachedClientUrl === url && cachedClientKey === anonKey) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    cachedClientUrl = url;
    cachedClientKey = anonKey;
    return cachedClient;
  } catch (err) {
    console.warn('Failed to initialize Supabase client:', err);
    return null;
  }
}

/**
 * Maps Supabase Auth User object to a clean application profile.
 */
function mapUserToProfile(user: User | null | undefined): SupabaseUserProfile | null {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    fullName: user.user_metadata?.full_name || user.user_metadata?.name || undefined,
    avatarUrl: user.user_metadata?.avatar_url || user.user_metadata?.picture || undefined,
    provider: user.app_metadata?.provider || 'email',
  };
}

/**
 * Retrieves the currently authenticated Supabase user profile.
 * When logged-out simulation is active, returns null immediately.
 */
export async function getCurrentUser(): Promise<SupabaseUserProfile | null> {
  if (checkSimulateLoggedOut()) return null;
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return null;
    return mapUserToProfile(user);
  } catch {
    return null;
  }
}

/**
 * Registers a new user with email and password.
 * Free tier includes up to 50,000 monthly active users.
 */
export async function signUpWithEmail(
  email: string,
  pass: string,
  captchaToken?: string
): Promise<{ success: boolean; user?: SupabaseUserProfile; message: string; requiresConfirmation?: boolean }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, message: 'The central cloud sync service is currently unavailable. Your notes remain safely stored locally on this device.' };
  }
  try {
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password: pass,
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (error) {
      return { success: false, message: error.message };
    }
    // If sign-up succeeds with session, disable any lingering logged-out simulation
    if (data.session) {
      setSimulateLoggedOut(false);
    }
    const profile = mapUserToProfile(data.user);
    const requiresConfirmation = !data.session;
    return {
      success: true,
      user: profile || undefined,
      requiresConfirmation,
      message: requiresConfirmation
        ? 'Account registered! Please check your email inbox to confirm your address before logging in.'
        : 'Account created and signed in successfully!',
    };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Failed to sign up.' };
  }
}

/**
 * Signs in an existing user with email and password.
 */
export async function signInWithEmail(
  email: string,
  pass: string,
  captchaToken?: string
): Promise<{ success: boolean; user?: SupabaseUserProfile; message: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, message: 'The central cloud sync service is currently unavailable. Your notes remain safely stored locally.' };
  }
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password: pass,
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (error) {
      return { success: false, message: error.message };
    }
    // Clear any lingering logged-out simulation upon deliberate sign-in
    setSimulateLoggedOut(false);
    const profile = mapUserToProfile(data.user);
    return {
      success: true,
      user: profile || undefined,
      message: 'Signed in successfully!',
    };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Failed to sign in.' };
  }
}

/**
 * Signs in using Social OAuth (Google, Apple, GitHub).
 * Note: Google & GitHub OAuth have zero cost. Apple requires an active Apple Developer Program ($99/yr).
 */
export async function signInWithOAuth(
  provider: 'google' | 'apple' | 'github'
): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, message: 'The central cloud sync service is currently unavailable. Your notes remain safely stored locally.' };
  }
  try {
    const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
      },
    });
    if (error) {
      return { success: false, message: error.message };
    }
    return { success: true, message: `Redirecting to ${provider} sign-in…` };
  } catch (err: any) {
    return { success: false, message: err?.message || 'OAuth sign-in initiation failed.' };
  }
}

/**
 * Signs the current user out.
 */
export async function signOutUser(): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: true, message: 'Signed out.' };
  }
  try {
    const { error } = await client.auth.signOut();
    if (error) {
      return { success: false, message: error.message };
    }
    return { success: true, message: 'Signed out successfully.' };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Error during sign out.' };
  }
}

/**
 * Listens for Auth state changes (sign in, sign out, token refresh).
 * Also listens for simulated logged-out state changes (URL, sessionStorage, console).
 * Returns unsubscribe cleanup function.
 */
export function onAuthStateChange(callback: (user: SupabaseUserProfile | null) => void): () => void {
  const client = getSupabaseClient();

  const handleSimAuthChange = () => {
    if (checkSimulateLoggedOut()) {
      callback(null);
    } else {
      void getCurrentUser().then(callback);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('scripturepage-sim-auth', handleSimAuthChange);
  }

  let unsubscribe = () => {};
  if (client) {
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (checkSimulateLoggedOut()) {
        callback(null);
      } else {
        callback(mapUserToProfile(session?.user));
      }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        void syncAllWithCloud().catch(() => {});
      }
    });
    unsubscribe = () => subscription.unsubscribe();
  } else {
    callback(null);
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('scripturepage-sim-auth', handleSimAuthChange);
    }
    unsubscribe();
  };
}

/**
 * Verifies connectivity to the configured Supabase instance and checks table accessibility.
 */
export async function testSupabaseConnection(): Promise<{
  success: boolean;
  message: string;
  notesTableOk: boolean;
  settingsTableOk: boolean;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      message: 'Supabase URL or Anon Key is missing.',
      notesTableOk: false,
      settingsTableOk: false,
    };
  }

  let notesTableOk = false;
  let settingsTableOk = false;

  try {
    const { error: notesErr } = await client.from('notes').select('id').limit(1);
    if (!notesErr) notesTableOk = true;

    const { error: settingsErr } = await client.from('user_settings').select('key').limit(1);
    if (!settingsErr) settingsTableOk = true;

    if (notesTableOk && settingsTableOk) {
      return {
        success: true,
        message: 'Connected to Supabase! Both notes and user_settings tables are accessible.',
        notesTableOk: true,
        settingsTableOk: true,
      };
    } else if (notesTableOk) {
      return {
        success: true,
        message: 'Connected to notes table. Note: user_settings table not found (optional).',
        notesTableOk: true,
        settingsTableOk: false,
      };
    } else {
      return {
        success: false,
        message: `Connected to Supabase project, but could not query notes table: ${notesErr?.message || 'Check RLS policies & SQL schema'}`,
        notesTableOk: false,
        settingsTableOk,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'Network error connecting to Supabase.',
      notesTableOk: false,
      settingsTableOk: false,
    };
  }
}

/**
 * Converts a CommentaryNote into a Supabase-compatible database row,
 * attaching the optional user_id for multi-user PostgreSQL isolation.
 */
function noteToRow(note: CommentaryNote, userId?: string | null) {
  const row: Record<string, any> = {
    id: note.id,
    book_id: note.bookId ?? 0,
    book_name: note.bookName ?? '',
    chapter: note.chapter ?? 0,
    start_verse: note.startVerse ?? 0,
    end_verse: note.endVerse ?? 0,
    content: note.content ?? '',
    title: note.title ?? null,
    is_synthesis: Boolean(note.isSynthesis),
    is_plain_note: Boolean(note.isPlainNote),
    is_starred: Boolean(note.isStarred),
    synthesis_quote: note.synthesisQuote ?? null,
    source_references: note.sourceReferences ?? [],
    source_note_ids: note.sourceNoteIds ?? [],
    source_footnotes: note.sourceFootnotes ?? [],
    key_themes: note.keyThemes ?? [],
    trajectory_summary: note.trajectorySummary ?? null,
    practical_application: note.practicalApplication ?? null,
    created_at: Number(note.createdAt) || Date.now(),
    updated_at: Number(note.updatedAt) || Date.now(),
    deleted_at: note.deletedAt != null ? Number(note.deletedAt) : null,
  };

  if (userId) {
    row.user_id = userId;
  }

  return row;
}

/**
 * Converts a Supabase database row into a CommentaryNote.
 */
function rowToNote(row: any): CommentaryNote {
  return {
    id: row.id,
    bookId: Number(row.book_id) || 0,
    bookName: row.book_name || '',
    chapter: Number(row.chapter) || 0,
    startVerse: Number(row.start_verse) || 0,
    endVerse: Number(row.end_verse) || 0,
    content: row.content || '',
    title: row.title || undefined,
    isSynthesis: Boolean(row.is_synthesis),
    isPlainNote: Boolean(row.is_plain_note),
    isStarred: Boolean(row.is_starred),
    synthesisQuote: row.synthesis_quote || undefined,
    sourceReferences: Array.isArray(row.source_references) ? row.source_references : undefined,
    sourceNoteIds: Array.isArray(row.source_note_ids) ? row.source_note_ids : undefined,
    sourceFootnotes: Array.isArray(row.source_footnotes) ? row.source_footnotes : undefined,
    keyThemes: Array.isArray(row.key_themes) ? row.key_themes : undefined,
    trajectorySummary: row.trajectory_summary || undefined,
    practicalApplication: row.practical_application || undefined,
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
    deletedAt: row.deleted_at != null ? Number(row.deleted_at) : undefined,
  };
}

/**
 * Upserts note rows while gracefully handling deployments whose Supabase schema
 * has not yet added the optional `deleted_at` column.
 */
async function upsertNoteRowsResilient(client: SupabaseClient, rows: Record<string, any>[]) {
  const { error } = await client.from('notes').upsert(rows, { onConflict: 'id' });
  if (error && error.message && error.message.includes('deleted_at')) {
    const activeOnly = rows
      .filter((r) => r.deleted_at == null)
      .map(({ deleted_at: _omit, ...rest }) => rest);
    if (activeOnly.length === 0) return { error: null };
    return await client.from('notes').upsert(activeOnly, { onConflict: 'id' });
  }
  return { error };
}

const ACTIVE_PLAN_SETTING_KEY = 'active_reading_plan_id';
const PLAN_TOMBSTONES_SETTING_KEY = 'reading_plan_tombstones';
const PLAN_STATE_FALLBACK_CLOUD_KEY = 'reading_plans_state';
const PLAN_TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function readingPlanToRow(plan: ReadingPlan, userId?: string | null) {
  const row: Record<string, any> = {
    id: plan.id,
    title: plan.title ?? '',
    description: plan.description ?? '',
    is_preset: Boolean(plan.isPreset),
    preset_key: plan.presetKey ?? null,
    scope: plan.scope,
    duration_days: Number(plan.durationDays) || 365,
    days_per_week: Number(plan.daysPerWeek) || 7,
    track_style: plan.trackStyle,
    custom_book_ids: Array.isArray(plan.customBookIds) ? plan.customBookIds : null,
    start_date: Number(plan.startDate) || Date.now(),
    created_at: Number(plan.createdAt) || Date.now(),
    updated_at: Number(plan.updatedAt) || Date.now(),
    is_active: Boolean(plan.isActive),
    completed_days: Array.isArray(plan.completedDays) ? plan.completedDays : [],
    completed_portions:
      plan.completedPortions && typeof plan.completedPortions === 'object'
        ? plan.completedPortions
        : {},
    deleted_at: null,
  };
  if (userId) {
    row.user_id = userId;
  }
  return row;
}

function rowToReadingPlan(row: any): ReadingPlan {
  return {
    id: String(row.id),
    title: row.title || 'Reading Plan',
    description: row.description || '',
    isPreset: Boolean(row.is_preset ?? row.isPreset),
    presetKey: (row.preset_key ?? row.presetKey) || undefined,
    scope: row.scope,
    durationDays: Number(row.duration_days ?? row.durationDays) || 365,
    daysPerWeek: (Number(row.days_per_week ?? row.daysPerWeek) || 7) as ReadingPlan['daysPerWeek'],
    trackStyle: row.track_style ?? row.trackStyle ?? 'canonical',
    customBookIds: Array.isArray(row.custom_book_ids ?? row.customBookIds)
      ? (row.custom_book_ids ?? row.customBookIds)
      : undefined,
    startDate: Number(row.start_date ?? row.startDate) || Date.now(),
    createdAt: Number(row.created_at ?? row.createdAt) || Date.now(),
    updatedAt: Number(row.updated_at ?? row.updatedAt) || Date.now(),
    isActive: Boolean(row.is_active ?? row.isActive),
    completedDays: Array.isArray(row.completed_days ?? row.completedDays)
      ? (row.completed_days ?? row.completedDays)
      : [],
    completedPortions:
      (row.completed_portions ?? row.completedPortions) &&
      typeof (row.completed_portions ?? row.completedPortions) === 'object'
        ? (row.completed_portions ?? row.completedPortions)
        : {},
  };
}

function isMissingReadingPlansTableError(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('reading_plans') && (msg.includes('does not exist') || msg.includes('could not find'))
  );
}

function pruneTombstones(raw: Record<string, number>, now: number): Record<string, number> {
  const cleaned: Record<string, number> = {};
  for (const [id, ts] of Object.entries(raw || {})) {
    const num = Number(ts);
    if (id && !id.startsWith('seed-') && Number.isFinite(num) && num > 0 && now - num < PLAN_TOMBSTONE_RETENTION_MS) {
      cleaned[id] = num;
    }
  }
  return cleaned;
}

export async function getLocalPlanTombstones(): Promise<Record<string, number>> {
  try {
    const entry = await db.settings.get(PLAN_TOMBSTONES_SETTING_KEY);
    if (entry && entry.value && typeof entry.value === 'object') {
      return pruneTombstones(entry.value, Date.now());
    }
  } catch {}
  return {};
}

export async function recordLocalPlanTombstone(planId: string, deletedAt = Date.now()): Promise<Record<string, number>> {
  const current = await getLocalPlanTombstones();
  if (!planId.startsWith('seed-')) {
    current[planId] = Math.max(current[planId] || 0, deletedAt);
    await db.settings.put({
      id: PLAN_TOMBSTONES_SETTING_KEY,
      value: current,
      updatedAt: deletedAt,
    } as any);
  }
  return current;
}

async function saveReadingPlansStateFallback(client: SupabaseClient, userId: string): Promise<void> {
  const allLocalPlans = (await db.readingPlans.toArray()).filter((p) => !p.id.startsWith('seed-'));
  const tombstones = await getLocalPlanTombstones();
  const now = Date.now();
  await client.from('user_settings').upsert(
    {
      key: PLAN_STATE_FALLBACK_CLOUD_KEY,
      user_id: userId,
      value: { plans: allLocalPlans, tombstones },
      updated_at: now,
    },
    { onConflict: 'key,user_id' }
  );
}

// Memory buffers for debouncing background cloud writes
const pendingNotesMap = new Map<string, CommentaryNote>();
const pendingNoteTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSettingsMap = new Map<string, any>();
const pendingSettingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingPlansMap = new Map<string, ReadingPlan>();
const pendingPlanTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingPlanDeletesMap = new Map<string, number>();

/**
 * Resolves current active user ID from cached session first, avoiding remote auth round-trips.
 */
async function getActiveUserId(client: SupabaseClient): Promise<string | undefined> {
  if (checkSimulateLoggedOut()) return undefined;
  try {
    const { data: { session } } = await client.auth.getSession();
    if (session?.user?.id) return session.user.id;
    const { data: { user } } = await client.auth.getUser();
    return user?.id;
  } catch {
    return undefined;
  }
}

/**
 * Flushes all queued background note, plan, and settings writes immediately.
 */
export async function flushPendingCloudSync(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const notesToFlush = Array.from(pendingNotesMap.values());
  pendingNotesMap.clear();
  pendingNoteTimers.forEach((timer) => clearTimeout(timer));
  pendingNoteTimers.clear();

  const plansToFlush = Array.from(pendingPlansMap.values());
  pendingPlansMap.clear();
  pendingPlanTimers.forEach((timer) => clearTimeout(timer));
  pendingPlanTimers.clear();

  const planDeletesToFlush = Array.from(pendingPlanDeletesMap.entries());
  pendingPlanDeletesMap.clear();

  const settingsToFlush = Array.from(pendingSettingsMap.entries());
  pendingSettingsMap.clear();
  pendingSettingTimers.forEach((timer) => clearTimeout(timer));
  pendingSettingTimers.clear();

  if (
    notesToFlush.length === 0 &&
    plansToFlush.length === 0 &&
    planDeletesToFlush.length === 0 &&
    settingsToFlush.length === 0
  ) {
    return;
  }

  try {
    const userId = await getActiveUserId(client);
    if (!userId) {
      // Guest reflections & plans remain securely local in IndexedDB until an account is signed in
      return;
    }

    const syncableNotes = notesToFlush.filter((n) => !n.id.startsWith('seed-'));
    if (syncableNotes.length > 0) {
      const rows = syncableNotes.map((n) => noteToRow(n, userId));
      await upsertNoteRowsResilient(client, rows);
    }

    const syncablePlans = plansToFlush.filter((p) => !p.id.startsWith('seed-'));
    let needsFallbackPlanState = false;
    if (syncablePlans.length > 0) {
      const planRows = syncablePlans.map((p) => readingPlanToRow(p, userId));
      const { error: planPushErr } = await client.from('reading_plans').upsert(planRows, { onConflict: 'id' });
      if (isMissingReadingPlansTableError(planPushErr)) {
        needsFallbackPlanState = true;
      }
    }

    if (planDeletesToFlush.length > 0) {
      const deleteIds = planDeletesToFlush.map(([id]) => id).filter((id) => !id.startsWith('seed-'));
      if (deleteIds.length > 0) {
        const { error: delErr } = await client
          .from('reading_plans')
          .delete()
          .eq('user_id', userId)
          .in('id', deleteIds);
        if (isMissingReadingPlansTableError(delErr)) {
          needsFallbackPlanState = true;
        }
      }
      const tombstones = await getLocalPlanTombstones();
      await client.from('user_settings').upsert(
        {
          key: PLAN_TOMBSTONES_SETTING_KEY,
          user_id: userId,
          value: tombstones,
          updated_at: Date.now(),
        },
        { onConflict: 'key,user_id' }
      );
    }

    if (needsFallbackPlanState) {
      await saveReadingPlansStateFallback(client, userId);
    }

    if (settingsToFlush.length > 0) {
      const now = Date.now();
      for (const [key, value] of settingsToFlush) {
        const payload: Record<string, any> = { key, value, updated_at: now };
        if (userId) payload.user_id = userId;
        await client.from('user_settings').upsert(payload, { onConflict: 'key,user_id' });
      }
    }
  } catch (err) {
    console.debug('Flushing pending cloud writes skipped:', err);
  }
}

// Ensure pending writes are flushed before the browser unloads or tabs hide
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    void flushPendingCloudSync();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushPendingCloudSync();
    }
  });
}

/**
 * Stand-in Online Hook: Debounced single-note push to Supabase.
 * Batches rapid typing keystrokes (1200ms debounce), reducing network calls by ~90%
 * while ensuring local Dexie storage remains instant.
 */
export async function pushNoteToCloud(note: CommentaryNote): Promise<void> {
  if (note.id.startsWith('seed-')) return;
  const client = getSupabaseClient();
  if (!client) return;

  pendingNotesMap.set(note.id, note);

  const existingTimer = pendingNoteTimers.get(note.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(async () => {
    pendingNoteTimers.delete(note.id);
    const queuedNote = pendingNotesMap.get(note.id);
    if (!queuedNote) return;
    pendingNotesMap.delete(note.id);

    try {
      const userId = await getActiveUserId(client);
      if (!userId) {
        // Guest mode notes remain safely in local IndexedDB until account registration/sign-in
        return;
      }
      const row = noteToRow(queuedNote, userId);
      await upsertNoteRowsResilient(client, [row]);
    } catch (err) {
      console.debug('Background Supabase note sync skipped:', err);
    }
  }, 1200);

  pendingNoteTimers.set(note.id, timer);
}

/**
 * Stand-in Online Hook: Single-note delete from Supabase.
 * Immediately cancels any pending debounced writes for the note.
 */
export async function deleteNoteFromCloud(id: string): Promise<void> {
  const existingTimer = pendingNoteTimers.get(id);
  if (existingTimer) {
    clearTimeout(existingTimer);
    pendingNoteTimers.delete(id);
  }
  pendingNotesMap.delete(id);

  const client = getSupabaseClient();
  if (!client) return;
  try {
    const userId = await getActiveUserId(client);
    if (!userId) return;
    await client.from('notes').delete().eq('id', id).eq('user_id', userId);
  } catch (err) {
    console.debug('Background Supabase note delete skipped:', err);
  }
}

/**
 * Debounced reading plan upsert to Supabase (800ms delay).
 * Skips demo (`seed-*`) plans and unauthenticated guests.
 */
export async function pushReadingPlanToCloud(plan: ReadingPlan): Promise<void> {
  if (plan.id.startsWith('seed-')) return;
  pendingPlanDeletesMap.delete(plan.id);

  const client = getSupabaseClient();
  if (!client) return;

  pendingPlansMap.set(plan.id, plan);

  const existingTimer = pendingPlanTimers.get(plan.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(async () => {
    pendingPlanTimers.delete(plan.id);
    const queuedPlan = pendingPlansMap.get(plan.id);
    if (!queuedPlan) return;
    pendingPlansMap.delete(plan.id);

    try {
      const userId = await getActiveUserId(client);
      if (!userId) return;

      const row = readingPlanToRow(queuedPlan, userId);
      const { error } = await client.from('reading_plans').upsert([row], { onConflict: 'id' });
      if (isMissingReadingPlansTableError(error)) {
        await saveReadingPlansStateFallback(client, userId);
      }
    } catch (err) {
      console.debug('Background Supabase reading plan sync skipped:', err);
    }
  }, 800);

  pendingPlanTimers.set(plan.id, timer);
}

/**
 * Deletes a reading plan from Supabase and propagates its deletion tombstone.
 */
export async function deleteReadingPlanFromCloud(planId: string, deletedAt = Date.now()): Promise<void> {
  const existingTimer = pendingPlanTimers.get(planId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    pendingPlanTimers.delete(planId);
  }
  pendingPlansMap.delete(planId);

  if (planId.startsWith('seed-')) return;

  const client = getSupabaseClient();
  if (!client) return;

  pendingPlanDeletesMap.set(planId, deletedAt);

  try {
    const userId = await getActiveUserId(client);
    if (!userId) return;

    pendingPlanDeletesMap.delete(planId);

    const { error: delErr } = await client
      .from('reading_plans')
      .delete()
      .eq('id', planId)
      .eq('user_id', userId);

    const tombstones = await getLocalPlanTombstones();
    await client.from('user_settings').upsert(
      {
        key: PLAN_TOMBSTONES_SETTING_KEY,
        user_id: userId,
        value: tombstones,
        updated_at: deletedAt,
      },
      { onConflict: 'key,user_id' }
    );

    if (isMissingReadingPlansTableError(delErr)) {
      await saveReadingPlansStateFallback(client, userId);
    }
  } catch (err) {
    console.debug('Background Supabase reading plan delete skipped:', err);
  }
}

/**
 * Fetches a single user setting directly from Supabase (used when local Dexie is unpopulated on a fresh device).
 */
export async function fetchRemoteSetting(key: string): Promise<{ value: any; updatedAt: number } | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const userId = await getActiveUserId(client);
    if (!userId) return null;
    const { data, error } = await client
      .from('user_settings')
      .select('value, updated_at')
      .eq('user_id', userId)
      .eq('key', key)
      .maybeSingle();

    if (!error && data && data.value !== undefined && data.value !== null) {
      return {
        value: data.value,
        updatedAt: Number(data.updated_at) || Date.now(),
      };
    }
  } catch (err) {
    console.debug('Failed fetching remote setting:', err);
  }
  return null;
}

/**
 * Stand-in Online Hook: Debounced user settings sync to Supabase (1000ms delay).
 */
export async function pushSettingToCloud(key: string, value: any): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  pendingSettingsMap.set(key, value);

  const existingTimer = pendingSettingTimers.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(async () => {
    pendingSettingTimers.delete(key);
    const queuedValue = pendingSettingsMap.get(key);
    if (queuedValue === undefined) return;
    pendingSettingsMap.delete(key);

    try {
      const userId = await getActiveUserId(client);
      if (!userId) {
        // Guest mode settings remain local in Dexie until account registration/sign-in
        return;
      }
      const payload: Record<string, any> = {
        key,
        user_id: userId,
        value: queuedValue,
        updated_at: Date.now(),
      };
      await client.from('user_settings').upsert(payload, { onConflict: 'key,user_id' });
    } catch (err) {
      console.debug('Background Supabase setting sync skipped:', err);
    }
  }, 1000);

  pendingSettingTimers.set(key, timer);
}

/**
 * Full bidirectional synchronization between local Dexie (IndexedDB) and Supabase.
 * Automatically respects active user credentials and Row Level Security.
 * 1. Pushes local notes to Supabase.
 * 2. Pulls remote notes down, merging newer versions into Dexie.
 * 3. Syncs user settings.
 */
export async function syncAllWithCloud(): Promise<SyncResult> {
  const client = getSupabaseClient();
  const now = Date.now();

  if (!client) {
    return {
      success: false,
      notesPushed: 0,
      notesPulled: 0,
      error: 'Central cloud sync service is currently unavailable.',
      timestamp: now,
    };
  }

  try {
    // Flush any pending debounced writes before beginning full bidirectional sync
    await flushPendingCloudSync();

    const user = checkSimulateLoggedOut() ? null : (await client.auth.getUser()).data.user;
    const userId = user?.id;
    if (!userId) {
      return {
        success: false,
        notesPushed: 0,
        notesPulled: 0,
        error: 'Sign in required before syncing notes to cloud.',
        timestamp: now,
      };
    }

    // 1. Fetch all local notes from Dexie, excluding demo/seed notes (offload dummy data)
    const allLocalNotes = await db.notes.toArray();
    const dummyNoteIds = allLocalNotes.filter((n) => n.id.startsWith('seed-')).map((n) => n.id);
    if (dummyNoteIds.length > 0 && !isDummyDataEnabled()) {
      await db.notes.bulkDelete(dummyNoteIds);
    }
    const localNotes = allLocalNotes.filter((n) => !n.id.startsWith('seed-'));

    // Also exclude/clean demo seed-* reading plans
    const allLocalPlansRaw = await db.readingPlans.toArray();
    const dummyPlanIds = allLocalPlansRaw.filter((p) => p.id.startsWith('seed-')).map((p) => p.id);
    if (dummyPlanIds.length > 0 && !isDummyDataEnabled()) {
      await db.readingPlans.bulkDelete(dummyPlanIds);
    }
    const localPlans = allLocalPlansRaw.filter((p) => !p.id.startsWith('seed-'));

    // 2. Push real local notes to Supabase in batches of 50
    let notesPushed = 0;
    if (localNotes.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < localNotes.length; i += batchSize) {
        const batch = localNotes.slice(i, i + batchSize).map((n) => noteToRow(n, userId));
        const { error: pushErr } = await upsertNoteRowsResilient(client, batch);
        if (pushErr) {
          throw new Error(`Failed pushing notes to Supabase: ${pushErr.message}`);
        }
        notesPushed += batch.length;
      }
    }

    // 3. Pull remote notes from Supabase (Row Level Security automatically limits to this user)
    let notesPulled = 0;
    let query = client.from('notes').select('*').order('updated_at', { ascending: false });
    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: remoteRows, error: pullErr } = await query;

    if (pullErr) {
      throw new Error(`Failed pulling notes from Supabase: ${pullErr.message}`);
    }

    if (remoteRows && remoteRows.length > 0) {
      const localMap = new Map(localNotes.map((n) => [n.id, n]));
      for (const row of remoteRows) {
        const remoteNote = rowToNote(row);
        const local = localMap.get(remoteNote.id);

        if (!local || (remoteNote.updatedAt && remoteNote.updatedAt > (local.updatedAt || 0))) {
          await db.notes.put(remoteNote);
          notesPulled++;
        }
      }
    }

    // 4. Bidirectional Sync of User Settings, Active Plan Pointer & Reading Plans
    if (userId) {
      let cloudSettingsMap = new Map<string, any>();
      try {
        const { data: remoteSettings, error: settingsPullErr } = await client
          .from('user_settings')
          .select('key, value, updated_at')
          .eq('user_id', userId);

        if (!settingsPullErr && remoteSettings) {
          cloudSettingsMap = new Map(remoteSettings.map((s: any) => [s.key, s]));

          const settingKeys: Array<{ cloudKey: string; dexieKey: string }> = [
            { cloudKey: 'user_profile', dexieKey: 'user_abridged_profile' },
            { cloudKey: 'appearance_settings', dexieKey: 'appearance_settings' },
            { cloudKey: 'reading_pos', dexieKey: 'reading_pos' },
            { cloudKey: ACTIVE_PLAN_SETTING_KEY, dexieKey: ACTIVE_PLAN_SETTING_KEY },
          ];

          for (const { cloudKey, dexieKey } of settingKeys) {
            const localEntry = await db.settings.get(dexieKey);
            const cloudEntry = cloudSettingsMap.get(cloudKey);

            if (cloudEntry && cloudEntry.value !== undefined) {
              const cloudTimestamp = Number(cloudEntry.updated_at) || 0;
              const localTimestamp = Number((localEntry as any)?.updatedAt) || 0;

              if (!localEntry || cloudTimestamp > localTimestamp) {
                await db.settings.put({
                  id: dexieKey,
                  value: cloudEntry.value,
                  updatedAt: cloudTimestamp || now,
                } as any);
              } else if (localEntry && localTimestamp > cloudTimestamp) {
                await client.from('user_settings').upsert(
                  {
                    key: cloudKey,
                    user_id: userId,
                    value: localEntry.value,
                    updated_at: localTimestamp || now,
                  },
                  { onConflict: 'key,user_id' }
                );
              }
            } else if (localEntry && localEntry.value !== undefined) {
              const localTimestamp = Number((localEntry as any)?.updatedAt) || now;
              await client.from('user_settings').upsert(
                {
                  key: cloudKey,
                  user_id: userId,
                  value: localEntry.value,
                  updated_at: localTimestamp,
                },
                { onConflict: 'key,user_id' }
              );
            }
          }
        }
      } catch (settingsSyncErr) {
        console.debug('Background user_settings sync non-fatal:', settingsSyncErr);
      }

      // 4b. Bidirectional Reading Plans Sync (dedicated table with user_settings fallback)
      try {
        const localTombstones = await getLocalPlanTombstones();
        const cloudTombstoneRaw = cloudSettingsMap.get(PLAN_TOMBSTONES_SETTING_KEY)?.value;
        const fallbackState = cloudSettingsMap.get(PLAN_STATE_FALLBACK_CLOUD_KEY)?.value;
        const fallbackTombstones =
          fallbackState?.tombstones && typeof fallbackState.tombstones === 'object'
            ? fallbackState.tombstones
            : {};

        const mergedTombstones = pruneTombstones(
          {
            ...localTombstones,
            ...(cloudTombstoneRaw && typeof cloudTombstoneRaw === 'object' ? cloudTombstoneRaw : {}),
            ...fallbackTombstones,
          },
          now
        );
        for (const [id, ts] of Object.entries(localTombstones)) {
          if (mergedTombstones[id] !== undefined) {
            mergedTombstones[id] = Math.max(mergedTombstones[id], ts);
          }
        }

        const { data: remotePlanRows, error: plansPullErr } = await client
          .from('reading_plans')
          .select('*')
          .eq('user_id', userId);

        const useFallbackTable = isMissingReadingPlansTableError(plansPullErr);
        const remotePlansList: ReadingPlan[] = [];

        if (!useFallbackTable && !plansPullErr && Array.isArray(remotePlanRows)) {
          for (const row of remotePlanRows) {
            if (row.deleted_at != null) {
              mergedTombstones[row.id] = Math.max(mergedTombstones[row.id] || 0, Number(row.deleted_at) || 0);
            } else {
              remotePlansList.push(rowToReadingPlan(row));
            }
          }
        }

        // Also fold in any plans stored in the user_settings fallback snapshot (migration/fallback)
        if (Array.isArray(fallbackState?.plans)) {
          for (const fp of fallbackState.plans) {
            const normalized = rowToReadingPlan(fp);
            const existingIdx = remotePlansList.findIndex((rp) => rp.id === normalized.id);
            if (existingIdx === -1) {
              remotePlansList.push(normalized);
            } else if ((normalized.updatedAt || 0) > (remotePlansList[existingIdx].updatedAt || 0)) {
              remotePlansList[existingIdx] = normalized;
            }
          }
        }

        const localPlanMap = new Map(localPlans.map((p) => [p.id, p]));
        const remotePlanMap = new Map(remotePlansList.map((p) => [p.id, p]));

        // Apply deletion tombstones locally and remotely
        const remoteDeleteIds: string[] = [];
        let plansChanged = false;
        for (const [planId, deletedAt] of Object.entries(mergedTombstones)) {
          const lp = localPlanMap.get(planId);
          if (lp && deletedAt >= (lp.updatedAt || 0)) {
            await db.readingPlans.delete(planId);
            localPlanMap.delete(planId);
            plansChanged = true;
          }
          const rp = remotePlanMap.get(planId);
          if (rp && deletedAt >= (rp.updatedAt || 0)) {
            remoteDeleteIds.push(planId);
            remotePlanMap.delete(planId);
          }
        }

        // Pull newer or missing remote plans into local Dexie
        for (const remotePlan of remotePlanMap.values()) {
          const localPlan = localPlanMap.get(remotePlan.id);
          if (!localPlan || (remotePlan.updatedAt || 0) > (localPlan.updatedAt || 0)) {
            await db.readingPlans.put(remotePlan);
            localPlanMap.set(remotePlan.id, remotePlan);
            plansChanged = true;
          }
        }

        // Push newer or missing local plans to cloud
        const plansToPush: ReadingPlan[] = [];
        for (const localPlan of localPlanMap.values()) {
          const remotePlan = remotePlanMap.get(localPlan.id);
          if (!remotePlan || (localPlan.updatedAt || 0) > (remotePlan.updatedAt || 0)) {
            plansToPush.push(localPlan);
          }
        }

        await db.settings.put({
          id: PLAN_TOMBSTONES_SETTING_KEY,
          value: mergedTombstones,
          updatedAt: now,
        } as any);

        if (useFallbackTable) {
          await saveReadingPlansStateFallback(client, userId);
        } else {
          if (remoteDeleteIds.length > 0) {
            await client
              .from('reading_plans')
              .delete()
              .eq('user_id', userId)
              .in('id', remoteDeleteIds);
          }
          if (plansToPush.length > 0) {
            await client
              .from('reading_plans')
              .upsert(plansToPush.map((p) => readingPlanToRow(p, userId)), { onConflict: 'id' });
          }
        }

        await client.from('user_settings').upsert(
          {
            key: PLAN_TOMBSTONES_SETTING_KEY,
            user_id: userId,
            value: mergedTombstones,
            updated_at: now,
          },
          { onConflict: 'key,user_id' }
        );

        // Reconcile active_reading_plan_id with merged plans
        const mergedPlans = Array.from(localPlanMap.values());
        const activeSetting = await db.settings.get(ACTIVE_PLAN_SETTING_KEY);
        const targetActiveId =
          typeof activeSetting?.value === 'string' && localPlanMap.has(activeSetting.value)
            ? activeSetting.value
            : mergedPlans.find((p) => p.isActive)?.id || mergedPlans[0]?.id || null;

        for (const p of mergedPlans) {
          const shouldBeActive = p.id === targetActiveId;
          if (p.isActive !== shouldBeActive) {
            await db.readingPlans.put({ ...p, isActive: shouldBeActive });
            plansChanged = true;
          }
        }

        if ((activeSetting?.value ?? null) !== targetActiveId) {
          await db.settings.put({
            id: ACTIVE_PLAN_SETTING_KEY,
            value: targetActiveId,
            updatedAt: now,
          } as any);
          await client.from('user_settings').upsert(
            {
              key: ACTIVE_PLAN_SETTING_KEY,
              user_id: userId,
              value: targetActiveId,
              updated_at: now,
            },
            { onConflict: 'key,user_id' }
          );
          plansChanged = true;
        }

        if (plansChanged && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('reneu:plans-synced'));
        }
      } catch (plansSyncErr) {
        console.debug('Background reading_plans sync non-fatal:', plansSyncErr);
      }
    }

    // 5. Record sync timestamp
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_LAST_SYNCED, String(now));
      } catch {}
    }

    return {
      success: true,
      notesPushed,
      notesPulled,
      timestamp: now,
      userId,
    };
  } catch (err: any) {
    console.warn('Sync failed:', err);
    return {
      success: false,
      notesPushed: 0,
      notesPulled: 0,
      error: err?.message || 'Sync failed due to an unexpected error.',
      timestamp: now,
    };
  }
}

/**
 * Returns formatted string representing the last sync time.
 */
export function getLastSyncedTime(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LAST_SYNCED);
    if (!raw) return null;
    const ts = parseInt(raw, 10);
    if (isNaN(ts) || ts <= 0) return null;
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

// Auto-sync listener: Trigger background sync when returning online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (isSupabaseConfigured()) {
      void syncAllWithCloud().catch(() => {});
    }
  });
}
