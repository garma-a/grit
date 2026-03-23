#!/usr/bin/env node
/**
 * Test script for points calculation
 */

import { calculateProblemSolvingPoints, calculateReadingPoints, calculateLearningPoints, calculateCodingPoints, calculateEnglishLearningPoints, calculateTier, getTierBadge } from './dist/points.js';

console.log('Testing Points Calculation Functions');
console.log('====================================\n');

// Test 1: Problem Solving
console.log('Test 1: Problem Solving');
const problemPoints = calculateProblemSolvingPoints([
  { difficulty: 'Easy', count: 1, topics: ['Test'] },
  { difficulty: 'Medium', count: 2, topics: ['Test'] },
  { difficulty: 'Hard', count: 1, topics: ['Test'] }
]);
console.log(`  1 Easy + 2 Medium + 1 Hard = ${problemPoints} points`);
console.log(`  Expected: 8 + 20 + 20 = 48 points`);
console.log(`  ✓ ${problemPoints === 48 ? 'PASS' : 'FAIL'}\n`);

// Test 2: Reading
console.log('Test 2: Reading');
const readingPoints = calculateReadingPoints([
  { type: 'book', category: 'Backend', topic: 'Test', pages: 10 },
  { type: 'article', category: 'Testing', topic: 'Test' }
]);
console.log(`  10 pages + 1 article = ${readingPoints} points`);
console.log(`  Expected: 10 + 10 = 20 points`);
console.log(`  ✓ ${readingPoints === 20 ? 'PASS' : 'FAIL'}\n`);

// Test 3: Learning
console.log('Test 3: Learning');
const learningPoints = calculateLearningPoints([
  { category: 'Algorithms', topic: 'Test', duration: 60 },
  { category: 'System Design', topic: 'Test', duration: 30 }
]);
console.log(`  60 min + 30 min = ${learningPoints} points`);
console.log(`  Expected: 20 + 10 = 30 points`);
console.log(`  ✓ ${learningPoints === 30 ? 'PASS' : 'FAIL'}\n`);

// Test 4: Coding
console.log('Test 4: Coding');
const codingPoints = calculateCodingPoints([
  { category: 'API', topic: 'Test', timeSpent: 60 },
  { category: 'UI', topic: 'Test', timeSpent: 45 }
]);
console.log(`  60 min + 45 min = ${codingPoints} points`);
console.log(`  Expected: 20 + 15 = 35 points`);
console.log(`  ✓ ${codingPoints === 35 ? 'PASS' : 'FAIL'}\n`);

// Test 5: English Learning
console.log('Test 5: English Learning');
const englishVideoPoints = calculateEnglishLearningPoints([
  { type: 'video', durationMinutes: 60 }
]);
const englishGrammarPoints = calculateEnglishLearningPoints([
  { type: 'book_grammar' }
]);
const englishVocabPoints = calculateEnglishLearningPoints([
  { type: 'book_vocabulary', wordsCount: 10 }
]);
const englishSpeakingPoints = calculateEnglishLearningPoints([
  { type: 'speaking_ai', durationMinutes: 20 }
]);

console.log(`  Video 60 min = ${englishVideoPoints} points (expected 10)`);
console.log(`  Grammar session = ${englishGrammarPoints} points (expected 10)`);
console.log(`  10 words = ${englishVocabPoints} points (expected 20)`);
console.log(`  Speaking 20 min = ${englishSpeakingPoints} points (expected 20)`);
console.log(`  ✓ ${englishVideoPoints === 10 && englishGrammarPoints === 10 && englishVocabPoints === 20 && englishSpeakingPoints === 20 ? 'PASS' : 'FAIL'}\n`);

// Test 6: Tier Calculation
console.log('Test 6: Tier Calculation');
const tier0 = calculateTier(50, 100);
const tier100 = calculateTier(100, 100);
const tier150 = calculateTier(150, 100);
const tier200 = calculateTier(200, 100);
const tier300 = calculateTier(300, 100);

console.log(`  50 points = ${getTierBadge(tier0)} (expected Failure)`);
console.log(`  100 points = ${getTierBadge(tier100)} (expected Bronze)`);
console.log(`  150 points = ${getTierBadge(tier150)} (expected Silver)`);
console.log(`  200 points = ${getTierBadge(tier200)} (expected Gold)`);
console.log(`  300 points = ${getTierBadge(tier300)} (expected Diamond)`);
console.log(`  ✓ ${tier0.tier === 'failure' && tier100.tier === 'bronze' && tier150.tier === 'silver' && tier200.tier === 'gold' && tier300.tier === 'diamond' ? 'PASS' : 'FAIL'}\n`);

console.log('====================================');
console.log('All tests completed!');
