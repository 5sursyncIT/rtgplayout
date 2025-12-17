/**
 * RTG Playout - WebSocket & HTTP Server
 * 
 * Manages playlist state and broadcasts updates to connected clients
 * Serves frontend files via HTTP
 * Integrates media scanner, persistence, CasparCG control, and autoplay
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const playlist = require('./models/playlist');
const { scanMediaDirectoryQuick, scanMediaDirectory } = require('./utils/mediaScanner');
const { loadPlaylist, savePlaylist } = require('./utils/persistence');
const { parseXMLPlaylist } = require('./utils/xmlParser');
const CasparClient = require('./caspar/casparClient');
const TemplateController = require('./caspar/templateController');
const MediaFolders = require('./models/mediaFolders');
const { saveFolders, loadFolders } = require('./utils/folderPersistence');

// Force reload of AutoplayScheduler to ensure latest code is used
// Clear all cached modules from the scheduler directory
Object.keys(require.cache).forEach(key => {
    if (key.includes('scheduler')) {
        delete require.cache[key];
    }
});
const AutoplayScheduler = require('./scheduler/autoplayScheduler');

const logger = require('./utils/logger');
const ErrorHandler = require('./utils/errorHandler');

const WS_PORT = 8080;
const HTTP_PORT = 3000;

// CONFIGURATION: Specify your preferred IP address here
// Set to null for auto-detection
const PREFERRED_IP = '172.16.4.180';

// CasparCG Configuration
const CASPAR_HOST = '127.0.0.1';
const CASPAR_PORT = 5250;
const CASPAR_CHANNEL = 1;
const CASPAR_LAYER = 10;

// Media library cache
let mediaLibrary = [];
let isScanning = false;

// CasparCG client instance
let casparClient = null;
let casparConnected = false;

// Autoplay scheduler instance
let autoplayScheduler = null;

// Template controller instance
let templateController = null;

// Error handler instance
let errorHandler = null;

// Media folders instance
let mediaFolders = null;

// Get local IP address
function getLocalIP() {
    if (PREFERRED_IP) {
        return PREFERRED_IP;
    }

    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

const localIP = getLocalIP();

// Create HTTP server for frontend
const httpServer = http.createServer((req, res) => {
    const frontendPath = path.join(__dirname, '../frontend');
    let filePath = path.join(frontendPath, req.url === '/' ? 'index.html' : req.url);

    if (!filePath.startsWith(frontendPath)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const extname = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json'
    };

    const contentType = contentTypes[extname] || 'text/plain';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    logger.info(`[HTTP] Frontend server running on:`);
    logger.info(`       http://localhost:${HTTP_PORT}`);
    logger.info(`       http://${localIP}:${HTTP_PORT}`);
});

// Create WebSocket server
const wss = new WebSocket.Server({
    port: WS_PORT,
    host: '0.0.0.0'
});

logger.info(`[WS] WebSocket server running on:`);
logger.info(`     ws://localhost:${WS_PORT}`);
logger.info(`     ws://${localIP}:${WS_PORT}`);

// Initialize playlist from saved data
async function initializePlaylist() {
    const savedPlaylist = await loadPlaylist();

    if (savedPlaylist && savedPlaylist.items && savedPlaylist.items.length > 0) {
        playlist.setItems(savedPlaylist.items);
        if (savedPlaylist.baseStartAt) {
            playlist.setBaseStartAt(savedPlaylist.baseStartAt);
        }
        logger.info(`[PLAYLIST] Loaded ${savedPlaylist.items.length} items from saved playlist`);
    } else {
        playlist.setBaseStartAt(null);
        logger.info('[PLAYLIST] No saved playlist found, starting with empty playlist');
    }
}

// Initialize media library (quick scan)
async function initializeMediaLibrary() {
    logger.info('[MEDIA] Performing quick scan of media directory...');
    mediaLibrary = await scanMediaDirectoryQuick();
    logger.info(`[MEDIA] Quick scan complete: ${mediaLibrary.length} files found`);
}

// Initialize CasparCG connection
async function initializeCaspar() {
    casparClient = new CasparClient(CASPAR_HOST, CASPAR_PORT);

    // Initialize template controller if not exists, or update client
    if (!templateController) {
        templateController = new TemplateController(casparClient, broadcast);
        logger.info('[TEMPLATE] Template controller initialized');
    } else {
        // Update client reference in existing controller to preserve presets/state
        templateController.casparClient = casparClient;
        logger.info('[TEMPLATE] Template controller client updated');
    }

    try {
        await casparClient.connect();
        const version = await casparClient.version();
        logger.info(`[CASPAR] Connected successfully: ${version}`);
        casparConnected = true;
    } catch (error) {
        logger.error('[CASPAR] Connection failed:', error.message);
        logger.info('[CASPAR] Will retry on first PLAY command');
        casparConnected = false;
    }
}

// Auto-save playlist after changes
async function autoSavePlaylist() {
    const playlistData = playlist.getRaw();
    await savePlaylist(playlistData);
}

/**
 * Broadcast message to all connected clients
 */
