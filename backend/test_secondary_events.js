const playlist = require('./models/playlist');
const AutoplayScheduler = require('./scheduler/autoplayScheduler');

// Mock CasparClient
const mockCasparClient = {
    cgAdd: async (channel, layer, flashLayer, template, play, data) => {
        console.log(`[MOCK] CG ADD: Ch=${channel}, L=${layer}, Tpl=${template}, Data=${data}`);
    },
    cgStop: async (channel, layer, flashLayer) => {
        console.log(`[MOCK] CG STOP: Ch=${channel}, L=${layer}`);
    },
    cgClear: async (channel, layer) => {
        console.log(`[MOCK] CG CLEAR: Ch=${channel}, L=${layer}`);
    }
};

// Initialize scheduler
const scheduler = new AutoplayScheduler(mockCasparClient, playlist, (msg) => console.log('[BROADCAST]', msg.type));

// 1. Create a dummy item with secondary events
const item = {
    id: 'test-item-1',
    name: 'Test Item with Events',
    file: 'test.mp4',
    durationSeconds: 30,
    secondaryEvents: [
        {
            id: 'evt-1',
            type: 'CG_ADD',
            trigger: 'START',
            offsetMs: 2000, // 2 seconds after start
            template: 'lower-third',
            data: { text: 'Hello World' },
            layer: 20
        },
        {
            id: 'evt-2',
            type: 'CG_STOP',
            trigger: 'END',
            offsetMs: 5000, // 5 seconds before end (at 25s)
            layer: 20
        }
    ]
};

console.log('--- Testing Secondary Events ---');

// 2. Simulate Playback Timeline
const startAt = new Date();
item.startAt = startAt.toISOString();

console.log(`Item Start Time: ${startAt.toISOString()}`);

// Test at T+1s (Should NOT trigger)
console.log('\n[T+1s] Checking events...');
scheduler.checkSecondaryEvents(item, new Date(startAt.getTime() + 1000));

// Test at T+2.1s (Should trigger START event)
console.log('\n[T+2.1s] Checking events...');
scheduler.checkSecondaryEvents(item, new Date(startAt.getTime() + 2100));

// Test at T+2.2s (Should NOT trigger again - already executed)
console.log('\n[T+2.2s] Checking events (idempotency check)...');
scheduler.checkSecondaryEvents(item, new Date(startAt.getTime() + 2200));

// Test at T+25.1s (Should trigger END event: 30s - 5s = 25s)
console.log('\n[T+25.1s] Checking events (END trigger)...');
scheduler.checkSecondaryEvents(item, new Date(startAt.getTime() + 25100));

console.log('\n--- Test Complete ---');
