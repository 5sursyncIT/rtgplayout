
const playlist = require('./models/playlist');

// Helper to reset playlist
function reset() {
    playlist.setItems([]);
    playlist.setBaseStartAt(null);
}

// Helper to create item
function createItem(id, duration, hardStart = null) {
    return {
        id: `item-${id}`,
        name: `Item ${id}`,
        file: `file-${id}`,
        durationSeconds: duration,
        hardStartTime: hardStart
    };
}

// Test 1: Late (Trimming)
console.log('\n--- Test 1: Late (Trimming) ---');
reset();
// Base start: 20:00:00
const baseTime = new Date();
baseTime.setHours(20, 0, 0, 0);
playlist.setBaseStartAt(baseTime);

// Item 1: 10 mins (Ends 20:10:00)
playlist.addItem(createItem(1, 600)); 
// Item 2: Hard Start 20:05:00
playlist.addItem(createItem(2, 600, '20:05:00'));

console.log('Before Recalculate:');
let scheduled = playlist.getScheduled();
console.log(`Item 1 End: ${new Date(scheduled.items[0].endAt).toLocaleTimeString()}`);
console.log(`Item 2 Start: ${new Date(scheduled.items[1].startAt).toLocaleTimeString()} (Target: 20:05:00)`);

playlist.recalculateWithHardStart();

console.log('After Recalculate:');
scheduled = playlist.getScheduled();
console.log(`Item 1 End: ${new Date(scheduled.items[0].endAt).toLocaleTimeString()}`);
console.log(`Item 2 Start: ${new Date(scheduled.items[1].startAt).toLocaleTimeString()}`);
console.log(`Item 1 Duration: ${scheduled.items[0].durationSeconds}s (Original: 600s)`);

if (Math.abs(scheduled.items[0].durationSeconds - 300) < 1) {
    console.log('SUCCESS: Item 1 trimmed correctly.');
} else {
    console.log('FAILURE: Item 1 NOT trimmed correctly.');
}

// Test 2: Early (Recover Trim)
console.log('\n--- Test 2: Early (Recover Trim) ---');
// Now Item 1 is 300s. Item 2 starts at 20:05:00.
// Let's remove Item 1 and replace with a shorter item (200s) to create a gap?
// No, let's pretend we moved the Hard Start to 20:08:00 (3 mins later).
// Current Item 1 ends at 20:05:00 (duration 300s + 300s trim).
// If we move Hard Start to 20:08:00, we have 3 mins of "Early".
// We should recover 3 mins (180s) from the trim.

playlist.items[1].hardStartTime = '20:08:00';
playlist.recalculateWithHardStart();

scheduled = playlist.getScheduled();
console.log(`Item 1 End: ${new Date(scheduled.items[0].endAt).toLocaleTimeString()}`);
console.log(`Item 1 Duration: ${scheduled.items[0].durationSeconds}s`);
console.log(`Item 1 TrimOut: ${scheduled.items[0].trimOutSeconds}s`);

if (Math.abs(scheduled.items[0].durationSeconds - 480) < 1) { // 300 + 180 = 480
    console.log('SUCCESS: Item 1 recovered 180s.');
} else {
    console.log('FAILURE: Item 1 did not recover correctly.');
}

// Test 3: Day Wrap
console.log('\n--- Test 3: Day Wrap ---');
reset();
baseTime.setHours(23, 50, 0, 0); // 23:50
playlist.setBaseStartAt(baseTime);

// Item 1: 15 mins (Ends 00:05 tomorrow)
playlist.addItem(createItem(1, 900));
// Item 2: Hard Start 00:00 (Tomorrow)
playlist.addItem(createItem(2, 600, '00:00:00'));

console.log('Before Recalculate:');
scheduled = playlist.getScheduled();
console.log(`Item 1 End: ${new Date(scheduled.items[0].endAt).toLocaleString()}`);
console.log(`Item 2 Start: ${new Date(scheduled.items[1].startAt).toLocaleString()} (Target: 00:00:00 Tomorrow)`);

playlist.recalculateWithHardStart();

console.log('After Recalculate:');
scheduled = playlist.getScheduled();
console.log(`Item 1 End: ${new Date(scheduled.items[0].endAt).toLocaleString()}`);
console.log(`Item 1 Duration: ${scheduled.items[0].durationSeconds}s`);

// Target is 00:00:00 Tomorrow. Sched is 00:05:00 Tomorrow.
// Diff is -5 mins (Late). Should trim.
if (Math.abs(scheduled.items[0].durationSeconds - 600) < 1) { // 900 - 300 = 600 (ends at 00:00)
    console.log('SUCCESS: Day wrap handled correctly (trimmed 5 mins).');
} else {
    console.log('FAILURE: Day wrap failed.');
}