function broadcast(message) {
    const messageStr = JSON.stringify(message);
    let sentCount = 0;

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
            sentCount++;
        }
    });

    // Don't log every broadcast to avoid clutter, only important ones
    if (message.type !== 'PLAYBACK_STATUS' && message.type !== 'AUTOPLAY_STATUS') {
        logger.info(`[WS] Broadcast to ${sentCount} client(s): ${message.type}`);
    }
}

/**
 * Send playlist to a specific client
 */
function sendPlaylist(ws, type = 'PLAYLIST_FULL') {
    const scheduled = playlist.getScheduled();
    const message = {
        type,
        data: scheduled
    };

    ws.send(JSON.stringify(message));
    logger.info(`[WS] Sent ${type} to client`);
}

/**
 * Send media library to a specific client
 */
function sendMediaLibrary(ws) {
    // Enrich media files with folder information
    const enrichedFiles = mediaLibrary.map(media => {
        const folderId = mediaFolders ? mediaFolders.getFolderForMedia(media.file) : 1;
        return {
            ...media,
            folderId
        };
    });

    const message = {
        type: 'MEDIA_LIBRARY',
        data: {
            files: enrichedFiles,
            isScanning: isScanning
        }
    };

    ws.send(JSON.stringify(message));
    logger.info(`[WS] Sent MEDIA_LIBRARY to client (${mediaLibrary.length} files)`);
}

/**
 * Handle client messages
 */
function handleMessage(ws, data) {
    try {
        const message = JSON.parse(data);
        logger.info(`[WS] Received: ${message.type}`);

        switch (message.type) {
            case 'ADD_ITEM':
                handleAddItem(message.data);
                break;

            case 'REMOVE_ITEM':
                handleRemoveItem(message.data);
                break;

            case 'REORDER_PLAYLIST':
                handleReorderPlaylist(message.data);
                break;

            case 'SET_BASE_START':
                handleSetBaseStart(message.data);
                break;

            case 'GET_PLAYLIST':
                sendPlaylist(ws, 'PLAYLIST_FULL');
                break;

            case 'GET_MEDIA_LIBRARY':
                sendMediaLibrary(ws);
                break;

            case 'SCAN_MEDIA':
                handleScanMedia(ws);
                break;

            case 'CLEAR_PLAYLIST':
                handleClearPlaylist();
                break;

            case 'IMPORT_XML':
                handleImportXML(message.data);
                break;

            case 'PLAY_ITEM':
                handlePlayItem(message.data);
                break;

            case 'STOP_PLAYBACK':
                handleStopPlayback(message.data);
                break;

            case 'CONNECT_CASPAR':
                handleConnectCaspar();
                break;

            case 'SET_AUTOPLAY_MODE':
                handleSetAutoplayMode(message.data);
                break;

            case 'GET_AUTOPLAY_STATUS':
                handleGetAutoplayStatus(ws);
                break;

            // Template control messages
            case 'TEMPLATE_LOAD':
                handleTemplateLoad(message.data);
                break;

            case 'TEMPLATE_PLAY':
                handleTemplatePlay(message.data);
                break;

            case 'TEMPLATE_STOP':
                handleTemplateStop(message.data);
                break;

            case 'TEMPLATE_UPDATE':
                handleTemplateUpdate(message.data);
                break;

            case 'TEMPLATE_REMOVE':
                handleTemplateRemove(message.data);
                break;

            case 'TEMPLATE_LOAD_AND_PLAY':
                handleTemplateLoadAndPlay(message.data);
                break;

            case 'TEMPLATE_GET_ACTIVE':
                handleTemplateGetActive(ws);
                break;

            case 'PRESET_SAVE':
                handlePresetSave(message.data);
                break;

            case 'PRESET_LOAD':
                handlePresetLoad(message.data);
                break;

            case 'PRESET_GET_ALL':
                handlePresetGetAll(ws);
                break;

            case 'PRESET_DELETE':
                handlePresetDelete(message.data);
                break;

            // Media folder messages
            case 'FOLDER_CREATE':
                handleFolderCreate(message.data);
                break;

            case 'FOLDER_UPDATE':
                handleFolderUpdate(message.data);
                break;

            case 'FOLDER_DELETE':
                handleFolderDelete(message.data);
                break;

            case 'FOLDER_ASSIGN_MEDIA':
                handleFolderAssignMedia(message.data);
                break;

            case 'FOLDER_GET_ALL':
                handleFolderGetAll(ws);
                break;

            case 'PLAYLIST_SET_HARD_START':
                handleSetHardStart(message.data);
                break;

            case 'SECONDARY_EVENT_ADD':
                handleSecondaryEventAdd(message.data);
                break;
            
            case 'SECONDARY_EVENT_REMOVE':
                handleSecondaryEventRemove(message.data);
                break;

            default:
                logger.warn(`[WS] Unknown message type: ${message.type}`);
                ws.send(JSON.stringify({
                    type: 'ERROR',
                    data: { message: `Unknown message type: ${message.type}` }
                }));
        }
    } catch (error) {
        logger.error('[WS] Error handling message:', error.message);
        ws.send(JSON.stringify({
            type: 'ERROR',
            data: { message: error.message }
        }));
    }
}

