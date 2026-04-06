'use strict';

const MAX_VISUAL_BITS = 4096;
const BASE_STEP_DELAY_MS = 250;
const BASE_STEP_RESULT_HOLD_MS = 170;
const GUIDE_STORAGE_KEY = 'bloom_visualizer_guide_seen_v1';

class BloomFilter {
    constructor(numBits, numHashFunctions) {
        if (!Number.isInteger(numBits) || numBits < 1) {
            throw new RangeError('numBits must be an integer >= 1');
        }
        if (!Number.isInteger(numHashFunctions) || numHashFunctions < 1) {
            throw new RangeError('numHashFunctions must be an integer >= 1');
        }

        this._m = numBits;
        this._k = numHashFunctions;
        this._bits = new Uint8Array(Math.ceil(numBits / 8));
    }

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

    static hash32(value, seed) {
        let hash = (2166136261 ^ seed) >>> 0;
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }

        hash ^= hash >>> 16;
        hash = Math.imul(hash, 2246822519);
        hash ^= hash >>> 13;
        hash = Math.imul(hash, 3266489917);
        hash ^= hash >>> 16;
        return hash >>> 0;
    }

    get size() {
        return this._m;
    }

    get hashCount() {
        return this._k;
    }

    get byteSize() {
        return this._bits.length;
    }

    get setBitsCount() {
        let count = 0;
        for (const byte of this._bits) {
            let b = byte;
            while (b) {
                count += b & 1;
                b >>>= 1;
            }
        }
        return count;
    }

    get fillRatio() {
        return this.setBitsCount / this._m;
    }

    get estimatedFPR() {
        return Math.pow(this.fillRatio, this._k);
    }

    reset() {
        this._bits.fill(0);
    }

    _positionsWithDetails(key) {
        const keyStr = String(key);
        const h1 = BloomFilter.hash32(keyStr, 0x9747b28c);
        const h2 = this._k > 1 ? BloomFilter.hash32(keyStr, 0x5bd1e995) : 0;
        const seen = new Set();
        const steps = [];

        for (let i = 0; i < this._k; i++) {
            const combined = (h1 + Math.imul(i, h2)) >>> 0;
            const pos = combined % this._m;
            const duplicate = seen.has(pos);
            seen.add(pos);
            steps.push({ i, combined, pos, duplicate });
        }

        return {
            h1,
            h2,
            steps,
            uniquePositions: [...seen]
        };
    }

    _setBit(pos) {
        const byteIndex = pos >>> 3;
        const bitIndex = pos & 7;
        this._bits[byteIndex] |= (1 << bitIndex);
    }

    _testBit(pos) {
        const byteIndex = pos >>> 3;
        const bitIndex = pos & 7;
        return (this._bits[byteIndex] & (1 << bitIndex)) !== 0;
    }
}

