/**
 * Storage Module for Grit Habit Tracker
 * 
 * This module provides the interface between the application and SQLite database.
 * Includes extensive defensive programming with assert statements.
 * 
 * MIGRATION: This module now uses SQLite instead of JSON file storage.
 */

import assert from 'node:assert';
import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';

// ── Import database operations ──
import {
  loadDataFromDb,
  saveDataToDb,
  migrateFromJson,
  getOrCreateTodayEntryDb,
  ensureCategoryDb,
  clearAllHistory as clearAllHistoryDb,
  clearTodayEntry as clearTodayEntryDb,
  closeDatabase
} from './database.js';

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORT TYPES FROM DATABASE MODULE
// ═══════════════════════════════════════════════════════════════════════════════

export type {
  ProblemSolvingLog,
  ReadingLog,
  LearningLog,
  CodingLog,
  GoodHabitsLog,
  BadHabitsLog,
  DailyEntry,
  Categories,
  GritData
} from './database.js';

import type {
  DailyEntry,
  GritData,
  Categories
} from './database.js';

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY V1 DATA STRUCTURE (for migration support)
// ═══════════════════════════════════════════════════════════════════════════════

export interface V1DailyEntry {
  date: string;
  habits: {
    problemSolving: boolean;
    reading: { done: boolean; topic?: string; pages?: number };
    learning: { done: boolean; topic?: string };
    coding: { done: boolean; topic?: string; timeSpent?: string };
  };
  score: number;
  success: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get today's date string in YYYY-MM-DD format (Cairo timezone)
 */
export function getTodayDateString(): string {
  const result = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

  // ── ASSERTION: validate date format ──
  assert(typeof result === 'string', '[DATE] toLocaleDateString must return a string');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(result), `[DATE] Date must be YYYY-MM-DD format, got: ${result}`);

  // ── ASSERTION: validate date components are reasonable ──
  const [year, month, day] = result.split('-').map(Number);
  assert(year !== undefined && year >= 2020 && year <= 2100, `[DATE] Year must be 2020-2100, got: ${year}`);
  assert(month !== undefined && month >= 1 && month <= 12, `[DATE] Month must be 1-12, got: ${month}`);
  assert(day !== undefined && day >= 1 && day <= 31, `[DATE] Day must be 1-31, got: ${day}`);

  return result;
}

/**
 * Get the next or previous day from a date string
 */
