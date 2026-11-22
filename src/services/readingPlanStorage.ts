import { db } from './db';
import type {
  ReadingPlan,
  PlanScope,
  PlanDaysPerWeek,
  PlanTrackStyle,
} from '../types/readingPlan';
import { CLASSICAL_PRESETS } from './readingPlanEngine';
import { isDummyDataEnabled } from '../utils/devSimulation';
import {
  pushReadingPlanToCloud,
  deleteReadingPlanFromCloud,
  pushSettingToCloud,
  recordLocalPlanTombstone,
} from './supabaseSync';

const SETTING_KEY_ACTIVE_PLAN = 'active_reading_plan_id';
const SETTING_KEY_PLANS_INITIAL_SEEDED = 'plans_initial_seeded';

let plansInitPromise: Promise<void> | null = null;

function clonePlain<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function isUntouchedLegacyMcheyneSeed(plan: ReadingPlan): boolean {
  return (
    plan.id.startsWith('plan-mcheyne-') &&
    plan.presetKey === 'mcheyne' &&
    (!plan.completedDays || plan.completedDays.length === 0) &&
    (!plan.completedPortions || Object.keys(plan.completedPortions).length === 0)
  );
}

/**
 * Initializes reading plans state cleanly:
 * - In production (!isDummyDataEnabled()): guarantees Plans start empty, purges any `seed-*`
 *   demo plans, and performs a one-time cleanup of untouched auto-seeded legacy beta M'Cheyne plans.
 * - In dev/demo mode (isDummyDataEnabled()): seeds the demo M'Cheyne plan once with a `seed-`
 *   prefix so it stays local and is never pushed to Supabase.
 */
export async function ensurePlansInitialized(): Promise<void> {
  if (!plansInitPromise) {
    plansInitPromise = (async () => {
      try {
        const dummyEnabled = isDummyDataEnabled();

        if (!dummyEnabled) {
          // Always strip any stray `seed-*` plans when running in production
          const currentPlans = await db.readingPlans.toArray();
          const seedPlanIds = currentPlans
            .filter((p) => p.id.startsWith('seed-'))
            .map((p) => p.id);

          if (seedPlanIds.length > 0) {
            await db.readingPlans.bulkDelete(seedPlanIds);
            const activeSetting = await db.settings.get(SETTING_KEY_ACTIVE_PLAN);
            if (typeof activeSetting?.value === 'string' && seedPlanIds.includes(activeSetting.value)) {
              await db.settings.delete(SETTING_KEY_ACTIVE_PLAN);
            }
          }

          // One-time migration for existing beta users who had auto-seeded untouched M'Cheyne plans
          const seededSetting = await db.settings.get(SETTING_KEY_PLANS_INITIAL_SEEDED);
          if (!seededSetting) {
            const remainingPlans = await db.readingPlans.toArray();
            if (
              remainingPlans.length > 0 &&
              remainingPlans.every((p) => isUntouchedLegacyMcheyneSeed(p))
            ) {
              const legacyIds = remainingPlans.map((p) => p.id);
              await db.readingPlans.bulkDelete(legacyIds);
              await db.settings.delete(SETTING_KEY_ACTIVE_PLAN);
              const now = Date.now();
              for (const legacyId of legacyIds) {
                await recordLocalPlanTombstone(legacyId, now);
                void deleteReadingPlanFromCloud(legacyId, now);
              }
            }
            await db.settings.put({ id: SETTING_KEY_PLANS_INITIAL_SEEDED, value: true });
          }
          return;
        }

        // Dev / Demo mode: seed M'Cheyne once if database has no plans yet
        const seededSetting = await db.settings.get(SETTING_KEY_PLANS_INITIAL_SEEDED);
        if (!seededSetting) {
          const count = await db.readingPlans.count();
          if (count === 0) {
            await createPlanFromPreset('mcheyne', true, { isSeedDemo: true });
          }
          await db.settings.put({ id: SETTING_KEY_PLANS_INITIAL_SEEDED, value: true });
        }
      } catch (err) {
        console.warn('Error during reading plans initialization:', err);
      }
    })();
  }
  return plansInitPromise;
}

/**
 * Retrieves all saved reading plans (most recently created first)
 */
export async function getAllReadingPlans(): Promise<ReadingPlan[]> {
  try {
    await ensurePlansInitialized();
    const plans = await db.readingPlans.orderBy('createdAt').reverse().toArray();
    if (!isDummyDataEnabled()) {
      return plans.filter((p) => !p.id.startsWith('seed-'));
    }
    return plans;
  } catch (err) {
    console.warn('Error fetching reading plans:', err);
    return [];
  }
}

/**
 * Retrieves the currently active reading plan, or null if no plans exist
 */
