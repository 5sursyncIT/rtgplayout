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
 * Save playlist to JSON file (atomic write pour éviter corruption)
 *
 * @param {Object} playlistData - Playlist data to save
 * @returns {Promise<boolean>} - True if saved successfully
 */
async function savePlaylist(playlistData) {
    const TEMP_FILE = PLAYLIST_FILE + '.tmp';
    const BACKUP_FILE = PLAYLIST_FILE + '.backup';

    try {
        await ensureDataDirectory();

        // Validation des données avant sauvegarde
        if (!playlistData || !Array.isArray(playlistData.items)) {
            throw new Error('Invalid playlist data structure');
        }

        const data = JSON.stringify(playlistData, null, 2);

        // Écriture atomique en 3 étapes pour éviter corruption
        // 1. Écrire dans fichier temporaire
        await fs.writeFile(TEMP_FILE, data, 'utf8');

        // 2. Backup de l'ancien fichier (si existe)
        try {
            await fs.access(PLAYLIST_FILE);
            await fs.copyFile(PLAYLIST_FILE, BACKUP_FILE);
        } catch (error) {
            // Pas de fichier existant, pas grave
        }

        // 3. Renommer le temp en final (opération atomique sur la plupart des FS)
        await fs.rename(TEMP_FILE, PLAYLIST_FILE);

        console.log(`[PERSISTENCE] Playlist saved: ${playlistData.items.length} items`);
        return true;
    } catch (error) {
        console.error('[PERSISTENCE] Error saving playlist:', error.message);

        // Nettoyer le fichier temp en cas d'échec
        try {
            await fs.unlink(TEMP_FILE);
        } catch (cleanupError) {
            // Ignorer l'erreur de nettoyage
        }

        return false;
    }
}

/**
 * Load playlist from JSON file (avec récupération depuis backup si corrompu)
 *
 * @returns {Promise<Object|null>} - Loaded playlist data or null
 */
async function loadPlaylist() {
    const BACKUP_FILE = PLAYLIST_FILE + '.backup';

    // Essayer de charger le fichier principal
    try {
        const data = await fs.readFile(PLAYLIST_FILE, 'utf8');
        const playlistData = JSON.parse(data);

        // Validation de la structure
        if (!playlistData || !Array.isArray(playlistData.items)) {
            throw new Error('Invalid playlist structure');
        }

        console.log(`[PERSISTENCE] Playlist loaded: ${playlistData.items.length} items`);
        return playlistData;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[PERSISTENCE] No saved playlist found');
            return null;
        }

        // Fichier corrompu ou erreur de parsing
        console.error('[PERSISTENCE] Error loading playlist:', error.message);
        console.log('[PERSISTENCE] Attempting to restore from backup...');

        // Essayer de charger le backup
        try {
            const backupData = await fs.readFile(BACKUP_FILE, 'utf8');
            const playlistData = JSON.parse(backupData);

            if (!playlistData || !Array.isArray(playlistData.items)) {
                throw new Error('Invalid backup structure');
            }

            console.log(`[PERSISTENCE] ✓ Playlist restored from backup: ${playlistData.items.length} items`);

            // Restaurer le fichier principal depuis le backup
            await fs.copyFile(BACKUP_FILE, PLAYLIST_FILE);

            return playlistData;
        } catch (backupError) {
            console.error('[PERSISTENCE] Backup restoration failed:', backupError.message);
            console.error('[PERSISTENCE] ✗ CRITICAL: Unable to load playlist. Starting fresh.');
            return null;
        }
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
