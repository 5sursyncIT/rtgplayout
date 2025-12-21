/**
 * Media Scanner - Scans media directory and retrieves file metadata
 */

const fs = require('fs').promises;
const fsNative = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const MEDIA_PATH = 'Z:\\nodal\\medias\\';
const THUMBNAILS_DIR = path.join(__dirname, '../../frontend/thumbnails');

// Supported video extensions
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mxf', '.mpg', '.mpeg', '.mkv', '.webm'];

/**
 * Recursively get all video files in a directory
 * @param {string} dir - Directory to search
 * @returns {Promise<Array<string>>} - Array of absolute file paths
 */
async function getFilesRecursively(dir) {
    const results = [];
    
    try {
        const list = await fs.readdir(dir);
        
        for (const file of list) {
            const filePath = path.join(dir, file);
            
            try {
                const stat = await fs.stat(filePath);
                
                if (stat && stat.isDirectory()) {
                    // Recurse into subdirectory
                    const subResults = await getFilesRecursively(filePath);
                    results.push(...subResults);
                } else {
                    // Check extension
                    const ext = path.extname(file).toLowerCase();
                    if (VIDEO_EXTENSIONS.includes(ext)) {
                        results.push(filePath);
                    }
                }
            } catch (err) {
                console.warn(`[SCANNER] Error accessing ${filePath}: ${err.message}`);
            }
        }
    } catch (err) {
        console.warn(`[SCANNER] Error reading directory ${dir}: ${err.message}`);
    }
    
    return results;
}

/**
 * Get video duration using FFprobe
 * 
 * @param {string} filePath - Absolute path to video file
 * @returns {Promise<number>} - Duration in seconds
 */