export async function getActiveReadingPlan(): Promise<ReadingPlan | null> {
  try {
    await ensurePlansInitialized();
    const all = await db.readingPlans.toArray();
    const plans = !isDummyDataEnabled() ? all.filter((p) => !p.id.startsWith('seed-')) : all;

    if (plans.length === 0) {
      return null;
    }

    const activeSetting = await db.settings.get(SETTING_KEY_ACTIVE_PLAN);
    if (activeSetting && typeof activeSetting.value === 'string' && activeSetting.value) {
      const match = plans.find((p) => p.id === activeSetting.value);
      if (match) return match;
    }

    // Fall back to first active plan or most recently created plan
    const sorted = [...plans].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const active = sorted.find((p) => p.isActive) || sorted[0] || null;
    if (active) {
      await db.settings.put({ id: SETTING_KEY_ACTIVE_PLAN, value: active.id });
    }
    return active;
  } catch (err) {
    console.warn('Error fetching active reading plan:', err);
    return null;
  }
}

/**
 * Saves or updates a reading plan in Dexie and syncs to Supabase when signed in
 */
export async function saveReadingPlan(plan: ReadingPlan): Promise<void> {
  const plain = clonePlain(plan);
  if (!plain.updatedAt) {
    plain.updatedAt = Date.now();
  }
  await db.readingPlans.put(plain);
  if (plain.isActive && !plain.id.startsWith('seed-')) {
    await db.settings.put({
      id: SETTING_KEY_ACTIVE_PLAN,
      value: plain.id,
      updatedAt: plain.updatedAt,
    } as any);
    void pushSettingToCloud(SETTING_KEY_ACTIVE_PLAN, plain.id);
  }
  void pushReadingPlanToCloud(plain);
}

/**
 * Sets a specific plan as the active one locally and in the cloud
 */
export async function setActiveReadingPlan(planId: string): Promise<void> {
  const now = Date.now();
  const plans = await db.readingPlans.toArray();
  let matchedNonSeed = false;

  for (const p of plans) {
    const isActive = p.id === planId;
    if (isActive && !p.id.startsWith('seed-')) {
      matchedNonSeed = true;
    }
    if (p.isActive !== isActive) {
      const updated: ReadingPlan = clonePlain({ ...p, isActive, updatedAt: now });
      await db.readingPlans.put(updated);
      void pushReadingPlanToCloud(updated);
    }
  }

  if (matchedNonSeed || !planId.startsWith('seed-')) {
    await db.settings.put({
      id: SETTING_KEY_ACTIVE_PLAN,
      value: planId,
      updatedAt: now,
    } as any);
    void pushSettingToCloud(SETTING_KEY_ACTIVE_PLAN, planId);
  } else {
    await db.settings.put({ id: SETTING_KEY_ACTIVE_PLAN, value: planId });
  }
}

/**
 * Deletes a reading plan locally and in Supabase (never re-creating a demo plan)
 */
export async function deleteReadingPlan(planId: string): Promise<void> {
  const now = Date.now();
  await db.readingPlans.delete(planId);

  if (!planId.startsWith('seed-')) {
    await recordLocalPlanTombstone(planId, now);
    void deleteReadingPlanFromCloud(planId, now);
  }

  const allRemaining = await db.readingPlans.orderBy('createdAt').reverse().toArray();
  const remaining = !isDummyDataEnabled()
    ? allRemaining.filter((p) => !p.id.startsWith('seed-'))
    : allRemaining;

  if (remaining.length > 0) {
    const activeSetting = await db.settings.get(SETTING_KEY_ACTIVE_PLAN);
    const currentActiveId = typeof activeSetting?.value === 'string' ? activeSetting.value : null;
    const stillHasActive = remaining.some((p) => p.id === currentActiveId || (currentActiveId !== planId && p.isActive));
    if (!stillHasActive || currentActiveId === planId) {
      await setActiveReadingPlan(remaining[0].id);
    }
  } else {
    await db.settings.put({
      id: SETTING_KEY_ACTIVE_PLAN,
      value: null,
      updatedAt: now,
    } as any);
    void pushSettingToCloud(SETTING_KEY_ACTIVE_PLAN, null);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('reneu:plan-deleted', { detail: { planId } }));
  }
}

async function deactivateOtherPlans(excludeId: string, now: number): Promise<void> {
  const existing = await db.readingPlans.toArray();
  for (const p of existing) {
    if (p.id !== excludeId && p.isActive) {
      const deactivated: ReadingPlan = clonePlain({ ...p, isActive: false, updatedAt: now });
      await db.readingPlans.put(deactivated);
      void pushReadingPlanToCloud(deactivated);
    }
  }
}

/**
 * Creates a plan from a classical preset definition
 */
export async function createPlanFromPreset(
  presetKey: NonNullable<ReadingPlan['presetKey']>,
  setAsActive: boolean = true,
  options?: { isSeedDemo?: boolean }
): Promise<ReadingPlan> {
  const def = CLASSICAL_PRESETS.find((p) => p.key === presetKey) || CLASSICAL_PRESETS[0];
  const now = Date.now();
  const prefix = options?.isSeedDemo ? `seed-plan-${presetKey}` : `plan-${presetKey}`;
  const id = `${prefix}-${now}-${Math.random().toString(36).substring(2, 7)}`;

  const newPlan: ReadingPlan = {
    id,
    title: def.title,
    description: def.description,
    isPreset: true,
    presetKey: def.key,
    scope: def.scope,
    durationDays: def.durationDays,
    daysPerWeek: def.daysPerWeek,
    trackStyle: def.trackStyle,
    startDate: now,
    createdAt: now,
    updatedAt: now,
    isActive: setAsActive,
    completedDays: [],
    completedPortions: {},
  };

  if (setAsActive) {
    await deactivateOtherPlans(id, now);
  }
  await saveReadingPlan(newPlan);
  return newPlan;
}

