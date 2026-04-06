'use strict';

const murmurHash3 = require('murmurhash3js');

/**
 * Deletable Bloom Filter (DlBF)
 *
 * This implements the paper-style approach that tracks collisions per region,
 * not per-bit counters (so this is NOT a Counting Bloom Filter).
 *
 * Idea:
 * 1. Normal Bloom bit array stores membership bits.
 * 2. A separate region-collision bitmap marks regions where collisions happened.
 * 3. During delete(key), clear only positions that belong to collision-free regions.
 *
 * This preserves the standard Bloom guarantee of no false negatives caused by
 * unsafe deletes, because we never clear bits from collided regions.
 */
class DeletableBloomFilter {
    /**
     * @param {number} numBits Total number of Bloom bits (m)
     * @param {number} numHashFunctions Number of hash functions (k)
     * @param {number} numRegions Number of collision-tracking regions (r)
     */
    constructor(numBits, numHashFunctions, numRegions = 64) {
        if (!Number.isInteger(numBits) || numBits < 1) {
            throw new RangeError('numBits must be an integer >= 1');
        }
        if (!Number.isInteger(numHashFunctions) || numHashFunctions < 1) {
            throw new RangeError('numHashFunctions must be an integer >= 1');
        }
        if (!Number.isInteger(numRegions) || numRegions < 1) {
            throw new RangeError('numRegions must be an integer >= 1');
        }
        if (numRegions > numBits) {
            throw new RangeError('numRegions cannot exceed numBits');
        }

        this._m = numBits;
        this._k = numHashFunctions;
        this._r = numRegions;

        this._bits = new Uint8Array(Math.ceil(numBits / 8));
        this._regionCollisions = new Uint8Array(Math.ceil(numRegions / 8));
        this._regionSize = Math.ceil(numBits / numRegions);
    }

    /**
     * Compute m and k from expected elements n and target false-positive rate p.
     *
     * m = ceil(-n * ln(p) / (ln(2)^2))
     * k = max(1, round((m / n) * ln(2)))
     */
    static optimalParams(expectedElements, falsePositiveProb) {
        if (!Number.isInteger(expectedElements) || expectedElements < 1) {
            throw new RangeError('expectedElements must be an integer >= 1');
        }
        if (typeof falsePositiveProb !== 'number' || falsePositiveProb <= 0 || falsePositiveProb >= 1) {
            throw new RangeError('falsePositiveProb must be a number in (0, 1)');
        }

        const ln2 = Math.LN2;
        const numBits = Math.ceil(
            -(expectedElements * Math.log(falsePositiveProb)) / (ln2 * ln2)
        );
        const numHashFunctions = Math.max(1, Math.round((numBits / expectedElements) * ln2));

        return { numBits, numHashFunctions };
    }

    static withOptimalParams(expectedElements, falsePositiveProb, numRegions = 64) {
        const params = DeletableBloomFilter.optimalParams(expectedElements, falsePositiveProb);
        return new DeletableBloomFilter(params.numBits, params.numHashFunctions, numRegions);
    }

    /**
     * Insert key and mark regions where collisions are observed.
     * @param {string} key
     */
    insert(key) {
        this._assertKey(key);

        for (const pos of this._positions(key)) {
            const region = this._regionIndex(pos);

            if (this._testBit(pos)) {
                this._markRegionCollision(region);
            }

            this._setBit(pos);
        }
    }

