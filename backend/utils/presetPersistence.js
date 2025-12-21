/**
 * Preset Persistence - Save/load graphics presets
 */

const fs = require('fs').promises;
const path = require('path');

const PRESETS_FILE = path.join(__dirname, '../data/presets.json');

/**
 * Ensure data directory exists
 */
async function ensureDataDirectory() {
    const dataDir = path.dirname(PRESETS_FILE);

    try {
        await fs.access(dataDir);
    } catch (error) {
        await fs.mkdir(dataDir, { recursive: true });
        console.log('[PRESETS] Created data directory');
    }
}

/**
 * Save presets to disk
 * @param {Array} presets - Array of preset objects
 */
async function savePresets(presets) {
    try {
        await ensureDataDirectory();

        const json = JSON.stringify(presets, null, 2);
        await fs.writeFile(PRESETS_FILE, json, 'utf8');

        console.log(`[PRESETS] Saved ${presets.length} presets to disk`);
        return true;
    } catch (error) {
        console.error('[PRESETS] Failed to save presets:', error.message);
        throw error;
    }
}

/**
 * Load presets from disk
 * @returns {Array} - Array of preset objects
 */
async function loadPresets() {
    try {
        await ensureDataDirectory();
        
        // Check if file exists
        try {
            await fs.access(PRESETS_FILE);
        } catch {
            console.log('[PRESETS] No saved presets found');
            return [];
        }

        const json = await fs.readFile(PRESETS_FILE, 'utf8');
        const data = JSON.parse(json);

        console.log(`[PRESETS] Loaded ${data.length} presets from disk`);
        return data;
    } catch (error) {
        console.error('[PRESETS] Failed to load presets:', error.message);
        return [];
    }
}

module.exports = {
    savePresets,
    loadPresets
};
