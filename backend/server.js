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

// Error handler instance
let errorHandler = null;

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
    const message = {
        type: 'MEDIA_LIBRARY',
        data: {
            files: mediaLibrary,
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
 * Handle ADD_ITEM message
 */
async function handleAddItem(data) {
    try {
        const item = playlist.addItem(data);
        logger.info(`[PLAYLIST] Item added: ${item.name}`);

        await autoSavePlaylist();

        broadcast({
            type: 'PLAYLIST_UPDATED',
            data: playlist.getScheduled()
        });
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

            await autoSavePlaylist();

            broadcast({
                type: 'PLAYLIST_UPDATED',
                data: playlist.getScheduled()
            });
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

            await autoSavePlaylist();

            broadcast({
                type: 'PLAYLIST_UPDATED',
                data: playlist.getScheduled()
            });
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

        await autoSavePlaylist();

        broadcast({
            type: 'PLAYLIST_UPDATED',
            data: playlist.getScheduled()
        });
    } catch (error) {
        logger.error('[PLAYLIST] Error setting base start:', error.message);
        throw error;
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

        logger.info(`[XML] Imported ${result.items.length} items`);

        await autoSavePlaylist();

        broadcast({
            type: 'PLAYLIST_UPDATED',
            data: playlist.getScheduled()
        });

        broadcast({
            type: 'INFO',
            data: { message: `Imported ${result.items.length} items from ${result.source}` }
        });
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

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    logger.info(`[WS] New client connected from ${clientIp}`);

    sendPlaylist(ws, 'PLAYLIST_FULL');
    sendMediaLibrary(ws);

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

// Initialize server
async function startServer() {
    await initializePlaylist();
    await initializeMediaLibrary();
    await initializeCaspar();

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
}

startServer().catch(error => {
    logger.error('[SERVER] Fatal error during startup:', error);
    process.exit(1);
});
