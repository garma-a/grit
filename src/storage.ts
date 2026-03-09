import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';

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

export interface ProblemSolvingLog {
  difficulty: string; // 'easy', 'medium', 'hard'
  count: number;
  topics: string[]; // e.g., ['Arrays', 'Binary Search']
}

export interface ReadingLog {
  type: 'article' | 'docs' | 'book';
  category: string; // e.g., 'Backend', 'Testing'
  topic: string; // e.g., 'GraphQL', 'Jest'
  pages?: number;
  sections?: number; // for docs: number of sections read
}

export interface LearningLog {
  category: string;
  topic: string;
  duration?: number; // duration in minutes
}

export interface CodingLog {
  category: string;
  topic: string;
  timeSpent: string;
}

export interface DailyEntry {
  date: string; // YYYY-MM-DD
  problemSolving: ProblemSolvingLog[];
  reading: ReadingLog[];
  learning: LearningLog[];
  coding: CodingLog[];
  score: number; // dynamically computed
  success: boolean; // dynamically computed (score >= 3)
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
  };
  categories: Categories;
  history: DailyEntry[];
}

export function getTodayDateString(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

export function getNextOrPrevDay(dateStr: string, offsetDays: number): string {
  const parts = dateStr.split('-');
  const y = parseInt(parts[0] || '0', 10);
  const m = parseInt(parts[1] || '0', 10);
  const d = parseInt(parts[2] || '0', 10);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  const yr = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const da = String(date.getUTCDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

export function migrateV1ToV2(v1Data: any): GritData {
  const oldHistory = v1Data.history as V1DailyEntry[];

  const newHistory: DailyEntry[] = oldHistory.map(old => {
    const entry: DailyEntry = {
      date: old.date,
      problemSolving: [],
      reading: [],
      learning: [],
      coding: [],
      score: old.score || 0,
      success: old.success || false
    };

    if (old.habits?.problemSolving) {
      entry.problemSolving.push({ difficulty: 'unknown', count: 1, topics: ['Legacy Entry'] });
    }
    if (old.habits?.reading?.done) {
      entry.reading.push({
        type: old.habits.reading.pages ? 'book' : 'article',
        category: 'Uncategorized',
        topic: old.habits.reading.topic || 'Legacy Reading',
        pages: old.habits.reading.pages
      });
    }
    if (old.habits?.learning?.done) {
      entry.learning.push({ category: 'Uncategorized', topic: old.habits.learning.topic || 'Legacy Learning' });
    }
    if (old.habits?.coding?.done) {
      entry.coding.push({
        category: 'Uncategorized',
        topic: old.habits.coding.topic || 'Legacy Coding',
        timeSpent: old.habits.coding.timeSpent || 'unknown'
      });
    }

    return entry;
  });

  return {
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
}

export async function loadData(dataPath: string): Promise<GritData> {
  let parsed: any;
  if (existsSync(dataPath)) {
    try {
      const content = await fs.readFile(dataPath, 'utf-8');
      parsed = JSON.parse(content);
    } catch (error) {
      // Return fresh default
    }
  }

  if (parsed) {
    if (!parsed.version || parsed.version === 1) {
      return migrateV1ToV2(parsed);
    }
    // Handle migration for users who already generated V2 data with topic instead of topics
    for (const entry of parsed.history || []) {
      for (const p of (entry.problemSolving || [])) {
        if (p.topic && !p.topics) {
          p.topics = [p.topic];
          delete p.topic;
        }
      }
    }
    return parsed as GritData;
  }

  return {
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
}

export async function saveData(dataPath: string, data: GritData): Promise<void> {
  const dir = path.dirname(dataPath);
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(dataPath, JSON.stringify(data, null, 2), 'utf-8');
}

export function computeDailySuccessAndScore(entry: DailyEntry): void {
  let score = 0;
  if (entry.problemSolving.length > 0) score++;
  if (entry.reading.length > 0) score++;
  if (entry.learning.length > 0) score++;
  if (entry.coding.length > 0) score++;

  entry.score = score;
  entry.success = score >= 3;
}

export function calculateStreak(history: DailyEntry[]): { current: number; highest: number } {
  if (history.length === 0) return { current: 0, highest: 0 };

  const successMap = new Map<string, boolean>();
  for (const entry of history) {
    computeDailySuccessAndScore(entry);
    if (entry.success) {
      successMap.set(entry.date, true);
    }
  }

  let current = 0;
  let highest = 0;

  const dates = Array.from(successMap.keys()).sort();
  if (dates.length > 0) {
    let tempStreak = 1;
    highest = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = dates[i - 1];
      const expectedNext = getNextOrPrevDay(prev as string, 1);

      if (dates[i] === expectedNext) {
        tempStreak++;
        if (tempStreak > highest) highest = tempStreak;
      } else {
        tempStreak = 1;
      }
    }
  }

  const todayStr = getTodayDateString();
  const yesterdayStr = getNextOrPrevDay(todayStr, -1);

  let checkDateStr = todayStr;
  if (!successMap.has(todayStr) && successMap.has(yesterdayStr)) {
    checkDateStr = yesterdayStr;
  } else if (!successMap.has(todayStr) && !successMap.has(yesterdayStr)) {
    return { current: 0, highest };
  }

  while (true) {
    if (successMap.has(checkDateStr)) {
      current++;
      checkDateStr = getNextOrPrevDay(checkDateStr, -1);
    } else {
      break;
    }
  }

  if (current > highest) {
    highest = current;
  }

  return { current, highest };
}

export function updateStats(data: GritData): void {
  const { current, highest } = calculateStreak(data.history);
  data.stats.currentStreak = current;
  data.stats.highestStreak = Math.max(data.stats.highestStreak || 0, highest);
}

// Utility to fetch or create today's entry
export function getOrCreateTodayEntry(data: GritData): DailyEntry {
  const todayStr = getTodayDateString();
  let entry = data.history.find(e => e.date === todayStr);
  if (!entry) {
    entry = {
      date: todayStr,
      problemSolving: [],
      reading: [],
      learning: [],
      coding: [],
      score: 0,
      success: false
    };
    data.history.push(entry);
  }
  return entry;
}

// Ensure a category exists in a list, return it
export function ensureCategory(list: string[], cat: string): string {
  const exists = list.find(c => c.toLowerCase() === cat.toLowerCase());
  if (!exists) {
    list.push(cat);
    return cat;
  }
  return exists;
}
