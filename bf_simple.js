'use strict';

const murmurHash3 = require('murmurhash3js');


class BloomFilter {
    /**
     * @param {number} numBits           Size of the bit array (m).
     * @param {number} numHashFunctions  Number of hash positions per item (k).
     */
    constructor(numBits, numHashFunctions) {
        if (numBits < 1)          throw new RangeError('numBits must be >= 1');
        if (numHashFunctions < 1) throw new RangeError('numHashFunctions must be >= 1');

        this._m    = numBits;
        this._k    = numHashFunctions;
        this._bits = new Uint8Array(Math.ceil(numBits / 8));
        console.log(typeof this._bits, this._bits.length); // zero-initialised
    }

    

    // ── Core operations ───────────────────────────────────────────────────────

    /**
     * Insert a key into the filter.
     * @param {string} key
     */
    insert(key) {
        for (const pos of this._positions(key)) {
            console.log(pos)
            this._setBit(pos);
        }
    }

    /**
     * Test if a key is in the filter.
     * @param   {string}  key
     * @returns {boolean} false → definitely absent | true → probably present
     */
    contains(key) {
        for (const pos of this._positions(key)) {
            if (!this._testBit(pos)) return false; // definite miss
        }
        return true; // probable hit
    }

    // ── Diagnostics ───────────────────────────────────────────────────────────

    get size()         { return this._m; }
    get hashCount()    { return this._k; }

    get setBitsCount() {
        let count = 0;
        for (const byte of this._bits) {
            let b = byte;
            while (b) { count += b & 1; b >>>= 1; }
        }
        return count;
    }

    /** Estimated current false-positive rate: (setBits / m) ^ k */
    get estimatedFPR() {
        return Math.pow(this.setBitsCount / this._m, this._k);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Derive k bit positions using murmurhash3js + double hashing.
     *   pos_i = (h1 + i * h2) % m
     *
     * murmurHash3.x86.hash32(key, seed) is called with seed=0 and seed=1
     * to get two independent 32-bit values h1 and h2.
     */
    _positions(key) {
        const h1 = murmurHash3.x86.hash32(key, 0);   // seed 0
        const h2 = this._k > 1
            ? murmurHash3.x86.hash32(key, 1)          // seed 1
            : 0;

        const positions = new Set();
        for (let i = 0; i < this._k; i++) {
            const combined = (h1 + Math.imul(i, h2)) >>> 0; // stay in uint32
            positions.add(combined % this._m);
        }
        return positions;
    }

    _setBit(pos) {
        
        this._bits[pos >>> 3] |= (1 << (pos & 7));
    }

    _testBit(pos) {
        return (this._bits[pos >>> 3] & (1 << (pos & 7))) !== 0;
    }
}


function demo() {
    console.log('━━━━ Demo 1 — k=1 (single hash), m=64 ━━━━');

    const bf = new BloomFilter(64, 1);
    const words = ['apple', 'banana', 'cherry', 'date'];

    words.forEach(w => bf.insert(w));
    console.log('Inserted:', words);

    console.log('\nInserted items (must all be true):');
    words.forEach(w =>
        console.log(`  contains("${w}") =`, bf.contains(w))
    );

    console.log('\nAbsent items (may occasionally be true = false positive):');
    ['dog', 'elephant', 'fig', 'grape'].forEach(w => {
        const result = bf.contains(w);
        console.log(`  contains("${w}") = ${result}${result ? '  ← false positive' : ''}`);
    });

    console.log(
        `\nStats: m=${bf.size}  k=${bf.hashCount}` +
        `  setBits=${bf.setBitsCount}  estFPR=${(bf.estimatedFPR * 100).toFixed(2)}%`
    );

}

demo();

module.exports = { BloomFilter };