/**
 * SQLite Database Module for Grit Habit Tracker
 * 
 * This module provides SQLite-based storage with runtime-agnostic adapter.
 * - Uses bun:sqlite when running in Bun
 * - Uses better-sqlite3 when running in Node.js
 * 
 * Extensive defensive programming with assert statements throughout.
 */

import assert from 'node:assert';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createDatabaseAdapter, getSqliteBackendName } from './sqlite-adapter.js';
import type { SqliteDatabase } from './sqlite-adapter.js';

// Re-export for external use
export { getSqliteBackendName };

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE CONNECTION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

let db: SqliteDatabase | null = null;
let currentDbPath: string | null = null;

/**
 * Get or create a database connection.
 * Uses singleton pattern to ensure only one connection per database path.
 */
export function getDatabase(dbPath: string): SqliteDatabase {
  // ── ASSERTION: dbPath must be a non-empty string ──
  assert(typeof dbPath === 'string', `[DB] dbPath must be a string, got ${typeof dbPath}`);
  assert(dbPath.length > 0, '[DB] dbPath cannot be empty');
  assert(dbPath.endsWith('.db') || dbPath.endsWith('.sqlite'), `[DB] dbPath should end with .db or .sqlite, got: ${dbPath}`);

  // ── If same database is already open, return it ──
  if (db !== null && currentDbPath === dbPath) {
    return db;
  }

  // ── Close existing connection if different path ──
  if (db !== null && currentDbPath !== dbPath) {
    assert(currentDbPath !== null, '[DB] currentDbPath should not be null when db is not null');
    closeDatabase();
  }

  // ── Ensure parent directory exists ──
  const parentDir = dirname(dbPath);
  assert(typeof parentDir === 'string', '[DB] dirname must return a string');

  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
    assert(existsSync(parentDir), `[DB] Failed to create directory: ${parentDir}`);
  }

  // ── Create new connection using adapter ──
  db = createDatabaseAdapter(dbPath);
  currentDbPath = dbPath;

  // ── ASSERTION: connection must be established ──
  assert(db !== null, '[DB] Database connection failed to establish');

  // ── Enable foreign keys ──
  db.pragma('foreign_keys = ON');

  // ── Initialize schema ──
  initializeSchema(db);

  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db !== null) {
    db.close();
    db = null;
    currentDbPath = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMA INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize database schema with all required tables.
 * Uses IF NOT EXISTS to make it idempotent.
 */
function initializeSchema(database: SqliteDatabase): void {
  // ── ASSERTION: database must be valid ──
  assert(database !== null, '[SCHEMA] database must not be null');

  // ── Stats table (singleton - only one row) ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_streak INTEGER NOT NULL DEFAULT 0,
      highest_streak INTEGER NOT NULL DEFAULT 0,
      current_points INTEGER NOT NULL DEFAULT 0,
      total_points_earned INTEGER NOT NULL DEFAULT 0,
      monthly_subtraction_amount INTEGER NOT NULL DEFAULT 100,
      next_subtraction_date TEXT,
      schema_version INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Insert default stats if not exists ──
  const statsCheck = database.prepare('SELECT COUNT(*) as count FROM stats').get() as { count: number };
  assert(statsCheck !== undefined, '[SCHEMA] stats count query returned undefined');
  assert(typeof statsCheck.count === 'number', '[SCHEMA] stats count must be a number');

  if (statsCheck.count === 0) {
    database.exec(`
      INSERT INTO stats (id, current_streak, highest_streak, current_points, total_points_earned, monthly_subtraction_amount, schema_version)
      VALUES (1, 0, 0, 0, 0, 100, 3);
    `);
  } else {
    // ── Migrate existing stats to add points columns ──
    const columns = database.prepare("PRAGMA table_info(stats)").all() as Array<{ name: string }>;
    const columnNames = columns.map(c => c.name);
    
    if (!columnNames.includes('current_points')) {
      database.exec(`ALTER TABLE stats ADD COLUMN current_points INTEGER NOT NULL DEFAULT 0`);
    }
    if (!columnNames.includes('total_points_earned')) {
      database.exec(`ALTER TABLE stats ADD COLUMN total_points_earned INTEGER NOT NULL DEFAULT 0`);
    }
    if (!columnNames.includes('monthly_subtraction_amount')) {
      database.exec(`ALTER TABLE stats ADD COLUMN monthly_subtraction_amount INTEGER NOT NULL DEFAULT 100`);
    }
    if (!columnNames.includes('next_subtraction_date')) {
      database.exec(`ALTER TABLE stats ADD COLUMN next_subtraction_date TEXT`);
    }
    // Update schema version
    database.exec(`UPDATE stats SET schema_version = 3 WHERE id = 1`);
  }

  // ── Categories table ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('reading', 'learning', 'coding', 'problems')),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type, name)
    );
  `);

  // ── Insert default categories if empty ──
  const catCheck = database.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number };
  assert(catCheck !== undefined, '[SCHEMA] categories count query returned undefined');

  if (catCheck.count === 0) {
    const defaultCategories = [
      { type: 'reading', names: ['Backend', 'Testing', 'Database', 'Security', 'Frontend'] },
      { type: 'learning', names: ['System Design', 'Algorithms', 'Languages'] },
      { type: 'coding', names: ['API', 'UI', 'Scripting'] },
      { type: 'problems', names: ['Easy', 'Medium', 'Hard'] }
    ];

    const insertCat = database.prepare('INSERT OR IGNORE INTO categories (type, name) VALUES (?, ?)');
    for (const cat of defaultCategories) {
      assert(Array.isArray(cat.names), `[SCHEMA] cat.names must be an array for type ${cat.type}`);
      for (const name of cat.names) {
        assert(typeof name === 'string', '[SCHEMA] category name must be a string');
        insertCat.run(cat.type, name);
      }
    }
  }

  // ── Daily entries table ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS daily_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 4),
      success INTEGER NOT NULL DEFAULT 0 CHECK (success IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_daily_entries_date ON daily_entries(date);
  `);

  // ── Problem solving logs table ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS problem_solving_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard', 'unknown')),
      count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (entry_id) REFERENCES daily_entries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_problem_solving_entry ON problem_solving_logs(entry_id);
  `);

  // ── Problem topics (many-to-many) ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS problem_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_log_id INTEGER NOT NULL,
      topic TEXT NOT NULL,
      FOREIGN KEY (problem_log_id) REFERENCES problem_solving_logs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_problem_topics_log ON problem_topics(problem_log_id);
  `);

  // ── Reading logs table ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS reading_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('article', 'docs', 'book')),
      category TEXT NOT NULL,
      topic TEXT NOT NULL,
      pages INTEGER,
      sections INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (entry_id) REFERENCES daily_entries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_reading_logs_entry ON reading_logs(entry_id);
  `);

  // ── Learning logs table ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS learning_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      topic TEXT NOT NULL,
      duration INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (entry_id) REFERENCES daily_entries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_learning_logs_entry ON learning_logs(entry_id);
  `);

  // ── Coding logs table ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS coding_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      topic TEXT NOT NULL,
      time_spent INTEGER NOT NULL DEFAULT 0 CHECK (time_spent >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (entry_id) REFERENCES daily_entries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_coding_logs_entry ON coding_logs(entry_id);
  `);

  // ── Good habits table ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS good_habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL UNIQUE,
      woke_up_early INTEGER CHECK (woke_up_early IN (0, 1, NULL)),
      wake_up_time TEXT,
      did_sport INTEGER CHECK (did_sport IN (0, 1, NULL)),
      sport_minutes INTEGER CHECK (sport_minutes IS NULL OR sport_minutes >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (entry_id) REFERENCES daily_entries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_good_habits_entry ON good_habits(entry_id);
  `);

  // ── Bad habits table ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS bad_habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL UNIQUE,
      watched_porn INTEGER CHECK (watched_porn IN (0, 1, NULL)),
      porn_reason TEXT,
      entertainment_hours REAL CHECK (entertainment_hours IS NULL OR entertainment_hours >= 0),
      entertainment_overuse INTEGER CHECK (entertainment_overuse IN (0, 1, NULL)),
      entertainment_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (entry_id) REFERENCES daily_entries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bad_habits_entry ON bad_habits(entry_id);
  `);

  // ── English learning logs table ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS english_learning_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('video', 'book_grammar', 'book_vocabulary', 'speaking_ai')),
      duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
      words_count INTEGER CHECK (words_count IS NULL OR words_count >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (entry_id) REFERENCES daily_entries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_english_learning_entry ON english_learning_logs(entry_id);
  `);

  // ── Points history table ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS points_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER,
      points_change INTEGER NOT NULL,
      points_after INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (entry_id) REFERENCES daily_entries(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_points_history_created ON points_history(created_at);
  `);

  // ── Daily entries: add points column ──
  const entryColumns = database.prepare("PRAGMA table_info(daily_entries)").all() as Array<{ name: string }>;
  const entryColumnNames = entryColumns.map(c => c.name);
  if (!entryColumnNames.includes('points_earned')) {
    database.exec(`ALTER TABLE daily_entries ADD COLUMN points_earned INTEGER NOT NULL DEFAULT 0`);
  }

  // ── Verify all tables exist ──
  const requiredTables = [
    'stats', 'categories', 'daily_entries', 'problem_solving_logs',
    'problem_topics', 'reading_logs', 'learning_logs', 'coding_logs',
    'good_habits', 'bad_habits', 'english_learning_logs', 'points_history'
  ];

  for (const table of requiredTables) {
    const result = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(table) as { name: string } | undefined;

    assert(result !== undefined, `[SCHEMA] Required table '${table}' does not exist after initialization`);
    assert(result.name === table, `[SCHEMA] Table name mismatch: expected '${table}', got '${result.name}'`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS (Re-exported for compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ProblemSolvingLog {
  difficulty: string;
  count: number;
  topics: string[];
}

export interface ReadingLog {
  type: 'article' | 'docs' | 'book';
  category: string;
  topic: string;
  pages?: number;
  sections?: number;
}

export interface LearningLog {
  category: string;
  topic: string;
  duration?: number;
}

export interface CodingLog {
  category: string;
  topic: string;
  timeSpent: number;
}

export interface GoodHabitsLog {
  wokeUpEarly?: boolean;
  wakeUpTime?: string;
  didSport?: boolean;
  sportMinutes?: number;
}

export interface BadHabitsLog {
  watchedPorn?: boolean;
  pornReason?: string;
  entertainmentHours?: number;
  entertainmentOveruse?: boolean;
  entertainmentReason?: string;
}

export interface EnglishLearningLog {
  type: 'video' | 'book_grammar' | 'book_vocabulary' | 'speaking_ai';
  durationMinutes?: number;  // for video and speaking_ai
  wordsCount?: number;        // for book_vocabulary
}

export interface PointsHistoryEntry {
  id?: number;
  entryId?: number;
  pointsChange: number;
  pointsAfter: number;
  reason: string;
  createdAt: string;
}

export interface DailyEntry {
  date: string;
  problemSolving: ProblemSolvingLog[];
  reading: ReadingLog[];
  learning: LearningLog[];
  coding: CodingLog[];
  englishLearning: EnglishLearningLog[];
  goodHabits: GoodHabitsLog;
  badHabits: BadHabitsLog;
  score: number;
  success: boolean;
  pointsEarned: number;
}

export interface Categories {
  reading: string[];
  learning: string[];
  coding: string[];
  problems: string[];
}

export interface GritData {
  version: number;
  stats: {
    currentStreak: number;
    highestStreak: number;
    currentPoints: number;
    totalPointsEarned: number;
    monthlySubtractionAmount: number;
    nextSubtractionDate?: string;
  };
  categories: Categories;
  history: DailyEntry[];
  pointsHistory: PointsHistoryEntry[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA ACCESS OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load all data from the database into the GritData structure.
 * This maintains compatibility with the existing codebase.
 */
export function loadDataFromDb(dbPath: string): GritData {
  // ── ASSERTION: dbPath validation ──
  assert(typeof dbPath === 'string', `[LOAD] dbPath must be a string, got ${typeof dbPath}`);
  assert(dbPath.length > 0, '[LOAD] dbPath cannot be empty');

  const database = getDatabase(dbPath);
  assert(database !== null, '[LOAD] Failed to get database connection');

  // ── Load stats ──
  const statsRow = database.prepare(`
    SELECT current_streak, highest_streak, current_points, total_points_earned, 
           monthly_subtraction_amount, next_subtraction_date, schema_version 
    FROM stats WHERE id = 1
  `).get() as {
    current_streak: number;
    highest_streak: number;
    current_points: number;
    total_points_earned: number;
    monthly_subtraction_amount: number;
    next_subtraction_date: string | null;
    schema_version: number;
  } | undefined;

  assert(statsRow !== undefined, '[LOAD] Stats row must exist in database');
  assert(typeof statsRow.current_streak === 'number', '[LOAD] current_streak must be a number');
  assert(typeof statsRow.highest_streak === 'number', '[LOAD] highest_streak must be a number');
  assert(typeof statsRow.current_points === 'number', '[LOAD] current_points must be a number');
  assert(typeof statsRow.total_points_earned === 'number', '[LOAD] total_points_earned must be a number');
  assert(statsRow.current_streak >= 0, '[LOAD] current_streak cannot be negative');
  assert(statsRow.highest_streak >= 0, '[LOAD] highest_streak cannot be negative');

  // ── Load categories ──
  const categoriesRows = database.prepare('SELECT type, name FROM categories ORDER BY type, name').all() as Array<{
    type: string;
    name: string;
  }>;

  assert(Array.isArray(categoriesRows), '[LOAD] categories query must return an array');

  const categories: Categories = {
    reading: [],
    learning: [],
    coding: [],
    problems: []
  };

  for (const row of categoriesRows) {
    assert(typeof row.type === 'string', '[LOAD] category type must be a string');
    assert(typeof row.name === 'string', '[LOAD] category name must be a string');
    assert(row.type in categories, `[LOAD] Unknown category type: ${row.type}`);

    const catType = row.type as keyof Categories;
    categories[catType].push(row.name);
  }

  // ── Load daily entries ──
  const entryRows = database.prepare('SELECT id, date, score, success FROM daily_entries ORDER BY date ASC').all() as Array<{
    id: number;
    date: string;
    score: number;
    success: number;
  }>;

  assert(Array.isArray(entryRows), '[LOAD] daily_entries query must return an array');

  const history: DailyEntry[] = [];

  for (const entryRow of entryRows) {
    // ── ASSERTION: entry row validation ──
    assert(typeof entryRow.id === 'number', '[LOAD] entry id must be a number');
    assert(typeof entryRow.date === 'string', '[LOAD] entry date must be a string');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(entryRow.date), `[LOAD] entry date must be YYYY-MM-DD format, got: ${entryRow.date}`);
    assert(typeof entryRow.score === 'number', '[LOAD] entry score must be a number');
    assert(entryRow.score >= 0 && entryRow.score <= 4, `[LOAD] entry score must be 0-4, got: ${entryRow.score}`);

    const entryId = entryRow.id;

    // ── Load problem solving logs ──
    const problemLogs = database.prepare(`
      SELECT id, difficulty, count FROM problem_solving_logs WHERE entry_id = ?
    `).all(entryId) as Array<{ id: number; difficulty: string; count: number }>;

    assert(Array.isArray(problemLogs), '[LOAD] problem_solving_logs query must return an array');

    const problemSolving: ProblemSolvingLog[] = [];
    for (const pLog of problemLogs) {
      assert(typeof pLog.id === 'number', '[LOAD] problem log id must be a number');
      assert(typeof pLog.difficulty === 'string', '[LOAD] problem difficulty must be a string');
      assert(typeof pLog.count === 'number', '[LOAD] problem count must be a number');
      assert(pLog.count > 0, '[LOAD] problem count must be positive');

      // ── Load topics for this problem log ──
      const topicRows = database.prepare('SELECT topic FROM problem_topics WHERE problem_log_id = ?').all(pLog.id) as Array<{ topic: string }>;
      assert(Array.isArray(topicRows), '[LOAD] problem_topics query must return an array');

      const topics = topicRows.map(t => {
        assert(typeof t.topic === 'string', '[LOAD] problem topic must be a string');
        return t.topic;
      });

      problemSolving.push({
        difficulty: pLog.difficulty,
        count: pLog.count,
        topics
      });
    }

    // ── Load reading logs ──
    const readingLogs = database.prepare(`
      SELECT type, category, topic, pages, sections FROM reading_logs WHERE entry_id = ?
    `).all(entryId) as Array<{
      type: string;
      category: string;
      topic: string;
      pages: number | null;
      sections: number | null;
    }>;

    assert(Array.isArray(readingLogs), '[LOAD] reading_logs query must return an array');

    const reading: ReadingLog[] = readingLogs.map(r => {
      assert(typeof r.type === 'string', '[LOAD] reading type must be a string');
      assert(['article', 'docs', 'book'].includes(r.type), `[LOAD] reading type must be article/docs/book, got: ${r.type}`);
      assert(typeof r.category === 'string', '[LOAD] reading category must be a string');
      assert(typeof r.topic === 'string', '[LOAD] reading topic must be a string');

      const log: ReadingLog = {
        type: r.type as 'article' | 'docs' | 'book',
        category: r.category,
        topic: r.topic
      };
      if (r.pages !== null) {
        assert(typeof r.pages === 'number', '[LOAD] reading pages must be a number or null');
        log.pages = r.pages;
      }
      if (r.sections !== null) {
        assert(typeof r.sections === 'number', '[LOAD] reading sections must be a number or null');
        log.sections = r.sections;
      }
      return log;
    });

    // ── Load learning logs ──
    const learningLogs = database.prepare(`
      SELECT category, topic, duration FROM learning_logs WHERE entry_id = ?
    `).all(entryId) as Array<{
      category: string;
      topic: string;
      duration: number | null;
    }>;

    assert(Array.isArray(learningLogs), '[LOAD] learning_logs query must return an array');

    const learning: LearningLog[] = learningLogs.map(l => {
      assert(typeof l.category === 'string', '[LOAD] learning category must be a string');
      assert(typeof l.topic === 'string', '[LOAD] learning topic must be a string');

      const log: LearningLog = {
        category: l.category,
        topic: l.topic
      };
      if (l.duration !== null) {
        assert(typeof l.duration === 'number', '[LOAD] learning duration must be a number or null');
        log.duration = l.duration;
      }
      return log;
    });

    // ── Load coding logs ──
    const codingLogs = database.prepare(`
      SELECT category, topic, time_spent FROM coding_logs WHERE entry_id = ?
    `).all(entryId) as Array<{
      category: string;
      topic: string;
      time_spent: number;
    }>;

    assert(Array.isArray(codingLogs), '[LOAD] coding_logs query must return an array');

    const coding: CodingLog[] = codingLogs.map(c => {
      assert(typeof c.category === 'string', '[LOAD] coding category must be a string');
      assert(typeof c.topic === 'string', '[LOAD] coding topic must be a string');
      assert(typeof c.time_spent === 'number', '[LOAD] coding time_spent must be a number');
      assert(c.time_spent >= 0, '[LOAD] coding time_spent cannot be negative');

      return {
        category: c.category,
        topic: c.topic,
        timeSpent: c.time_spent
      };
    });

    // ── Load good habits ──
    const goodHabitsRow = database.prepare(`
      SELECT woke_up_early, wake_up_time, did_sport, sport_minutes FROM good_habits WHERE entry_id = ?
    `).get(entryId) as {
      woke_up_early: number | null;
      wake_up_time: string | null;
      did_sport: number | null;
      sport_minutes: number | null;
    } | undefined;

    const goodHabits: GoodHabitsLog = {};
    if (goodHabitsRow) {
      if (goodHabitsRow.woke_up_early !== null) {
        goodHabits.wokeUpEarly = goodHabitsRow.woke_up_early === 1;
      }
      if (goodHabitsRow.wake_up_time !== null) {
        assert(typeof goodHabitsRow.wake_up_time === 'string', '[LOAD] wake_up_time must be a string');
        goodHabits.wakeUpTime = goodHabitsRow.wake_up_time;
      }
      if (goodHabitsRow.did_sport !== null) {
        goodHabits.didSport = goodHabitsRow.did_sport === 1;
      }
      if (goodHabitsRow.sport_minutes !== null) {
        assert(typeof goodHabitsRow.sport_minutes === 'number', '[LOAD] sport_minutes must be a number');
        goodHabits.sportMinutes = goodHabitsRow.sport_minutes;
      }
    }

    // ── Load bad habits ──
    const badHabitsRow = database.prepare(`
      SELECT watched_porn, porn_reason, entertainment_hours, entertainment_overuse, entertainment_reason 
      FROM bad_habits WHERE entry_id = ?
    `).get(entryId) as {
      watched_porn: number | null;
      porn_reason: string | null;
      entertainment_hours: number | null;
      entertainment_overuse: number | null;
      entertainment_reason: string | null;
    } | undefined;

    const badHabits: BadHabitsLog = {};
    if (badHabitsRow) {
      if (badHabitsRow.watched_porn !== null) {
        badHabits.watchedPorn = badHabitsRow.watched_porn === 1;
      }
      if (badHabitsRow.porn_reason !== null) {
        assert(typeof badHabitsRow.porn_reason === 'string', '[LOAD] porn_reason must be a string');
        badHabits.pornReason = badHabitsRow.porn_reason;
      }
      if (badHabitsRow.entertainment_hours !== null) {
        assert(typeof badHabitsRow.entertainment_hours === 'number', '[LOAD] entertainment_hours must be a number');
        badHabits.entertainmentHours = badHabitsRow.entertainment_hours;
      }
      if (badHabitsRow.entertainment_overuse !== null) {
        badHabits.entertainmentOveruse = badHabitsRow.entertainment_overuse === 1;
      }
      if (badHabitsRow.entertainment_reason !== null) {
        assert(typeof badHabitsRow.entertainment_reason === 'string', '[LOAD] entertainment_reason must be a string');
        badHabits.entertainmentReason = badHabitsRow.entertainment_reason;
      }
    }

    // ── Load English learning logs ──
    const englishLogs = database.prepare(`
      SELECT type, duration_minutes, words_count FROM english_learning_logs WHERE entry_id = ?
    `).all(entryId) as Array<{
      type: string;
      duration_minutes: number | null;
      words_count: number | null;
    }>;

    assert(Array.isArray(englishLogs), '[LOAD] english_learning_logs query must return an array');

    const englishLearning: EnglishLearningLog[] = englishLogs.map(e => {
      assert(typeof e.type === 'string', '[LOAD] english type must be a string');
      assert(['video', 'book_grammar', 'book_vocabulary', 'speaking_ai'].includes(e.type), `[LOAD] english type must be video/book_grammar/book_vocabulary/speaking_ai, got: ${e.type}`);

      const log: EnglishLearningLog = {
        type: e.type as 'video' | 'book_grammar' | 'book_vocabulary' | 'speaking_ai'
      };
      if (e.duration_minutes !== null) {
        assert(typeof e.duration_minutes === 'number', '[LOAD] duration_minutes must be a number or null');
        log.durationMinutes = e.duration_minutes;
      }
      if (e.words_count !== null) {
        assert(typeof e.words_count === 'number', '[LOAD] words_count must be a number or null');
        log.wordsCount = e.words_count;
      }
      return log;
    });

    // ── Get points earned (from daily_entries table) ──
    const pointsEarnedRow = database.prepare('SELECT points_earned FROM daily_entries WHERE id = ?').get(entryId) as { points_earned: number } | undefined;
    const pointsEarned = pointsEarnedRow?.points_earned ?? 0;

    // ── Build daily entry ──
    const entry: DailyEntry = {
      date: entryRow.date,
      problemSolving,
      reading,
      learning,
      coding,
      englishLearning,
      goodHabits,
      badHabits,
      score: entryRow.score,
      success: entryRow.success === 1,
      pointsEarned
    };

    // ── ASSERTION: validate constructed entry ──
    assert(typeof entry.date === 'string', '[LOAD] constructed entry date must be a string');
    assert(Array.isArray(entry.problemSolving), '[LOAD] constructed entry problemSolving must be an array');
    assert(Array.isArray(entry.reading), '[LOAD] constructed entry reading must be an array');
    assert(Array.isArray(entry.learning), '[LOAD] constructed entry learning must be an array');
    assert(Array.isArray(entry.coding), '[LOAD] constructed entry coding must be an array');
    assert(Array.isArray(entry.englishLearning), '[LOAD] constructed entry englishLearning must be an array');
    assert(typeof entry.goodHabits === 'object', '[LOAD] constructed entry goodHabits must be an object');
    assert(typeof entry.badHabits === 'object', '[LOAD] constructed entry badHabits must be an object');

    history.push(entry);
  }

  // ── Load points history ──
  const pointsHistoryRows = database.prepare(`
    SELECT id, entry_id, points_change, points_after, reason, created_at 
    FROM points_history ORDER BY created_at ASC
  `).all() as Array<{
    id: number;
    entry_id: number | null;
    points_change: number;
    points_after: number;
    reason: string;
    created_at: string;
  }>;

  assert(Array.isArray(pointsHistoryRows), '[LOAD] points_history query must return an array');

  const pointsHistory: PointsHistoryEntry[] = pointsHistoryRows.map(p => ({
    id: p.id,
    entryId: p.entry_id ?? undefined,
    pointsChange: p.points_change,
    pointsAfter: p.points_after,
    reason: p.reason,
    createdAt: p.created_at
  }));

  // ── Build final GritData ──
  const data: GritData = {
    version: statsRow.schema_version,
    stats: {
      currentStreak: statsRow.current_streak,
      highestStreak: statsRow.highest_streak,
      currentPoints: statsRow.current_points,
      totalPointsEarned: statsRow.total_points_earned,
      monthlySubtractionAmount: statsRow.monthly_subtraction_amount,
      nextSubtractionDate: statsRow.next_subtraction_date ?? undefined
    },
    categories,
    history,
    pointsHistory
  };

  // ── ASSERTION: validate final data structure ──
  assert(typeof data.version === 'number', '[LOAD] data.version must be a number');
  assert(data.version >= 1, '[LOAD] data.version must be >= 1');
  assert(typeof data.stats === 'object', '[LOAD] data.stats must be an object');
  assert(typeof data.stats.currentStreak === 'number', '[LOAD] data.stats.currentStreak must be a number');
  assert(typeof data.stats.highestStreak === 'number', '[LOAD] data.stats.highestStreak must be a number');
  assert(typeof data.categories === 'object', '[LOAD] data.categories must be an object');
  assert(Array.isArray(data.history), '[LOAD] data.history must be an array');

  return data;
}

/**
 * Save all data to the database.
 * This performs a full sync, updating all entries.
 */
export function saveDataToDb(dbPath: string, data: GritData): void {
  // ── ASSERTION: input validation ──
  assert(typeof dbPath === 'string', `[SAVE] dbPath must be a string, got ${typeof dbPath}`);
  assert(dbPath.length > 0, '[SAVE] dbPath cannot be empty');
  assert(typeof data === 'object' && data !== null, '[SAVE] data must be a non-null object');
  assert(typeof data.version === 'number', '[SAVE] data.version must be a number');
  assert(typeof data.stats === 'object', '[SAVE] data.stats must be an object');
  assert(typeof data.categories === 'object', '[SAVE] data.categories must be an object');
  assert(Array.isArray(data.history), '[SAVE] data.history must be an array');

  const database = getDatabase(dbPath);
  assert(database !== null, '[SAVE] Failed to get database connection');

  // ── Update stats ──
  assert(typeof data.stats.currentStreak === 'number', '[SAVE] currentStreak must be a number');
  assert(typeof data.stats.highestStreak === 'number', '[SAVE] highestStreak must be a number');
  assert(typeof data.stats.currentPoints === 'number', '[SAVE] currentPoints must be a number');
  assert(typeof data.stats.totalPointsEarned === 'number', '[SAVE] totalPointsEarned must be a number');
  assert(typeof data.stats.monthlySubtractionAmount === 'number', '[SAVE] monthlySubtractionAmount must be a number');
  assert(data.stats.currentStreak >= 0, '[SAVE] currentStreak cannot be negative');
  assert(data.stats.highestStreak >= 0, '[SAVE] highestStreak cannot be negative');

  database.prepare(`
    UPDATE stats SET 
      current_streak = ?,
      highest_streak = ?,
      current_points = ?,
      total_points_earned = ?,
      monthly_subtraction_amount = ?,
      next_subtraction_date = ?,
      schema_version = ?,
      updated_at = datetime('now')
    WHERE id = 1
  `).run(
    data.stats.currentStreak, 
    data.stats.highestStreak, 
    data.stats.currentPoints,
    data.stats.totalPointsEarned,
    data.stats.monthlySubtractionAmount,
    data.stats.nextSubtractionDate ?? null,
    data.version
  );

  // ── Sync categories ──
  for (const [catType, names] of Object.entries(data.categories)) {
    assert(['reading', 'learning', 'coding', 'problems'].includes(catType), `[SAVE] Invalid category type: ${catType}`);
    assert(Array.isArray(names), `[SAVE] Category ${catType} must be an array`);

    for (const name of names) {
      assert(typeof name === 'string', `[SAVE] Category name must be a string in ${catType}`);
      assert(name.length > 0, `[SAVE] Category name cannot be empty in ${catType}`);

      database.prepare('INSERT OR IGNORE INTO categories (type, name) VALUES (?, ?)').run(catType, name);
    }
  }

  // ── Sync daily entries ──
  for (const entry of data.history) {
    // ── ASSERTION: entry validation ──
    assert(typeof entry.date === 'string', '[SAVE] entry.date must be a string');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(entry.date), `[SAVE] entry.date must be YYYY-MM-DD format, got: ${entry.date}`);
    assert(typeof entry.score === 'number', '[SAVE] entry.score must be a number');
    assert(entry.score >= 0 && entry.score <= 4, `[SAVE] entry.score must be 0-4, got: ${entry.score}`);
    assert(typeof entry.success === 'boolean', '[SAVE] entry.success must be a boolean');
    assert(Array.isArray(entry.problemSolving), '[SAVE] entry.problemSolving must be an array');
    assert(Array.isArray(entry.reading), '[SAVE] entry.reading must be an array');
    assert(Array.isArray(entry.learning), '[SAVE] entry.learning must be an array');
    assert(Array.isArray(entry.coding), '[SAVE] entry.coding must be an array');
    assert(Array.isArray(entry.englishLearning), '[SAVE] entry.englishLearning must be an array');
    assert(typeof entry.pointsEarned === 'number', '[SAVE] entry.pointsEarned must be a number');

    // ── Upsert daily entry ──
    database.prepare(`
      INSERT INTO daily_entries (date, score, success, points_earned, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(date) DO UPDATE SET
        score = excluded.score,
        success = excluded.success,
        points_earned = excluded.points_earned,
        updated_at = datetime('now')
    `).run(entry.date, entry.score, entry.success ? 1 : 0, entry.pointsEarned);

    // ── Get entry ID ──
    const entryIdRow = database.prepare('SELECT id FROM daily_entries WHERE date = ?').get(entry.date) as { id: number } | undefined;
    assert(entryIdRow !== undefined, `[SAVE] Failed to get entry ID for date: ${entry.date}`);
    assert(typeof entryIdRow.id === 'number', '[SAVE] entry ID must be a number');

    const entryId = entryIdRow.id;

    // ── Clear existing logs for this entry (to replace with current data) ──
    database.prepare('DELETE FROM problem_solving_logs WHERE entry_id = ?').run(entryId);
    database.prepare('DELETE FROM reading_logs WHERE entry_id = ?').run(entryId);
    database.prepare('DELETE FROM learning_logs WHERE entry_id = ?').run(entryId);
    database.prepare('DELETE FROM coding_logs WHERE entry_id = ?').run(entryId);
    database.prepare('DELETE FROM english_learning_logs WHERE entry_id = ?').run(entryId);
    database.prepare('DELETE FROM good_habits WHERE entry_id = ?').run(entryId);
    database.prepare('DELETE FROM bad_habits WHERE entry_id = ?').run(entryId);

    // ── Insert problem solving logs ──
    for (const pLog of entry.problemSolving) {
      assert(typeof pLog.difficulty === 'string', '[SAVE] problem difficulty must be a string');
      assert(typeof pLog.count === 'number', '[SAVE] problem count must be a number');
      assert(pLog.count > 0, '[SAVE] problem count must be positive');
      assert(Array.isArray(pLog.topics), '[SAVE] problem topics must be an array');

      const result = database.prepare(`
        INSERT INTO problem_solving_logs (entry_id, difficulty, count)
        VALUES (?, ?, ?)
      `).run(entryId, pLog.difficulty, pLog.count);

      const problemLogId = result.lastInsertRowid;
      assert(typeof problemLogId === 'number' || typeof problemLogId === 'bigint', '[SAVE] lastInsertRowid must be a number');

      for (const topic of pLog.topics) {
        assert(typeof topic === 'string', '[SAVE] problem topic must be a string');
        database.prepare('INSERT INTO problem_topics (problem_log_id, topic) VALUES (?, ?)').run(Number(problemLogId), topic);
      }
    }

    // ── Insert reading logs ──
    for (const rLog of entry.reading) {
      assert(typeof rLog.type === 'string', '[SAVE] reading type must be a string');
      assert(['article', 'docs', 'book'].includes(rLog.type), `[SAVE] reading type must be article/docs/book, got: ${rLog.type}`);
      assert(typeof rLog.category === 'string', '[SAVE] reading category must be a string');
      assert(typeof rLog.topic === 'string', '[SAVE] reading topic must be a string');

      database.prepare(`
        INSERT INTO reading_logs (entry_id, type, category, topic, pages, sections)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(entryId, rLog.type, rLog.category, rLog.topic, rLog.pages ?? null, rLog.sections ?? null);
    }

    // ── Insert learning logs ──
    for (const lLog of entry.learning) {
      assert(typeof lLog.category === 'string', '[SAVE] learning category must be a string');
      assert(typeof lLog.topic === 'string', '[SAVE] learning topic must be a string');

      database.prepare(`
        INSERT INTO learning_logs (entry_id, category, topic, duration)
        VALUES (?, ?, ?, ?)
      `).run(entryId, lLog.category, lLog.topic, lLog.duration ?? null);
    }

    // ── Insert coding logs ──
    for (const cLog of entry.coding) {
      assert(typeof cLog.category === 'string', '[SAVE] coding category must be a string');
      assert(typeof cLog.topic === 'string', '[SAVE] coding topic must be a string');
      assert(typeof cLog.timeSpent === 'number', '[SAVE] coding timeSpent must be a number');
      assert(cLog.timeSpent >= 0, '[SAVE] coding timeSpent cannot be negative');

      database.prepare(`
        INSERT INTO coding_logs (entry_id, category, topic, time_spent)
        VALUES (?, ?, ?, ?)
      `).run(entryId, cLog.category, cLog.topic, cLog.timeSpent);
    }

    // ── Insert good habits ──
    const gh = entry.goodHabits || {};
    assert(typeof gh === 'object', '[SAVE] goodHabits must be an object');

    database.prepare(`
      INSERT INTO good_habits (entry_id, woke_up_early, wake_up_time, did_sport, sport_minutes)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      entryId,
      gh.wokeUpEarly === undefined ? null : (gh.wokeUpEarly ? 1 : 0),
      gh.wakeUpTime ?? null,
      gh.didSport === undefined ? null : (gh.didSport ? 1 : 0),
      gh.sportMinutes ?? null
    );

    // ── Insert bad habits ──
    const bh = entry.badHabits || {};
    assert(typeof bh === 'object', '[SAVE] badHabits must be an object');

    database.prepare(`
      INSERT INTO bad_habits (entry_id, watched_porn, porn_reason, entertainment_hours, entertainment_overuse, entertainment_reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entryId,
      bh.watchedPorn === undefined ? null : (bh.watchedPorn ? 1 : 0),
      bh.pornReason ?? null,
      bh.entertainmentHours ?? null,
      bh.entertainmentOveruse === undefined ? null : (bh.entertainmentOveruse ? 1 : 0),
      bh.entertainmentReason ?? null
    );

    // ── Insert English learning logs ──
    for (const eLog of entry.englishLearning) {
      assert(typeof eLog.type === 'string', '[SAVE] english learning type must be a string');
      assert(['video', 'book_grammar', 'book_vocabulary', 'speaking_ai'].includes(eLog.type), `[SAVE] english learning type must be video/book_grammar/book_vocabulary/speaking_ai, got: ${eLog.type}`);

      database.prepare(`
        INSERT INTO english_learning_logs (entry_id, type, duration_minutes, words_count)
        VALUES (?, ?, ?, ?)
      `).run(entryId, eLog.type, eLog.durationMinutes ?? null, eLog.wordsCount ?? null);
    }
  }
}