/**
 * Helper to notify scheduler of playlist updates
 */
function notifyPlaylistUpdate() {
    if (autoplayScheduler) {
        autoplayScheduler.onPlaylistUpdated();
        broadcast({
            type: 'AUTOPLAY_STATUS',
            data: autoplayScheduler.getStatus()
        });
    }
}

/**
 * Handle ADD_ITEM message
 */
async function handleAddItem(data) {
    try {
        const item = playlist.addItem(data);
        logger.info(`[PLAYLIST] Item added: ${item.name}`);

        // Recalculate hard start timings
        playlist.recalculateWithHardStart();

        await autoSavePlaylist();

        broadcast({
            type: 'PLAYLIST_UPDATED',
            data: playlist.getScheduled()
        });

        notifyPlaylistUpdate();
    } catch (error) {
        logger.error('[PLAYLIST] Error adding item:', error.message);
        throw error;
    }
}

/**
 * Handle REMOVE_ITEM message
 */
async function handleRemoveItem(data) {
    try {
        const removed = playlist.removeItem(data.id);

        if (removed) {
            logger.info(`[PLAYLIST] Item removed: ${data.id}`);

            // Recalculate hard start timings
            playlist.recalculateWithHardStart();

            await autoSavePlaylist();

            broadcast({
                type: 'PLAYLIST_UPDATED',
                data: playlist.getScheduled()
            });

            notifyPlaylistUpdate();
        }
    } catch (error) {
        logger.error('[PLAYLIST] Error removing item:', error.message);
        throw error;
    }
}

/**
 * Handle REORDER_PLAYLIST message
 */
async function handleReorderPlaylist(data) {
    try {
        const { fromIndex, toIndex } = data;
        const success = playlist.reorderItems(fromIndex, toIndex);

        if (success) {
            logger.info(`[PLAYLIST] Items reordered: ${fromIndex} -> ${toIndex}`);

            // Recalculate hard start timings
            playlist.recalculateWithHardStart();

            await autoSavePlaylist();

            broadcast({
                type: 'PLAYLIST_UPDATED',
                data: playlist.getScheduled()
            });

            notifyPlaylistUpdate();
        }
    } catch (error) {
        logger.error('[PLAYLIST] Error reordering items:', error.message);
        throw error;
    }
}

/**
 * Handle SET_BASE_START message
 */
async function handleSetBaseStart(data) {
    try {
        playlist.setBaseStartAt(data.isoDate);
        logger.info(`[PLAYLIST] Base start time updated`);

        // Recalculate hard start timings
        playlist.recalculateWithHardStart();

        await autoSavePlaylist();

        broadcast({
            type: 'PLAYLIST_UPDATED',
            data: playlist.getScheduled()
        });

        notifyPlaylistUpdate();
    } catch (error) {
        logger.error('[PLAYLIST] Error setting base start:', error.message);
        throw error;
    }
}

/**
 * Handle PLAYLIST_SET_HARD_START message
 */
