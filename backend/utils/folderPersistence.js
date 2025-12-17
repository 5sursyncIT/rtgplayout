/**
 * Folder Persistence - Save/load media folder structure
 */

const fs = require('fs').promises;
const path = require('path');

const FOLDERS_FILE = path.join(__dirname, '../data/mediaFolders.json');

/**
 * Ensure data directory exists
 */
async function ensureDataDirectory() {
    const dataDir = path.dirname(FOLDERS_FILE);

    try {
        await fs.access(dataDir);
    } catch (error) {
        await fs.mkdir(dataDir, { recursive: true });
        console.log('[FOLDERS] Created data directory');
    }
}

/**
 * Save folder structure to disk
 */
async function saveFolders(mediaFolders) {
    try {
        await ensureDataDirectory();

        const data = mediaFolders.toJSON();
        const json = JSON.stringify(data, null, 2);

        await fs.writeFile(FOLDERS_FILE, json, 'utf8');

        console.log('[FOLDERS] Saved folder structure to disk');
        return true;
    } catch (error) {
        console.error('[FOLDERS] Failed to save folders:', error.message);
        throw error;
    }
}

/**
 * Load folder structure from disk
 */
async function loadFolders() {
    try {
        await fs.access(FOLDERS_FILE);

        const json = await fs.readFile(FOLDERS_FILE, 'utf8');
        const data = JSON.parse(json);

        console.log('[FOLDERS] Loaded folder structure from disk');
        return data;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[FOLDERS] No saved folder structure found');
            return null;
        }

        console.error('[FOLDERS] Failed to load folders:', error.message);
        throw error;
    }
}

module.exports = {
    saveFolders,
    loadFolders
};
