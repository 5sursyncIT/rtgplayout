/**
 * Media Folders - Virtual folder management for media library
 *
 * Provides folder structure without modifying physical file system
 * Allows organizing media files into logical categories
 */

class MediaFolders {
    constructor() {
        // Folders structure: Map<folderId, folderObject>
        this.folders = new Map();

        // Media assignments: Map<mediaFile, folderId>
        this.mediaAssignments = new Map();

        // Auto-increment ID
        this.nextId = 1;

        // Initialize with default folders
        this.initializeDefaults();
    }

    /**
     * Initialize default folders
     */
    initializeDefaults() {
        this.createFolder('Non classé', null, '#6c757d', true);
        this.createFolder('Vidéos', null, '#118ab2');
        this.createFolder('Jingles', null, '#06d6a0');
        this.createFolder('Publicités', null, '#e63946');
        this.createFolder('Génériques', null, '#f77f00');
    }

    /**
     * Create a new folder
     */
    createFolder(name, parentId = null, color = '#118ab2', isDefault = false) {
        const id = this.nextId++;

        const folder = {
            id,
            name,
            parentId,
            color,
            isDefault,
            createdAt: new Date(),
            mediaCount: 0
        };

        this.folders.set(id, folder);

        console.log(`[FOLDERS] Created folder: ${name} (ID: ${id})`);
        return folder;
    }

    /**
     * Update folder
     */
    updateFolder(id, updates) {
        const folder = this.folders.get(id);

        if (!folder) {
            throw new Error(`Folder ${id} not found`);
        }

        if (folder.isDefault && updates.name) {
            throw new Error('Cannot rename default folders');
        }

        Object.assign(folder, updates);

        console.log(`[FOLDERS] Updated folder ${id}:`, updates);
        return folder;
    }

    /**
     * Delete folder
     */
    deleteFolder(id) {
        const folder = this.folders.get(id);

        if (!folder) {
            throw new Error(`Folder ${id} not found`);
        }

        if (folder.isDefault) {
            throw new Error('Cannot delete default folders');
        }

        // Move all media from this folder to "Non classé" (ID: 1)
        const unclassifiedId = 1;
        for (const [mediaFile, folderId] of this.mediaAssignments) {
            if (folderId === id) {
                this.mediaAssignments.set(mediaFile, unclassifiedId);
            }
        }

        this.folders.delete(id);

        console.log(`[FOLDERS] Deleted folder ${id}`);
        return true;
    }

    /**
     * Assign media file to folder
     */
    assignMedia(mediaFile, folderId) {
        if (folderId !== null && !this.folders.has(folderId)) {
            throw new Error(`Folder ${folderId} not found`);
        }

        // Remove from previous folder count
        const previousFolderId = this.mediaAssignments.get(mediaFile);
        if (previousFolderId) {
            const previousFolder = this.folders.get(previousFolderId);
            if (previousFolder) {
                previousFolder.mediaCount = Math.max(0, previousFolder.mediaCount - 1);
            }
        }

        // Assign to new folder
        if (folderId === null) {
            this.mediaAssignments.delete(mediaFile);
        } else {
            this.mediaAssignments.set(mediaFile, folderId);

            // Update new folder count
            const newFolder = this.folders.get(folderId);
            if (newFolder) {
                newFolder.mediaCount++;
            }
        }

        console.log(`[FOLDERS] Assigned ${mediaFile} to folder ${folderId}`);
        return true;
    }

    /**
     * Sync assignments with physical directory structure
     * @param {Array} mediaFiles - List of media files from scanner
     */
    syncWithPhysicalStructure(mediaFiles) {
        let changed = false;

        for (const media of mediaFiles) {
            // Check if file is in a subdirectory (contains forward slash)
            // media.file uses forward slashes as normalized by scanner
            const parts = media.file.split('/');
            
            if (parts.length > 1) {
                // It's in a subdirectory
                const folderName = parts[0];
                
                // Find folder by name (case insensitive)
                let targetFolderId = null;
                for (const folder of this.folders.values()) {
                    if (folder.name.toLowerCase() === folderName.toLowerCase()) {
                        targetFolderId = folder.id;
                        break;
                    }
                }
                
                if (targetFolderId) {
                    // Only assign if not already assigned explicitly
                    if (!this.mediaAssignments.has(media.file)) {
                        this.mediaAssignments.set(media.file, targetFolderId);
                        changed = true;
                        console.log(`[FOLDERS] Auto-assigned ${media.file} to folder "${folderName}"`);
                    }
                }
            }
        }
        
        if (changed) {
            this.recalculateCounts();
        }
    }

    /**
     * Get folder for a media file
     */
    getFolderForMedia(mediaFile) {
        return this.mediaAssignments.get(mediaFile) || 1; // Default to "Non classé"
    }

    /**
     * Get all media in a folder
     */
    getMediaInFolder(folderId) {
        const mediaFiles = [];

        for (const [mediaFile, assignedFolderId] of this.mediaAssignments) {
            if (assignedFolderId === folderId) {
                mediaFiles.push(mediaFile);
            }
        }

        return mediaFiles;
    }

    /**
     * Get all folders
     */
    getAllFolders() {
        const folders = [];

        for (const folder of this.folders.values()) {
            folders.push({ ...folder });
        }

        // Sort by ID (default folders first)
        folders.sort((a, b) => a.id - b.id);

        return folders;
    }

    /**
     * Get folder by ID
     */
    getFolder(id) {
        const folder = this.folders.get(id);
        return folder ? { ...folder } : null;
    }

    /**
     * Recalculate media counts for all folders
     */
    recalculateCounts() {
        // Reset all counts
        for (const folder of this.folders.values()) {
            folder.mediaCount = 0;
        }

        // Count media assignments
        for (const folderId of this.mediaAssignments.values()) {
            const folder = this.folders.get(folderId);
            if (folder) {
                folder.mediaCount++;
            }
        }

        console.log('[FOLDERS] Recalculated media counts');
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            totalFolders: this.folders.size,
            totalAssignments: this.mediaAssignments.size,
            folders: this.getAllFolders()
        };
    }

    /**
     * Serialize to JSON for persistence
     */
    toJSON() {
        return {
            folders: Array.from(this.folders.entries()),
            mediaAssignments: Array.from(this.mediaAssignments.entries()),
            nextId: this.nextId
        };
    }

    /**
     * Load from JSON
     */
    fromJSON(data) {
        if (!data) return;

        this.folders = new Map(data.folders || []);
        this.mediaAssignments = new Map(data.mediaAssignments || []);
        this.nextId = data.nextId || 1;

        console.log(`[FOLDERS] Loaded ${this.folders.size} folders and ${this.mediaAssignments.size} assignments`);
    }

    /**
     * Clear all data
     */
    clear() {
        this.folders.clear();
        this.mediaAssignments.clear();
        this.nextId = 1;
        this.initializeDefaults();

        console.log('[FOLDERS] Cleared all folder data');
    }
}

module.exports = MediaFolders;