async function handleSetHardStart(data) {
    try {
        const { itemId, hardStartTime } = data;

        // Find the item
        const item = playlist.items.find(i => i.id === itemId);
        if (!item) {
            throw new Error(`Item ${itemId} not found`);
        }

        // Set or clear hard start time
        if (hardStartTime) {
            item.hardStartTime = hardStartTime;
            logger.info(`[PLAYLIST] Hard start time set for item ${itemId}: ${hardStartTime}`);
        } else {
            delete item.hardStartTime;
            logger.info(`[PLAYLIST] Hard start time removed for item ${itemId}`);
        }

        // Recalculate schedule with hard start constraints
        const result = playlist.recalculateWithHardStart();

        // If there are errors, send them to the client but still save
        if (!result.success && result.errors.length > 0) {
            logger.warn('[PLAYLIST] Hard start adjustment failed:', result.errors);

            // Send error notification to client
            broadcast({
                type: 'HARD_START_ERROR',
                data: {
                    errors: result.errors
                }
            });
        }

        await autoSavePlaylist();

        broadcast({
            type: 'PLAYLIST_UPDATED',
            data: playlist.getScheduled()
        });

        notifyPlaylistUpdate();
    } catch (error) {
        logger.error('[PLAYLIST] Error setting hard start:', error.message);
        throw error;
    }
}

/**
 * Handle SECONDARY_EVENT_ADD
 */