export function getNextOrPrevDay(dateStr: string, offsetDays: number): string {
  // ── ASSERTION: input validation ──
  assert(typeof dateStr === 'string', `[DATE] dateStr must be a string, got ${typeof dateStr}`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(dateStr), `[DATE] dateStr must be YYYY-MM-DD format, got: ${dateStr}`);
  assert(typeof offsetDays === 'number', `[DATE] offsetDays must be a number, got ${typeof offsetDays}`);
  assert(Number.isInteger(offsetDays), `[DATE] offsetDays must be an integer, got: ${offsetDays}`);
  assert(Math.abs(offsetDays) <= 365 * 10, `[DATE] offsetDays seems too large: ${offsetDays}`);

  const parts = dateStr.split('-');

  // ── ASSERTION: split result validation ──
  assert(parts.length === 3, `[DATE] Date string must have 3 parts, got: ${parts.length}`);

  const y = parseInt(parts[0] || '0', 10);
  const m = parseInt(parts[1] || '0', 10);
  const d = parseInt(parts[2] || '0', 10);

  // ── ASSERTION: parsed values validation ──
  assert(!isNaN(y) && y > 0, `[DATE] Year parse failed: ${parts[0]}`);
  assert(!isNaN(m) && m >= 1 && m <= 12, `[DATE] Month parse failed: ${parts[1]}`);
  assert(!isNaN(d) && d >= 1 && d <= 31, `[DATE] Day parse failed: ${parts[2]}`);

  const date = new Date(Date.UTC(y, m - 1, d));

  // ── ASSERTION: Date object validation ──
  assert(!isNaN(date.getTime()), `[DATE] Failed to create Date object from: ${dateStr}`);

  date.setUTCDate(date.getUTCDate() + offsetDays);

  // ── ASSERTION: date manipulation didn't produce invalid date ──
  assert(!isNaN(date.getTime()), `[DATE] Date became invalid after offset: ${offsetDays}`);

  const yr = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const da = String(date.getUTCDate()).padStart(2, '0');

  const result = `${yr}-${mo}-${da}`;

  // ── ASSERTION: result validation ──
  assert(/^\d{4}-\d{2}-\d{2}$/.test(result), `[DATE] Result must be YYYY-MM-DD format, got: ${result}`);

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// V1 TO V2 MIGRATION (Legacy JSON format to current format)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Migrate V1 JSON data format to V2 GritData format
 */
export function migrateV1ToV2(v1Data: any): GritData {
  // ── ASSERTION: input validation ──
  assert(typeof v1Data === 'object' && v1Data !== null, '[MIGRATE_V1] v1Data must be a non-null object');

  const oldHistory = v1Data.history as V1DailyEntry[] | undefined;

  // ── ASSERTION: history validation ──
  assert(oldHistory === undefined || Array.isArray(oldHistory), '[MIGRATE_V1] history must be an array or undefined');

  const newHistory: DailyEntry[] = [];

  if (oldHistory) {
    for (let i = 0; i < oldHistory.length; i++) {
      const old = oldHistory[i];

      // ── ASSERTION: entry validation ──
      assert(old !== undefined, `[MIGRATE_V1] history entry at index ${i} is undefined`);
      assert(typeof old.date === 'string', `[MIGRATE_V1] history[${i}].date must be a string`);

      const entry: DailyEntry = {
        date: old.date,
        problemSolving: [],
        reading: [],
        learning: [],
        coding: [],
        goodHabits: {},
        badHabits: {},
        score: typeof old.score === 'number' ? old.score : 0,
        success: typeof old.success === 'boolean' ? old.success : false
      };

      // ── Migrate problem solving ──
      if (old.habits?.problemSolving) {
        entry.problemSolving.push({
          difficulty: 'unknown',
          count: 1,
          topics: ['Legacy Entry']
        });
      }

      // ── Migrate reading ──
      if (old.habits?.reading?.done) {
        entry.reading.push({
          type: old.habits.reading.pages ? 'book' : 'article',
          category: 'Uncategorized',
          topic: old.habits.reading.topic || 'Legacy Reading',
          pages: old.habits.reading.pages
        });
      }

      // ── Migrate learning ──
      if (old.habits?.learning?.done) {
        entry.learning.push({
          category: 'Uncategorized',
          topic: old.habits.learning.topic || 'Legacy Learning'
        });
      }

      // ── Migrate coding ──
      if (old.habits?.coding?.done) {
        const timeSpentStr = old.habits.coding.timeSpent || '0';
        const timeSpent = parseInt(timeSpentStr) || 0;

        entry.coding.push({
          category: 'Uncategorized',
          topic: old.habits.coding.topic || 'Legacy Coding',
          timeSpent
        });
      }

      newHistory.push(entry);
    }
  }

  const result: GritData = {
    version: 2,
    stats: {
      currentStreak: v1Data.stats?.currentStreak || 0,
      highestStreak: v1Data.stats?.highestStreak || 0
    },
    categories: {
      reading: ['Backend', 'Testing', 'Database', 'Security', 'Frontend'],
      learning: ['System Design', 'Algorithms', 'Languages'],
      coding: ['API', 'UI', 'Scripting'],
      problems: ['Easy', 'Medium', 'Hard']
    },
    history: newHistory
  };

  // ── ASSERTION: result validation ──
  assert(result.version === 2, '[MIGRATE_V1] result version must be 2');
  assert(Array.isArray(result.history), '[MIGRATE_V1] result history must be an array');
  assert(typeof result.stats === 'object', '[MIGRATE_V1] result stats must be an object');

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA LOADING AND SAVING (SQLite-backed)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert a JSON data path to SQLite database path
 */
export function jsonPathToDbPath(jsonPath: string): string {
  // ── ASSERTION: input validation ──
  assert(typeof jsonPath === 'string', `[PATH] jsonPath must be a string, got ${typeof jsonPath}`);
  assert(jsonPath.length > 0, '[PATH] jsonPath cannot be empty');

  // ── Replace .json extension with .db, or add .db if no .json extension ──
  let dbPath: string;
  if (jsonPath.endsWith('.json')) {
    dbPath = jsonPath.replace(/\.json$/, '.db');
  } else {
    dbPath = jsonPath + '.db';
  }

  // ── ASSERTION: output validation ──
  assert(dbPath.endsWith('.db'), `[PATH] dbPath must end with .db, got: ${dbPath}`);
  assert(dbPath !== jsonPath, '[PATH] dbPath must be different from jsonPath');

  return dbPath;
}

/**
 * Load data from storage.
 * 
 * This function handles:
 * 1. Loading from existing SQLite database
 * 2. Migrating from JSON file if database doesn't exist
 * 3. Creating fresh database with defaults if nothing exists
 * 
 * @param dataPath - Path to the data file (can be .json or .db)
 */
export async function loadData(dataPath: string): Promise<GritData> {
  // ── ASSERTION: input validation ──
  assert(typeof dataPath === 'string', `[LOAD] dataPath must be a string, got ${typeof dataPath}`);
  assert(dataPath.length > 0, '[LOAD] dataPath cannot be empty');

  // ── Determine paths ──
  const dbPath = dataPath.endsWith('.db') ? dataPath : jsonPathToDbPath(dataPath);
  const jsonPath = dataPath.endsWith('.json') ? dataPath : dataPath.replace(/\.db$/, '.json');

  // ── ASSERTION: path determination ──
  assert(dbPath.endsWith('.db'), `[LOAD] dbPath must end with .db, got: ${dbPath}`);

  const dbExists = existsSync(dbPath);
  const jsonExists = existsSync(jsonPath);

  // ── Case 1: Database exists - load from it ──
  if (dbExists) {
    const data = loadDataFromDb(dbPath);

    // ── ASSERTION: loaded data validation ──
    assert(typeof data === 'object' && data !== null, '[LOAD] Loaded data must be a non-null object');
    assert(typeof data.version === 'number', '[LOAD] data.version must be a number');
    assert(Array.isArray(data.history), '[LOAD] data.history must be an array');

    return data;
  }

  // ── Case 2: JSON exists but DB doesn't - migrate ──
  if (jsonExists && !dbExists) {
    let parsed: any;

    try {
      const content = await fs.readFile(jsonPath, 'utf-8');

      // ── ASSERTION: file content validation ──
      assert(typeof content === 'string', '[LOAD] File content must be a string');
      assert(content.length > 0, '[LOAD] File content cannot be empty');

      parsed = JSON.parse(content);

      // ── ASSERTION: JSON parse validation ──
      assert(typeof parsed === 'object' && parsed !== null, '[LOAD] Parsed JSON must be a non-null object');

    } catch (error) {
      // ── File exists but couldn't be read/parsed - create fresh DB ──
      const freshData = createDefaultData();
      migrateFromJson(freshData, dbPath);
      return loadDataFromDb(dbPath);
    }

    // ── Handle V1 to V2 migration if needed ──
    let migratedData: GritData;
    if (!parsed.version || parsed.version === 1) {
      migratedData = migrateV1ToV2(parsed);
    } else {
      // ── Handle V2 data with potential fixes ──
      migratedData = normalizeV2Data(parsed);
    }

    // ── Migrate to SQLite ──
    migrateFromJson(migratedData, dbPath);

    return loadDataFromDb(dbPath);
  }

  // ── Case 3: Nothing exists - create fresh database ──
  const freshData = createDefaultData();
  migrateFromJson(freshData, dbPath);

  return loadDataFromDb(dbPath);
}

/**
 * Create default GritData structure
 */
function createDefaultData(): GritData {
  const data: GritData = {
    version: 2,
    stats: { currentStreak: 0, highestStreak: 0 },
    categories: {
      reading: ['Backend', 'Testing', 'Database', 'Security', 'Frontend'],
      learning: ['System Design', 'Algorithms', 'Languages'],
      coding: ['API', 'UI', 'Scripting'],
      problems: ['Easy', 'Medium', 'Hard']
    },
    history: []
  };

  // ── ASSERTION: default data validation ──
  assert(data.version === 2, '[DEFAULT] version must be 2');
  assert(data.stats.currentStreak === 0, '[DEFAULT] currentStreak must be 0');
  assert(data.stats.highestStreak === 0, '[DEFAULT] highestStreak must be 0');
  assert(data.categories.reading.length > 0, '[DEFAULT] reading categories must not be empty');
  assert(data.history.length === 0, '[DEFAULT] history must be empty');

  return data;
}

/**
 * Normalize V2 data, fixing any inconsistencies
 */
function normalizeV2Data(parsed: any): GritData {
  // ── ASSERTION: input validation ──
  assert(typeof parsed === 'object' && parsed !== null, '[NORMALIZE] parsed must be a non-null object');

  const data: GritData = {
    version: 2,
    stats: {
      currentStreak: parsed.stats?.currentStreak || 0,
      highestStreak: parsed.stats?.highestStreak || 0
    },
    categories: {
      reading: Array.isArray(parsed.categories?.reading) ? parsed.categories.reading : ['Backend', 'Testing', 'Database', 'Security', 'Frontend'],
      learning: Array.isArray(parsed.categories?.learning) ? parsed.categories.learning : ['System Design', 'Algorithms', 'Languages'],
      coding: Array.isArray(parsed.categories?.coding) ? parsed.categories.coding : ['API', 'UI', 'Scripting'],
      problems: Array.isArray(parsed.categories?.problems) ? parsed.categories.problems : ['Easy', 'Medium', 'Hard']
    },
    history: []
  };

  // ── Normalize history entries ──
  if (Array.isArray(parsed.history)) {
    for (let i = 0; i < parsed.history.length; i++) {
      const entry = parsed.history[i];

      if (!entry || typeof entry.date !== 'string') {
        continue; // Skip invalid entries
      }

      // ── Fix problem solving logs ──
      const problemSolving = [];
      if (Array.isArray(entry.problemSolving)) {
        for (const p of entry.problemSolving) {
          if (p && typeof p === 'object') {
            // ── Handle topic vs topics migration ──
            let topics: string[];
            if (Array.isArray(p.topics)) {
              topics = p.topics;
            } else if (p.topic && typeof p.topic === 'string') {
              topics = [p.topic];
            } else {
              topics = [];
            }

            problemSolving.push({
              difficulty: p.difficulty || 'unknown',
              count: typeof p.count === 'number' ? p.count : 1,
              topics
            });
          }
        }
      }

      const normalizedEntry: DailyEntry = {
        date: entry.date,
        problemSolving,
        reading: Array.isArray(entry.reading) ? entry.reading : [],
        learning: Array.isArray(entry.learning) ? entry.learning : [],
        coding: Array.isArray(entry.coding) ? entry.coding : [],
        goodHabits: typeof entry.goodHabits === 'object' && entry.goodHabits !== null ? entry.goodHabits : {},
        badHabits: typeof entry.badHabits === 'object' && entry.badHabits !== null ? entry.badHabits : {},
        score: typeof entry.score === 'number' ? entry.score : 0,
        success: typeof entry.success === 'boolean' ? entry.success : false
      };

      data.history.push(normalizedEntry);
    }
  }

  // ── ASSERTION: normalized data validation ──
  assert(data.version === 2, '[NORMALIZE] version must be 2');
  assert(Array.isArray(data.history), '[NORMALIZE] history must be an array');

  return data;
}

/**
 * Save data to storage (SQLite database)
 * 
 * @param dataPath - Path to the data file (can be .json or .db)
 * @param data - GritData to save
 */
export async function saveData(dataPath: string, data: GritData): Promise<void> {
  // ── ASSERTION: input validation ──
  assert(typeof dataPath === 'string', `[SAVE] dataPath must be a string, got ${typeof dataPath}`);
  assert(dataPath.length > 0, '[SAVE] dataPath cannot be empty');
  assert(typeof data === 'object' && data !== null, '[SAVE] data must be a non-null object');
  assert(typeof data.version === 'number', '[SAVE] data.version must be a number');
  assert(typeof data.stats === 'object', '[SAVE] data.stats must be an object');
  assert(typeof data.categories === 'object', '[SAVE] data.categories must be an object');
  assert(Array.isArray(data.history), '[SAVE] data.history must be an array');

  // ── Determine database path ──
  const dbPath = dataPath.endsWith('.db') ? dataPath : jsonPathToDbPath(dataPath);

  // ── ASSERTION: path validation ──
  assert(dbPath.endsWith('.db'), `[SAVE] dbPath must end with .db, got: ${dbPath}`);

  // ── Ensure parent directory exists ──
  const dir = path.dirname(dbPath);
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });

    // ── ASSERTION: directory creation ──
    assert(existsSync(dir), `[SAVE] Failed to create directory: ${dir}`);
  }

  // ── Save to database ──
  saveDataToDb(dbPath, data);

  // ── ASSERTION: verify save ──
  assert(existsSync(dbPath), `[SAVE] Database file should exist after save: ${dbPath}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORE AND SUCCESS COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute daily success and score for an entry
 * Success = completed 3 or more of 4 core habits
 */
export function computeDailySuccessAndScore(entry: DailyEntry): void {
  // ── ASSERTION: input validation ──
  assert(typeof entry === 'object' && entry !== null, '[COMPUTE] entry must be a non-null object');
  assert(Array.isArray(entry.problemSolving), '[COMPUTE] entry.problemSolving must be an array');
  assert(Array.isArray(entry.reading), '[COMPUTE] entry.reading must be an array');
  assert(Array.isArray(entry.learning), '[COMPUTE] entry.learning must be an array');
  assert(Array.isArray(entry.coding), '[COMPUTE] entry.coding must be an array');

  let score = 0;

  if (entry.problemSolving.length > 0) score++;
  if (entry.reading.length > 0) score++;
  if (entry.learning.length > 0) score++;
  if (entry.coding.length > 0) score++;

  // ── ASSERTION: score bounds ──
  assert(score >= 0 && score <= 4, `[COMPUTE] Score must be 0-4, got: ${score}`);

  entry.score = score;
  entry.success = score >= 3;

  // ── ASSERTION: success consistency ──
  assert(typeof entry.success === 'boolean', '[COMPUTE] entry.success must be a boolean');
  assert((score >= 3) === entry.success, '[COMPUTE] Success flag inconsistent with score');
}

// ═══════════════════════════════════════════════════════════════════════════════
// STREAK CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate current and highest streak from history
 */
export function calculateStreak(history: DailyEntry[]): { current: number; highest: number } {
  // ── ASSERTION: input validation ──
  assert(Array.isArray(history), '[STREAK] history must be an array');

  if (history.length === 0) {
    return { current: 0, highest: 0 };
  }

  // ── Build success map ──
  const successMap = new Map<string, boolean>();

  for (const entry of history) {
    // ── ASSERTION: entry validation ──
    assert(typeof entry === 'object' && entry !== null, '[STREAK] entry must be a non-null object');
    assert(typeof entry.date === 'string', '[STREAK] entry.date must be a string');

    computeDailySuccessAndScore(entry);

    if (entry.success) {
      successMap.set(entry.date, true);
    }
  }

  let current = 0;
  let highest = 0;

  // ── Calculate highest streak ever ──
  const dates = Array.from(successMap.keys()).sort();

  // ── ASSERTION: dates array validation ──
  assert(Array.isArray(dates), '[STREAK] dates must be an array');

  if (dates.length > 0) {
    let tempStreak = 1;
    highest = 1;

    for (let i = 1; i < dates.length; i++) {
      const prev = dates[i - 1];

      // ── ASSERTION: previous date exists ──
      assert(prev !== undefined, `[STREAK] Previous date at index ${i - 1} is undefined`);

      const expectedNext = getNextOrPrevDay(prev as string, 1);

      if (dates[i] === expectedNext) {
        tempStreak++;
        if (tempStreak > highest) {
          highest = tempStreak;
        }
      } else {
        tempStreak = 1;
      }
    }
  }

  // ── Calculate current streak ──
  const todayStr = getTodayDateString();
  const yesterdayStr = getNextOrPrevDay(todayStr, -1);

  let checkDateStr = todayStr;

  if (!successMap.has(todayStr) && successMap.has(yesterdayStr)) {
    checkDateStr = yesterdayStr;
  } else if (!successMap.has(todayStr) && !successMap.has(yesterdayStr)) {
    return { current: 0, highest };
  }

  // ── Count consecutive successful days ──
  let iterations = 0;
  const maxIterations = history.length + 1; // Prevent infinite loops

  while (iterations < maxIterations) {
    iterations++;

    if (successMap.has(checkDateStr)) {
      current++;
      checkDateStr = getNextOrPrevDay(checkDateStr, -1);
    } else {
      break;
    }
  }

  // ── ASSERTION: loop didn't run forever ──
  assert(iterations <= maxIterations, '[STREAK] Streak calculation exceeded maximum iterations');

  if (current > highest) {
    highest = current;
  }

  // ── ASSERTION: result validation ──
  assert(current >= 0, '[STREAK] current streak cannot be negative');
  assert(highest >= 0, '[STREAK] highest streak cannot be negative');
  assert(highest >= current, '[STREAK] highest must be >= current');

  return { current, highest };
}

/**
 * Update stats in data based on current history
 */
export function updateStats(data: GritData): void {
  // ── ASSERTION: input validation ──
  assert(typeof data === 'object' && data !== null, '[UPDATE_STATS] data must be a non-null object');
  assert(typeof data.stats === 'object', '[UPDATE_STATS] data.stats must be an object');
  assert(Array.isArray(data.history), '[UPDATE_STATS] data.history must be an array');

  const { current, highest } = calculateStreak(data.history);

  // ── ASSERTION: streak values ──
  assert(typeof current === 'number', '[UPDATE_STATS] current must be a number');
  assert(typeof highest === 'number', '[UPDATE_STATS] highest must be a number');

  data.stats.currentStreak = current;
  data.stats.highestStreak = Math.max(data.stats.highestStreak || 0, highest);

  // ── ASSERTION: stats consistency ──
  assert(data.stats.highestStreak >= data.stats.currentStreak,
    '[UPDATE_STATS] highestStreak must be >= currentStreak');
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTRY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get or create today's entry in the data
 */
export function getOrCreateTodayEntry(data: GritData): DailyEntry {
  // ── ASSERTION: input validation ──
  assert(typeof data === 'object' && data !== null, '[GET_TODAY] data must be a non-null object');
  assert(Array.isArray(data.history), '[GET_TODAY] data.history must be an array');

  const todayStr = getTodayDateString();

  // ── ASSERTION: date format ──
  assert(/^\d{4}-\d{2}-\d{2}$/.test(todayStr), `[GET_TODAY] todayStr must be YYYY-MM-DD, got: ${todayStr}`);

  let entry = data.history.find(e => e.date === todayStr);

  if (!entry) {
    entry = {
      date: todayStr,
      problemSolving: [],
      reading: [],
      learning: [],
      coding: [],
      goodHabits: {},
      badHabits: {},
      score: 0,
      success: false
    };
    data.history.push(entry);

    // ── ASSERTION: entry was added ──
    assert(data.history.includes(entry), '[GET_TODAY] Entry was not added to history');
  }

  // ── Ensure goodHabits and badHabits are objects ──
  if (!entry.goodHabits || typeof entry.goodHabits !== 'object') {
    entry.goodHabits = {};
  }
  if (!entry.badHabits || typeof entry.badHabits !== 'object') {
    entry.badHabits = {};
  }

  // ── ASSERTION: entry structure ──
  assert(typeof entry.date === 'string', '[GET_TODAY] entry.date must be a string');
  assert(entry.date === todayStr, '[GET_TODAY] entry.date must match today');
  assert(Array.isArray(entry.problemSolving), '[GET_TODAY] entry.problemSolving must be an array');
  assert(Array.isArray(entry.reading), '[GET_TODAY] entry.reading must be an array');
  assert(Array.isArray(entry.learning), '[GET_TODAY] entry.learning must be an array');
  assert(Array.isArray(entry.coding), '[GET_TODAY] entry.coding must be an array');
  assert(typeof entry.goodHabits === 'object', '[GET_TODAY] entry.goodHabits must be an object');
  assert(typeof entry.badHabits === 'object', '[GET_TODAY] entry.badHabits must be an object');

  return entry;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ensure a category exists in a list, return the canonical name
 */
export function ensureCategory(list: string[], cat: string): string {
  // ── ASSERTION: input validation ──
  assert(Array.isArray(list), '[ENSURE_CAT] list must be an array');
  assert(typeof cat === 'string', '[ENSURE_CAT] cat must be a string');
  assert(cat.length > 0, '[ENSURE_CAT] cat cannot be empty');

  // ── Check for existing category (case-insensitive) ──
  const exists = list.find(c => c.toLowerCase() === cat.toLowerCase());

  if (!exists) {
    list.push(cat);

    // ── ASSERTION: category was added ──
    assert(list.includes(cat), '[ENSURE_CAT] Category was not added to list');

    return cat;
  }

  // ── ASSERTION: found category ──
  assert(typeof exists === 'string', '[ENSURE_CAT] exists must be a string');

  return exists;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE PATH HELPER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the database path from a config data path
 */
export function getDbPath(configDataPath: string): string {
  // ── ASSERTION: input validation ──
  assert(typeof configDataPath === 'string', '[GET_DB_PATH] configDataPath must be a string');
  assert(configDataPath.length > 0, '[GET_DB_PATH] configDataPath cannot be empty');

  if (configDataPath.endsWith('.db')) {
    return configDataPath;
  }

  return jsonPathToDbPath(configDataPath);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Close database connection (for cleanup)
 */
export { closeDatabase };
