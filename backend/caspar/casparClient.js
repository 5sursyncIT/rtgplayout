/**
 * CasparCG AMCP Client - Control CasparCG Server via AMCP protocol
 */

const net = require('net');
const EventEmitter = require('events');

class CasparClient extends EventEmitter {
    constructor(host = '127.0.0.1', port = 5250) {
        super();
        this.host = host;
        this.port = port;
        this.socket = null;
        this.connected = false;
        this.buffer = '';
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000; // 5 secondes
        this.pendingCommands = new Map(); // Track pending commands
        this.commandTimeout = 5000; // 5 secondes timeout

        // Éviter trop de listeners (augmenter la limite)
        this.setMaxListeners(50);
    }

    /**
     * Connect to CasparCG Server
     */
    connect() {
        return new Promise((resolve, reject) => {
            // Nettoyer l'ancienne socket si elle existe
            if (this.socket) {
                this.socket.removeAllListeners();
                this.socket.destroy();
                this.socket = null;
            }

            console.log(`[CASPAR] Connecting to ${this.host}:${this.port}...`);

            this.socket = new net.Socket();
            this.socket.setKeepAlive(true, 10000); // Keepalive toutes les 10s
            this.socket.setTimeout(30000); // Timeout 30s pour inactivité

            this.socket.on('connect', () => {
                console.log('[CASPAR] Connected to CasparCG Server');
                this.connected = true;
                this.reconnectAttempts = 0; // Reset compteur

                // Annuler le timer de reconnexion si présent
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }

                this.emit('connected');
                resolve();
            });

            this.socket.on('data', (data) => {
                this.handleData(data);
            });

            this.socket.on('timeout', () => {
                console.error('[CASPAR] Socket timeout - no activity for 30s');
                this.socket.destroy();
            });

            this.socket.on('error', (error) => {
                console.error('[CASPAR] Socket error:', error.message);
                this.connected = false;
                this.emit('error', error);

                // Ne pas rejeter si déjà connecté (gestion asynchrone)
                if (!this.connected) {
                    reject(error);
                }
            });

            this.socket.on('close', (hadError) => {
                console.log(`[CASPAR] Connection closed ${hadError ? '(with error)' : ''}`);
                const wasConnected = this.connected;
                this.connected = false;

                // Rejeter toutes les commandes en attente
                this.pendingCommands.forEach((cmdData, cmdId) => {
                    if (cmdData.timeoutId) clearTimeout(cmdData.timeoutId);
                    cmdData.reject(new Error('Connection closed'));
                });
                this.pendingCommands.clear();

                this.emit('disconnected');

                // Reconnexion automatique si c'était une perte de connexion
                if (wasConnected) {
                    this.scheduleReconnect();
                }
            });

            // Timeout de connexion initiale (10s)
            const connectionTimeout = setTimeout(() => {
                if (!this.connected) {
                    this.socket.destroy();
                    reject(new Error('Connection timeout after 10s'));
                }
            }, 10000);

            this.socket.once('connect', () => {
                clearTimeout(connectionTimeout);
            });

            this.socket.connect(this.port, this.host);
        });
    }

    /**
     * Planifier une reconnexion automatique
     */
    scheduleReconnect() {
        if (this.reconnectTimer) return; // Déjà planifié

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[CASPAR] Max reconnection attempts reached, giving up');
            this.emit('reconnect-failed');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 3); // Backoff exponentiel (max 15s)

        console.log(`[CASPAR] Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay/1000}s...`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect().catch(err => {
                console.error('[CASPAR] Reconnection failed:', err.message);
                // scheduleReconnect sera appelé par le handler 'close'
            });
        }, delay);
    }

    /**
     * Handle incoming data from CasparCG
     */
    handleData(data) {
        this.buffer += data.toString();

        // AMCP responses end with \r\n
        const lines = this.buffer.split('\r\n');

        // Keep incomplete line in buffer
        this.buffer = lines.pop();

        lines.forEach(line => {
            if (line.trim()) {
                console.log('[CASPAR] Response:', line);
                this.emit('response', line);
            }
        });
    }

    /**
     * Send command to CasparCG (version robuste sans fuite mémoire)
     */
    sendCommand(command) {
        return new Promise((resolve, reject) => {
            if (!this.connected || !this.socket) {
                return reject(new Error('Not connected to CasparCG'));
            }

            console.log('[CASPAR] Sending command:', command);

            // Générer un ID unique pour cette commande
            const commandId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);

            // Listen for response (avec cleanup automatique)
            const responseHandler = (response) => {
                // Check if response is for this command
                if (response.startsWith('2')) { // Success codes start with 2
                    cleanup();
                    resolve(response);
                } else if (response.startsWith('4') || response.startsWith('5')) { // Error codes
                    cleanup();
                    reject(new Error(response));
                }
            };

            // Fonction de nettoyage pour éviter les fuites mémoire
            const cleanup = () => {
                this.removeListener('response', responseHandler);
                const cmdData = this.pendingCommands.get(commandId);
                if (cmdData && cmdData.timeoutId) {
                    clearTimeout(cmdData.timeoutId);
                }
                this.pendingCommands.delete(commandId);
            };

            // Timeout avec cleanup
            const timeoutId = setTimeout(() => {
                cleanup();
                reject(new Error('Command timeout after 5s'));
            }, this.commandTimeout);

            // Stocker la commande en attente
            this.pendingCommands.set(commandId, {
                command,
                timeoutId,
                resolve,
                reject
            });

            this.on('response', responseHandler);

            // Send command (avec gestion d'erreur d'écriture)
            try {
                this.socket.write(command + '\r\n', (err) => {
                    if (err) {
                        cleanup();
                        reject(new Error('Failed to write command: ' + err.message));
                    }
                });
            } catch (error) {
                cleanup();
                reject(new Error('Socket write error: ' + error.message));
            }
        });
    }

    /**
     * Get CasparCG version
     */
    async version() {
        const response = await this.sendCommand('VERSION');
        return response;
    }

    /**
     * Get channel info
     */
    /**
     * Get channel info (handles multi-line XML response)
     */
    info(channel = 1) {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                return reject(new Error('Not connected to CasparCG'));
            }

            let xmlData = '';
            let isCollecting = false;

            const responseHandler = (line) => {
                // Check for start of response
                if (line.startsWith('201 INFO') || line.startsWith('200 INFO')) {
                    isCollecting = true;
                    return;
                }

                // Check for error
                if (!isCollecting && (line.startsWith('4') || line.startsWith('5'))) {
                    this.removeListener('response', responseHandler);
                    reject(new Error(line));
                    return;
                }

                // Collect data
                if (isCollecting) {
                    xmlData += line;

                    // Check for end of XML
                    if (line.includes('</channel>')) {
                        this.removeListener('response', responseHandler);
                        resolve(xmlData);
                    }
                }
            };

            this.on('response', responseHandler);

            console.log(`[CASPAR] Sending INFO ${channel}`);
            this.socket.write(`INFO ${channel}\r\n`);

            // Timeout after 2 seconds
            setTimeout(() => {
                this.removeListener('response', responseHandler);
                if (xmlData) {
                    // Return partial data if we have some
                    resolve(xmlData);
                } else {
                    reject(new Error('Info command timeout'));
                }
            }, 2000);
        });
    }

    /**
     * Play a file on specified channel-layer
     * @param {number} channel - Channel number
     * @param {number} layer - Layer number
     * @param {string} file - File name
     * @param {number} [seek] - Start frame (optional)
     * @param {number} [length] - Duration in frames (optional)
     */
    async play(channel, layer, file, seek, length) {
        let command = `PLAY ${channel}-${layer} "${file}"`;
        
        if (seek !== undefined && seek !== null) {
            command += ` SEEK ${Math.floor(seek)}`;
        }
        
        if (length !== undefined && length !== null) {
            command += ` LENGTH ${Math.floor(length)}`;
        }

        const response = await this.sendCommand(command);
        return response;
    }

    /**
     * Load a file on specified channel-layer (without playing)
     */
    async load(channel, layer, file) {
        const response = await this.sendCommand(`LOAD ${channel}-${layer} "${file}"`);
        return response;
    }

    /**
     * Stop playback on specified channel-layer
     */
    async stop(channel, layer) {
        const response = await this.sendCommand(`STOP ${channel}-${layer}`);
        return response;
    }

    /**
     * Clear channel-layer
     */
    async clear(channel, layer) {
        const response = await this.sendCommand(`CLEAR ${channel}-${layer}`);
        return response;
    }

    /**
     * CG ADD - Load a template
     * @param {number} channel - Channel number
     * @param {number} layer - Layer number
     * @param {number} flashLayer - Flash layer (0 for HTML templates)
     * @param {string} templateName - Template path (e.g., "rtg-lower-third/index")
     * @param {boolean} playOnLoad - Auto-play on load
     * @param {string} data - JSON data string
     */
    async cgAdd(channel, layer, flashLayer, templateName, playOnLoad, data) {
        const playFlag = playOnLoad ? '1' : '0';
        const dataParam = data ? ` "${this.escapeString(data)}"` : '';
        const command = `CG ${channel}-${layer} ADD ${flashLayer} "${templateName}" ${playFlag}${dataParam}`;
        const response = await this.sendCommand(command);
        return response;
    }

    /**
     * CG PLAY - Play a template (show with animation)
     * @param {number} channel - Channel number
     * @param {number} layer - Layer number
     * @param {number} flashLayer - Flash layer (0 for HTML templates)
     */
    async cgPlay(channel, layer, flashLayer) {
        const response = await this.sendCommand(`CG ${channel}-${layer} PLAY ${flashLayer}`);
        return response;
    }

    /**
     * CG STOP - Stop a template (hide with animation)
     * @param {number} channel - Channel number
     * @param {number} layer - Layer number
     * @param {number} flashLayer - Flash layer (0 for HTML templates)
     */
    async cgStop(channel, layer, flashLayer) {
        const response = await this.sendCommand(`CG ${channel}-${layer} STOP ${flashLayer}`);
        return response;
    }

    /**
     * CG UPDATE - Update template data without replaying
     * @param {number} channel - Channel number
     * @param {number} layer - Layer number
     * @param {number} flashLayer - Flash layer (0 for HTML templates)
     * @param {string} data - JSON data string
     */
    async cgUpdate(channel, layer, flashLayer, data) {
        const command = `CG ${channel}-${layer} UPDATE ${flashLayer} "${this.escapeString(data)}"`;
        const response = await this.sendCommand(command);
        return response;
    }

    /**
     * CG CLEAR - Remove all templates from layer
     * @param {number} channel - Channel number
     * @param {number} layer - Layer number
     */
    async cgClear(channel, layer) {
        const response = await this.sendCommand(`CG ${channel}-${layer} CLEAR`);
        return response;
    }

    /**
     * CG REMOVE - Remove specific template
     * @param {number} channel - Channel number
     * @param {number} layer - Layer number
     * @param {number} flashLayer - Flash layer (0 for HTML templates)
     */
    async cgRemove(channel, layer, flashLayer) {
        const response = await this.sendCommand(`CG ${channel}-${layer} REMOVE ${flashLayer}`);
        return response;
    }

    /**
     * Escape quotes in string for AMCP
     */
    escapeString(str) {
        return str.replace(/"/g, '\\"');
    }

    /**
     * Disconnect from CasparCG
     */
    disconnect() {
        // Annuler la reconnexion automatique
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // Rejeter toutes les commandes en attente
        this.pendingCommands.forEach((cmdData, cmdId) => {
            if (cmdData.timeoutId) clearTimeout(cmdData.timeoutId);
            cmdData.reject(new Error('Client disconnected'));
        });
        this.pendingCommands.clear();

        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.destroy();
            this.socket = null;
            this.connected = false;
            console.log('[CASPAR] Disconnected');
        }
    }

    /**
     * Vérifier l'état de santé de la connexion
     */
    isHealthy() {
        return this.connected &&
               this.socket &&
               !this.socket.destroyed &&
               this.socket.readyState === 'open';
    }

    /**
     * Obtenir des statistiques de connexion
     */
    getStats() {
        return {
            connected: this.connected,
            reconnectAttempts: this.reconnectAttempts,
            pendingCommands: this.pendingCommands.size,
            socketState: this.socket ? this.socket.readyState : 'no socket'
        };
    }
}

module.exports = CasparClient;
