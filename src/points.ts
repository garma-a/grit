/**
 * Points System Module for Grit Habit Tracker
 * 
 * This module handles all points calculation, tier determination, and points history management.
 */

import assert from 'node:assert';
import type {
  DailyEntry,
  ProblemSolvingLog,
  ReadingLog,
  LearningLog,
  CodingLog,
  EnglishLearningLog,
  GritData,
  PointsHistoryEntry
} from './database.js';
import { getTodayDateString } from './storage.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TIER SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

export type Tier = 'failure' | 'bronze' | 'silver' | 'gold' | 'diamond';

export interface TierInfo {
  tier: Tier;
  name: string;
  color: string; // ANSI color code
  minPoints: number;
  maxPoints: number | null; // null means unlimited
}

/**
 * Tier definitions based on monthly subtraction capacity
 */
export const TIER_DEFINITIONS: Record<Tier, TierInfo> = {
  failure: {
    tier: 'failure',
    name: 'Failure',
    color: '\x1b[31m', // Red
    minPoints: 0,
    maxPoints: 99
  },
  bronze: {
    tier: 'bronze',
    name: 'Bronze',
    color: '\x1b[38;5;130m', // Bronze/brown color
    minPoints: 100,
    maxPoints: 149
  },
  silver: {
    tier: 'silver',
    name: 'Silver',
    color: '\x1b[37m', // White/silver
    minPoints: 150,
    maxPoints: 199
  },
  gold: {
    tier: 'gold',
    name: 'Gold',
    color: '\x1b[33m', // Yellow/gold
    minPoints: 200,
    maxPoints: 299
  },
  diamond: {
    tier: 'diamond',
    name: 'Diamond',
    color: '\x1b[36m', // Cyan/diamond
    minPoints: 300,
    maxPoints: null
  }
};

const RESET_COLOR = '\x1b[0m';

/**
 * Calculate tier based on current points and monthly subtraction amount
 */
export function calculateTier(currentPoints: number, monthlySubtractionAmount: number): TierInfo {
  assert(typeof currentPoints === 'number', '[TIER] currentPoints must be a number');
  assert(currentPoints >= 0, '[TIER] currentPoints cannot be negative');
  assert(typeof monthlySubtractionAmount === 'number', '[TIER] monthlySubtractionAmount must be a number');
  assert(monthlySubtractionAmount > 0, '[TIER] monthlySubtractionAmount must be positive');

  // Determine tier based on ability to afford monthly subtraction
  if (currentPoints < monthlySubtractionAmount) {
    return TIER_DEFINITIONS.failure;
  }

  const capacity = currentPoints / monthlySubtractionAmount;

  if (capacity >= 3) {
    return TIER_DEFINITIONS.diamond;
  } else if (capacity >= 2) {
    return TIER_DEFINITIONS.gold;
  } else if (capacity >= 1.5) {
    return TIER_DEFINITIONS.silver;
  } else {
    return TIER_DEFINITIONS.bronze;
  }
}

/**
 * Format tier name with color
 */
export function formatTierColored(tierInfo: TierInfo): string {
  return `${tierInfo.color}${tierInfo.name}${RESET_COLOR}`;
}

/**
 * Get tier badge with color and symbols
 */
