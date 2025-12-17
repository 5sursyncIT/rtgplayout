/**
 * Playlist Model - In-memory playlist state management
 * 
 * Manages a single active playlist with timing calculations
 */

const { computeSchedule } = require('../utils/timing');

class PlaylistModel {
    constructor() {
        this.id = 'MAIN-CHANNEL-1';
        this.baseStartAt = null;  // Date object or null
        this.items = [];          // Array of PlaylistItem
    }

    /**
     * Set the base start time for the playlist
     * 
     * @param {Date|string|null} date - Date object, ISO string, or null for "now"
     */
    setBaseStartAt(date) {
        if (date === null) {
            this.baseStartAt = null;
            console.log('[PLAYLIST] Base start time set to NOW (dynamic)');
            return;
        }

        if (typeof date === 'string') {
            this.baseStartAt = new Date(date);
        } else if (date instanceof Date) {
            this.baseStartAt = new Date(date);
        } else {
            throw new Error('[PLAYLIST] Invalid date format');
        }

        console.log(`[PLAYLIST] Base start time set to: ${this.baseStartAt.toISOString()}`);
    }

    /**
     * Replace all items in the playlist
     * 
     * @param {Array} itemsArray - Array of playlist items
     */
    setItems(itemsArray) {
        if (!Array.isArray(itemsArray)) {
            throw new Error('[PLAYLIST] Items must be an array');
        }

        this.items = itemsArray.map(item => this._validateItem(item));
        console.log(`[PLAYLIST] Set ${this.items.length} items`);
    }