/**
 * Clear all history from the database
 */
export function clearAllHistory(dbPath: string): void {
  assert(typeof dbPath === 'string', '[CLEAR] dbPath must be a string');
  assert(dbPath.length > 0, '[CLEAR] dbPath cannot be empty');

  const database = getDatabase(dbPath);
  assert(database !== null, '[CLEAR] Failed to get database connection');

  // ── Delete all daily entries (cascades to related tables) ──
  database.exec('DELETE FROM daily_entries');

  // ── Reset stats ──
  database.prepare(`
    UPDATE stats SET current_streak = 0, highest_streak = 0, updated_at = datetime('now') WHERE id = 1
  `).run();

  // ── Verify deletion ──
  const countRow = database.prepare('SELECT COUNT(*) as count FROM daily_entries').get() as { count: number };
  assert(countRow.count === 0, '[CLEAR] Failed to clear all daily entries');
}

/**
 * Clear today's entry from the database
 */
export function clearTodayEntry(dbPath: string, todayDate: string): void {
  assert(typeof dbPath === 'string', '[CLEAR_TODAY] dbPath must be a string');
  assert(dbPath.length > 0, '[CLEAR_TODAY] dbPath cannot be empty');
  assert(typeof todayDate === 'string', '[CLEAR_TODAY] todayDate must be a string');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(todayDate), `[CLEAR_TODAY] todayDate must be YYYY-MM-DD format, got: ${todayDate}`);

  const database = getDatabase(dbPath);
  assert(database !== null, '[CLEAR_TODAY] Failed to get database connection');

  // ── Get entry ID ──
  const entryRow = database.prepare('SELECT id FROM daily_entries WHERE date = ?').get(todayDate) as { id: number } | undefined;

  if (entryRow) {
    assert(typeof entryRow.id === 'number', '[CLEAR_TODAY] entry ID must be a number');

    // ── Delete the entry (cascades to related tables) ──
    database.prepare('DELETE FROM daily_entries WHERE id = ?').run(entryRow.id);

    // ── Verify deletion ──
    const checkRow = database.prepare('SELECT id FROM daily_entries WHERE date = ?').get(todayDate);
    assert(checkRow === undefined, `[CLEAR_TODAY] Failed to delete entry for date: ${todayDate}`);
  }
}