const dom = {
    expectedItemsInput: document.getElementById('expectedItemsInput'),
    fprInput: document.getElementById('fprInput'),
    keyInput: document.getElementById('keyInput'),
    createFilterBtn: document.getElementById('createFilterBtn'),
    guidedDemoBtn: document.getElementById('guidedDemoBtn'),
    insertBtn: document.getElementById('insertBtn'),
    containsBtn: document.getElementById('containsBtn'),
    resetBtn: document.getElementById('resetBtn'),
    statusLine: document.getElementById('statusLine'),
    bitGrid: document.getElementById('bitGrid'),
    insertedKeysList: document.getElementById('insertedKeysList'),
    metricExpected: document.getElementById('metricExpected'),
    metricFprTarget: document.getElementById('metricFprTarget'),
    metricBits: document.getElementById('metricBits'),
    metricHashes: document.getElementById('metricHashes'),
    metricBytes: document.getElementById('metricBytes'),
    metricSetBits: document.getElementById('metricSetBits'),
    metricFill: document.getElementById('metricFill'),
    metricFprEst: document.getElementById('metricFprEst'),
    metricInserted: document.getElementById('metricInserted'),
    opModeBadge: document.getElementById('opModeBadge'),
    opKeyLabel: document.getElementById('opKeyLabel'),
    opH1: document.getElementById('opH1'),
    opH2: document.getElementById('opH2'),
    opEquation: document.getElementById('opEquation'),
    opCurrentI: document.getElementById('opCurrentI'),
    opPosition: document.getElementById('opPosition'),
    opByteBit: document.getElementById('opByteBit'),
    opBitFlip: document.getElementById('opBitFlip'),
    hashTrack: document.getElementById('hashTrack'),
    nextHint: document.getElementById('nextHint'),
    demoCoach: document.getElementById('demoCoach'),
    demoCoachText: document.getElementById('demoCoachText'),
    demoProgressBar: document.getElementById('demoProgressBar'),
    demoProgressTrack: document.querySelector('.demo-progress'),
    openGuideBtn: document.getElementById('openGuideBtn'),
    tourOverlay: document.getElementById('tourOverlay'),
    tourCard: document.getElementById('tourCard'),
    tourStepCount: document.getElementById('tourStepCount'),
    tourTitle: document.getElementById('tourTitle'),
    tourDescription: document.getElementById('tourDescription'),
    tourPrevBtn: document.getElementById('tourPrevBtn'),
    tourNextBtn: document.getElementById('tourNextBtn'),
    tourSkipBtn: document.getElementById('tourSkipBtn')
};

