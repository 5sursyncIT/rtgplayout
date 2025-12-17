
const playlist = require('./models/playlist');

// Reset playlist just in case
playlist.setItems([]);
playlist.setBaseStartAt(null);

// Add items
playlist.addItem({ name: 'Item 1', durationSeconds: 10, file: 'f1' });
playlist.addItem({ name: 'Item 2', durationSeconds: 20, file: 'f2' });
playlist.addItem({ name: 'Item 3', durationSeconds: 30, file: 'f3' });

console.log('--- Initial State (Base Time = null) ---');
let scheduled = playlist.getScheduled();
console.log('Item 0 start:', scheduled.items[0].startAt); // Should be NOW
console.log('Item 1 start:', scheduled.items[1].startAt); // Should be NOW + 10s

// Simulate playing Item 1 (Index 1)
console.log('\n--- Playing Item 1 (Index 1) ---');
const index = 1;

// Logic from _updatePlaylistTiming
const rawPlaylist = playlist.getRaw();
let elapsedDuration = 0;
for (let i = 0; i < index; i++) {
    elapsedDuration += rawPlaylist.items[i].durationSeconds;
}

const now = Date.now();
const newBaseStart = new Date(now - (elapsedDuration * 1000));
playlist.setBaseStartAt(newBaseStart);

console.log(`Now: ${new Date(now).toISOString()}`);
console.log(`New Base Start: ${newBaseStart.toISOString()}`);

// Verify Schedule
scheduled = playlist.getScheduled();
const item1Start = new Date(scheduled.items[1].startAt).getTime();
const diff = Math.abs(item1Start - now);

console.log('Item 1 start:', scheduled.items[1].startAt);
console.log('Difference from NOW (ms):', diff);

if (diff < 100) {
    console.log('SUCCESS: Item 1 is anchored to NOW.');
} else {
    console.log('FAILURE: Item 1 is NOT anchored to NOW.');
}

// Check Item 2 (Next Item)
const item2Start = new Date(scheduled.items[2].startAt).getTime();
const expectedItem2Start = now + (20 * 1000); // Item 1 duration is 20s
const diff2 = Math.abs(item2Start - expectedItem2Start);

console.log('Item 2 start:', scheduled.items[2].startAt);
console.log('Expected Item 2 start:', new Date(expectedItem2Start).toISOString());
console.log('Difference (ms):', diff2);

if (diff2 < 100) {
    console.log('SUCCESS: Item 2 is scheduled correctly (NOW + 20s).');
} else {
    console.log('FAILURE: Item 2 schedule is wrong.');
}
