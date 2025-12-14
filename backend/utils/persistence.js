/**
 * Playlist Persistence - Save and load playlists to/from JSON files
 */

const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const PLAYLIST_FILE = path.join(DATA_DIR, 'playlist.json');

/**
 * Ensure data directory exists
 */
async function ensureDataDirectory() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
        console.error('[PERSISTENCE] Error creating data directory:', error.message);
    }
}

/**
 * Save playlist to JSON file
 * 
 * @param {Object} playlistData - Playlist data to save
 * @returns {Promise<boolean>} - True if saved successfully
 */
async function savePlaylist(playlistData) {
    try {
        await ensureDataDirectory();

        const data = JSON.stringify(playlistData, null, 2);
        await fs.writeFile(PLAYLIST_FILE, data, 'utf8');

        console.log(`[PERSISTENCE] Playlist saved: ${playlistData.items.length} items`);
        return true;
    } catch (error) {
        console.error('[PERSISTENCE] Error saving playlist:', error.message);
        return false;
    }
}

/**
 * Load playlist from JSON file
 * 
 * @returns {Promise<Object|null>} - Loaded playlist data or null
 */
async function loadPlaylist() {
    try {
        const data = await fs.readFile(PLAYLIST_FILE, 'utf8');
        const playlistData = JSON.parse(data);

        console.log(`[PERSISTENCE] Playlist loaded: ${playlistData.items.length} items`);
        return playlistData;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[PERSISTENCE] No saved playlist found');
        } else {
            console.error('[PERSISTENCE] Error loading playlist:', error.message);
        }
        return null;
    }
}

/**
 * Check if saved playlist exists
 * 
 * @returns {Promise<boolean>} - True if playlist file exists
 */
async function playlistExists() {
    try {
        await fs.access(PLAYLIST_FILE);
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    savePlaylist,
    loadPlaylist,
    playlistExists,
    PLAYLIST_FILE
};
