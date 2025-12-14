/**
 * Error Handler Module
 * Manages playback errors, retries, and fallback strategies
 */

const logger = require('./logger');

class ErrorHandler {
    constructor(casparClient, broadcast) {
        this.casparClient = casparClient;
        this.broadcast = broadcast;

        this.MAX_RETRIES = 3;
        this.RETRY_DELAY = 1000; // 1 second
        this.FALLBACK_FILE = 'SLATE'; // Name of the fallback file (without extension)

        this.retryCounts = new Map(); // Track retries per item ID
    }

    /**
     * Handle playback error
     */
    async handlePlayError(error, item, channel, layer) {
        const itemId = item.id;
        const currentRetries = this.retryCounts.get(itemId) || 0;

        logger.error(`Playback error for item ${item.name} (${item.file})`, error);

        // Notify frontend of error
        this.notifyFrontend('ERROR', `Erreur de lecture: ${item.name}`);

        if (currentRetries < this.MAX_RETRIES) {
            // Retry strategy
            const nextRetry = currentRetries + 1;
            this.retryCounts.set(itemId, nextRetry);

            logger.warn(`Retrying playback for ${item.name} (Attempt ${nextRetry}/${this.MAX_RETRIES})`);
            this.notifyFrontend('WARNING', `Nouvelle tentative (${nextRetry}/${this.MAX_RETRIES})...`);

            setTimeout(async () => {
                try {
                    // Remove file extension for CasparCG
                    const fileName = item.file.replace(/\.[^/.]+$/, '');

                    await this.casparClient.play(channel, layer, fileName);

                    // If successful, clear retry count
                    this.retryCounts.delete(itemId);
                    logger.info(`Retry successful for ${item.name}`);
                    this.notifyFrontend('SUCCESS', `Lecture rétablie: ${item.name}`);

                } catch (retryError) {
                    this.handlePlayError(retryError, item, channel, layer);
                }
            }, this.RETRY_DELAY);

        } else {
            // Fallback strategy
            logger.error(`Max retries reached for ${item.name}. Switching to fallback.`);
            this.retryCounts.delete(itemId);

            await this.playFallback(channel, layer);
        }
    }

    /**
     * Play fallback media (SLATE)
     */
    async playFallback(channel, layer) {
        try {
            this.notifyFrontend('ERROR', 'Échec définitif. Passage au secours (SLATE).');
            logger.warn(`Playing fallback media: ${this.FALLBACK_FILE}`);

            await this.casparClient.play(channel, layer, this.FALLBACK_FILE);

        } catch (error) {
            logger.error('Critical: Failed to play fallback media!', error);
            this.notifyFrontend('ERROR', 'CRITIQUE: Échec du média de secours !');
        }
    }

    /**
     * Send notification to frontend
     */
    notifyFrontend(level, message) {
        if (this.broadcast) {
            this.broadcast({
                type: 'NOTIFICATION',
                data: {
                    level, // 'INFO', 'SUCCESS', 'WARNING', 'ERROR'
                    message,
                    timestamp: new Date().toISOString()
                }
            });
        }
    }

    /**
     * Reset retry count for an item
     */
    resetRetries(itemId) {
        if (this.retryCounts.has(itemId)) {
            this.retryCounts.delete(itemId);
        }
    }
}

module.exports = ErrorHandler;
