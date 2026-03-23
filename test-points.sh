#!/bin/bash

# Test script for the points system
# This script simulates answering the daily check-in questions

echo "Testing Grit Points System"
echo "=========================="
echo ""

# Test 1: Problem Solving (Easy - 8 points)
echo "Test 1: Problem Solving - 1 Easy problem (expect 8 points)"
echo -e "y\n1\nEasy\nTest Problem\nn\nn\nn\nn\nn\n" | grit

# Check points
echo ""
echo "Current points after Test 1:"
grit points | grep "Points:" | head -1

# Test 2: Reading (Book - 10 pages = 10 points)
echo ""
echo "Test 2: Reading - 10 pages (expect +10 points, total 18)"
echo -e "n\ny\nbook\nTesting\nTest Book\n10\nn\nn\nn\nn\n" | grit

echo ""
echo "Current points after Test 2:"
grit points | grep "Points:" | head -1

# Test 3: Learning (60 minutes = 20 points)
echo ""
echo "Test 3: Learning - 60 minutes (expect +20 points, total 38)"
echo -e "n\nn\ny\nAlgorithms\nTest Learning\n60\nn\nn\nn\n" | grit

echo ""
echo "Current points after Test 3:"
grit points | grep "Points:" | head -1

# Test 4: Coding (45 minutes = 15 points)
echo ""
echo "Test 4: Coding - 45 minutes (expect +15 points, total 53)"
echo -e "n\nn\nn\ny\nAPI\nTest API\n45\nn\nn\nn\n" | grit

echo ""
echo "Current points after Test 4:"
grit points | grep "Points:" | head -1

# Test 5: English Learning - Video (60 minutes = 10 points)
echo ""
echo "Test 5: English - Video 60 minutes (expect +10 points, total 63)"
echo -e "n\nn\nn\nn\nn\nn\ny\nvideo\n60\n" | grit

echo ""
echo "Current points after Test 5:"
grit points | grep "Points:" | head -1

# Test 6: English Learning - Vocabulary (10 words = 20 points)
echo ""
echo "Test 6: English - 10 new words (expect +20 points, total 83)"
echo -e "n\nn\nn\nn\nn\nn\ny\nbook_vocabulary\n10\n" | grit

echo ""
echo "Current points after Test 6:"
grit points | grep "Points:" | head -1

echo ""
echo "=========================="
echo "Final Points Summary:"
grit points | head -25

echo ""
echo "Testing complete!"
