/**
 * RTG Playout - WebSocket & HTTP Server
 * 
 * Manages playlist state and broadcasts updates to connected clients
 * Serves frontend files via HTTP
 * Integrates media scanner, persistence, and CasparCG control
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
    console.log(`[HTTP] Frontend server running on:`);
    console.log(`       http://localhost:${HTTP_PORT}`);
    console.log(`       http://${localIP}:${HTTP_PORT}`);
});

// Create WebSocket server
const wss = new WebSocket.Server({
    port: WS_PORT,
    host: '0.0.0.0'
});

console.log(`[WS] WebSocket server running on:`);
console.log(`     ws://localhost:${WS_PORT}`);
console.log(`     ws://${localIP}:${WS_PORT}`);

// Initialize playlist from saved data
async function initializePlaylist() {
    const savedPlaylist = await loadPlaylist();

    if (savedPlaylist && savedPlaylist.items && savedPlaylist.items.length > 0) {
        playlist.setItems(savedPlaylist.items);
        if (savedPlaylist.baseStartAt) {
            playlist.setBaseStartAt(savedPlaylist.baseStartAt);
        }
        console.log(`[PLAYLIST] Loaded ${savedPlaylist.items.length} items from saved playlist`);
    } else {
        playlist.setBaseStartAt(null);
        console.log('[PLAYLIST] No saved playlist found, starting with empty playlist');
    }
}

// Initialize media library (quick scan)
async function initializeMediaLibrary() {
    console.log('[MEDIA] Performing quick scan of media directory...');
    mediaLibrary = await scanMediaDirectoryQuick();
    console.log(`[MEDIA] Quick scan complete: ${mediaLibrary.length} files found`);
}

// Initialize CasparCG connection
async function initializeCaspar() {
    casparClient = new CasparClient(CASPAR_HOST, CASPAR_PORT);

    try {
        await casparClient.connect();
        const version = await casparClient.version();
        console.log(`[CASPAR] Connected successfully: ${version}`);
        casparConnected = true;
    } catch (error) {
        console.error('[CASPAR] Connection failed:', error.message);
        console.log('[CASPAR] Will retry on first PLAY command');
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

    console.log(`[WS] Broadcast to ${sentCount} client(s): ${message.type}`);
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
    console.log(`[WS] Sent ${type} to client`);
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
    console.log(`[WS] Sent MEDIA_LIBRARY to client (${mediaLibrary.length} files)`);
}

/**
 * Handle client messages
 */
function handleMessage(ws, data) {
    try {
        const message = JSON.parse(data);
        console.log(`[WS] Received: ${message.type}`);

        switch (message.type) {
            case 'ADD_ITEM':
                handleAddItem(message.data);
                break;

            case 'REMOVE_ITEM':
                handleRemoveItem(message.data);
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
                console.warn(`[WS] Unknown message type: ${message.type}`);
                ws.send(JSON.stringify({
                    type: 'ERROR',
                    data: { message: `Unknown message type: ${message.type}` }
                }));
        }
    } catch (error) {
        console.error('[WS] Error handling message:', error.message);
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
        console.log(`[PLAYLIST] Item added: ${item.name}`);

        await autoSavePlaylist();

        broadcast({
            type: 'PLAYLIST_UPDATED',
            data: playlist.getScheduled()
        });
    } catch (error) {
        console.error('[PLAYLIST] Error adding item:', error.message);
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
            console.log(`[PLAYLIST] Item removed: ${data.id}`);

            await autoSavePlaylist();

            broadcast({
                type: 'PLAYLIST_UPDATED',
                data: playlist.getScheduled()
            });
        }
    } catch (error) {
        console.error('[PLAYLIST] Error removing item:', error.message);
        throw error;
    }
}

/**
 * Handle SET_BASE_START message
 */
