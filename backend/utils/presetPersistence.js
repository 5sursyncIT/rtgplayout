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
 * Save presets to disk (atomic write)
 * @param {Array} presets - Array of preset objects
 */
async function savePresets(presets) {
    const TEMP_FILE = PRESETS_FILE + '.tmp';
    const BACKUP_FILE = PRESETS_FILE + '.backup';

    try {
        await ensureDataDirectory();

        // Validation
        if (!Array.isArray(presets)) {
            throw new Error('Presets must be an array');
        }

        const json = JSON.stringify(presets, null, 2);

        // Atomic write
        await fs.writeFile(TEMP_FILE, json, 'utf8');

        // Backup existant
        try {
            await fs.access(PRESETS_FILE);
            await fs.copyFile(PRESETS_FILE, BACKUP_FILE);
        } catch (e) {
            // Pas de fichier existant
        }

        await fs.rename(TEMP_FILE, PRESETS_FILE);

        console.log(`[PRESETS] Saved ${presets.length} presets to disk`);
        return true;
    } catch (error) {
        console.error('[PRESETS] Failed to save presets:', error.message);

        // Cleanup
        try {
            await fs.unlink(TEMP_FILE);
        } catch (e) {}

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