async function getVideoDuration(filePath) {
    try {
        // Use full path to ffprobe to avoid PATH issues on network drives
        const ffprobePath = 'C:\\SERVER\\ffprobe.exe';
        const command = `"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
        const { stdout } = await execAsync(command);
        const duration = parseFloat(stdout.trim());

        return isNaN(duration) ? 0 : Math.round(duration);
    } catch (error) {
        console.warn(`[SCANNER] Could not get duration for ${path.basename(filePath)}:`, error.message);
        return 0;
    }
}

/**
 * Ensure thumbnails directory exists
 */
async function ensureThumbnailsDir() {
    try {
        await fs.mkdir(THUMBNAILS_DIR, { recursive: true });
    } catch (error) {
        console.error('[SCANNER] Could not create thumbnails directory:', error.message);
    }
}

/**
 * Generate thumbnail for video
 * 
 * @param {string} filePath - Absolute path to video file
 * @param {string} fileName - File name (without extension)
 * @returns {Promise<string>} - Relative path to thumbnail
 */
async function generateThumbnail(filePath, fileName) {
    const thumbnailName = `${fileName}.jpg`;
    const thumbnailPath = path.join(THUMBNAILS_DIR, thumbnailName);
    const relativePath = `/thumbnails/${thumbnailName}`;

    try {
        // Check if thumbnail already exists
        try {
            await fs.access(thumbnailPath);
            return relativePath;
        } catch (e) {
            // Does not exist, generate it
        }

        const ffmpegPath = 'C:\\SERVER\\ffmpeg.exe';
        // Take screenshot at 5 seconds, scale to 320px width
        const command = `"${ffmpegPath}" -y -i "${filePath}" -ss 00:00:05 -vframes 1 -vf scale=320:-1 "${thumbnailPath}"`;

        await execAsync(command);
        return relativePath;
    } catch (error) {
        console.warn(`[SCANNER] Could not generate thumbnail for ${fileName}:`, error.message);
        return null;
    }
}

/**
 * Scan media directory for video files
 * 
 * @returns {Promise<Array>} - Array of media file objects
 */
async function scanMediaDirectory() {
    console.log(`[SCANNER] Scanning media directory: ${MEDIA_PATH}`);
    await ensureThumbnailsDir();

    try {
        const filePaths = await getFilesRecursively(MEDIA_PATH);
        const mediaFiles = [];

        for (const filePath of filePaths) {
            const ext = path.extname(filePath).toLowerCase();
            
            // Calculate relative path for CasparCG (e.g. "SUBDIR/FILE.mp4")
            const relativePath = path.relative(MEDIA_PATH, filePath);
            const casparFile = relativePath.replace(/\\/g, '/'); // Normalize to forward slashes
            
            // For thumbnail name, flatten path to avoid subdirectory creation in thumbnails folder
            // e.g. "SUBDIR_FILE"
            const flatName = relativePath.replace(/[\/\\]/g, '_').replace(ext, '');

            try {
                const stats = await fs.stat(filePath);

                // Get duration (this can be slow, so we'll do it in batches)
                const duration = await getVideoDuration(filePath);

                // Generate thumbnail
                const thumbnail = await generateThumbnail(filePath, flatName);

                mediaFiles.push({
                    name: path.basename(filePath, ext), // Name without extension
                    file: casparFile,                   // Full filename (relative path with forward slashes)
                    path: filePath,                     // Absolute path
                    size: stats.size,                   // File size in bytes
                    durationSeconds: duration,          // Duration in seconds
                    modified: stats.mtime,              // Last modified date
                    thumbnail: thumbnail                // Path to thumbnail
                });

                console.log(`[SCANNER] Found: ${casparFile} (${duration}s)`);
            } catch (error) {
                console.warn(`[SCANNER] Error reading file ${filePath}:`, error.message);
            }
        }

        console.log(`[SCANNER] Found ${mediaFiles.length} video file(s)`);
        return mediaFiles;
    } catch (error) {
        console.error('[SCANNER] Error scanning media directory:', error.message);
        return [];
    }
}

/**
 * Scan media directory quickly (without duration)
 * For faster initial load
 * 
 * @returns {Promise<Array>} - Array of media file objects (without duration)
 */
async function scanMediaDirectoryQuick() {
    console.log(`[SCANNER] Quick scan of media directory: ${MEDIA_PATH}`);

    try {
        const filePaths = await getFilesRecursively(MEDIA_PATH);
        const mediaFiles = [];

        for (const filePath of filePaths) {
            const ext = path.extname(filePath).toLowerCase();
            
            // Calculate relative path for CasparCG
            const relativePath = path.relative(MEDIA_PATH, filePath);
            const casparFile = relativePath.replace(/\\/g, '/');

            try {
                const stats = await fs.stat(filePath);

                mediaFiles.push({
                    name: path.basename(filePath, ext),
                    file: casparFile,
                    path: filePath,
                    size: stats.size,
                    durationSeconds: 0, // Will be filled later
                    modified: stats.mtime
                });
            } catch (error) {
                console.warn(`[SCANNER] Error reading file ${filePath}:`, error.message);
            }
        }

        console.log(`[SCANNER] Quick scan found ${mediaFiles.length} video file(s)`);
        return mediaFiles;
    } catch (error) {
        console.error('[SCANNER] Error in quick scan:', error.message);
        return [];
    }
}

/**
 * Format file size to human-readable string
 * 
 * @param {number} bytes - File size in bytes
 * @returns {string} - Formatted size
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

let watcher = null;
let scanTimeout = null;

/**
 * Watch media directory for changes
 * @param {Function} callback - Function to call with new media list
 */
function watchMediaDirectory(callback) {
    if (watcher) return;
    
    console.log(`[WATCHER] Starting watch on ${MEDIA_PATH}`);
    try {
        watcher = fsNative.watch(MEDIA_PATH, { recursive: true }, (eventType, filename) => {
            if (filename) {
                // Ignore temporary files or hidden files if needed
                if (filename.startsWith('.')) return;
                
                // Debounce scan
                if (scanTimeout) clearTimeout(scanTimeout);
                
                console.log(`[WATCHER] File change detected: ${filename} (${eventType})`);
                
                scanTimeout = setTimeout(async () => {
                    console.log('[WATCHER] Triggering scan...');
                    // We perform a quick scan first to update the UI immediately
                    // Then we could optionally do a full scan for durations in background
                    const files = await scanMediaDirectoryQuick();
                    callback(files);
                    
                    // Trigger full scan in background to get durations/thumbnails
                    // But maybe we shouldn't flood with full scans. 
                    // Let's stick to quick scan + lazy loading or rely on manual full scan for now.
                    // Or maybe we should try to get info for just the new file? 
                    // For now, quick scan is safe.
                }, 2000);
            }
        });
        
        watcher.on('error', (error) => {
            console.error(`[WATCHER] Watcher error: ${error.message}`);
        });
        
    } catch (error) {
        console.error(`[WATCHER] Error watching directory: ${error.message}`);
    }
}

module.exports = {
    scanMediaDirectory,
    scanMediaDirectoryQuick,
    getVideoDuration,
    generateThumbnail,
    formatFileSize,
    watchMediaDirectory,
    MEDIA_PATH
};