    /**
     * Standard Bloom membership check.
     * @param {string} key
     * @returns {boolean}
     */
    contains(key) {
        this._assertKey(key);

        for (const pos of this._positions(key)) {
            if (!this._testBit(pos)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Delete using DlBF strategy:
     * Clear only bits that are in collision-free regions.
     *
     * @param {string} key
     * @returns {{deleted:boolean, clearedBits:number, blockedBits:number}}
     */
    delete(key) {
        this._assertKey(key);

        const positions = this._positions(key);
        let clearedBits = 0;
        let blockedBits = 0;

        for (const pos of positions) {
            const region = this._regionIndex(pos);

            if (this._regionHasCollision(region)) {
                blockedBits++;
                continue;
            }

            if (this._testBit(pos)) {
                this._clearBit(pos);
                clearedBits++;
            }
        }

        return {
            deleted: clearedBits > 0,
            clearedBits,
            blockedBits
        };
    }


    get size() {
        return this._m;
    }

    get hashCount() {
        return this._k;
    }

    get regionCount() {
        return this._r;
    }

    get byteSize() {
        return this._bits.length;
    }

    get setBitsCount() {
        return this._countSetBits(this._bits);
    }

    get collidedRegionCount() {
        return this._countSetBits(this._regionCollisions);
    }

    get deletableRegionCount() {
        return this._r - this.collidedRegionCount;
    }

    get fillRatio() {
        return this.setBitsCount / this._m;
    }

    get estimatedFPR() {
        return Math.pow(this.fillRatio, this._k);
    }


    _positions(key) {
        const keyStr = String(key);
        const h1 = murmurHash3.x86.hash32(keyStr, 0);
        const h2 = this._k > 1 ? murmurHash3.x86.hash32(keyStr, 1) : 0;

        const positions = new Set();
        for (let i = 0; i < this._k; i++) {
            const combined = (h1 + Math.imul(i, h2)) >>> 0;
            positions.add(combined % this._m);
        }
        return positions;
    }

    _regionIndex(pos) {
        return Math.min(this._r - 1, Math.floor(pos / this._regionSize));
    }

    _markRegionCollision(regionIndex) {
        this._regionCollisions[regionIndex >>> 3] |= (1 << (regionIndex & 7));
    }

    _regionHasCollision(regionIndex) {
        return (this._regionCollisions[regionIndex >>> 3] & (1 << (regionIndex & 7))) !== 0;
    }

    _setBit(pos) {
        this._bits[pos >>> 3] |= (1 << (pos & 7));
    }

    _clearBit(pos) {
        this._bits[pos >>> 3] &= ~(1 << (pos & 7));
    }

    _testBit(pos) {
        return (this._bits[pos >>> 3] & (1 << (pos & 7))) !== 0;
    }

    _countSetBits(byteArray) {
        let count = 0;
        for (const byte of byteArray) {
            let b = byte;
            while (b) {
                count += b & 1;
                b >>>= 1;
            }
        }
        return count;
    }

    _assertKey(key) {
        if (typeof key !== 'string' || key.length === 0) {
            throw new TypeError('key must be a non-empty string');
        }
    }
}


const STATIC_EXPECTED_ELEMENTS = 1000;
const STATIC_TARGET_FPR = 0.01;
const STATIC_REGIONS = 64;

function demo() {
    console.log('Deletable Bloom Filter Demo (paper-style region collision approach)');
    console.log(`Static inputs: n=${STATIC_EXPECTED_ELEMENTS}, targetFPR=${STATIC_TARGET_FPR}`);

    const bf = DeletableBloomFilter.withOptimalParams(
        STATIC_EXPECTED_ELEMENTS,
        STATIC_TARGET_FPR,
        STATIC_REGIONS
    );

    console.log(
        `Computed params: m=${bf.size}, k=${bf.hashCount}, regions=${bf.regionCount}, bytes=${bf.byteSize}`
    );

    const keys = ['apple', 'banana', 'cherry', 'date'];
    keys.forEach(k => bf.insert(k));

    console.log('\nContains before delete:');
    keys.forEach(k => console.log(`  contains("${k}") = ${bf.contains(k)}`));

    const deleteResult = bf.delete('banana');
    console.log('\nDelete("banana") result:', deleteResult);

    console.log('\nContains after delete attempt:');
    console.log(`  contains("banana") = ${bf.contains('banana')}`);
    console.log(`  contains("apple") = ${bf.contains('apple')}`);

    console.log('\nStats:');
    console.log(`  setBits=${bf.setBitsCount}`);
    console.log(`  collidedRegions=${bf.collidedRegionCount}/${bf.regionCount}`);
    console.log(`  deletableRegions=${bf.deletableRegionCount}/${bf.regionCount}`);
    console.log(`  estFPR=${(bf.estimatedFPR * 100).toFixed(2)}%`);
}

if (require.main === module) {
    demo();
}

module.exports = { DeletableBloomFilter, demo };
