# Bloom Filter Handbook

This repository is built for learners.

The goal is simple: help you understand Bloom filters from zero to advanced, including why they are used, how they work, why false positives happen, why deletion is hard, and how a Deletable Bloom Filter (DlBF) handles deletion safely in many practical cases.

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
11. [References](#references)

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

![](/images/bf-0.png)

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
If Bloom filter says key is present, it may be present or may be a collision artifact.in this case we need to check db so we reduce db calls for the key which definitely absent.

This is the most important mental model.

---

## How Bloom Filter Works (Step by Step)

Assume:
- Bit array size m = 16
- Number of hash positions k = 3
- Initial bit array: all zeros

### Step 1: Bit array initialization

All 16 bits are set to 0.

![](/images/bf-1.png)


### Step 2: Insert a key

Example: insert("apple")

Suppose hashes give positions:
- hash_0("apple") % 16 = 2
- hash_1("apple") % 16 = 9
- hash_2("apple") % 16 = 13

Set bit 2, bit 9, bit 13 to 1.

![](/images/bf2.png)

Now insert("cat")

Suppose positions:
- 5, 9, 12

Bit 9 is already 1 from "apple".
That overlap is a normal collision in Bloom filters.

![](/images/bf3.png)


### Step 3: Contains (membership query)

For contains(key):
1. Compute k positions
2. Check each corresponding bit

Rules:
- If any bit is 0: return false immediately (definitely absent)
- If all bits are 1: return true (probably present)

Example A: contains("apple") checks 2, 9, 13

![](/images/bf-4.png)

- bit 2 = 1
- bit 9 = 1
- bit 13 = 1
- return true

Example B: contains("dog") checks 3, 9, 14

![](/images/bf-5.png)

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

![](/images/bf-6.png)
  
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

![](/images/bf-7.png)
  
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

![](/images/bf-8.png)

### Insert in DlBF

For each hashed position:
1. Find its region
2. If target bit is already 1, mark that region as collided
3. Set the bit to 1

Example: insert("apple")

Suppose hashes give positions:
- hash_0("apple") % 16 = 2
- hash_1("apple") % 16 = 9
- hash_2("apple") % 16 = 13

![](/images/bf-11.png)

Set bit 2, bit 9, bit 13 to 1. no collision in any region.

Now insert("cat")

Suppose positions:
- 5, 9, 12

![](/images/bf-9.png)

Bit 9 is already 1 from "apple".bit 9 belongs into the R3. so R3 is marked with 1 which represents there is collision in this region.


### Contains in DlBF

Same as standard Bloom filter:
- all k bits 1 -> probably present
- any bit 0 -> definitely absent

### Delete in DlBF

For each hashed position of the key:
- If its region is collision-free, clear the bit (safe)
- If its region is marked collided, skip clearing (unsafe)

Now Delete("apple")

- hash positions -> 2,9,13
- first check position belongs into the particular region are collision-free or not. 0 -> safe, 1 -> unsafe
- 2 -> R1 = 0 (safe) -> clear bit 2.
- 9 -> R3 = 1 (unsafe) -> do not clear bit 9.
- 13 -> R4 = 0 (safe) -> clear bit 13.

![](/images/bf-10.png)

This prevents unsafe deletion from collided regions.
now check for 'cat' is exists or not :-
- hash postions -> 5, 9, 12 -> all three are 1. so you Successfully deleted the apple without altering the other keys.
  
---

## When an Element Is Deletable vs Not Deletable

### Deletable case

- If at least one of the key's k positions is in a collision-free region, that bit can be cleared.

- Once at least one required bit becomes 0, contains(key) will return false.

### Not deletable case

- If all k positions are in collided regions, no safe bit can be cleared.

- The element remains and may continue to appear as present.

- This is acceptable in Bloom-filter semantics because false positives are already allowed.

### Important clarification about deletion percentage

Actual deletability depends on:
- load factor (how full the filter is)
- collision pattern
- number of regions r
- m, k, and insertion distribution

In many practical scenarios, partial deletion is useful, but the exact rate is workload-dependent.

---

## References

- Christian Esteve Rothenberg, Carlos A. B. Macapuna, Fábio L. Verdi, Maurício F. Magalhães  
  *The Deletable Bloom Filter – A New Member of the Bloom Family*