    /**
     * Add a single item to the playlist
     * 
     * @param {Object} item - Playlist item to add
     * @returns {Object} - The added item with generated ID
     */
    addItem(item) {
        const validatedItem = this._validateItem(item);

        // Generate ID if not provided
        if (!validatedItem.id) {
            validatedItem.id = `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        }

        this.items.push(validatedItem);
        console.log(`[PLAYLIST] Added item: ${validatedItem.name} (${validatedItem.id})`);

        return validatedItem;
    }

    /**
     * Remove an item from the playlist by ID
     * 
     * @param {string} id - Item ID to remove
     * @returns {boolean} - True if item was removed
     */
    removeItem(id) {
        const initialLength = this.items.length;
        this.items = this.items.filter(item => item.id !== id);

        const removed = this.items.length < initialLength;
        if (removed) {
            console.log(`[PLAYLIST] Removed item: ${id}`);
        } else {
            console.warn(`[PLAYLIST] Item not found: ${id}`);
        }

        return removed;
    }

    /**
     * Reorder items in the playlist
     * 
     * @param {number} fromIndex - Original index
     * @param {number} toIndex - New index
     * @returns {boolean} - True if successful
     */
    reorderItems(fromIndex, toIndex) {
        if (fromIndex < 0 || fromIndex >= this.items.length ||
            toIndex < 0 || toIndex >= this.items.length) {
            console.warn(`[PLAYLIST] Invalid reorder indices: ${fromIndex} -> ${toIndex}`);
            return false;
        }

        const [movedItem] = this.items.splice(fromIndex, 1);
        this.items.splice(toIndex, 0, movedItem);

        console.log(`[PLAYLIST] Reordered item ${fromIndex} to ${toIndex}`);
        return true;
    }

    /**
     * Get the playlist with calculated start/end times
     * 
     * @returns {Object} - Playlist with scheduled items
     */
    getScheduled() {
        // Use current time if baseStartAt is null
        const baseDate = this.baseStartAt || new Date();

        const scheduledItems = computeSchedule(this.items, baseDate);

        return {
            id: this.id,
            baseStartAt: baseDate.toISOString(),
            items: scheduledItems
        };
    }

    /**
     * Reset the schedule base time to now
     */
    resetSchedule() {
        this.baseStartAt = new Date();
        console.log('[PLAYLIST] Schedule reset to:', this.baseStartAt.toISOString());
        return this.getScheduled();
    }

    /**
     * Get raw playlist without scheduling
     * 
     * @returns {Object} - Raw playlist data
     */
    getRaw() {
        return {
            id: this.id,
            baseStartAt: this.baseStartAt ? this.baseStartAt.toISOString() : null,
            items: [...this.items]
        };
    }

    /**
     * Recalculate schedule with hard start time constraints
     * Adjusts previous item durations if needed to respect hard start times
     * @returns {Object} - Result object with success status and errors
     */
    recalculateWithHardStart() {
        // Find items with hard start times
        const hardStartItems = this.items
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => item.hardStartTime);

        if (hardStartItems.length === 0) {
            return { success: true, errors: [] };
        }

        const errors = [];

        // For each item with hard start time
        hardStartItems.forEach(({ item, index }) => {
            if (index === 0) {
                errors.push({
                    itemId: item.id,
                    itemName: item.name,
                    reason: 'Cannot apply hard start to first item'
                });
                return;
            }

            // Parse hard start time (HH:MM:SS)
            const [hours, minutes, seconds] = item.hardStartTime.split(':').map(Number);

            // Calculate scheduled start time of current item first
            const baseDate = this.baseStartAt || new Date();
            let cumulativeSeconds = 0;
            for (let i = 0; i < index; i++) {
                cumulativeSeconds += this.items[i].durationSeconds;
            }
            const scheduledStart = new Date(baseDate.getTime() + cumulativeSeconds * 1000);

            // Create target start based on scheduled date (not current date)
            const targetStart = new Date(scheduledStart);
            targetStart.setHours(hours, minutes, seconds || 0, 0);

            // Calculate difference
            // If target is more than 12 hours away, assume day wrap
            // e.g. Sched 23:50, Target 00:10 -> Diff is -23h40m -> Add day to target -> Diff +20m
            // e.g. Sched 00:10, Target 23:50 -> Diff is +23h40m -> Subtract day from target -> Diff -20m
            
            let timeDiffSeconds = (targetStart - scheduledStart) / 1000;

            if (timeDiffSeconds > 12 * 3600) {
                targetStart.setDate(targetStart.getDate() - 1);
                timeDiffSeconds = (targetStart - scheduledStart) / 1000;
            } else if (timeDiffSeconds < -12 * 3600) {
                targetStart.setDate(targetStart.getDate() + 1);
                timeDiffSeconds = (targetStart - scheduledStart) / 1000;
            }

            if (timeDiffSeconds < 0) {
                // We're running late - need to trim previous item(s)
                const trimNeeded = Math.abs(timeDiffSeconds);

                // Adjust the immediately previous item
                const prevItem = this.items[index - 1];
                const maxTrim = prevItem.durationSeconds - 10; // Keep at least 10 seconds

                if (trimNeeded <= maxTrim) {
                    // Adjust duration by setting trimOutSeconds
                    prevItem.durationSeconds -= trimNeeded;
                    prevItem.trimOutSeconds = (prevItem.trimOutSeconds || 0) + trimNeeded;
                    console.log(`[HARD START] "${item.name}" @ ${item.hardStartTime}: trimmed ${Math.round(trimNeeded)}s from previous item`);
                } else {
                    const errorMsg = `Cannot trim ${Math.round(trimNeeded)}s from previous item (max: ${Math.round(maxTrim)}s)`;
                    console.error(`[HARD START] "${item.name}" @ ${item.hardStartTime}: ${errorMsg}`);
                    errors.push({
                        itemId: item.id,
                        itemName: item.name,
                        hardStartTime: item.hardStartTime,
                        reason: errorMsg,
                        trimNeeded: Math.round(trimNeeded),
                        maxTrim: Math.round(maxTrim)
                    });
                }
            } else if (timeDiffSeconds > 0) {
                // We're running early - extend previous item to fill the gap
                const extendNeeded = timeDiffSeconds;
                const prevItem = this.items[index - 1];
                
                // Allow extending beyond original duration (negative trimOut)
                // This effectively creates a "hold" or "gap" after the item finishes
                prevItem.durationSeconds += extendNeeded;
                prevItem.trimOutSeconds = (prevItem.trimOutSeconds || 0) - extendNeeded;
                
                console.log(`[HARD START] "${item.name}" @ ${item.hardStartTime}: extended previous item by ${Math.round(extendNeeded)}s (added gap/hold)`);
            }
        });

        return {
            success: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Validate a playlist item
     *
     * @private
     * @param {Object} item - Item to validate
     * @returns {Object} - Validated item
     */
    _validateItem(item) {
        if (!item.name || typeof item.name !== 'string') {
            throw new Error('[PLAYLIST] Item must have a valid name');
        }

        if (!item.file || typeof item.file !== 'string') {
            throw new Error('[PLAYLIST] Item must have a valid file');
        }

        if (typeof item.durationSeconds !== 'number' || item.durationSeconds <= 0) {
            throw new Error('[PLAYLIST] Item must have a valid durationSeconds > 0');
        }

        return {
            id: item.id || null,
            name: item.name,
            file: item.file,
            durationSeconds: item.durationSeconds,
            trimInSeconds: item.trimInSeconds || 0,
            trimOutSeconds: item.trimOutSeconds || 0,
            thumbnail: item.thumbnail || null,
            hardStartTime: item.hardStartTime || null
        };
    }
}

// Export singleton instance
module.exports = new PlaylistModel();