/**
 * Get or create today's entry in the database
 */
export function getOrCreateTodayEntryDb(dbPath: string, todayDate: string): DailyEntry {
  assert(typeof dbPath === 'string', '[GET_TODAY] dbPath must be a string');
  assert(typeof todayDate === 'string', '[GET_TODAY] todayDate must be a string');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(todayDate), `[GET_TODAY] todayDate must be YYYY-MM-DD format, got: ${todayDate}`);

  const database = getDatabase(dbPath);
  assert(database !== null, '[GET_TODAY] Failed to get database connection');

  // ── Check if entry exists ──
  let entryRow = database.prepare('SELECT id, date, score, success FROM daily_entries WHERE date = ?').get(todayDate) as {
    id: number;
    date: string;
    score: number;
    success: number;
  } | undefined;

  if (!entryRow) {
    // ── Create new entry ──
    database.prepare(`
      INSERT INTO daily_entries (date, score, success) VALUES (?, 0, 0)
    `).run(todayDate);

    entryRow = database.prepare('SELECT id, date, score, success FROM daily_entries WHERE date = ?').get(todayDate) as {
      id: number;
      date: string;
      score: number;
      success: number;
    };

    assert(entryRow !== undefined, `[GET_TODAY] Failed to create entry for date: ${todayDate}`);

    // ── Create empty good_habits and bad_habits records ──
    database.prepare('INSERT INTO good_habits (entry_id) VALUES (?)').run(entryRow.id);
    database.prepare('INSERT INTO bad_habits (entry_id) VALUES (?)').run(entryRow.id);
  }

  // ── Load full entry data ──
  const data = loadDataFromDb(dbPath);
  const entry = data.history.find(e => e.date === todayDate);

  assert(entry !== undefined, `[GET_TODAY] Entry not found after creation for date: ${todayDate}`);

  return entry;
}