async function handleSecondaryEventAdd(data) {
    try {
        const { itemId, event } = data;
        
        const item = playlist.items.find(i => i.id === itemId);
        if (!item) throw new Error(`Item ${itemId} not found`);

        if (!item.secondaryEvents) item.secondaryEvents = [];
        
        // Add ID if missing
        if (!event.id) event.id = `evt-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        
        item.secondaryEvents.push(event);
        logger.info(`[SECONDARY] Added event to ${item.name}: ${event.type} (${event.trigger})`);

        await autoSavePlaylist();
        broadcast({ type: 'PLAYLIST_UPDATED', data: playlist.getScheduled() });
        notifyPlaylistUpdate();

    } catch (error) {
        logger.error('[SECONDARY] Add failed:', error.message);
        broadcast({ type: 'ERROR', data: { message: `Add event failed: ${error.message}` } });
    }
}

/**
 * Handle SECONDARY_EVENT_REMOVE
 */
async function handleSecondaryEventRemove(data) {
    try {
        const { itemId, eventId } = data;
        
        const item = playlist.items.find(i => i.id === itemId);
        if (!item) throw new Error(`Item ${itemId} not found`);

        if (item.secondaryEvents) {
            item.secondaryEvents = item.secondaryEvents.filter(e => e.id !== eventId);
            logger.info(`[SECONDARY] Removed event ${eventId} from ${item.name}`);
        }

        await autoSavePlaylist();
        broadcast({ type: 'PLAYLIST_UPDATED', data: playlist.getScheduled() });
        notifyPlaylistUpdate();

    } catch (error) {
        logger.error('[SECONDARY] Remove failed:', error.message);
        broadcast({ type: 'ERROR', data: { message: `Remove event failed: ${error.message}` } });
    }
}

/**
 * Handle SCAN_MEDIA message (full scan with FFprobe)
 */
async function handleScanMedia(ws) {
    if (isScanning) {
        ws.send(JSON.stringify({
            type: 'ERROR',
            data: { message: 'Scan already in progress' }
        }));
        return;
    }

    isScanning = true;
    logger.info('[MEDIA] Starting full media scan with FFprobe...');

    broadcast({
        type: 'SCAN_STARTED',
        data: {}
    });

    try {
        mediaLibrary = await scanMediaDirectory();
        logger.info(`[MEDIA] Full scan complete: ${mediaLibrary.length} files`);

        broadcast({
            type: 'MEDIA_LIBRARY',
            data: {
                files: mediaLibrary,
                isScanning: false
            }
        });
    } catch (error) {
        logger.error('[MEDIA] Error during scan:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: 'Media scan failed: ' + error.message }
        });
    } finally {
        isScanning = false;
    }
}

/**
 * Handle CLEAR_PLAYLIST message
 */
async function handleClearPlaylist() {
    try {
        playlist.setItems([]);
        logger.info('[PLAYLIST] Playlist cleared');

        await autoSavePlaylist();

        broadcast({
            type: 'PLAYLIST_UPDATED',
            data: playlist.getScheduled()
        });

        notifyPlaylistUpdate();
    } catch (error) {
        logger.error('[PLAYLIST] Error clearing playlist:', error.message);
        throw error;
    }
}

/**
 * Handle CONNECT_CASPAR message
 */
async function handleConnectCaspar() {
    try {
        await initializeCaspar();
        broadcast({
            type: 'CASPAR_STATUS',
            data: { connected: casparConnected }
        });
    } catch (error) {
        logger.error('[CASPAR] Connection error:', error.message);
    }
}

/**
 * Handle IMPORT_XML message
 */
async function handleImportXML(data) {
    try {
        logger.info(`[XML] Importing playlist from: ${data.xmlPath}`);

        const result = await parseXMLPlaylist(data.xmlPath);
        playlist.setItems(result.items);
        
        // Recalculate hard start timings
        playlist.recalculateWithHardStart();

        await autoSavePlaylist();

        broadcast({
            type: 'PLAYLIST_UPDATED',
            data: playlist.getScheduled()
        });

        notifyPlaylistUpdate();
    } catch (error) {
        logger.error('[XML] Import failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `XML import failed: ${error.message}` }
        });
    }
}

/**
 * Handle PLAY_ITEM message
 */
async function handlePlayItem(data) {
    try {
        if (!casparConnected) {
            logger.info('[CASPAR] Not connected, attempting to connect...');
            await initializeCaspar();
        }

        if (!casparConnected) {
            throw new Error('CasparCG not connected');
        }

        logger.info(`[CASPAR] Playing: ${data.file}`);

        // Remove file extension for CasparCG
        const fileName = data.file.replace(/\.[^/.]+$/, '');

        await casparClient.play(CASPAR_CHANNEL, CASPAR_LAYER, fileName);

        logger.info(`[CASPAR] Now playing: ${fileName}`);

        // Reset retry count for this item if playback succeeds
        if (errorHandler) {
            errorHandler.resetRetries(data.id);
        }

        // Sync autoplay scheduler state
        if (autoplayScheduler) {
            autoplayScheduler.syncState(data.id);

            // Broadcast updated autoplay status (for next item display)
            broadcast({
                type: 'AUTOPLAY_STATUS',
                data: autoplayScheduler.getStatus()
            });
        }

        broadcast({
            type: 'PLAYBACK_STATUS',
            data: {
                itemId: data.id,
                status: 'playing',
                file: data.file
            }
        });
    } catch (error) {
        logger.error('[CASPAR] Play failed:', error.message);

        // Use ErrorHandler for retry/fallback
        if (errorHandler) {
            // Find item in playlist to pass full item object
            const item = playlist.getItem(data.id);
            if (item) {
                await errorHandler.handlePlayError(error, item, CASPAR_CHANNEL, CASPAR_LAYER);
            }
        } else {
            broadcast({
                type: 'ERROR',
                data: { message: `Playback failed: ${error.message}` }
            });
        }
    }
}

/**
 * Handle STOP_PLAYBACK message
 */
async function handleStopPlayback(data) {
    try {
        if (!casparConnected) {
            throw new Error('CasparCG not connected');
        }

        logger.info(`[CASPAR] Stopping playback on ${CASPAR_CHANNEL}-${CASPAR_LAYER}`);

        await casparClient.stop(CASPAR_CHANNEL, CASPAR_LAYER);

        logger.info('[CASPAR] Playback stopped');

        // Sync autoplay scheduler state
        if (autoplayScheduler) {
            // This will reset current item and stop polling
            autoplayScheduler.stopPlayback();

            broadcast({
                type: 'AUTOPLAY_STATUS',
                data: autoplayScheduler.getStatus()
            });
        }

        broadcast({
            type: 'PLAYBACK_STATUS',
            data: {
                itemId: null,
                status: 'stopped'
            }
        });
    } catch (error) {
        logger.error('[CASPAR] Stop failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Stop failed: ${error.message}` }
        });
    }
}

/**
 * Handle SET_AUTOPLAY_MODE message
 */
function handleSetAutoplayMode(data) {
    try {
        if (!autoplayScheduler) {
            throw new Error('Autoplay scheduler not initialized');
        }

        autoplayScheduler.setMode(data.mode);
        logger.info(`[AUTOPLAY] Mode changed to: ${data.mode}`);

        broadcast({
            type: 'AUTOPLAY_STATUS',
            data: autoplayScheduler.getStatus()
        });
    } catch (error) {
        logger.error('[AUTOPLAY] Set mode failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Autoplay mode change failed: ${error.message}` }
        });
    }
}

