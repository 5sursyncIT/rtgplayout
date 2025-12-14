/**
 * Autoplay Scheduler - Automatic playlist playback
 * 
 * Manages automatic playback of playlist items based on scheduled times
 * Detects end of playback and automatically plays next item
 */

class AutoplayScheduler {
    constructor(casparClient, playlist, broadcast) {
        this.casparClient = casparClient;
        this.playlist = playlist;
        this.broadcast = broadcast;

        this.mode = 'MANUAL'; // 'AUTO' or 'MANUAL'
        this.currentItemId = null;
        this.currentIndex = -1;

        this.scheduleTimer = null;
        this.statusPoller = null;

        this.SCHEDULE_CHECK_INTERVAL = 1000; // 1 second
        this.STATUS_POLL_INTERVAL = 500; // 500ms
        this.TIME_TOLERANCE = 2; // ±2 seconds

        this.CASPAR_CHANNEL = 1;
        this.CASPAR_LAYER = 10;
    }

    /**
     * Start the scheduler
     */
    start() {
        console.log('[AUTOPLAY] Scheduler started');
        this.scheduleTimer = setInterval(() => {
            this.checkSchedule();
        }, this.SCHEDULE_CHECK_INTERVAL);
    }

    /**
     * Stop the scheduler
     */
    stop() {
        console.log('[AUTOPLAY] Scheduler stopped');

        if (this.scheduleTimer) {
            clearInterval(this.scheduleTimer);
            this.scheduleTimer = null;
        }

        this.stopStatusPolling();
    }

    /**
     * Set playback mode
     */
    setMode(mode) {
        if (mode !== 'AUTO' && mode !== 'MANUAL') {
            throw new Error(`Invalid mode: ${mode}`);
        }

        this.mode = mode;
        console.log(`[AUTOPLAY] Mode set to: ${mode}`);

        if (mode === 'MANUAL') {
            this.stopStatusPolling();
        }
    }

    /**
     * Get current mode
     */
    getMode() {
        return this.mode;
    }

    /**
     * Check if any item should be played now
     */
    checkSchedule() {
        if (this.mode !== 'AUTO') return;

        const now = new Date();
        const scheduled = this.playlist.getScheduled();

        if (!scheduled || !scheduled.items || scheduled.items.length === 0) {
            return;
        }

        // Find next item to play
        for (let i = 0; i < scheduled.items.length; i++) {
            const item = scheduled.items[i];

            if (this.shouldPlay(item, now)) {
                console.log(`[AUTOPLAY] Time to play: ${item.name}`);
                this.playItem(item, i);
                break;
            }
        }
    }

    /**
     * Determine if item should be played now
     */
    shouldPlay(item, now) {
        // Already playing
        if (item.id === this.currentItemId) {
            return false;
        }

        const startTime = new Date(item.startAt);
        const diffSeconds = (now - startTime) / 1000;

        // Within tolerance window (±2 seconds)
        return diffSeconds >= -this.TIME_TOLERANCE &&
            diffSeconds <= this.TIME_TOLERANCE;
    }

    /**
     * Play an item
     */
    async playItem(item, index) {
        try {
            console.log(`[AUTOPLAY] Playing item: ${item.name} (${item.file})`);

            // Remove file extension for CasparCG
            const fileName = item.file.replace(/\.[^/.]+$/, '');

            // Send PLAY command
            await this.casparClient.play(
                this.CASPAR_CHANNEL,
                this.CASPAR_LAYER,
                fileName
            );

            this.currentItemId = item.id;
            this.currentIndex = index;

            // Broadcast status
            this.broadcast({
                type: 'PLAYBACK_STATUS',
                data: {
                    itemId: item.id,
                    status: 'playing',
                    file: item.file
                }
            });

            // Start polling for end detection
            this.startStatusPolling();

            console.log(`[AUTOPLAY] Now playing: ${item.name}`);
        } catch (error) {
            console.error('[AUTOPLAY] Play failed:', error.message);

            this.broadcast({
                type: 'ERROR',
                data: { message: `Autoplay failed: ${error.message}` }
            });
        }
    }