const state = {
    bloom: null,
    bitCells: [],
    expectedElements: null,
    targetFpr: null,
    insertedKeyEvents: [],
    insertedKeySet: new Set(),
    animationScale: 1,
    isGuidedDemoRunning: false,
    tourActive: false,
    tourIndex: 0,
    busy: false
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getStepDelay() {
    return Math.round(BASE_STEP_DELAY_MS * state.animationScale);
}

function getStepResultHoldDelay() {
    return Math.round(BASE_STEP_RESULT_HOLD_MS * state.animationScale);
}

function setStatus(message, tone = 'neutral') {
    const tones = ['is-neutral', 'is-info', 'is-success', 'is-warning', 'is-error'];
    dom.statusLine.classList.remove(...tones);

    const toneClassMap = {
        neutral: 'is-neutral',
        info: 'is-info',
        success: 'is-success',
        warning: 'is-warning',
        error: 'is-error'
    };

    dom.statusLine.classList.add(toneClassMap[tone] || 'is-neutral');
    dom.statusLine.textContent = message;
}

function setHint(message) {
    dom.nextHint.textContent = message;
}

function setCoach(message) {
    dom.demoCoachText.textContent = message;
}

function setCoachProgress(percent) {
    const safe = Math.max(0, Math.min(100, percent));
    dom.demoProgressBar.style.width = `${safe}%`;
    dom.demoProgressTrack.setAttribute('aria-valuenow', String(Math.round(safe)));
}

function getGuideSteps() {
    return [
        {
            selector: '.hero',
            title: 'Welcome To The Visualizer',
            description: 'This page teaches Bloom filters visually. You will see hash math, bit flips, and false-positive behavior in real time.'
        },
        {
            selector: '#guideConfig',
            title: 'Step 1: Configure Filter',
            description: 'Choose expected items (n) and target false-positive rate (p). The system computes the bit-array size m and hash count k.'
        },
        {
            selector: '#createFilterBtn',
            title: 'Create The Filter',
            description: 'Click Create Filter after changing n or p. This resets the grid and builds a new Bloom filter with fresh metrics.'
        },
        {
            selector: '#guideInteract',
            title: 'Step 2: Insert And Check Keys',
            description: 'Insert sets bits for the key. Contains probes the same bit positions and can return probably present or definitely absent.'
        },
        {
            selector: '#guideOperation',
            title: 'Operation Walkthrough Panel',
            description: 'This panel shows h1/h2 values, equation updates for each i, selected bit position, and byte/bit mapping details.'
        },
        {
            selector: '#guideBitGrid',
            title: 'Bit Grid Visualization',
            description: 'Each box is one bit. During insert, 0 can flip to 1. During contains, highlighted bits show hits or misses.'
        },
        {
            selector: '#guideMetrics',
            title: 'Live Metrics',
            description: 'Track m, k, set bits, fill ratio, and estimated false-positive rate while operations run.'
        },
        {
            selector: '#guideLedger',
            title: 'Inserted Key Ledger',
            description: 'This list records unique keys inserted in this session. Duplicate inserts update bits but do not duplicate the ledger.'
        },
        {
            selector: '#guidedDemoBtn',
            title: 'Narrated Guided Demo',
            description: 'Run Guided Demo for a slower coach mode that explains each step before and after every insert and contains operation.'
        }
    ];
}

function clearTourFocus() {
    const highlighted = document.querySelectorAll('.tour-focus');
    highlighted.forEach(node => node.classList.remove('tour-focus'));
}

function focusTourTarget(selector) {
    const target = document.querySelector(selector);
    if (!target) return null;

    target.classList.add('tour-focus');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return target;
}

function renderTourStep() {
    const steps = getGuideSteps();
    const index = state.tourIndex;
    const step = steps[index];
    if (!step) return;

    clearTourFocus();
    focusTourTarget(step.selector);

    dom.tourStepCount.textContent = `Step ${index + 1} of ${steps.length}`;
    dom.tourTitle.textContent = step.title;
    dom.tourDescription.textContent = step.description;

    dom.tourPrevBtn.disabled = index === 0;
    dom.tourNextBtn.textContent = index === steps.length - 1 ? 'Finish' : 'Next';
}

function closeGuideTour(markSeen) {
    state.tourActive = false;
    dom.tourOverlay.classList.add('is-hidden');
    dom.tourOverlay.setAttribute('aria-hidden', 'true');
    clearTourFocus();

    if (markSeen) {
        try {
            localStorage.setItem(GUIDE_STORAGE_KEY, '1');
        } catch (error) {
            // Ignore storage failures and continue.
        }
    }
}

function openGuideTour() {
    if (state.busy) return;

    state.tourActive = true;
    state.tourIndex = 0;
    dom.tourOverlay.classList.remove('is-hidden');
    dom.tourOverlay.setAttribute('aria-hidden', 'false');
    renderTourStep();
}

function goToNextTourStep() {
    const steps = getGuideSteps();
    if (state.tourIndex >= steps.length - 1) {
        closeGuideTour(true);
        return;
    }

    state.tourIndex += 1;
    renderTourStep();
}

function goToPrevTourStep() {
    if (state.tourIndex === 0) return;
    state.tourIndex -= 1;
    renderTourStep();
}

function formatPercent(value) {
    return `${(value * 100).toFixed(3)}%`;
}

function setMode(mode, key) {
    dom.opModeBadge.classList.remove('is-idle', 'is-insert', 'is-contains');

    if (mode === 'insert') {
        dom.opModeBadge.classList.add('is-insert');
        dom.opModeBadge.textContent = 'Insert Flow';
    } else if (mode === 'contains') {
        dom.opModeBadge.classList.add('is-contains');
        dom.opModeBadge.textContent = 'Contains Flow';
    } else {
        dom.opModeBadge.classList.add('is-idle');
        dom.opModeBadge.textContent = 'Idle';
    }

    dom.opKeyLabel.textContent = `Key: ${key || '-'}`;
}

function resetOperationDetails() {
    dom.opH1.textContent = 'h1: -';
    dom.opH2.textContent = 'h2: -';
    dom.opEquation.textContent = 'pos_i = (h1 + i * h2) % m';
    dom.opCurrentI.textContent = 'i: -';
    dom.opPosition.textContent = 'position: -';
    dom.opByteBit.textContent = 'byte: -, bit: -';
    dom.opBitFlip.textContent = 'bit state: -';
    dom.hashTrack.innerHTML = '';
}

function renderHashTrack(details) {
    dom.hashTrack.innerHTML = '';

    for (const step of details.steps) {
        const row = document.createElement('div');
        row.className = 'hash-step-row is-pending';
        row.dataset.index = String(step.i);

        const indexEl = document.createElement('span');
        indexEl.className = 'hash-i';
        indexEl.textContent = `i=${step.i}`;

        const formulaEl = document.createElement('span');
        formulaEl.className = 'hash-formula';
        formulaEl.textContent = `(${details.h1} + ${step.i}*${details.h2}) % ${state.bloom.size} = ${step.pos}`;

        const statusEl = document.createElement('span');
        statusEl.className = 'hash-status';
        statusEl.textContent = 'pending';

        row.appendChild(indexEl);
        row.appendChild(formulaEl);
        row.appendChild(statusEl);
        dom.hashTrack.appendChild(row);
    }
}

function setHashTrackState(index, className, statusText) {
    const row = dom.hashTrack.querySelector(`[data-index="${index}"]`);
    if (!row) return;

    row.classList.remove('is-pending', 'is-active', 'is-set', 'is-hit', 'is-miss', 'is-skipped');
    row.classList.add(className);

    const statusEl = row.querySelector('.hash-status');
    if (statusEl) {
        statusEl.textContent = statusText;
    }
}

function markRemainingSkipped(fromIndex) {
    for (let i = fromIndex; i < state.bloom.hashCount; i++) {
        setHashTrackState(i, 'is-skipped', 'skipped');
    }
}

function updateOperationDetails(details, step, bitBefore, bitAfter, mode) {
    const byteIndex = step.pos >>> 3;
    const bitIndex = step.pos & 7;

    dom.opH1.textContent = `h1: ${details.h1}`;
    dom.opH2.textContent = `h2: ${details.h2}`;
    dom.opEquation.textContent = `combined = (h1 + ${step.i} * h2) >>> 0 = ${step.combined}`;
    dom.opCurrentI.textContent = `i: ${step.i}`;
    dom.opPosition.textContent = `position: ${step.pos}`;
    dom.opByteBit.textContent = `byte: ${byteIndex}, bit: ${bitIndex}`;

    if (mode === 'insert') {
        dom.opBitFlip.textContent = `bit state: ${bitBefore ? '1 -> 1 (already set)' : '0 -> 1 (flipped)'}`;
    } else {
        dom.opBitFlip.textContent = `bit state: ${bitBefore ? '1 (hit)' : '0 (miss)'} -> ${bitAfter ? '1' : '0'}`;
    }
}

function createBitCell(index) {
    const cell = document.createElement('div');
    cell.className = 'bit-cell';
    cell.title = `bit[${index}]`;
    cell.dataset.index = String(index);

    const valueEl = document.createElement('span');
    valueEl.className = 'bit-value';
    valueEl.textContent = '0';

    const indexEl = document.createElement('span');
    indexEl.className = 'bit-index';
    indexEl.textContent = String(index);

    cell.appendChild(valueEl);
    cell.appendChild(indexEl);
    return cell;
}

function clearTransientCellClasses() {
    for (const cell of state.bitCells) {
        cell.classList.remove('is-probe', 'is-hit', 'is-miss');
    }
}

function syncCellState(index) {
    const cell = state.bitCells[index];
    if (!cell || !state.bloom) return;

    const bitOn = state.bloom._testBit(index);
    const valueEl = cell.querySelector('.bit-value');

    if (bitOn) {
        cell.classList.add('is-on');
        if (valueEl) valueEl.textContent = '1';
    } else {
        cell.classList.remove('is-on');
        if (valueEl) valueEl.textContent = '0';
    }
}

function refreshInsertedLedger() {
    dom.insertedKeysList.innerHTML = '';

    if (state.insertedKeyEvents.length === 0) {
        const item = document.createElement('li');
        item.className = 'is-empty';
        item.textContent = 'No keys inserted yet.';
        dom.insertedKeysList.appendChild(item);
        return;
    }

    state.insertedKeyEvents.forEach(entry => {
        const item = document.createElement('li');
        item.textContent = `${entry.key} @ ${entry.time}`;
        dom.insertedKeysList.appendChild(item);
    });
}

function updateMetrics() {
    if (!state.bloom) {
        dom.metricExpected.textContent = '-';
        dom.metricFprTarget.textContent = '-';
        dom.metricBits.textContent = '-';
        dom.metricHashes.textContent = '-';
        dom.metricBytes.textContent = '-';
        dom.metricSetBits.textContent = '-';
        dom.metricFill.textContent = '-';
        dom.metricFprEst.textContent = '-';
        dom.metricInserted.textContent = '0';
        return;
    }

    dom.metricExpected.textContent = String(state.expectedElements);
    dom.metricFprTarget.textContent = formatPercent(state.targetFpr);
    dom.metricBits.textContent = String(state.bloom.size);
    dom.metricHashes.textContent = String(state.bloom.hashCount);
    dom.metricBytes.textContent = String(state.bloom.byteSize);
    dom.metricSetBits.textContent = String(state.bloom.setBitsCount);
    dom.metricFill.textContent = formatPercent(state.bloom.fillRatio);
    dom.metricFprEst.textContent = formatPercent(state.bloom.estimatedFPR);
    dom.metricInserted.textContent = String(state.insertedKeyEvents.length);
}

function setBusy(nextBusy) {
    state.busy = nextBusy;
    dom.createFilterBtn.disabled = nextBusy;
    dom.guidedDemoBtn.disabled = nextBusy;
    dom.insertBtn.disabled = nextBusy;
    dom.containsBtn.disabled = nextBusy;
    dom.resetBtn.disabled = nextBusy;
}

function assertFilterReady() {
    if (!state.bloom) {
        setStatus('Create a filter first.', 'warning');
        setHint('Next: choose n and p, then click Create Filter.');
        return false;
    }
    return true;
}

function parseKeyInput() {
    const key = dom.keyInput.value.trim();
    if (!key) {
        setStatus('Enter a non-empty key.', 'warning');
        setHint('Next: type a key like user:42 and click Insert Key.');
        return null;
    }
    return key;
}

function buildBitGrid() {
    dom.bitGrid.innerHTML = '';
    state.bitCells = [];

    if (!state.bloom) return;

    const m = state.bloom.size;
    const minCellSize = m <= 256 ? 34 : m <= 1024 ? 28 : 22;
    dom.bitGrid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${minCellSize}px, 1fr))`;

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < m; i++) {
        const cell = createBitCell(i);
        fragment.appendChild(cell);
        state.bitCells.push(cell);
    }

    dom.bitGrid.appendChild(fragment);
}

function createFilter() {
    const expectedItems = Number.parseInt(dom.expectedItemsInput.value, 10);
    const fpr = Number.parseFloat(dom.fprInput.value);

    if (!Number.isInteger(expectedItems) || expectedItems < 1) {
        setStatus('Expected items must be an integer >= 1.', 'error');
        setHint('Fix n and create the filter again.');
        return;
    }

    if (!Number.isFinite(fpr) || fpr <= 0 || fpr >= 1) {
        setStatus('False positive rate must be in (0, 1).', 'error');
        setHint('Set p like 0.01 (1%) and create the filter.');
        return;
    }

    const params = BloomFilter.optimalParams(expectedItems, fpr);
    if (params.numBits > MAX_VISUAL_BITS) {
        setStatus(`m=${params.numBits} is too large for smooth animation.`, 'warning');
        setHint(`Try smaller n or a larger p. Max visual bits: ${MAX_VISUAL_BITS}.`);
        return;
    }

    state.bloom = new BloomFilter(params.numBits, params.numHashFunctions);
    state.expectedElements = expectedItems;
    state.targetFpr = fpr;
    state.insertedKeyEvents = [];
    state.insertedKeySet.clear();

    setMode('idle', null);
    resetOperationDetails();
    buildBitGrid();
    updateMetrics();
    refreshInsertedLedger();
    setCoach('Filter created. Start with Insert Key to see hash mapping step by step.');
    setCoachProgress(0);

    setStatus(`Filter ready (m=${params.numBits}, k=${params.numHashFunctions}).`, 'success');
    setHint('Next: insert a key and watch each hash map to its bit position.');
}

async function animateInsert(key) {
    if (!assertFilterReady() || state.busy) return;

    const details = state.bloom._positionsWithDetails(key);
    const wasAlreadyInserted = state.insertedKeySet.has(key);
    setBusy(true);
    clearTransientCellClasses();
    setMode('insert', key);
    renderHashTrack(details);

    dom.opH1.textContent = `h1: ${details.h1}`;
    dom.opH2.textContent = `h2: ${details.h2}`;
    if (!state.isGuidedDemoRunning) {
        setCoach(`Insert mode: computing ${state.bloom.hashCount} probe positions for "${key}" and setting them to 1.`);
    }

    setStatus(`Insert started for "${key}".`, 'info');
    setHint('Watch each i step: formula -> position -> byte/bit -> set to 1.');

    for (const step of details.steps) {
        const cell = state.bitCells[step.pos];
        const bitBefore = state.bloom._testBit(step.pos);

        setHashTrackState(step.i, 'is-active', 'probing');
        updateOperationDetails(details, step, bitBefore, true, 'insert');

        cell.classList.add('is-probe');
        await sleep(getStepDelay());

        state.bloom._setBit(step.pos);
        const bitAfter = state.bloom._testBit(step.pos);
        syncCellState(step.pos);

        cell.classList.remove('is-probe');
        cell.classList.add('is-hit');

        updateOperationDetails(details, step, bitBefore, bitAfter, 'insert');
        setHashTrackState(
            step.i,
            'is-set',
            bitBefore ? 'already 1' : 'set 1'
        );

        await sleep(getStepResultHoldDelay());
        cell.classList.remove('is-hit');
    }

    state.insertedKeySet.add(key);
    if (!wasAlreadyInserted) {
        state.insertedKeyEvents.push({ key, time: new Date().toLocaleTimeString() });
    }

    if (state.insertedKeyEvents.length > 160) {
        state.insertedKeyEvents = state.insertedKeyEvents.slice(-160);
    }

    updateMetrics();
    refreshInsertedLedger();

    if (wasAlreadyInserted) {
        setStatus(`Insert complete for "${key}" (already inserted earlier).`, 'warning');
        setHint('This duplicate key was not added again in the inserted-keys list.');
        if (!state.isGuidedDemoRunning) {
            setCoach('Duplicate insert completed. Bloom bits were re-probed, but unique key ledger stayed unchanged.');
        }
    } else {
        setStatus(`Insert complete for "${key}".`, 'success');
        setHint('Next: run Contains? on an inserted key and then on a new key.');
        if (!state.isGuidedDemoRunning) {
            setCoach('Insert completed. Now use Contains? to check how Bloom membership works.');
        }
    }

    setBusy(false);
}

async function animateContains(key) {
    if (!assertFilterReady() || state.busy) return;

    const details = state.bloom._positionsWithDetails(key);
    setBusy(true);
    clearTransientCellClasses();
    setMode('contains', key);
    renderHashTrack(details);

    dom.opH1.textContent = `h1: ${details.h1}`;
    dom.opH2.textContent = `h2: ${details.h2}`;
    if (!state.isGuidedDemoRunning) {
        setCoach(`Contains mode: probing ${state.bloom.hashCount} positions for "${key}".`);
    }

    setStatus(`Contains check started for "${key}".`, 'info');
    setHint('Any probed bit = 0 means definitely absent.');

    let probablyPresent = true;

    for (const step of details.steps) {
        const cell = state.bitCells[step.pos];
        const bitBefore = state.bloom._testBit(step.pos);

        setHashTrackState(step.i, 'is-active', 'probing');
        updateOperationDetails(details, step, bitBefore, bitBefore, 'contains');

        cell.classList.add('is-probe');
        await sleep(getStepDelay());

        const bitSet = state.bloom._testBit(step.pos);
        cell.classList.remove('is-probe');
        cell.classList.add(bitSet ? 'is-hit' : 'is-miss');

        updateOperationDetails(details, step, bitSet, bitSet, 'contains');
        setHashTrackState(step.i, bitSet ? 'is-hit' : 'is-miss', bitSet ? 'hit' : 'miss');

        await sleep(getStepResultHoldDelay());
        cell.classList.remove('is-hit', 'is-miss');

        if (!bitSet) {
            probablyPresent = false;
            markRemainingSkipped(step.i + 1);
            break;
        }
    }

    updateMetrics();

    if (!probablyPresent) {
        setStatus(`Result: "${key}" is definitely absent.`, 'info');
        setHint('Contains stopped early because one required bit was 0.');
        if (!state.isGuidedDemoRunning) {
            setCoach('Contains returned definitely absent because at least one required bit was 0.');
        }
    } else if (state.insertedKeySet.has(key)) {
        setStatus(`Result: "${key}" is probably present (known inserted key).`, 'success');
        setHint('All required bits were 1, so the key is likely present.');
        if (!state.isGuidedDemoRunning) {
            setCoach('Contains returned probably present. For inserted keys this is expected unless there is a bug.');
        }
    } else {
        setStatus(`Result: "${key}" is probably present (possible false positive).`, 'warning');
        setHint('All required bits were 1, but key was not inserted in this session.');
        if (!state.isGuidedDemoRunning) {
            setCoach('Contains returned probably present for a non-inserted key. This illustrates a possible false positive.');
        }
    }

    setBusy(false);
}

function resetFilter() {
    if (!assertFilterReady() || state.busy) return;

    state.bloom.reset();
    state.insertedKeyEvents = [];
    state.insertedKeySet.clear();

    clearTransientCellClasses();
    for (let i = 0; i < state.bitCells.length; i++) {
        syncCellState(i);
    }

    setMode('idle', null);
    resetOperationDetails();
    updateMetrics();
    refreshInsertedLedger();
    setCoach('Filter reset complete. Start again with Insert Key.');
    setCoachProgress(0);

    setStatus('Filter reset complete.', 'neutral');
    setHint('Next: insert a key to start the visual walkthrough again.');
}

async function runGuidedDemo() {
    if (state.busy) return;

    if (!state.bloom) {
        dom.expectedItemsInput.value = '80';
        dom.fprInput.value = '0.04';
        createFilter();
    }

    if (!state.bloom || state.busy) return;

    const guidedSteps = [
        {
            type: 'insert',
            key: 'apple',
            before: 'Step 1: Insert "apple". Watch how k hash probes pick exact bit indices.',
            after: 'Apple inserted. Some bits turned from 0 to 1.'
        },
        {
            type: 'insert',
            key: 'banana',
            before: 'Step 2: Insert "banana". Notice how some positions may overlap existing 1 bits.',
            after: 'Banana inserted. Overlaps are normal and save memory.'
        },
        {
            type: 'contains',
            key: 'banana',
            before: 'Step 3: Check contains("banana"). All required bits should be 1.',
            after: 'Contains for banana is probably present, as expected for inserted keys.'
        },
        {
            type: 'contains',
            key: 'orange',
            before: 'Step 4: Check contains("orange") for a non-inserted key. A 0 bit causes immediate definite absence.',
            after: 'Contains for orange completed. If any probed bit was 0, result is definitely absent.'
        },
        {
            type: 'insert',
            key: 'apple',
            before: 'Step 5: Insert "apple" again to see duplicate behavior. Ledger should not duplicate this key.',
            after: 'Duplicate insert handled. Unique-key ledger remains unchanged.'
        }
    ];

    const previousAnimationScale = state.animationScale;
    state.animationScale = 3.2;
    state.isGuidedDemoRunning = true;

    setStatus('Guided demo running in coach mode.', 'info');
    setHint('Follow the coach panel. Each step pauses so you can observe the transitions.');
    setCoach('Guided demo started. We will move step by step through insert and contains behavior.');
    setCoachProgress(0);

    try {
        for (let index = 0; index < guidedSteps.length; index++) {
            const step = guidedSteps[index];
            const progressBefore = (index / guidedSteps.length) * 100;
            const progressAfter = ((index + 1) / guidedSteps.length) * 100;

            dom.keyInput.value = step.key;
            setCoach(step.before);
            setCoachProgress(progressBefore);
            await sleep(1200);

            if (step.type === 'insert') {
                await animateInsert(step.key);
            } else {
                await animateContains(step.key);
            }

            setCoach(step.after);
            setCoachProgress(progressAfter);
            await sleep(1150);
        }

        setStatus('Guided demo finished.', 'success');
        setHint('Now try your own keys and compare behaviors at your own pace.');
        setCoach('Guided demo complete. You can replay the demo or manually test new keys.');
        setCoachProgress(100);
    } finally {
        state.animationScale = previousAnimationScale;
        state.isGuidedDemoRunning = false;
    }
}

function bindEvents() {
    dom.createFilterBtn.addEventListener('click', createFilter);
    dom.guidedDemoBtn.addEventListener('click', runGuidedDemo);
    dom.openGuideBtn.addEventListener('click', () => {
        openGuideTour();
    });

    dom.tourNextBtn.addEventListener('click', goToNextTourStep);
    dom.tourPrevBtn.addEventListener('click', goToPrevTourStep);
    dom.tourSkipBtn.addEventListener('click', () => {
        closeGuideTour(true);
    });

    dom.tourOverlay.addEventListener('click', event => {
        if (event.target === dom.tourOverlay || event.target.classList.contains('tour-backdrop')) {
            closeGuideTour(true);
        }
    });

    dom.insertBtn.addEventListener('click', async () => {
        const key = parseKeyInput();
        if (!key) return;
        await animateInsert(key);
    });

    dom.containsBtn.addEventListener('click', async () => {
        const key = parseKeyInput();
        if (!key) return;
        await animateContains(key);
    });

    dom.resetBtn.addEventListener('click', resetFilter);

    dom.keyInput.addEventListener('keydown', async event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            const key = parseKeyInput();
            if (!key) return;
            await animateInsert(key);
        }
    });

    document.addEventListener('keydown', event => {
        if (!state.tourActive) return;

        if (event.key === 'Escape') {
            closeGuideTour(true);
        } else if (event.key === 'ArrowRight') {
            goToNextTourStep();
        } else if (event.key === 'ArrowLeft') {
            goToPrevTourStep();
        }
    });
}

function shouldRunFirstTimeGuide() {
    try {
        return localStorage.getItem(GUIDE_STORAGE_KEY) !== '1';
    } catch (error) {
        return true;
    }
}

function initialize() {
    bindEvents();
    updateMetrics();
    refreshInsertedLedger();
    createFilter();

    if (shouldRunFirstTimeGuide()) {
        window.setTimeout(() => {
            openGuideTour();
        }, 500);
    }
}

initialize();