/**
 * Handle GET_AUTOPLAY_STATUS message
 */
function handleGetAutoplayStatus(ws) {
    try {
        if (!autoplayScheduler) {
            throw new Error('Autoplay scheduler not initialized');
        }

        ws.send(JSON.stringify({
            type: 'AUTOPLAY_STATUS',
            data: autoplayScheduler.getStatus()
        }));

        logger.info('[AUTOPLAY] Sent status to client');
    } catch (error) {
        logger.error('[AUTOPLAY] Get status failed:', error.message);
    }
}

/**
 * Template control handlers
 */
async function handleTemplateLoad(data) {
    try {
        if (!casparConnected) {
            logger.info('[CASPAR] Not connected, attempting to connect...');
            await initializeCaspar();
        }

        if (!templateController) {
            throw new Error('Template controller not initialized');
        }

        const { channel, layer, templateName, templateData } = data;
        await templateController.loadTemplate(channel, layer, templateName, templateData);
        logger.info(`[TEMPLATE] Loaded ${templateName} on ${channel}-${layer}`);
    } catch (error) {
        logger.error('[TEMPLATE] Load failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Template load failed: ${error.message}` }
        });
    }
}

async function handleTemplatePlay(data) {
    try {
        if (!casparConnected) {
            logger.info('[CASPAR] Not connected, attempting to connect...');
            await initializeCaspar();
        }

        if (!templateController) {
            throw new Error('Template controller not initialized');
        }

        const { channel, layer } = data;
        await templateController.playTemplate(channel, layer);
        logger.info(`[TEMPLATE] Playing ${channel}-${layer}`);
    } catch (error) {
        logger.error('[TEMPLATE] Play failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Template play failed: ${error.message}` }
        });
    }
}

async function handleTemplateStop(data) {
    try {
        if (!casparConnected) {
            logger.info('[CASPAR] Not connected, attempting to connect...');
            await initializeCaspar();
        }

        if (!templateController) {
            throw new Error('Template controller not initialized');
        }

        const { channel, layer } = data;
        await templateController.stopTemplate(channel, layer);
        logger.info(`[TEMPLATE] Stopped ${channel}-${layer}`);
    } catch (error) {
        logger.error('[TEMPLATE] Stop failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Template stop failed: ${error.message}` }
        });
    }
}

async function handleTemplateUpdate(data) {
    try {
        if (!casparConnected) {
            logger.info('[CASPAR] Not connected, attempting to connect...');
            await initializeCaspar();
        }

        if (!templateController) {
            throw new Error('Template controller not initialized');
        }

        const { channel, layer, templateData } = data;
        await templateController.updateTemplate(channel, layer, templateData);
        logger.info(`[TEMPLATE] Updated ${channel}-${layer}`);
    } catch (error) {
        logger.error('[TEMPLATE] Update failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Template update failed: ${error.message}` }
        });
    }
}

async function handleTemplateRemove(data) {
    try {
        if (!casparConnected) {
            logger.info('[CASPAR] Not connected, attempting to connect...');
            await initializeCaspar();
        }

        if (!templateController) {
            throw new Error('Template controller not initialized');
        }

        const { channel, layer } = data;
        await templateController.removeTemplate(channel, layer);
        logger.info(`[TEMPLATE] Removed ${channel}-${layer}`);
    } catch (error) {
        logger.error('[TEMPLATE] Remove failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Template remove failed: ${error.message}` }
        });
    }
}

async function handleTemplateLoadAndPlay(data) {
    try {
        if (!casparConnected) {
            logger.info('[CASPAR] Not connected, attempting to connect...');
            await initializeCaspar();
        }

        if (!templateController) {
            throw new Error('Template controller not initialized');
        }

        const { channel, layer, templateName, templateData } = data;
        await templateController.loadAndPlay(channel, layer, templateName, templateData);
        logger.info(`[TEMPLATE] Loaded and played ${templateName} on ${channel}-${layer}`);
    } catch (error) {
        logger.error('[TEMPLATE] Load and play failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Template load and play failed: ${error.message}` }
        });
    }
}

