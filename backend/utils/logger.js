/**
 * Logger Module
 * Handles persistent logging to files with daily rotation
 */

const fs = require('fs');
const path = require('path');

class Logger {
    constructor(logDir = 'logs') {
        this.logDir = path.join(__dirname, '..', '..', logDir);
        this.ensureLogDir();
    }

    /**
     * Ensure log directory exists
     */
    ensureLogDir() {
        if (!fs.existsSync(this.logDir)) {
            try {
                fs.mkdirSync(this.logDir, { recursive: true });
            } catch (error) {
                console.error('Failed to create log directory:', error);
            }
        }
    }

    /**
     * Get current log file path based on date
     */
    getLogFilePath() {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
        return path.join(this.logDir, `rtg-playout-${dateStr}.log`);
    }

    /**
     * Format log message
     */
    formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        let logMessage = `[${timestamp}] [${level}] ${message}`;

        if (data) {
            if (data instanceof Error) {
                logMessage += `\nStack: ${data.stack}`;
            } else if (typeof data === 'object') {
                try {
                    logMessage += `Data: ${JSON.stringify(data)}`;
                } catch (e) {
                    logMessage += `Data: [Circular or Non-serializable]`;
                }
            } else {
                logMessage += ` Data: ${data}`;
            }
        }

        return logMessage + '\n';
    }

    /**
     * Write to log file and console
     */
    log(level, message, data = null) {
        const logMessage = this.formatMessage(level, message, data);

        // Console output with colors
        const consoleMsg = logMessage.trim();
        switch (level) {
            case 'ERROR':
                console.error('\x1b[31m%s\x1b[0m', consoleMsg); // Red
                break;
            case 'WARN':
                console.warn('\x1b[33m%s\x1b[0m', consoleMsg); // Yellow
                break;
            case 'INFO':
                console.log('\x1b[36m%s\x1b[0m', consoleMsg); // Cyan
                break;
            default:
                console.log(consoleMsg);
        }

        // File output
        try {
            fs.appendFileSync(this.getLogFilePath(), logMessage);
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    info(message, data) {
        this.log('INFO', message, data);
    }

    warn(message, data) {
        this.log('WARN', message, data);
    }

    error(message, data) {
        this.log('ERROR', message, data);
    }
}

// Export singleton instance
module.exports = new Logger();