export function getTierBadge(tierInfo: TierInfo): string {
  const symbols: Record<Tier, string> = {
    failure: '💀',
    bronze: '🥉',
    silver: '🥈',
    gold: '🥇',
    diamond: '💎'
  };

  return `${symbols[tierInfo.tier]} ${formatTierColored(tierInfo)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POINTS CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate points for problem solving activities
 */
export function calculateProblemSolvingPoints(logs: ProblemSolvingLog[]): number {
  assert(Array.isArray(logs), '[POINTS] logs must be an array');

  let totalPoints = 0;

  for (const log of logs) {
    assert(typeof log === 'object' && log !== null, '[POINTS] log must be a non-null object');
    assert(typeof log.count === 'number', '[POINTS] log.count must be a number');
    assert(log.count > 0, '[POINTS] log.count must be positive');

    const pointsPerProblem: Record<string, number> = {
      easy: 8,
      medium: 10,
      hard: 20,
      unknown: 10 // Default for unknown difficulty
    };

    const difficulty = log.difficulty.toLowerCase();
    const points = pointsPerProblem[difficulty] ?? pointsPerProblem.unknown ?? 10;
    totalPoints += points * log.count;
  }

  assert(totalPoints >= 0, '[POINTS] totalPoints cannot be negative');
  return totalPoints;
}

/**
 * Calculate points for reading activities
 */
export function calculateReadingPoints(logs: ReadingLog[]): number {
  assert(Array.isArray(logs), '[POINTS] logs must be an array');

  let totalPoints = 0;

  for (const log of logs) {
    assert(typeof log === 'object' && log !== null, '[POINTS] log must be a non-null object');

    if (log.type === 'book' && typeof log.pages === 'number') {
      // 1 point per page
      totalPoints += log.pages;
    } else if (log.type === 'article') {
      // 10 points per article
      totalPoints += 10;
    }
  }

  assert(totalPoints >= 0, '[POINTS] totalPoints cannot be negative');
  return totalPoints;
}

/**
 * Calculate points for learning activities
 * 10 points per 30 min, 20 points per 1h (scales proportionally)
 */
export function calculateLearningPoints(logs: LearningLog[]): number {
  assert(Array.isArray(logs), '[POINTS] logs must be an array');

  let totalPoints = 0;

  for (const log of logs) {
    assert(typeof log === 'object' && log !== null, '[POINTS] log must be a non-null object');

    if (typeof log.duration === 'number' && log.duration > 0) {
      // 20 points per hour = 0.333... points per minute
      totalPoints += Math.round(log.duration * (20 / 60));
    } else {
      // If no time specified, assume 30 minutes
      totalPoints += 10;
    }
  }

  assert(totalPoints >= 0, '[POINTS] totalPoints cannot be negative');
  return totalPoints;
}

/**
 * Calculate points for coding activities
 * 10 points per 30 min, 20 points per 1h (scales proportionally)
 */
export function calculateCodingPoints(logs: CodingLog[]): number {
  assert(Array.isArray(logs), '[POINTS] logs must be an array');

  let totalPoints = 0;

  for (const log of logs) {
    assert(typeof log === 'object' && log !== null, '[POINTS] log must be a non-null object');
    assert(typeof log.timeSpent === 'number', '[POINTS] log.timeSpent must be a number');

    if (log.timeSpent > 0) {
      // 20 points per hour = 0.333... points per minute
      totalPoints += Math.round(log.timeSpent * (20 / 60));
    }
  }

  assert(totalPoints >= 0, '[POINTS] totalPoints cannot be negative');
  return totalPoints;
}

/**
 * Calculate points for English learning activities
 */
export function calculateEnglishLearningPoints(logs: EnglishLearningLog[]): number {
  assert(Array.isArray(logs), '[POINTS] logs must be an array');

  let totalPoints = 0;

  for (const log of logs) {
    assert(typeof log === 'object' && log !== null, '[POINTS] log must be a non-null object');
    assert(typeof log.type === 'string', '[POINTS] log.type must be a string');

    switch (log.type) {
      case 'video':
        // 10 points per 1h, 20 points per 2h (scales proportionally)
        // 10 points per 60 minutes = 0.1666... points per minute
        if (typeof log.durationMinutes === 'number' && log.durationMinutes > 0) {
          totalPoints += Math.round(log.durationMinutes * (10 / 60));
        }
        break;

      case 'book_grammar':
        // 10 points per session
        totalPoints += 10;
        break;

      case 'book_vocabulary':
        // 10 points per 5 new words = 2 points per word
        if (typeof log.wordsCount === 'number' && log.wordsCount > 0) {
          totalPoints += Math.round(log.wordsCount * 2);
        }
        break;

      case 'speaking_ai':
        // 10 points per 10 minutes = 1 point per minute
        if (typeof log.durationMinutes === 'number' && log.durationMinutes > 0) {
          totalPoints += log.durationMinutes;
        }
        break;

      default:
        assert(false, `[POINTS] Unknown English learning type: ${log.type}`);
    }
  }

  assert(totalPoints >= 0, '[POINTS] totalPoints cannot be negative');
  return totalPoints;
}

/**
 * Calculate total points earned for a daily entry
 */
export function calculateDailyPoints(entry: DailyEntry): number {
  assert(typeof entry === 'object' && entry !== null, '[POINTS] entry must be a non-null object');

  let totalPoints = 0;

  totalPoints += calculateProblemSolvingPoints(entry.problemSolving);
  totalPoints += calculateReadingPoints(entry.reading);
  totalPoints += calculateLearningPoints(entry.learning);
  totalPoints += calculateCodingPoints(entry.coding);
  totalPoints += calculateEnglishLearningPoints(entry.englishLearning || []);

  assert(totalPoints >= 0, '[POINTS] totalPoints cannot be negative');
  return totalPoints;
}

/**
 * Update points for a daily entry and add to points history
 */
export function updateEntryPoints(entry: DailyEntry, data: GritData): void {
  assert(typeof entry === 'object' && entry !== null, '[POINTS] entry must be a non-null object');
  assert(typeof data === 'object' && data !== null, '[POINTS] data must be a non-null object');

  const pointsEarned = calculateDailyPoints(entry);
  
  // Update entry
  entry.pointsEarned = pointsEarned;

  // Update stats
  data.stats.currentPoints += pointsEarned;
  data.stats.totalPointsEarned += pointsEarned;

  // Add to points history
  const currentTier = calculateTier(data.stats.currentPoints, data.stats.monthlySubtractionAmount).tier;
  const historyEntry: PointsHistoryEntry = {
    pointsChange: pointsEarned,
    pointsAfter: data.stats.currentPoints,
    reason: `Daily activity points - ${currentTier} tier`,
    createdAt: entry.date
  };

  data.pointsHistory.push(historyEntry);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MONTHLY SUBTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if monthly subtraction is due and apply it if needed
 */
export function checkAndApplyMonthlySubtraction(data: GritData): boolean {
  assert(typeof data === 'object' && data !== null, '[SUBTRACTION] data must be a non-null object');
  assert(typeof data.stats === 'object', '[SUBTRACTION] data.stats must be an object');

  // If no next subtraction date is set, don't apply subtraction
  if (!data.stats.nextSubtractionDate) {
    return false;
  }

  const today = getTodayDateString();
  
  // If we haven't reached the subtraction date yet, don't subtract
  if (today < data.stats.nextSubtractionDate) {
    return false;
  }

  // Apply subtraction
  const amountToSubtract = data.stats.monthlySubtractionAmount;
  const oldPoints = data.stats.currentPoints;
  data.stats.currentPoints = Math.max(0, data.stats.currentPoints - amountToSubtract);

  // Calculate next subtraction date (30 days from today)
  const todayDate = new Date(today);
  todayDate.setDate(todayDate.getDate() + 30);
  data.stats.nextSubtractionDate = todayDate.toISOString().split('T')[0] as string;

  // Add to points history
  const currentTier = calculateTier(data.stats.currentPoints, data.stats.monthlySubtractionAmount).tier;
  const historyEntry: PointsHistoryEntry = {
    pointsChange: -(oldPoints - data.stats.currentPoints),
    pointsAfter: data.stats.currentPoints,
    reason: `Monthly subtraction (${amountToSubtract} points) - ${currentTier} tier`,
    createdAt: today
  };

  data.pointsHistory.push(historyEntry);

  return true;
}

/**
 * Set the next monthly subtraction date
 * @param data - GritData object
 * @param startNow - If true, sets date to today; if false, sets to tomorrow
 */
export function setMonthlySubtractionDate(data: GritData, startNow: boolean): void {
  assert(typeof data === 'object' && data !== null, '[SUBTRACTION] data must be a non-null object');
  assert(typeof startNow === 'boolean', '[SUBTRACTION] startNow must be a boolean');

  const today = getTodayDateString();
  
  if (startNow) {
    data.stats.nextSubtractionDate = today;
  } else {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    data.stats.nextSubtractionDate = tomorrow.toISOString().split('T')[0] as string;
  }
}

/**
 * Reset points to 0 while keeping history
 */
export function resetPoints(data: GritData): void {
  assert(typeof data === 'object' && data !== null, '[RESET] data must be a non-null object');

  const oldPoints = data.stats.currentPoints;
  data.stats.currentPoints = 0;
  data.stats.totalPointsEarned = 0;

  // Add to points history
  const historyEntry: PointsHistoryEntry = {
    pointsChange: -oldPoints,
    pointsAfter: 0,
    reason: 'Points reset',
    createdAt: getTodayDateString()
  };

  data.pointsHistory.push(historyEntry);
}