function handleTemplateGetActive(ws) {
    try {
        if (!templateController) {
            throw new Error('Template controller not initialized');
        }

        const activeTemplates = templateController.getActiveTemplates();
        ws.send(JSON.stringify({
            type: 'TEMPLATE_ACTIVE_LIST',
            data: { templates: activeTemplates }
        }));

        logger.info('[TEMPLATE] Sent active templates to client');
    } catch (error) {
        logger.error('[TEMPLATE] Get active failed:', error.message);
    }
}

/**
 * Preset handlers
 */
function handlePresetSave(data) {
    try {
        if (!templateController) {
            throw new Error('Template controller not initialized');
        }

        const { name, channel, layer, templateName, templateData } = data;
        templateController.savePreset(name, channel, layer, templateName, templateData);
        logger.info(`[PRESET] Saved: ${name}`);

        broadcast({
            type: 'PRESET_LIST',
            data: { presets: templateController.getPresets() }
        });
    } catch (error) {
        logger.error('[PRESET] Save failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Preset save failed: ${error.message}` }
        });
    }
}

async function handlePresetLoad(data) {
    try {
        if (!casparConnected) {
            logger.info('[CASPAR] Not connected, attempting to connect...');
            await initializeCaspar();
        }

        if (!templateController) {
            throw new Error('Template controller not initialized');
        }

        const { name, play } = data;
        await templateController.loadPreset(name, play !== false);
        logger.info(`[PRESET] Loaded: ${name}`);
    } catch (error) {
        logger.error('[PRESET] Load failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Preset load failed: ${error.message}` }
        });
    }
}

function handlePresetGetAll(ws) {
    try {
        if (!templateController) {
            throw new Error('Template controller not initialized');
        }

        const presets = templateController.getPresets();
        ws.send(JSON.stringify({
            type: 'PRESET_LIST',
            data: { presets }
        }));

        logger.info('[PRESET] Sent presets to client');
    } catch (error) {
        logger.error('[PRESET] Get all failed:', error.message);
    }
}

function handlePresetDelete(data) {
    try {
        if (!templateController) {
            throw new Error('Template controller not initialized');
        }

        const { name } = data;
        templateController.deletePreset(name);
        logger.info(`[PRESET] Deleted: ${name}`);

        broadcast({
            type: 'PRESET_LIST',
            data: { presets: templateController.getPresets() }
        });
    } catch (error) {
        logger.error('[PRESET] Delete failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Preset delete failed: ${error.message}` }
        });
    }
}

/**
 * Media Folder handlers
 */
function handleFolderCreate(data) {
    try {
        if (!mediaFolders) {
            throw new Error('Media folders not initialized');
        }

        const { name, parentId, color } = data;
        const folder = mediaFolders.createFolder(name, parentId, color);
        logger.info(`[FOLDER] Created: ${name}`);

        // Save to disk
        saveFolders(mediaFolders).catch(err => {
            logger.error('[FOLDER] Failed to save after create:', err.message);
        });

        broadcast({
            type: 'FOLDER_LIST',
            data: { folders: mediaFolders.getAllFolders() }
        });

        broadcast({
            type: 'NOTIFICATION',
            data: {
                level: 'success',
                message: `Dossier "${name}" créé`
            }
        });
    } catch (error) {
        logger.error('[FOLDER] Create failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Folder create failed: ${error.message}` }
        });
    }
}

function handleFolderUpdate(data) {
    try {
        if (!mediaFolders) {
            throw new Error('Media folders not initialized');
        }

        const { id, updates } = data;
        const folder = mediaFolders.updateFolder(id, updates);
        logger.info(`[FOLDER] Updated: ${id}`);

        // Save to disk
        saveFolders(mediaFolders).catch(err => {
            logger.error('[FOLDER] Failed to save after update:', err.message);
        });

        broadcast({
            type: 'FOLDER_LIST',
            data: { folders: mediaFolders.getAllFolders() }
        });
    } catch (error) {
        logger.error('[FOLDER] Update failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Folder update failed: ${error.message}` }
        });
    }
}

function handleFolderDelete(data) {
    try {
        if (!mediaFolders) {
            throw new Error('Media folders not initialized');
        }

        const { id } = data;
        mediaFolders.deleteFolder(id);
        logger.info(`[FOLDER] Deleted: ${id}`);

        // Save to disk
        saveFolders(mediaFolders).catch(err => {
            logger.error('[FOLDER] Failed to save after delete:', err.message);
        });

        broadcast({
            type: 'FOLDER_LIST',
            data: { folders: mediaFolders.getAllFolders() }
        });

        broadcast({
            type: 'NOTIFICATION',
            data: {
                level: 'success',
                message: 'Dossier supprimé'
            }
        });
    } catch (error) {
        logger.error('[FOLDER] Delete failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Folder delete failed: ${error.message}` }
        });
    }
}