/**
 * Creates a custom configured reading plan
 */
export async function createCustomPlan(params: {
  title: string;
  description?: string;
  scope: PlanScope;
  durationDays: number;
  daysPerWeek: PlanDaysPerWeek;
  trackStyle: PlanTrackStyle;
  customBookIds?: number[];
  setAsActive?: boolean;
}): Promise<ReadingPlan> {
  const now = Date.now();
  const id = `plan-custom-${now}-${Math.random().toString(36).substring(2, 7)}`;
  const shouldActivate = params.setAsActive ?? true;

  const newPlan: ReadingPlan = {
    id,
    title: params.title.trim() || 'Custom Reading Plan',
    description: params.description?.trim() || 'Personal Bible reading schedule.',
    isPreset: false,
    scope: params.scope,
    durationDays: params.durationDays,
    daysPerWeek: params.daysPerWeek,
    trackStyle: params.trackStyle,
    customBookIds: params.customBookIds,
    startDate: now,
    createdAt: now,
    updatedAt: now,
    isActive: shouldActivate,
    completedDays: [],
    completedPortions: {},
  };

  if (shouldActivate) {
    await deactivateOtherPlans(id, now);
  }
  await saveReadingPlan(newPlan);
  return newPlan;
}

/**
 * Toggles a day's completed state
 */
export async function toggleDayCompleted(planId: string, dayNumber: number): Promise<ReadingPlan | null> {
  const plan = await db.readingPlans.get(planId);
  if (!plan) return null;

  const completedDaysSet = new Set(plan.completedDays || []);
  const willBeCompleted = !completedDaysSet.has(dayNumber);

  if (willBeCompleted) {
    completedDaysSet.add(dayNumber);
  } else {
    completedDaysSet.delete(dayNumber);
  }

  plan.completedDays = Array.from(completedDaysSet).sort((a, b) => a - b);
  plan.updatedAt = Date.now();

  await saveReadingPlan(plan);
  return plan;
}

/**
 * Toggles an individual portion's completed state, auto-completing the day if all portions are marked
 */
export async function togglePortionCompleted(
  planId: string,
  portionKey: string,
  dayNumber: number,
  allDayPortionKeys: string[]
): Promise<ReadingPlan | null> {
  const plan = await db.readingPlans.get(planId);
  if (!plan) return null;

  const completedPortions = { ...(plan.completedPortions || {}) };
  const currentVal = Boolean(completedPortions[portionKey]);
  if (currentVal) {
    delete completedPortions[portionKey];
  } else {
    completedPortions[portionKey] = true;
  }
  plan.completedPortions = completedPortions;

  // Check if all portions for this day are finished
  const allFinished = allDayPortionKeys.length > 0 && allDayPortionKeys.every((k) => completedPortions[k]);
  const completedDaysSet = new Set(plan.completedDays || []);

  if (allFinished) {
    completedDaysSet.add(dayNumber);
  } else {
    completedDaysSet.delete(dayNumber);
  }

  plan.completedDays = Array.from(completedDaysSet).sort((a, b) => a - b);
  plan.updatedAt = Date.now();

  await saveReadingPlan(plan);
  return plan;
}

/**
 * Sets a day's completed state explicitly and marks its assigned portions
 */
export async function setDayCompletionState(
  planId: string,
  dayNumber: number,
  isCompleted: boolean,
  allDayPortionKeys?: string[]
): Promise<ReadingPlan | null> {
  const plan = await db.readingPlans.get(planId);
  if (!plan) return null;

  const completedDaysSet = new Set(plan.completedDays || []);
  const completedPortions = { ...(plan.completedPortions || {}) };

  if (isCompleted) {
    completedDaysSet.add(dayNumber);
    if (allDayPortionKeys) {
      for (const k of allDayPortionKeys) {
        completedPortions[k] = true;
      }
    }
  } else {
    completedDaysSet.delete(dayNumber);
    if (allDayPortionKeys) {
      for (const k of allDayPortionKeys) {
        delete completedPortions[k];
      }
    }
  }

  plan.completedDays = Array.from(completedDaysSet).sort((a, b) => a - b);
  plan.completedPortions = completedPortions;
  plan.updatedAt = Date.now();

  await saveReadingPlan(plan);
  return plan;
}

/**
 * Resets all progress for a given reading plan
 */
export async function resetPlanProgress(planId: string): Promise<ReadingPlan | null> {
  const plan = await db.readingPlans.get(planId);
  if (!plan) return null;

  plan.completedDays = [];
  plan.completedPortions = {};
  plan.startDate = Date.now();
  plan.updatedAt = Date.now();

  await saveReadingPlan(plan);
  return plan;
}