async function handleSetBaseStart(data) {
    try {
        playlist.setBaseStartAt(data.isoDate);
        console.log(`[PLAYLIST] Base start time updated`);

        await autoSavePlaylist();

        broadcast({
            type: 'PLAYLIST_UPDATED',
            data: playlist.getScheduled()
        });
    } catch (error) {
        console.error('[PLAYLIST] Error setting base start:', error.message);
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
    console.log('[MEDIA] Starting full media scan with FFprobe...');

    broadcast({
        type: 'SCAN_STARTED',
        data: {}
    });

    try {
        mediaLibrary = await scanMediaDirectory();
        console.log(`[MEDIA] Full scan complete: ${mediaLibrary.length} files`);

        broadcast({
            type: 'MEDIA_LIBRARY',
            data: {
                files: mediaLibrary,
                isScanning: false
            }
        });
    } catch (error) {
        console.error('[MEDIA] Error during scan:', error.message);
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
        console.log('[PLAYLIST] Playlist cleared');

        await autoSavePlaylist();

        broadcast({
            type: 'PLAYLIST_UPDATED',
            data: playlist.getScheduled()
        });
    } catch (error) {
        console.error('[PLAYLIST] Error clearing playlist:', error.message);
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
        console.error('[CASPAR] Connection error:', error.message);
    }
}

/**
 * Handle IMPORT_XML message
 */
async function handleImportXML(data) {
    try {
        console.log(`[XML] Importing playlist from: ${data.xmlPath}`);

        const result = await parseXMLPlaylist(data.xmlPath);
        playlist.setItems(result.items);

        console.log(`[XML] Imported ${result.items.length} items`);

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
        console.error('[XML] Import failed:', error.message);
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
            console.log('[CASPAR] Not connected, attempting to connect...');
            await initializeCaspar();
        }

        if (!casparConnected) {
            throw new Error('CasparCG not connected');
        }

        console.log(`[CASPAR] Playing: ${data.file}`);

        // Remove file extension for CasparCG
        const fileName = data.file.replace(/\.[^/.]+$/, '');

        await casparClient.play(CASPAR_CHANNEL, CASPAR_LAYER, fileName);

        console.log(`[CASPAR] Now playing: ${fileName}`);

        broadcast({
            type: 'PLAYBACK_STATUS',
            data: {
                itemId: data.id,
                status: 'playing',
                file: data.file
            }
        });
    } catch (error) {
        console.error('[CASPAR] Play failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Playback failed: ${error.message}` }
        });
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

        console.log(`[CASPAR] Stopping playback on ${CASPAR_CHANNEL}-${CASPAR_LAYER}`);

        await casparClient.stop(CASPAR_CHANNEL, CASPAR_LAYER);

        console.log('[CASPAR] Playback stopped');

        broadcast({
            type: 'PLAYBACK_STATUS',
            data: {
                itemId: null,
                status: 'stopped'
            }
        });
    } catch (error) {
        console.error('[CASPAR] Stop failed:', error.message);
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
        console.log(`[AUTOPLAY] Mode changed to: ${data.mode}`);

        broadcast({
            type: 'AUTOPLAY_STATUS',
            data: autoplayScheduler.getStatus()
        });
    } catch (error) {
        console.error('[AUTOPLAY] Set mode failed:', error.message);
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

        console.log('[AUTOPLAY] Sent status to client');
    } catch (error) {
        console.error('[AUTOPLAY] Get status failed:', error.message);
    }
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[WS] New client connected from ${clientIp}`);

    sendPlaylist(ws, 'PLAYLIST_FULL');
    sendMediaLibrary(ws);

    ws.on('message', (data) => {
        handleMessage(ws, data);
    });

    ws.on('close', () => {
        console.log(`[WS] Client disconnected from ${clientIp}`);
    });

    ws.on('error', (error) => {
        console.error('[WS] Client error:', error.message);
    });
});

// Server error handler
wss.on('error', (error) => {
    type: 'PLAYLIST_UPDATED',
        data: playlist.getScheduled()
});
    } catch (error) {
    console.error('[PLAYLIST] Error clearing playlist:', error.message);
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
        console.error('[CASPAR] Connection error:', error.message);
    }
}

/**
 * Handle IMPORT_XML message
 */
async function handleImportXML(data) {
    try {
        console.log(`[XML] Importing playlist from: ${data.xmlPath}`);

        const result = await parseXMLPlaylist(data.xmlPath);
        playlist.setItems(result.items);

        console.log(`[XML] Imported ${result.items.length} items`);

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
        console.error('[XML] Import failed:', error.message);
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
            console.log('[CASPAR] Not connected, attempting to connect...');
            await initializeCaspar();
        }

        if (!casparConnected) {
            throw new Error('CasparCG not connected');
        }

        console.log(`[CASPAR] Playing: ${data.file}`);

        // Remove file extension for CasparCG
        const fileName = data.file.replace(/\.[^/.]+$/, '');

        await casparClient.play(CASPAR_CHANNEL, CASPAR_LAYER, fileName);

        console.log(`[CASPAR] Now playing: ${fileName}`);

        broadcast({
            type: 'PLAYBACK_STATUS',
            data: {
                itemId: data.id,
                status: 'playing',
                file: data.file
            }
        });
    } catch (error) {
        console.error('[CASPAR] Play failed:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Playback failed: ${error.message}` }
        });
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

        console.log(`[CASPAR] Stopping playback on ${CASPAR_CHANNEL}-${CASPAR_LAYER}`);

        await casparClient.stop(CASPAR_CHANNEL, CASPAR_LAYER);

        console.log('[CASPAR] Playback stopped');

        broadcast({
            type: 'PLAYBACK_STATUS',
            data: {
                itemId: null,
                status: 'stopped'
            }
        });
    } catch (error) {
        console.error('[CASPAR] Stop failed:', error.message);
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
        console.log(`[AUTOPLAY] Mode changed to: ${data.mode}`);

        broadcast({
            type: 'AUTOPLAY_STATUS',
            data: autoplayScheduler.getStatus()
        });
    } catch (error) {
        console.error('[AUTOPLAY] Set mode failed:', error.message);
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

        console.log('[AUTOPLAY] Sent status to client');
    } catch (error) {
        console.error('[AUTOPLAY] Get status failed:', error.message);
    }
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[WS] New client connected from ${clientIp}`);

    sendPlaylist(ws, 'PLAYLIST_FULL');
    sendMediaLibrary(ws);

    ws.on('message', (data) => {
        handleMessage(ws, data);
    });

    ws.on('close', () => {
        console.log(`[WS] Client disconnected from ${clientIp}`);
    });

    ws.on('error', (error) => {
        console.error('[WS] Client error:', error.message);
    });
});

// Server error handler
wss.on('error', (error) => {
    console.error('[WS] Server error:', error.message);
});

// Initialize server
async function startServer() {
    await initializePlaylist();
    await initializeMediaLibrary();
    await initializeCaspar();

    // Initialize autoplay scheduler
    autoplayScheduler = new AutoplayScheduler(casparClient, playlist, broadcast);
    autoplayScheduler.start();
    console.log('[AUTOPLAY] Scheduler initialized in MANUAL mode');

    console.log('\n========================================');
    console.log('RTG PLAYOUT SERVER READY');
    console.log('========================================');
    console.log(`Frontend: http://${localIP}:${HTTP_PORT}`);
    console.log(`WebSocket: ws://${localIP}:${WS_PORT}`);
    console.log(`CasparCG: ${casparConnected ? '✓ Connected' : '✗ Not connected'}`);
    console.log(`Autoplay: ${autoplayScheduler.getMode()}`);
    console.log('========================================\n');
    console.log('[WS] Waiting for client connections...');
}

startServer().catch(error => {
    console.error('[SERVER] Fatal error during startup:', error);
    process.exit(1);
});
