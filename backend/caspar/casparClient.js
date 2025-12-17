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
    }

    /**
     * Connect to CasparCG Server
     */
    connect() {
        return new Promise((resolve, reject) => {
            console.log(`[CASPAR] Connecting to ${this.host}:${this.port}...`);

            this.socket = new net.Socket();

            this.socket.on('connect', () => {
                console.log('[CASPAR] Connected to CasparCG Server');
                this.connected = true;
                this.emit('connected');
                resolve();
            });

            this.socket.on('data', (data) => {
                this.handleData(data);
            });

            this.socket.on('error', (error) => {
                console.error('[CASPAR] Socket error:', error.message);
                this.connected = false;
                this.emit('error', error);
                reject(error);
            });

            this.socket.on('close', () => {
                console.log('[CASPAR] Connection closed');
                this.connected = false;
                this.emit('disconnected');
            });

            this.socket.connect(this.port, this.host);
        });
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
     * Send command to CasparCG
     */
    sendCommand(command) {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                return reject(new Error('Not connected to CasparCG'));
            }

            console.log('[CASPAR] Sending command:', command);

            // Listen for response
            const responseHandler = (response) => {
                // Check if response is for this command
                if (response.startsWith('2')) { // Success codes start with 2
                    this.removeListener('response', responseHandler);
                    resolve(response);
                } else if (response.startsWith('4') || response.startsWith('5')) { // Error codes
                    this.removeListener('response', responseHandler);
                    reject(new Error(response));
                }
            };

            this.on('response', responseHandler);

            // Send command
            this.socket.write(command + '\r\n');

            // Timeout after 5 seconds
            setTimeout(() => {
                this.removeListener('response', responseHandler);
                reject(new Error('Command timeout'));
            }, 5000);
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
     */
    async play(channel, layer, file) {
        const response = await this.sendCommand(`PLAY ${channel}-${layer} "${file}"`);
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
        if (this.socket) {
            this.socket.destroy();
            this.connected = false;
            console.log('[CASPAR] Disconnected');
        }
    }
}

module.exports = CasparClient;
