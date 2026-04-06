# Bloom Filter Handbook

This repository is built for learners.

The goal is simple: help you understand Bloom filters from zero to advanced, including why they are used, how they work, why false positives happen, why deletion is hard, and how a Deletable Bloom Filter (DlBF) handles deletion safely in many practical cases.

If you are learning system design, distributed systems, storage optimization, or backend engineering, this README is written for you.

---

## Table of Contents

1. [The Core Problem](#the-core-problem)
2. [What Is a Bloom Filter?](#what-is-a-bloom-filter)
3. [Two Guarantees You Must Remember](#two-guarantees-you-must-remember)
4. [How Bloom Filter Works (Step by Step)](#how-bloom-filter-works-step-by-step)
5. [False Positives (Why They Happen)](#false-positives-why-they-happen)
6. [How to Choose Optimal m and k](#how-to-choose-optimal-m-and-k)
7. [Double Hashing (Practical Hashing Strategy)](#double-hashing-practical-hashing-strategy)
8. [Why Standard Bloom Filter Cannot Delete Safely](#why-standard-bloom-filter-cannot-delete-safely)
9. [Deletable Bloom Filter (DlBF)](#deletable-bloom-filter-dlbf)
10. [When an Element Is Deletable vs Not Deletable](#when-an-element-is-deletable-vs-not-deletable)
11. [Complexity and Memory](#complexity-and-memory)
12. [Repository Files](#repository-files)
13. [How to Run This Project](#how-to-run-this-project)
14. [Practical Tips](#practical-tips)
15. [References](#references)

---

## The Core Problem

In many real systems, you repeatedly ask:

"Does this key exist?"

Common approach:
- Check database every time: expensive at scale
- Keep in-memory structure (Set/hash table/tree): fast lookup, but can use high memory

Your rough documentation focused on this memory overhead issue, and that is exactly where Bloom filters shine.

### Memory intuition

If each entry stores value plus metadata/pointers, metadata can become large for millions of elements.

![visual](https://drive.google.com/file/d/1F3EMqZvvEZ8VI9jD0WNrBF_X-ZagDh_M/view?usp=sharing)

You gave a useful intuition example:
- Value: 4 bytes
- Metadata (pointers/structure): 8 bytes
- Total per entry: 12 bytes

For 1,000,000 entries:
- Actual value bytes: about 4 MB
- Metadata bytes: about 8 MB
- Total: about 12 MB

Even if exact numbers vary by language/runtime and data structure implementation, the learning point is correct:

The storage overhead for exact key storage can be much larger than expected.

Bloom filters reduce this by storing only bits, not full keys.

---

## What Is a Bloom Filter?

A Bloom filter is a probabilistic data structure for membership testing.

It does not store keys.

It stores a compact bit array of length m and uses k hash positions per key.

Because it stores only bit state, memory usage is very small compared to storing all keys exactly.

---

## Two Guarantees You Must Remember

1. No false negatives
If Bloom filter says key is absent, it is definitely absent.

2. Possible false positives
If Bloom filter says key is present, it may be present or may be a collision artifact.

This is the most important mental model.

---

## How Bloom Filter Works (Step by Step)

Assume:
- Bit array size m = 16
- Number of hash positions k = 3
- Initial bit array: all zeros

### Step 1: Bit array initialization

All 16 bits are set to 0.

[Image Placeholder: Empty bit array (all bits 0)]


### Step 2: Insert a key

Example: insert("apple")

Suppose hashes give positions:
- hash_0("apple") % 16 = 2
- hash_1("apple") % 16 = 9
- hash_2("apple") % 16 = 13

Set bit 2, bit 9, bit 13 to 1.

[Image Placeholder: Bit array after insert("apple")]


Now insert("cat")

Suppose positions:
- 5, 9, 12

Bit 9 is already 1 from "apple".
That overlap is a normal collision in Bloom filters.

[Image Placeholder: Bit array after insert("cat")]


### Step 3: Contains (membership query)

For contains(key):
1. Compute k positions
2. Check each corresponding bit

Rules:
- If any bit is 0: return false immediately (definitely absent)
- If all bits are 1: return true (probably present)

Example A: contains("apple") checks 2, 9, 13
- bit 2 = 1
- bit 9 = 1
- bit 13 = 1
- return true

Example B: contains("dog") checks 3, 9, 14
- bit 3 = 0
- stop immediately
- return false (definite miss)

---

## False Positives (Why They Happen)

A false positive means:
- key was never inserted
- but query returns true

How?

Because each of that key's k positions was already set by other keys.

Example:
- contains("grape") checks 5, 9, 12
- those bits are already 1 because of previous inserts
- query returns true even though "grape" was never inserted

This behavior is expected and allowed.

Bloom filters trade exactness for memory efficiency and speed.

---

## How to Choose Optimal m and k

Given:
- n = expected number of inserted items
- p = desired false positive probability

Use these formulas:

```
m = -n * ln(p) / (ln(2)^2)
k = (m / n) * ln(2)
```

Implementation notes:
- m: round up with ceil
- k: round to nearest integer, ensure k >= 1

### Example intuition

If n grows and m stays fixed, false positives increase.

If you want lower p, you need a larger m (more memory) and usually a larger k.

So Bloom filter tuning is a balance between:
- memory budget
- acceptable false positive rate
- operation cost O(k)

---

## Double Hashing (Practical Hashing Strategy)

Using k completely different hash algorithms is expensive.

Practical approach:
- Compute two base hashes h1 and h2
- Generate each position using:

```
pos_i = (h1 + i * h2) % m
for i = 0, 1, 2, ..., k-1
```

Your rough documentation correctly described this.

### Example flow

key = "apple"

- h1 = MurmurHash3(key, seed=0)
- h2 = MurmurHash3(key, seed=1)

Then:
- i=0 -> pos_0 = (h1 + 0*h2) % m
- i=1 -> pos_1 = (h1 + 1*h2) % m
- i=2 -> pos_2 = (h1 + 2*h2) % m

[Image Placeholder: Double-hashing diagram with h1, h2, and derived positions]


This repository uses MurmurHash3-based hashing in the Node.js implementations.

---

## Why Standard Bloom Filter Cannot Delete Safely

In standard Bloom filters, bits are shared.

If you clear bits for one key, you may clear a bit needed by another key, which creates false negatives.

### Demonstration

Suppose:
- apple -> bits 2, 9, 13
- cat -> bits 5, 9, 12

Bit 9 is shared.

If you naively delete apple by clearing 2, 9, 13:
- bit 9 becomes 0
- contains("cat") checks 5, 9, 12
- bit 9 is now 0
- returns false even though cat was inserted

That is a false negative, which breaks the core Bloom guarantee.

So exact safe deletion is not supported in a normal Bloom filter.

---

## Deletable Bloom Filter (DlBF)

DlBF introduces a smart tradeoff: allow deletion only when it is safe.

### Region approach

1. Divide the main bit array into r regions
2. Keep a collision bitmap of r bits
3. collisionBitmap[j] = 1 means region j has seen collisions

Conceptual view:
- Main bit array for membership
- Small region-collision map for delete safety

[Image Placeholder: Main bit array divided into regions + collision bitmap]


### Insert in DlBF

For each hashed position:
1. Find its region
2. If target bit is already 1, mark that region as collided
3. Set the bit to 1

### Contains in DlBF

Same as standard Bloom filter:
- all k bits 1 -> probably present
- any bit 0 -> definitely absent

### Delete in DlBF

For each hashed position of the key:
- If its region is collision-free, clear the bit (safe)
- If its region is marked collided, skip clearing (unsafe)

This prevents unsafe deletion from collided regions.

### Worked region example (from basic idea to delete)

Assume:
- Total budget = 32 bits
- k = 3
- r = 4 regions

One practical split is:
- 28 bits for Bloom data
- 4 bits for collision bitmap (1 bit per region)

So each region covers 7 Bloom bits.

Collision bitmap example:

```
Region:   R0 R1 R2 R3
Bitmap:    1  0  1  0
```

Interpretation:
- R0 collided (not safe to clear there)
- R1 collision-free (safe)
- R2 collided (not safe)
- R3 collision-free (safe)

Now imagine key x hashes to one position in each of regions:
- Region 0
- Region 1
- Region 3

Delete(x):
- Position in R0 -> bitmap is 1 -> skip
- Position in R1 -> bitmap is 0 -> clear
- Position in R3 -> bitmap is 0 -> clear

Because at least one required bit for x is now cleared, contains(x) can return false.

If later all regions used by a key become collided, future delete attempts for that key may be blocked.

[Image Placeholder: DlBF worked example with 4 regions and collision bitmap transitions]

---

## When an Element Is Deletable vs Not Deletable

### Deletable case

If at least one of the key's k positions is in a collision-free region, that bit can be cleared.

Once at least one required bit becomes 0, contains(key) will return false.

### Not deletable case

If all k positions are in collided regions, no safe bit can be cleared.

The element remains and may continue to appear as present.

This is acceptable in Bloom-filter semantics because false positives are already allowed.

### Important clarification about deletion percentage

There is no universal fixed number like "80-90% always deletable".

Actual deletability depends on:
- load factor (how full the filter is)
- collision pattern
- number of regions r
- m, k, and insertion distribution

In many practical scenarios, partial deletion is useful, but the exact rate is workload-dependent.

---

## Complexity and Memory

### Standard Bloom filter

- Insert: O(k)
- Contains: O(k)
- Space: O(m) bits

### Deletable Bloom filter

- Insert: O(k)
- Contains: O(k)
- Delete: O(k)
- Extra memory: collision bitmap of r bits

DlBF adds small metadata (r bits) to enable safe partial deletion.

---

## Repository Files

- bf_simple.js
  - Standard Bloom filter implementation
  - Uses MurmurHash3 + double hashing
  - Includes simple demo run

- bf_deletable.js
  - Deletable Bloom Filter with region-collision tracking
  - Includes sizing formulas and delete behavior demo

- visualization.html
  - Interactive web UI for visual learning

- dynamic.js
  - Visualization logic and guided flow

- dynamic.css
  - Visual styles for the learning interface

---

## How to Run This Project

### 1) Install dependencies

```bash
npm install
```

### 2) Run simple Bloom filter demo

```bash
node bf_simple.js
```

### 3) Run Deletable Bloom filter demo

```bash
node bf_deletable.js
```

### 4) Run visualizer in browser

```bash
npm start
```

Open the local URL shown in terminal.

---

## Suggested Image Slots

Use your diagrams in these exact places:

1. Empty bit array
2. After insert("apple")
3. After insert("cat") and collision highlight
4. contains("dog") early-stop miss
5. False positive example for "grape"
6. Double hashing pipeline (h1, h2 -> pos_i)
7. Naive deletion failure with shared bit
8. DlBF region split and collision bitmap
9. DlBF safe delete walkthrough

---

## Practical Tips

- Use Bloom filter before expensive DB/cache access to reject definite misses quickly.
- Keep expected n realistic. If actual inserts exceed expected n by a lot, false positives rise.
- Rebuild the filter periodically when workload size changes significantly.
- For strict delete requirements, evaluate Counting Bloom Filter or alternative structures.
- For interview and production discussions, always mention the core tradeoff:
  memory efficiency versus occasional false positives.

---

## References

- Bloom, B. H. (1970). Space/Time Trade-Offs in Hash Coding with Allowable Errors.
- Kirsch, A., Mitzenmacher, M. (2006). Less Hashing, Same Performance: Building a Better Bloom Filter.
- Deletable Bloom Filter literature (region-collision tracking variants).
