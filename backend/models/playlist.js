/**
 * Playlist Model - In-memory playlist state management
 * 
 * Manages a single active playlist with timing calculations
 */

const {
    computeScheduleRobust,
    validateHardStarts,
    calculateHardStartTarget,
    parseHardStartTime,
    FRAME_RATES
} = require('../utils/timingRobust');

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
     * Get the playlist with calculated start/end times (ROBUST version)
     *
     * @param {Object} options - Options de calcul
     * @returns {Object} - Playlist with scheduled items
     */
    getScheduled(options = {}) {
        // Clean orphaned trim values before scheduling
        // (trim values without hard start constraints)
        this.cleanOrphanedTrims();

        // Use current time if baseStartAt is null
        const baseDate = this.baseStartAt || new Date();

        // Utiliser la version robuste avec frame-accuracy
        const scheduledItems = computeScheduleRobust(this.items, baseDate, {
            frameRate: options.frameRate || FRAME_RATES.PAL,
            frameAccurate: options.frameAccurate !== false, // true par défaut
            validateHardStartsFirst: options.validateHardStartsFirst !== false
        });

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
     * Recalculate schedule with hard start time constraints (VERSION ROBUSTE)
     * Adjusts previous item durations if needed to respect hard start times
     * @returns {Object} - Result object with success status and errors
     */
    recalculateWithHardStart() {
        // Utiliser la validation robuste des hard starts
        const baseDate = this.baseStartAt || new Date();
        const validation = validateHardStarts(this.items, baseDate);

        if (!validation.valid) {
            console.error('[HARD START] Validation failed:', validation.errors);
            return {
                success: false,
                errors: validation.errors
            };
        }

        // Pas de hard starts = succès immédiat
        if (!validation.hardStartTargets || validation.hardStartTargets.length === 0) {
            return { success: true, errors: [] };
        }

        const errors = [];
        const adjustments = [];

        // Pour chaque hard start validé
        validation.hardStartTargets.forEach(({ index, itemId, itemName, scheduledStart, targetStart, diff }) => {
            if (index === 0) {
                errors.push({
                    itemId,
                    itemName,
                    reason: 'Cannot apply hard start to first item'
                });
                return;
            }

            const item = this.items[index];
            const diffSeconds = diff / 1000;

            if (diffSeconds < 0) {
                // En retard - besoin de trim
                const trimNeeded = Math.abs(diffSeconds);
                const prevItem = this.items[index - 1];

                // Sécurité: garder au moins 5 secondes + trim déjà existant
                const currentDuration = prevItem.durationSeconds;
                const existingTrimOut = prevItem.trimOutSeconds || 0;
                const maxTrim = Math.max(0, currentDuration - 5);

                if (trimNeeded <= maxTrim) {
                    // Ajuster la durée
                    prevItem.durationSeconds -= trimNeeded;
                    prevItem.trimOutSeconds = existingTrimOut + trimNeeded;

                    adjustments.push({
                        type: 'trim',
                        itemId: prevItem.id,
                        itemName: prevItem.name,
                        amount: trimNeeded,
                        reason: `Hard start "${itemName}" @ ${item.hardStartTime}`
                    });

                    console.log(`[HARD START] ✓ Trimmed ${trimNeeded.toFixed(3)}s from "${prevItem.name}" for hard start "${itemName}" @ ${item.hardStartTime}`);
                } else {
                    const errorMsg = `Cannot trim ${trimNeeded.toFixed(1)}s from previous item (max: ${maxTrim.toFixed(1)}s)`;
                    console.error(`[HARD START] ✗ "${itemName}" @ ${item.hardStartTime}: ${errorMsg}`);

                    errors.push({
                        itemId,
                        itemName,
                        hardStartTime: item.hardStartTime,
                        reason: errorMsg,
                        trimNeeded: Math.round(trimNeeded * 1000) / 1000,
                        maxTrim: Math.round(maxTrim * 1000) / 1000,
                        scheduledStart: scheduledStart.toISOString(),
                        targetStart: targetStart.toISOString()
                    });
                }
            } else if (diffSeconds > 0) {
                // En avance - étendre l'item précédent (créer un gap/hold)
                const extendNeeded = diffSeconds;
                const prevItem = this.items[index - 1];

                prevItem.durationSeconds += extendNeeded;
                prevItem.trimOutSeconds = (prevItem.trimOutSeconds || 0) - extendNeeded;

                adjustments.push({
                    type: 'extend',
                    itemId: prevItem.id,
                    itemName: prevItem.name,
                    amount: extendNeeded,
                    reason: `Hard start "${itemName}" @ ${item.hardStartTime}`
                });

                console.log(`[HARD START] ✓ Extended "${prevItem.name}" by ${extendNeeded.toFixed(3)}s (gap/hold) for hard start "${itemName}" @ ${item.hardStartTime}`);
            } else {
                // Parfait timing - pas d'ajustement
                console.log(`[HARD START] ✓ "${itemName}" @ ${item.hardStartTime} is perfectly timed (no adjustment needed)`);
            }
        });

        return {
            success: errors.length === 0,
            errors,
            adjustments,
            hardStartCount: validation.hardStartTargets.length
        };
    }

    /**
     * Clean orphaned trim values (trim without hard start)
     * This removes trim values that don't make sense without a hard start constraint
     */
    cleanOrphanedTrims() {
        let cleanedCount = 0;

        this.items.forEach((item, index) => {
            // If item has NO hard start but has suspicious trim values
            if (!item.hardStartTime) {
                // Reset excessive trim values that are likely orphaned from removed hard starts
                if (Math.abs(item.trimOutSeconds || 0) > item.durationSeconds * 0.5) {
                    console.log(`[PLAYLIST] Cleaning orphaned trim on "${item.name}": ${item.trimOutSeconds}s → 0s`);
                    item.trimOutSeconds = 0;
                    cleanedCount++;
                }
            }
        });

        if (cleanedCount > 0) {
            console.log(`[PLAYLIST] Cleaned ${cleanedCount} orphaned trim value(s)`);
        }

        return cleanedCount;
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

        // For 'clip' type, file is required. For 'live', file represents device number (e.g., "1")
        if (!item.file || typeof item.file !== 'string') {
            throw new Error('[PLAYLIST] Item must have a valid file/source');
        }

        if (typeof item.durationSeconds !== 'number' || item.durationSeconds <= 0) {
            throw new Error('[PLAYLIST] Item must have a valid durationSeconds > 0');
        }

        return {
            id: item.id || null,
            name: item.name,
            file: item.file,
            type: item.type || 'clip', // 'clip', 'live', 'stream'
            durationSeconds: item.durationSeconds,
            trimInSeconds: item.trimInSeconds || 0,
            trimOutSeconds: item.trimOutSeconds || 0,
            thumbnail: item.thumbnail || null,
            hardStartTime: item.hardStartTime || null,
            secondaryEvents: Array.isArray(item.secondaryEvents) ? item.secondaryEvents : []
        };
    }
}

// Export singleton instance
module.exports = new PlaylistModel();
