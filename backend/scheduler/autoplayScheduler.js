/**
 * Autoplay Scheduler - Automatic playlist playback
 *
 * Manages automatic playback of playlist items based on scheduled times
 * Detects end of playback and automatically plays next item
 */

console.log('[AUTOPLAY] *** MODULE LOADED - Version with dual <time> tag parsing and <5s protection ***');

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

        this.lastPlayTime = 0;
        this.lastLogTime = 0;

        // Playback failure detection
        this.playbackTimeout = null;
        this.PLAYBACK_TIMEOUT_MS = 10000; // 10 seconds
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
            throw new Error();
        }

        const previousMode = this.mode;
        this.mode = mode;
        console.log();

        if (mode === 'MANUAL') {
            this.stopStatusPolling();
        } else if (mode === 'AUTO') {
            // Check schedule immediately when activating AUTO mode
            console.log('[AUTOPLAY] AUTO mode activated, checking schedule immediately...');
            this.checkSchedule();
        }
    }

    /**
     * Get current mode
     */
    getMode() {
        return this.mode;
    }

    /**
     * Sync scheduler state with manual playback
     */
    syncState(itemId) {
        const scheduled = this.playlist.getScheduled();
        if (!scheduled || !scheduled.items) return;

        const index = scheduled.items.findIndex(item => item.id === itemId);

        if (index !== -1) {
            this.currentItemId = itemId;
            this.currentIndex = index;

            // Update playlist timing to anchor this item to NOW
            this._updatePlaylistTiming(index);

            // If in AUTO mode, ensure polling is active
            if (this.mode === 'AUTO') {
                this.startStatusPolling();
            }

            console.log(`[AUTOPLAY] Synced state to item index ${index}: ${itemId}`);
        } else {
            console.warn(`[AUTOPLAY] Could not sync state: item ${itemId} not found in playlist`);
        }
    }

    /**
     * Handle playlist updates (re-sync state)
     */
    onPlaylistUpdated() {
        if (this.currentItemId) {
            console.log('[AUTOPLAY] Playlist updated, re-syncing state...');
            this.syncState(this.currentItemId);
        }
    }

    /**
     * Recover state from CasparCG (e.g. after restart)
     */
    async recoverState() {
        try {
            console.log('[AUTOPLAY] Attempting to recover state from CasparCG...');
            const response = await this.casparClient.info(this.CASPAR_CHANNEL);
            console.log('[AUTOPLAY] Raw CasparCG INFO response:', response);

            // Extract file name from response
            // <file>name_of_file</file>
            let playingFile = null;
            let currentPosition = 0;

            // Pattern 1: Simple <file>name</file>
            const simpleMatch = response.match(/<file>([^<]+)<\/file>/);
            if (simpleMatch && !simpleMatch[1].trim().startsWith('<')) {
                playingFile = simpleMatch[1];
            }

            // Pattern 2: Nested <file><name>name</name></file> inside layer 10 (CasparCG 2.2+)
            if (!playingFile) {
                // Find layer 10 block
                const layerMatch = response.match(/<layer_10>[\s\S]*?<\/layer_10>/);
                if (layerMatch) {
                    // Look for foreground file name
                    const foregroundMatch = layerMatch[0].match(/<foreground>[\s\S]*?<\/foreground>/);
                    if (foregroundMatch) {
                        const nameMatch = foregroundMatch[0].match(/<name>([^<]+)<\/name>/);
                        if (nameMatch) {
                            playingFile = nameMatch[1];
                        }

                        // Try to parse current time (position)
                        const timeMatch = foregroundMatch[0].match(/<time>([\d.]+)<\/time>/);
                        if (timeMatch) {
                            currentPosition = parseFloat(timeMatch[1]);
                        }
                    }
                }
            }

            if (playingFile) {
                console.log(`[AUTOPLAY] CasparCG is playing: ${playingFile} (Position: ${currentPosition}s)`);

                // Find in playlist (ignoring extension differences if needed)
                const scheduled = this.playlist.getScheduled();
                if (!scheduled || !scheduled.items) return;

                // Normalize for comparison (remove extension, lowercase)
                const normalize = (str) => str.replace(/^.*[\\/]/, '').replace(/\.[^/.]+$/, '').toLowerCase();
                const normalizedPlaying = normalize(playingFile);

                const itemIndex = scheduled.items.findIndex(item => {
                    // Check for standard file match
                    if (normalize(item.file) === normalizedPlaying) return true;
                    
                    // Check for Live Input match (e.g. "DECKLINK 1" vs file "1")
                    if (item.type === 'live' && normalizedPlaying.includes('decklink') && normalizedPlaying.includes(item.file)) {
                        return true;
                    }
                    
                    return false;
                });

                if (itemIndex !== -1) {
                    const foundItem = scheduled.items[itemIndex];
                    console.log(`[AUTOPLAY] Found matching item in playlist: ${foundItem.name}`);

                    this.currentItemId = foundItem.id;
                    this.currentIndex = itemIndex;

                    if (currentPosition > 0) {
                        // Calculate duration of all items BEFORE this one
                        let previousDuration = 0;
                        for (let i = 0; i < itemIndex; i++) {
                            previousDuration += scheduled.items[i].durationSeconds;
                        }

                        // New Base Start = Now - (Position + PreviousItemsDuration)
                        const newBaseStart = new Date(Date.now() - ((currentPosition + previousDuration) * 1000));
                        this.playlist.setBaseStartAt(newBaseStart);
                        console.log(`[AUTOPLAY] Synced playlist timing. Base Start: ${newBaseStart.toISOString()}`);

                        // If in AUTO mode, ensure polling is active
                        if (this.mode === 'AUTO') {
                            this.startStatusPolling();
                        }
                    } else {
                        this.syncState(foundItem.id);
                    }

                    // Also start polling to detect when it finishes
                    this.startStatusPolling();
                } else {
                    console.log('[AUTOPLAY] Playing file not found in current playlist');
                }
            } else {
                console.log('[AUTOPLAY] CasparCG is not playing any file');
            }
        } catch (error) {
            console.error('[AUTOPLAY] State recovery failed:', error.message);
        }
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

        // Debug log every 10 seconds (reduce spam)
        if (!this.lastLogTime || Date.now() - this.lastLogTime > 10000) {
            console.log(`[AUTOPLAY] Checking schedule, currentIndex: ${this.currentIndex}, items: ${scheduled.items.length}`);
            this.lastLogTime = Date.now();
        }

        // Find next item to play
        for (let i = 0; i < scheduled.items.length; i++) {
            const item = scheduled.items[i];

            if (this.shouldPlay(item, now, i)) {
                console.log(`[AUTOPLAY] ✓ Time to play: ${item.name}`);
                this.playItem(item, i);
                break;
            }
        }
    }

    /**
     * Check and execute secondary events for the playing item
     */
    checkSecondaryEvents(item, now) {
        if (!item.secondaryEvents || item.secondaryEvents.length === 0) return;

        const startTime = new Date(item.startAt).getTime();
        const nowTime = now.getTime();
        const elapsedMs = nowTime - startTime; // Time since item started

        item.secondaryEvents.forEach(event => {
            if (event.executed) return;

            let triggerTimeMs = 0;
            if (event.trigger === 'START') {
                triggerTimeMs = event.offsetMs || 0;
            } else if (event.trigger === 'END') {
                const durationMs = item.durationSeconds * 1000;
                triggerTimeMs = durationMs - (event.offsetMs || 0);
            }

            // Execute if within 500ms window (polling interval is 1000ms, so be generous)
            // Or if we passed it recently (missed frame catch-up)
            if (elapsedMs >= triggerTimeMs) {
                console.log(`[SECONDARY] Executing event: ${event.type} for ${item.name}`);
                this.executeSecondaryEvent(event, item);
                event.executed = true; // Mark as done (in memory only, resets on next play)
            }
        });
    }

    /**
     * Execute a specific secondary event
     */
    async executeSecondaryEvent(event, item) {
        try {
            console.log(`[SECONDARY] Executing event: ${event.type} (Trigger: ${event.trigger}, Offset: ${event.offsetMs}ms)`);
            switch (event.type) {
                case 'CG_ADD':
                    // template: 'lower-third', data: {...}
                    if (!event.template) {
                         console.warn('[SECONDARY] CG_ADD failed: No template specified');
                         return;
                    }
                    console.log(`[SECONDARY] CG_ADD Layer ${event.layer || 20}: ${event.template}`);
                    await this.casparClient.cgAdd(
                        this.CASPAR_CHANNEL, 
                        event.layer || 20, 
                        1, 
                        event.template, 
                        true, 
                        JSON.stringify(event.data || {})
                    );
                    break;

                case 'CG_STOP':
                    console.log(`[SECONDARY] CG_STOP Layer ${event.layer || 20}`);
                    await this.casparClient.cgStop(
                        this.CASPAR_CHANNEL, 
                        event.layer || 20, 
                        1
                    );
                    break;
                
                case 'CG_CLEAR':
                     console.log(`[SECONDARY] CG_CLEAR Layer ${event.layer || 20}`);
                     await this.casparClient.cgClear(
                        this.CASPAR_CHANNEL, 
                        event.layer || 20
                    );
                    break;

                default:
                    console.warn(`[SECONDARY] Unknown event type: ${event.type}`);
            }
        } catch (error) {
            console.error(`[SECONDARY] Failed to execute event ${event.type}:`, error);
        }
    }

    /**
     * Determine if item should be played now
     */
    shouldPlay(item, now, itemIndex) {
        // Already playing
        if (item.id === this.currentItemId) {
            // Check secondary events for current item
            this.checkSecondaryEvents(item, now);
            return false;
        }

        // Don't go backwards - only play items AFTER current index
        if (this.currentIndex >= 0 && itemIndex <= this.currentIndex) {
            return false;
        }

        const startTime = new Date(item.startAt);
        const endTime = new Date(item.endAt);
        const nowTime = now.getTime();

        const diffFromStart = (nowTime - startTime.getTime()) / 1000;
        const diffFromEnd = (endTime.getTime() - nowTime) / 1000;

        // Play if within tolerance window OR if we should already be playing (catch-up)
        const shouldStartNow = diffFromStart >= -this.TIME_TOLERANCE &&
            diffFromStart <= this.TIME_TOLERANCE;
        const alreadyStarted = diffFromStart > this.TIME_TOLERANCE && diffFromEnd > 0;

        if (shouldStartNow || alreadyStarted) {
            console.log('[AUTOPLAY] Item "' + item.name + '" should play: startDiff=' + diffFromStart.toFixed(1) + 's, endDiff=' + diffFromEnd.toFixed(1) + 's');
            return true;
        }

        return false;
    }

    /**
     * Play an item
     */
    async playItem(item, index) {
        try {
            console.log(`[AUTOPLAY] Playing item: ${item.name} (${item.file})`);

            // Reset secondary events flags
            if (item.secondaryEvents) {
                item.secondaryEvents.forEach(e => e.executed = false);
            }

            // Clear any existing timeout
            this.clearPlaybackTimeout();

            if (item.type === 'live') {
                // Handle Live Input (DeckLink)
                console.log(`[AUTOPLAY] Starting Live Input: DECKLINK ${item.file}`);
                await this.casparClient.sendCommand(`PLAY ${this.CASPAR_CHANNEL}-${this.CASPAR_LAYER} DECKLINK ${item.file}`);
            } else {
                // Handle Video Clip
                // Remove file extension for CasparCG
                const fileName = item.file.replace(/\.[^/.]+$/, '');

                // Calculate Seek and Length in frames
                const seekFrames = (item.trimInSeconds || 0) * this.FRAME_RATE;
                const lengthFrames = item.durationSeconds * this.FRAME_RATE;

                // Send PLAY command with Seek and Length
                await this.casparClient.play(
                    this.CASPAR_CHANNEL,
                    this.CASPAR_LAYER,
                    fileName,
                    seekFrames > 0 ? seekFrames : null,
                    lengthFrames > 0 ? lengthFrames : null
                );
            }

            this.currentItemId = item.id;
            this.currentIndex = index;
            this.lastPlayTime = Date.now();

            // Update playlist timing to anchor this item to NOW
            this._updatePlaylistTiming(index);

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

            // Set timeout to detect playback failure
            this.startPlaybackTimeout(item);

            console.log(`[AUTOPLAY] Now playing: ${item.name}`);
        } catch (error) {
            console.error('[AUTOPLAY] Play failed:', error.message);

            this.broadcast({
                type: 'ERROR',
                data: { message: `Autoplay failed: ${error.message}` }
            });

            // If in AUTO mode, try playing next item after failure
            if (this.mode === 'AUTO') {
                console.log('[AUTOPLAY] Play command failed, attempting next item in 2 seconds...');
                setTimeout(() => {
                    this.playNext();
                }, 2000);
            }
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
            this.clearPlaybackTimeout();

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

            // Check secondary events for current item (even in MANUAL mode)
            const currentItem = this.getCurrentItem();
            if (currentItem && currentItem.id === this.currentItemId) {
                this.checkSecondaryEvents(currentItem, new Date());
            }
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
     * Start playback timeout to detect if video fails to play
     */
    startPlaybackTimeout(item) {
        this.clearPlaybackTimeout();

        this.playbackTimeout = setTimeout(async () => {
            console.warn(`[AUTOPLAY] ⚠️  Playback timeout after ${this.PLAYBACK_TIMEOUT_MS / 1000}s for: ${item.name}`);
            console.warn(`[AUTOPLAY] File may be corrupted or not playing correctly: ${item.file}`);

            // Broadcast error notification
            this.broadcast({
                type: 'NOTIFICATION',
                data: {
                    level: 'error',
                    message: `Échec de lecture: ${item.name} (timeout ${this.PLAYBACK_TIMEOUT_MS / 1000}s)`
                }
            });

            // If in AUTO mode, try next item
            if (this.mode === 'AUTO') {
                console.log('[AUTOPLAY] Attempting to play next item...');
                await this.playNext();
            } else {
                // In manual mode, just stop and clear
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
            }
        }, this.PLAYBACK_TIMEOUT_MS);

        console.log(`[AUTOPLAY] Playback timeout set for ${this.PLAYBACK_TIMEOUT_MS / 1000}s`);
    }

    /**
     * Clear playback timeout
     */
    clearPlaybackTimeout() {
        if (this.playbackTimeout) {
            clearTimeout(this.playbackTimeout);
            this.playbackTimeout = null;
        }
    }

    /**
     * Check playback status via CasparCG INFO
     */
    async checkPlaybackStatus() {
        try {
            // Don't check if we just started playing (give it 2 seconds)
            if (Date.now() - this.lastPlayTime < 2000) return;

            const response = await this.casparClient.info(this.CASPAR_CHANNEL);
            const currentItem = this.getCurrentItem();

            // Check if video is actually playing (has valid foreground)
            if (this.isVideoPlaying(response)) {
                // Video is playing successfully, clear the timeout
                this.clearPlaybackTimeout();
            }

            // Special handling for Live items: check duration expiration
            if (currentItem && currentItem.type === 'live') {
                const now = Date.now();
                const endTime = new Date(currentItem.endAt).getTime();
                
                // Check if duration expired
                if (now >= endTime) {
                    console.log('[AUTOPLAY] Live item finished (duration expired), playing next');
                    this.clearPlaybackTimeout();
                    await this.playNext();
                    return;
                }
            }

            if (this.isFinished(response)) {
                console.log('[AUTOPLAY] Video finished, playing next');
                this.clearPlaybackTimeout();
                await this.playNext();
            }
        } catch (error) {
            console.error('[AUTOPLAY] Status check failed:', error.message);
        }
    }

    /**
     * Check if video is actually playing (not empty/failed)
     */
    isVideoPlaying(data) {
        if (!data) return false;

        try {
            const layerRegex = new RegExp(`<layer_${this.CASPAR_LAYER}\\b[^>]*>([\\s\\S]*?)<\\/layer_${this.CASPAR_LAYER}>`);
            const layerMatch = data.match(layerRegex);

            if (!layerMatch) return false;

            const layerContent = layerMatch[1];
            const foregroundMatch = layerContent.match(/<foreground>([\s\S]*?)<\/foreground>/);

            if (!foregroundMatch) return false;

            const foregroundContent = foregroundMatch[1];

            // Check if producer is ffmpeg (not empty)
            if (foregroundContent.includes('<producer>ffmpeg</producer>') || 
                foregroundContent.includes('<producer>decklink</producer>')) {
                
                // For decklink, we assume it's always playing if present
                if (foregroundContent.includes('<producer>decklink</producer>')) return true;

                // Check if time is progressing (> 0)
                const timeMatch = foregroundContent.match(/<time>([^<]+)<\/time>/);
                if (timeMatch) {
                    const time = parseFloat(timeMatch[1]);
                    return !isNaN(time) && time > 0;
                }
            }

            return false;
        } catch (error) {
            return false;
        }
    }

    /**
     * Determine if playback is finished based on INFO response
     */
    /**
     * Check if current video is finished based on CasparCG info
     */
    isFinished(data) {
        console.log('[DEBUG isFinished] ========== METHOD CALLED ==========');

        if (!data) {
            console.log('[DEBUG isFinished] No data, returning false');
            return false;
        }

        try {
            // 1. Extract layer content (more robust regex)
            // Matches <layer_10> or <layer_10 ...>
            const layerRegex = new RegExp(`<layer_${this.CASPAR_LAYER}\\b[^>]*>([\\s\\S]*?)<\\/layer_${this.CASPAR_LAYER}>`);
            const layerMatch = data.match(layerRegex);

            if (!layerMatch) {
                console.log(`[DEBUG isFinished] Layer ${this.CASPAR_LAYER} not found in XML, returning true`);
                // console.log('[DEBUG] XML dump:', data.substring(0, 200) + '...'); 
                return true;
            }

            const layerContent = layerMatch[1];

            // 3. Check foreground
            const foregroundMatch = layerContent.match(/<foreground>([\s\S]*?)<\/foreground>/);
            if (!foregroundMatch) return true;

            const foregroundContent = foregroundMatch[1];

            // 4. Check producer
            if (foregroundContent.includes('<producer>empty</producer>')) {
                return true;
            }

            // 5. If ffmpeg, check duration
            if (foregroundContent.includes('<producer>ffmpeg</producer>')) {
                // CasparCG returns TWO <time> tags: current position and total duration
                const timeMatches = foregroundContent.match(/<time>([^<]+)<\/time>/g);

                console.log('[DEBUG isFinished] timeMatches:', timeMatches);

                if (timeMatches && timeMatches.length >= 2) {
                    // Extract values from both <time> tags
                    const currentTime = parseFloat(timeMatches[0].replace(/<\/?time>/g, ''));
                    const totalDuration = parseFloat(timeMatches[1].replace(/<\/?time>/g, ''));

                    console.log(`[DEBUG isFinished] Parsed: currentTime=${currentTime}, totalDuration=${totalDuration}`);

                    if (!isNaN(currentTime) && !isNaN(totalDuration) && totalDuration > 0) {
                        const remaining = totalDuration - currentTime;

                        console.log(`[DEBUG isFinished] remaining=${remaining.toFixed(1)}s, TIME_TOLERANCE=${this.TIME_TOLERANCE}`);

                        // Don't mark as finished if video just started (less than 5 seconds in)
                        if (currentTime < 5) {
                            console.log('[DEBUG isFinished] Video just started (<5s), returning false');
                            return false;
                        }

                        // Video is finished if remaining time is within tolerance
                        const isFinished = remaining <= this.TIME_TOLERANCE;

                        if (isFinished) {
                            console.log(`[AUTOPLAY] Video finishing: time=${currentTime.toFixed(1)}s, duration=${totalDuration.toFixed(1)}s, remaining=${remaining.toFixed(1)}s`);
                        }

                        console.log(`[DEBUG isFinished] Returning isFinished=${isFinished}`);
                        return isFinished;
                    }
                } else {
                    console.log('[DEBUG isFinished] timeMatches not found or insufficient, falling back to old method');
                }

                // Fallback: try old method with <duration> or <clip>
                const timeMatch = foregroundContent.match(/<time>([^<]+)<\/time>/);
                let duration = 0;
                const explicitDurationMatch = foregroundContent.match(/<duration>([^<]+)<\/duration>/);
                const clipMatches = foregroundContent.match(/<clip>([^<]+)<\/clip>/g);

                if (explicitDurationMatch) {
                    duration = parseFloat(explicitDurationMatch[1]);
                } else if (clipMatches && clipMatches.length >= 2) {
                    const val = clipMatches[1].replace(/<\/?clip>/g, '');
                    duration = parseFloat(val);
                }

                if (timeMatch && duration > 0) {
                    const time = parseFloat(timeMatch[1]);

                    // Don't mark as finished if video just started
                    if (time < 5) {
                        return false;
                    }

                    const remaining = duration - time;
                    return remaining <= this.TIME_TOLERANCE;
                }
            }

            return false;

        } catch (error) {
            console.error('[AUTOPLAY] Error parsing status:', error);
            return false;
        }
    }

    /**
     * Update playlist base time so that item at index starts NOW
     * @private
     */
    _updatePlaylistTiming(index) {
        try {
            const rawPlaylist = this.playlist.getRaw();
            if (!rawPlaylist || !rawPlaylist.items) return;

            let elapsedDuration = 0;
            for (let i = 0; i < index; i++) {
                const item = rawPlaylist.items[i];
                if (item && typeof item.durationSeconds === 'number') {
                    elapsedDuration += item.durationSeconds;
                }
            }

            const newBaseStart = new Date(Date.now() - (elapsedDuration * 1000));
            this.playlist.setBaseStartAt(newBaseStart);
            console.log(`[AUTOPLAY] Updated playlist base time: ${newBaseStart.toISOString()} (anchored item ${index} to now)`);
            
            // Broadcast playlist update so clients see correct times
            if (this.broadcast) {
                this.broadcast({
                    type: 'PLAYLIST_UPDATED',
                    data: this.playlist.getScheduled()
                });
            }
        } catch (error) {
            console.error('[AUTOPLAY] Error updating playlist timing:', error);
        }
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
        console.log(`[AUTOPLAY] getNextItem: currentIndex=${this.currentIndex}, nextIndex=${nextIndex}, totalItems=${scheduled.items.length}`);
        
        if (nextIndex >= scheduled.items.length) {
            console.log('[AUTOPLAY] getNextItem: No next item (end of playlist)');
            return null;
        }

        const nextItem = scheduled.items[nextIndex];
        console.log(`[AUTOPLAY] getNextItem: Found next item: ${nextItem.name} (${nextItem.id})`);
        return nextItem;
    }

    /**
     * Get scheduler status
     */
    getStatus() {
        const currentItem = this.getCurrentItem();
        const nextItem = this.getNextItem();

        if (nextItem) {
            console.log('[DEBUG] getStatus nextItem:', JSON.stringify(nextItem, null, 2));
        }

        return {
            mode: this.mode,
            currentItem: currentItem ? {
                id: currentItem.id,
                name: currentItem.name,
                file: currentItem.file,
                startAt: currentItem.startAt,
                durationSeconds: currentItem.durationSeconds,
                status: 'PLAYING'
            } : null,
            nextItem: nextItem ? {
                id: nextItem.id,
                name: nextItem.name,
                file: nextItem.file,
                startAt: nextItem.startAt,
                durationSeconds: nextItem.durationSeconds
            } : null
        };
    }
}

module.exports = AutoplayScheduler;
