# Bloom Filter and Deletable Bloom Filter (DlBF)

A comprehensive, learner-focused implementation of probabilistic data structures. 

This repository is designed to take you from zero to advanced understanding of Bloom Filters. It covers the core mechanics, the mathematics behind false positives, practical hashing strategies, and the implementation of Deletable Bloom Filters (DlBF) for safe element removal.

**Live Interactive Visualization:** [Explore the Bloom Filter Demo](https://bloom-visualization.vercel.app/)

---

## Table of Contents

1. [The Core Problem: Memory Overhead](#the-core-problem-memory-overhead)
2. [What Is a Bloom Filter?](#what-is-a-bloom-filter)
3. [Core Guarantees](#core-guarantees)
4. [Standard Bloom Filter Operations](#standard-bloom-filter-operations)
5. [Understanding False Positives](#understanding-false-positives)
6. [Mathematical Optimization (Choosing m and k)](#mathematical-optimization-choosing-m-and-k)
7. [Practical Implementation: Double Hashing](#practical-implementation-double-hashing)
8. [The Deletion Problem in Standard Filters](#the-deletion-problem-in-standard-filters)
9. [Deletable Bloom Filter (DlBF) Architecture](#deletable-bloom-filter-dlbf-architecture)
10. [Deletability Conditions](#deletability-conditions)
11. [References](#references)

---

## The Core Problem: Memory Overhead

In large-scale distributed systems and databases, you must frequently answer the question: *"Does this key exist?"*

Common approaches have significant drawbacks at scale:
* **Database Queries:** Expensive and slow due to disk I/O or network latency.
* **In-Memory Structures (Hash Tables/Trees):** Fast, but consume massive amounts of memory.

### The Memory Intuition
Consider a traditional in-memory structure. If each entry requires 4 bytes for the value and 8 bytes for structural metadata (pointers), the total per entry is 12 bytes. 

![](/images/bf-0.png)

For 1,000,000 entries:
* Value Storage: ~4 MB
* Metadata Storage: ~8 MB
* **Total Memory:** ~12 MB

While exact figures vary by language runtime, the fundamental principle remains: storing exact keys and metadata incurs massive storage overhead. Bloom filters solve this by storing only bits, drastically reducing the memory footprint.

---

## What Is a Bloom Filter?

A Bloom filter is a highly space-efficient probabilistic data structure used to test whether an element is a member of a set. 

It does not store the actual keys. Instead, it utilizes a compact bit array of length $m$ and processes each key through $k$ different hash functions to flip specific bits. Because it only tracks bit states, its memory consumption is microscopic compared to traditional exact-storage structures.

---

## Core Guarantees

When querying a Bloom filter, you must understand two absolute rules:

1.  **No False Negatives:** If the filter indicates a key is absent, it is definitively absent.
2.  **Possible False Positives:** If the filter indicates a key is present, it may be present, or it may be a hash collision artifact. 

In system architecture, this means you only perform an expensive database lookup when the Bloom filter returns true. The filter effectively intercepts and eliminates all database calls for keys that do not exist.

---

## Standard Bloom Filter Operations

Assume a simplified scenario:
* Bit array size $m = 16$
* Number of hash functions $k = 3$

### Step 1: Initialization
The bit array is initialized with all bits set to 0.

![](/images/bf-1.png)

### Step 2: Insertion
Example: `insert("apple")`

Assume the 3 hash functions return the following modulo positions: 2, 9, and 13.
The bits at indices 2, 9, and 13 are flipped to 1.

![](/images/bf2.png)

Example: `insert("cat")`

Assume the hash positions are 5, 9, and 12. 
Notice that bit 9 is already set to 1 from the "apple" insertion. This overlap is a standard collision and is expected behavior. Bits 5 and 12 are flipped to 1.

![](/images/bf3.png)

### Step 3: Membership Query (Contains)
To check if a key exists, compute its $k$ positions and verify the bits.
* If **any** bit is 0: Return false (definitively absent).
* If **all** bits are 1: Return true (probably present).

**Example A: `contains("apple")`**
Checks positions 2, 9, and 13. All are 1. Returns true.
![](/images/bf-4.png)

**Example B: `contains("dog")`**
Checks positions 3, 9, and 14. Bit 3 is 0. The process stops immediately and returns false.
![](/images/bf-5.png)

---

## Understanding False Positives

A false positive occurs when the query returns true for a key that was never inserted. 

This happens when all $k$ hash positions for the uninserted key happen to have been set to 1 by previous, completely different insertions. 

**Example:** `contains("grape")`
Assume the hash positions for "grape" are 5, 9, and 12. 
![](/images/bf-6.png)

Even though "grape" was never inserted, bits 5, 9, and 12 are all currently 1 due to the earlier insertions of "apple" and "cat". The filter returns true. This tradeoff of exactness for speed and memory efficiency is the defining characteristic of the data structure.

---

## Mathematical Optimization (Choosing m and k)

To construct an optimal Bloom filter, you must define:
* $n$ = Expected number of items to be inserted.
* $p$ = Acceptable false positive probability rate.

The optimal bit array size ($m$) and number of hash functions ($k$) are calculated as follows:

$$m = -\frac{n \cdot \ln(p)}{(\ln(2))^2}$$

$$k = \left(\frac{m}{n}\right) \cdot \ln(2)$$

**Implementation Notes:**
* Round $m$ up to the nearest integer.
* Round $k$ to the nearest integer, ensuring $k \ge 1$.
* As $n$ grows, if $m$ remains fixed, the false positive rate $p$ will rapidly degrade.

---

## Practical Implementation: Double Hashing

Executing $k$ separate, distinct hash functions (like SHA-256 or MurmurHash) for every operation is computationally expensive. Standard implementations use a "Double Hashing" strategy to simulate $k$ hash functions using only two base hashes ($h_1$ and $h_2$).

$$pos_i = (h_1 + i \cdot h_2) \pmod m$$
*(where $i$ ranges from $0$ to $k-1$)*

**Example Flow for "apple":**
1. $h_1$ = MurmurHash3("apple", seed=0)
2. $h_2$ = MurmurHash3("apple", seed=1)
3. $pos_0 = (h_1 + 0 \cdot h_2) \pmod m$
4. $pos_1 = (h_1 + 1 \cdot h_2) \pmod m$
5. $pos_2 = (h_1 + 2 \cdot h_2) \pmod m$

---

## The Deletion Problem in Standard Filters

Standard Bloom filters do not support safe deletion because bits are shared across multiple keys.

If you attempt to delete "apple" by resetting its bits (2, 9, 13) to 0, you will simultaneously reset bit 9. Because bit 9 is also relied upon by "cat", a subsequent query for `contains("cat")` will encounter a 0 at position 9 and return false. 

![](/images/bf-7.png)

This creates a **false negative**, which violates the primary guarantee of the data structure.

---

## Deletable Bloom Filter (DlBF) Architecture

The Deletable Bloom Filter (DlBF) introduces a structural tradeoff: it tracks collisions to allow safe deletion where possible.

### The Region Approach
1. The primary bit array is divided into $r$ distinct regions.
2. A secondary collision bitmap of length $r$ is maintained.
3. If `collisionBitmap[j] == 1`, it indicates that a hash collision has occurred within region $j$.

![](/images/bf-8.png)

### DlBF Insertion
During insertion, for each of the $k$ hashed positions:
1. Identify the region the target bit belongs to.
2. If the target bit is already 1, mark that specific region as collided in the collision bitmap.
3. Set the target bit to 1.

**Example: `insert("apple")`** -> Positions 2, 9, 13.
No bits were previously set, so no regions are marked as collided.
![](/images/bf-11.png)

**Example: `insert("cat")`** -> Positions 5, 9, 12.
Bit 9 is already 1 (from "apple"). Bit 9 resides in Region 3 (R3). Therefore, R3 is marked as collided (1) in the collision bitmap.
![](/images/bf-9.png)

### DlBF Deletion
To delete a key, check the $k$ hashed positions against the collision bitmap:
* If the position's region is collision-free (0), it is safe to reset the bit to 0.
* If the position's region is marked as collided (1), the bit must remain unchanged to prevent false negatives.

**Example: `delete("apple")`** (Positions 2, 9, 13)
* Position 2 (Region 1): Collision-free. Safe to clear.
* Position 9 (Region 3): Collided. Do not clear.
* Position 13 (Region 4): Collision-free. Safe to clear.

![](/images/bf-10.png)

Because bits 2 and 13 were successfully cleared, `contains("apple")` will now find a 0 and correctly return false. Because bit 9 was preserved, `contains("cat")` remains intact and returns true. Deletion was successful without corrupting the filter.

---

## Deletability Conditions

A DlBF does not guarantee that every element can be deleted.

* **Successfully Deletable:** An element is conceptually deleted as long as *at least one* of its $k$ bits resides in a collision-free region and can be cleared. Once a single bit is 0, the membership query evaluates to false.
* **Non-Deletable:** If *all* $k$ positions for a key reside in regions marked as collided, the key cannot be safely deleted. It will remain in the filter as a permanent false positive. 

**Note on Efficiency:** The actual deletability percentage relies heavily on the filter's load factor, the number of regions ($r$), and the ratio of $m$ to $n$.

---

## References

* Rothenberg, C. E., Macapuna, C. A. B., Verdi, F. L., & Magalhães, M. F. *The Deletable Bloom Filter – A New Member of the Bloom Family*.