    /**
     * Play next item in playlist
     */
    async playNext() {
        const scheduled = this.playlist.getScheduled();

        if (!scheduled || !scheduled.items) {
            console.log('[AUTOPLAY] No playlist available');
            return;
        }

        const nextIndex = this.currentIndex + 1;

        if (nextIndex >= scheduled.items.length) {
            console.log('[AUTOPLAY] End of playlist reached');
            this.currentItemId = null;
            this.currentIndex = -1;
            this.stopStatusPolling();

            this.broadcast({
                type: 'PLAYBACK_STATUS',
                data: {
                    itemId: null,
                    status: 'stopped'
                }
            });

            return;
        }

        const nextItem = scheduled.items[nextIndex];
        console.log(`[AUTOPLAY] Playing next: ${nextItem.name}`);

        await this.playItem(nextItem, nextIndex);
    }

    /**
     * Stop current playback
     */
    async stopPlayback() {
        try {
            await this.casparClient.stop(this.CASPAR_CHANNEL, this.CASPAR_LAYER);

            this.currentItemId = null;
            this.currentIndex = -1;
            this.stopStatusPolling();

            console.log('[AUTOPLAY] Playback stopped');
        } catch (error) {
            console.error('[AUTOPLAY] Stop failed:', error.message);
        }
    }

    /**
     * Start polling CasparCG for playback status
     */
    startStatusPolling() {
        this.stopStatusPolling();

        this.statusPoller = setInterval(async () => {
            await this.checkPlaybackStatus();
        }, this.STATUS_POLL_INTERVAL);

        console.log('[AUTOPLAY] Status polling started');
    }

    /**
     * Stop status polling
     */
    stopStatusPolling() {
        if (this.statusPoller) {
            clearInterval(this.statusPoller);
            this.statusPoller = null;
            console.log('[AUTOPLAY] Status polling stopped');
        }
    }

    /**
     * Check playback status via CasparCG INFO
     */
    async checkPlaybackStatus() {
        try {
            const response = await this.casparClient.info(this.CASPAR_CHANNEL);

            if (this.isFinished(response)) {
                console.log('[AUTOPLAY] Video finished, playing next');
                await this.playNext();
            }
        } catch (error) {
            console.error('[AUTOPLAY] Status check failed:', error.message);
        }
    }

    /**
     * Determine if playback is finished based on INFO response
     */
    isFinished(infoResponse) {
        // CasparCG INFO returns XML
        // When foreground is empty, playback is finished

        // Check for empty foreground
        if (infoResponse.includes('<foreground></foreground>')) {
            return true;
        }

        // Check if no file is playing
        if (!infoResponse.includes('<file>')) {
            return true;
        }

        // Check for paused state at end
        if (infoResponse.includes('<paused>true</paused>')) {
            // Additional check: if time equals duration
            const timeMatch = infoResponse.match(/<time>([^<]+)<\/time>/);
            const durationMatch = infoResponse.match(/<duration>([^<]+)<\/duration>/);

            if (timeMatch && durationMatch) {
                const time = parseFloat(timeMatch[1]);
                const duration = parseFloat(durationMatch[1]);

                // If within 1 frame of end
                if (Math.abs(time - duration) < 0.05) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Get current item
     */
    getCurrentItem() {
        if (this.currentIndex < 0) return null;

        const scheduled = this.playlist.getScheduled();
        if (!scheduled || !scheduled.items) return null;

        return scheduled.items[this.currentIndex];
    }

    /**
     * Get next item
     */
    getNextItem() {
        const scheduled = this.playlist.getScheduled();
        if (!scheduled || !scheduled.items) return null;

        const nextIndex = this.currentIndex + 1;
        if (nextIndex >= scheduled.items.length) return null;

        return scheduled.items[nextIndex];
    }

    /**
     * Get scheduler status
     */
    getStatus() {
        const currentItem = this.getCurrentItem();
        const nextItem = this.getNextItem();

        return {
            mode: this.mode,
            currentItem: currentItem ? {
                id: currentItem.id,
                name: currentItem.name,
                file: currentItem.file,
                status: 'PLAYING'
            } : null,
            nextItem: nextItem ? {
                id: nextItem.id,
                name: nextItem.name,
                file: nextItem.file,
                startAt: nextItem.startAt
            } : null
        };
    }
}

module.exports = AutoplayScheduler;
