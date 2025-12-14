/**
 * Media Scanner - Scans media directory and retrieves file metadata
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const MEDIA_PATH = 'Z:\\nodal\\medias\\';
const THUMBNAILS_DIR = path.join(__dirname, '../../frontend/thumbnails');

// Supported video extensions
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mxf', '.mpg', '.mpeg', '.mkv', '.webm'];

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
        const files = await fs.readdir(MEDIA_PATH);
        const mediaFiles = [];

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();

            // Skip non-video files
            if (!VIDEO_EXTENSIONS.includes(ext)) {
                continue;
            }

            const filePath = path.join(MEDIA_PATH, file);

            try {
                const stats = await fs.stat(filePath);

                // Get duration (this can be slow, so we'll do it in batches)
                const duration = await getVideoDuration(filePath);

                // Generate thumbnail
                const thumbnail = await generateThumbnail(filePath, path.basename(file, ext));

                mediaFiles.push({
                    name: path.basename(file, ext), // Name without extension
                    file: file,                     // Full filename
                    path: filePath,                 // Absolute path
                    size: stats.size,               // File size in bytes
                    durationSeconds: duration,      // Duration in seconds
                    modified: stats.mtime,          // Last modified date
                    thumbnail: thumbnail            // Path to thumbnail
                });

                console.log(`[SCANNER] Found: ${file} (${duration}s)`);
            } catch (error) {
                console.warn(`[SCANNER] Error reading file ${file}:`, error.message);
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
        const files = await fs.readdir(MEDIA_PATH);
        const mediaFiles = [];

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();

            if (!VIDEO_EXTENSIONS.includes(ext)) {
                continue;
            }

            const filePath = path.join(MEDIA_PATH, file);

            try {
                const stats = await fs.stat(filePath);

                mediaFiles.push({
                    name: path.basename(file, ext),
                    file: file,
                    path: filePath,
                    size: stats.size,
                    durationSeconds: 0, // Will be filled later
                    modified: stats.mtime
                });
            } catch (error) {
                console.warn(`[SCANNER] Error reading file ${file}:`, error.message);
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

module.exports = {
    scanMediaDirectory,
    scanMediaDirectoryQuick,
    getVideoDuration,
    generateThumbnail,
    formatFileSize,
    MEDIA_PATH
};
