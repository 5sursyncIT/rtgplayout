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
            trimOutSeconds: item.trimOutSeconds || 0
        };
    }
}

// Export singleton instance
module.exports = new PlaylistModel();