function handleFolderAssignMedia(data) {
    try {
        if (!mediaFolders) {
            throw new Error('Media folders not initialized');
        }

        const { mediaFile, folderId } = data;
        mediaFolders.assignMedia(mediaFile, folderId);
        logger.info(`[FOLDER] Assigned ${mediaFile} to folder ${folderId}`);

        // Save to disk
        saveFolders(mediaFolders).catch(err => {
            logger.error('[FOLDER] Failed to save after assign:', err.message);
        });

        broadcast({
            type: 'FOLDER_LIST',
            data: { folders: mediaFolders.getAllFolders() }
        });
    } catch (error) {
        logger.error('[FOLDER] Assign media failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Folder assign failed: ${error.message}` }
        });
    }
}

function handleFolderGetAll(ws) {
    try {
        if (!mediaFolders) {
            throw new Error('Media folders not initialized');
        }

        ws.send(JSON.stringify({
            type: 'FOLDER_LIST',
            data: { folders: mediaFolders.getAllFolders() }
        }));

        logger.info('[FOLDER] Sent folder list to client');
    } catch (error) {
        logger.error('[FOLDER] Get all failed:', error.message);
    }
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    logger.info(`[WS] New client connected from ${clientIp}`);

    sendPlaylist(ws, 'PLAYLIST_FULL');
    sendMediaLibrary(ws);

    // Send folder list if available
    if (mediaFolders) {
        ws.send(JSON.stringify({
            type: 'FOLDER_LIST',
            data: { folders: mediaFolders.getAllFolders() }
        }));
    }

    // Send autoplay status if available
    if (autoplayScheduler) {
        ws.send(JSON.stringify({
            type: 'AUTOPLAY_STATUS',
            data: autoplayScheduler.getStatus()
        }));
    }

    ws.on('message', (data) => {
        handleMessage(ws, data);
    });

    ws.on('close', () => {
        logger.info(`[WS] Client disconnected from ${clientIp}`);
    });

    ws.on('error', (error) => {
        logger.error('[WS] Client error:', error.message);
    });
});

// Server error handler
wss.on('error', (error) => {
    logger.error('[WS] Server error:', error.message);
});

// Initialize media folders
async function initializeMediaFolders() {
    mediaFolders = new MediaFolders();

    // Load saved folder structure
    const savedData = await loadFolders();
    if (savedData) {
        mediaFolders.fromJSON(savedData);
        logger.info('[FOLDERS] Loaded folder structure from disk');
    } else {
        logger.info('[FOLDERS] Using default folder structure');
    }

    // Auto-assign unclassified media to default folder
    mediaFolders.recalculateCounts();
}

// Initialize server
async function startServer() {
    await initializePlaylist();
    await initializeMediaLibrary();
    await initializeCaspar();
    await initializeMediaFolders();

    // Initialize error handler
    errorHandler = new ErrorHandler(casparClient, broadcast);
    logger.info('[ERROR] Error handler initialized');

    // Initialize autoplay scheduler
    autoplayScheduler = new AutoplayScheduler(casparClient, playlist, broadcast);
    autoplayScheduler.start();
    logger.info('[AUTOPLAY] Scheduler initialized in MANUAL mode');

    console.log('\n========================================');
    console.log('RTG PLAYOUT SERVER READY');
    console.log('========================================');
    console.log(`Frontend: http://${localIP}:${HTTP_PORT}`);
    console.log(`WebSocket: ws://${localIP}:${WS_PORT}`);
    console.log(`CasparCG: ${casparConnected ? '✓ Connected' : '✗ Not connected'}`);
    console.log(`Autoplay: ${autoplayScheduler.getMode()}`);
    console.log('========================================\n');
    logger.info('[WS] Waiting for client connections...');

    // Attempt to recover state after a short delay to ensure everything is settled
    setTimeout(() => {
        if (autoplayScheduler) {
            autoplayScheduler.recoverState();
        }
    }, 2000);
}

startServer().catch(error => {
    logger.error('[SERVER] Fatal error during startup:', error);
    process.exit(1);
});