/**
 * Ensure a category exists in the database
 */
export function ensureCategoryDb(dbPath: string, catType: string, name: string): string {
  assert(typeof dbPath === 'string', '[ENSURE_CAT] dbPath must be a string');
  assert(typeof catType === 'string', '[ENSURE_CAT] catType must be a string');
  assert(['reading', 'learning', 'coding', 'problems'].includes(catType), `[ENSURE_CAT] Invalid category type: ${catType}`);
  assert(typeof name === 'string', '[ENSURE_CAT] name must be a string');
  assert(name.length > 0, '[ENSURE_CAT] name cannot be empty');

  const database = getDatabase(dbPath);
  assert(database !== null, '[ENSURE_CAT] Failed to get database connection');

  // ── Check if category exists (case-insensitive) ──
  const existingRow = database.prepare(`
    SELECT name FROM categories WHERE type = ? AND LOWER(name) = LOWER(?)
  `).get(catType, name) as { name: string } | undefined;

  if (existingRow) {
    assert(typeof existingRow.name === 'string', '[ENSURE_CAT] existing category name must be a string');
    return existingRow.name;
  }

  // ── Insert new category ──
  database.prepare('INSERT INTO categories (type, name) VALUES (?, ?)').run(catType, name);

  return name;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIGRATION FROM JSON
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Migrate data from an existing JSON file to SQLite database
 */
export function migrateFromJson(jsonData: GritData, dbPath: string): void {
  // ── ASSERTION: input validation ──
  assert(typeof jsonData === 'object' && jsonData !== null, '[MIGRATE] jsonData must be a non-null object');
  assert(typeof dbPath === 'string', '[MIGRATE] dbPath must be a string');
  assert(dbPath.length > 0, '[MIGRATE] dbPath cannot be empty');

  // ── Validate JSON data structure ──
  assert(typeof jsonData.version === 'number' || jsonData.version === undefined, '[MIGRATE] jsonData.version must be a number or undefined');
  assert(typeof jsonData.stats === 'object' || jsonData.stats === undefined, '[MIGRATE] jsonData.stats must be an object or undefined');
  assert(Array.isArray(jsonData.history) || jsonData.history === undefined, '[MIGRATE] jsonData.history must be an array or undefined');

  // ── Initialize database (creates schema) ──
  const database = getDatabase(dbPath);
  assert(database !== null, '[MIGRATE] Failed to get database connection');

  // ── Normalize data with defaults ──
  const normalizedData: GritData = {
    version: jsonData.version || 3,
    stats: {
      currentStreak: jsonData.stats?.currentStreak || 0,
      highestStreak: jsonData.stats?.highestStreak || 0,
      currentPoints: jsonData.stats?.currentPoints || 0,
      totalPointsEarned: jsonData.stats?.totalPointsEarned || 0,
      monthlySubtractionAmount: jsonData.stats?.monthlySubtractionAmount || 100,
      nextSubtractionDate: jsonData.stats?.nextSubtractionDate
    },
    categories: {
      reading: jsonData.categories?.reading || ['Backend', 'Testing', 'Database', 'Security', 'Frontend'],
      learning: jsonData.categories?.learning || ['System Design', 'Algorithms', 'Languages'],
      coding: jsonData.categories?.coding || ['API', 'UI', 'Scripting'],
      problems: jsonData.categories?.problems || ['Easy', 'Medium', 'Hard']
    },
    history: jsonData.history || [],
    pointsHistory: jsonData.pointsHistory || []
  };

  // ── Validate normalized history entries ──
  for (let i = 0; i < normalizedData.history.length; i++) {
    const entry = normalizedData.history[i];
    assert(entry !== undefined, `[MIGRATE] history entry at index ${i} is undefined`);
    assert(typeof entry.date === 'string', `[MIGRATE] history[${i}].date must be a string`);

    // ── Ensure arrays exist ──
    if (!Array.isArray(entry.problemSolving)) entry.problemSolving = [];
    if (!Array.isArray(entry.reading)) entry.reading = [];
    if (!Array.isArray(entry.learning)) entry.learning = [];
    if (!Array.isArray(entry.coding)) entry.coding = [];
    if (!Array.isArray(entry.englishLearning)) entry.englishLearning = [];
    if (typeof entry.goodHabits !== 'object' || entry.goodHabits === null) entry.goodHabits = {};
    if (typeof entry.badHabits !== 'object' || entry.badHabits === null) entry.badHabits = {};
    if (typeof entry.score !== 'number') entry.score = 0;
    if (typeof entry.success !== 'boolean') entry.success = false;
    if (typeof entry.pointsEarned !== 'number') entry.pointsEarned = 0;
  }

  // ── Save to database ──
  saveDataToDb(dbPath, normalizedData);

  // ── Verify migration ──
  const loadedData = loadDataFromDb(dbPath);
  assert(loadedData.history.length === normalizedData.history.length,
    `[MIGRATE] Migration verification failed: expected ${normalizedData.history.length} entries, got ${loadedData.history.length}`);
}
