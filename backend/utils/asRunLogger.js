/**
 * As-Run Logger - Logs de diffusion certifiés pour conformité réglementaire
 *
 * Génère des logs horodatés de tout ce qui passe à l'antenne:
 * - Vidéos diffusées (début, fin, durée réelle)
 * - Graphics/Templates affichés
 * - Événements de contrôle (PLAY, STOP, erreurs)
 *
 * Format compatible avec les exigences des régies publicitaires et autorités de régulation
 */

const fs = require('fs').promises;
const path = require('path');

class AsRunLogger {
    constructor(logDir = path.join(__dirname, '../logs/as-run')) {
        this.logDir = logDir;
        this.currentLogFile = null;
        this.currentDate = null;
        this.buffer = []; // Buffer pour écriture par batch
        this.flushInterval = null;
        this.initialized = false;
    }

    /**
     * Initialiser le logger
     */
    async initialize() {
        try {
            // Créer le dossier de logs
            await fs.mkdir(this.logDir, { recursive: true });

            // Démarrer le flush automatique toutes les 5 secondes
            this.flushInterval = setInterval(() => {
                this.flush().catch(err => {
                    console.error('[AS-RUN] Flush error:', err.message);
                });
            }, 5000);

            this.initialized = true;
            console.log('[AS-RUN] Logger initialized');
            console.log(`[AS-RUN] Log directory: ${this.logDir}`);
        } catch (error) {
            console.error('[AS-RUN] Initialization failed:', error.message);
            throw error;
        }
    }

    /**
     * Obtenir le nom du fichier de log du jour
     */
    getLogFileName() {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

        // Nouveau jour = nouveau fichier
        if (dateStr !== this.currentDate) {
            this.currentDate = dateStr;
            this.currentLogFile = path.join(this.logDir, `as-run-${dateStr}.log`);
        }

        return this.currentLogFile;
    }

    /**
     * Formater un timestamp pour les logs
     */
    formatTimestamp(date = new Date()) {
        return date.toISOString(); // ISO 8601 pour compatibilité internationale
    }

    /**
     * Formater une durée en HH:MM:SS.mmm
     */
    formatDuration(milliseconds) {
        const totalSeconds = Math.floor(milliseconds / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const ms = milliseconds % 1000;

        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    }

    /**
     * Log une entrée (ajout au buffer)
     */
    async log(eventType, data) {
        if (!this.initialized) {
            console.warn('[AS-RUN] Logger not initialized, skipping log');
            return;
        }

        const timestamp = this.formatTimestamp();
        const logEntry = {
            timestamp,
            eventType,
            ...data
        };

        // Format JSON Lines (un JSON par ligne pour parsing facile)
        const logLine = JSON.stringify(logEntry);

        // Ajouter au buffer
        this.buffer.push(logLine);

        // Format lisible pour console
        console.log(`[AS-RUN] ${eventType}:`, data);

        // Flush immédiatement pour événements critiques
        if (eventType === 'PLAY_START' || eventType === 'PLAY_ERROR') {
            await this.flush();
        }
    }

    /**
     * Écrire le buffer sur disque
     */
    async flush() {
        if (this.buffer.length === 0) return;

        try {
            const logFile = this.getLogFileName();
            const content = this.buffer.join('\n') + '\n';

            // Append au fichier du jour
            await fs.appendFile(logFile, content, 'utf8');

            // Vider le buffer
            this.buffer = [];
        } catch (error) {
            console.error('[AS-RUN] Failed to flush logs:', error.message);
        }
    }

    /**
     * Log début de lecture vidéo
     */
    async logPlayStart(itemId, fileName, scheduledTime, actualTime) {
        const delay = actualTime - new Date(scheduledTime);

        await this.log('PLAY_START', {
            itemId,
            fileName,
            scheduledTime: this.formatTimestamp(new Date(scheduledTime)),
            actualTime: this.formatTimestamp(actualTime),
            delayMs: delay,
            status: 'started'
        });
    }

    /**
     * Log fin de lecture vidéo
     */
    async logPlayEnd(itemId, fileName, startTime, endTime, expectedDuration) {
        const actualDuration = endTime - startTime;
        const variance = actualDuration - expectedDuration;

        await this.log('PLAY_END', {
            itemId,
            fileName,
            startTime: this.formatTimestamp(startTime),
            endTime: this.formatTimestamp(endTime),
            expectedDuration: this.formatDuration(expectedDuration),
            actualDuration: this.formatDuration(actualDuration),
            varianceMs: variance,
            status: 'completed'
        });
    }

    /**
     * Log arrêt manuel
     */
    async logPlayStop(itemId, fileName, reason = 'manual') {
        await this.log('PLAY_STOP', {
            itemId,
            fileName,
            reason,
            status: 'stopped'
        });
    }

    /**
     * Log erreur de lecture
     */
    async logPlayError(itemId, fileName, error) {
        await this.log('PLAY_ERROR', {
            itemId,
            fileName,
            error: error.message,
            errorStack: error.stack,
            status: 'error'
        });
    }

    /**
     * Log affichage de template/graphic
     */
    async logTemplateShow(templateName, channel, layer, data) {
        await this.log('TEMPLATE_SHOW', {
            templateName,
            channel,
            layer,
            data: JSON.stringify(data),
            status: 'displayed'
        });
    }

    /**
     * Log masquage de template
     */
    async logTemplateHide(templateName, channel, layer, displayDuration) {
        await this.log('TEMPLATE_HIDE', {
            templateName,
            channel,
            layer,
            displayDuration: this.formatDuration(displayDuration),
            status: 'hidden'
        });
    }

    /**
     * Log événement système
     */
    async logSystemEvent(event, details) {
        await this.log('SYSTEM_EVENT', {
            event,
            details
        });
    }

    /**
     * Générer un rapport quotidien
     */
    async generateDailyReport(date = new Date()) {
        const dateStr = date.toISOString().split('T')[0];
        const logFile = path.join(this.logDir, `as-run-${dateStr}.log`);
        const reportFile = path.join(this.logDir, `report-${dateStr}.txt`);

        try {
            // Lire le fichier de log
            const content = await fs.readFile(logFile, 'utf8');
            const lines = content.trim().split('\n');
            const entries = lines.map(line => JSON.parse(line));

            // Statistiques
            const stats = {
                totalEvents: entries.length,
                playStarts: entries.filter(e => e.eventType === 'PLAY_START').length,
                playEnds: entries.filter(e => e.eventType === 'PLAY_END').length,
                playErrors: entries.filter(e => e.eventType === 'PLAY_ERROR').length,
                playStops: entries.filter(e => e.eventType === 'PLAY_STOP').length,
                templatesShown: entries.filter(e => e.eventType === 'TEMPLATE_SHOW').length,
                templatesHidden: entries.filter(e => e.eventType === 'TEMPLATE_HIDE').length,
                systemEvents: entries.filter(e => e.eventType === 'SYSTEM_EVENT').length
            };

            // Générer le rapport textuel
            let report = `=================================================\n`;
            report += `  AS-RUN REPORT - ${dateStr}\n`;
            report += `  RTG Playout System\n`;
            report += `=================================================\n\n`;

            report += `SUMMARY\n`;
            report += `-------\n`;
            report += `Total Events:        ${stats.totalEvents}\n`;
            report += `Videos Started:      ${stats.playStarts}\n`;
            report += `Videos Completed:    ${stats.playEnds}\n`;
            report += `Videos Stopped:      ${stats.playStops}\n`;
            report += `Playback Errors:     ${stats.playErrors}\n`;
            report += `Graphics Displayed:  ${stats.templatesShown}\n`;
            report += `System Events:       ${stats.systemEvents}\n\n`;

            // Détails par heure
            report += `HOURLY BREAKDOWN\n`;
            report += `----------------\n`;
            const hourlyStats = {};
            entries.forEach(entry => {
                const hour = entry.timestamp.substring(11, 13);
                if (!hourlyStats[hour]) hourlyStats[hour] = 0;
                hourlyStats[hour]++;
            });

            Object.keys(hourlyStats).sort().forEach(hour => {
                report += `${hour}:00 - ${hour}:59  =>  ${hourlyStats[hour]} events\n`;
            });

            report += `\n`;

            // Liste des erreurs
            const errors = entries.filter(e => e.eventType === 'PLAY_ERROR');
            if (errors.length > 0) {
                report += `ERRORS LOG\n`;
                report += `----------\n`;
                errors.forEach(err => {
                    report += `[${err.timestamp}] ${err.fileName || 'Unknown'}: ${err.error}\n`;
                });
                report += `\n`;
            }

            // Liste complète des diffusions
            report += `COMPLETE BROADCAST LOG\n`;
            report += `----------------------\n`;
            const playEvents = entries.filter(e =>
                e.eventType === 'PLAY_START' ||
                e.eventType === 'PLAY_END' ||
                e.eventType === 'PLAY_STOP'
            );

            playEvents.forEach(event => {
                const time = event.timestamp.substring(11, 19);
                const type = event.eventType.replace('PLAY_', '');
                const file = event.fileName || 'N/A';
                report += `[${time}] ${type.padEnd(8)} | ${file}\n`;
            });

            report += `\n=================================================\n`;
            report += `End of Report\n`;
            report += `Generated: ${new Date().toISOString()}\n`;
            report += `=================================================\n`;

            // Sauvegarder le rapport
            await fs.writeFile(reportFile, report, 'utf8');

            console.log(`[AS-RUN] Daily report generated: ${reportFile}`);
            return { reportFile, stats };
        } catch (error) {
            console.error('[AS-RUN] Failed to generate daily report:', error.message);
            throw error;
        }
    }

    /**
     * Obtenir les logs d'une période
     */
    async getLogs(startDate, endDate = new Date()) {
        const logs = [];
        const current = new Date(startDate);

        while (current <= endDate) {
            const dateStr = current.toISOString().split('T')[0];
            const logFile = path.join(this.logDir, `as-run-${dateStr}.log`);

            try {
                const content = await fs.readFile(logFile, 'utf8');
                const lines = content.trim().split('\n');
                const entries = lines.map(line => JSON.parse(line));
                logs.push(...entries);
            } catch (error) {
                // Fichier n'existe pas pour ce jour
            }

            current.setDate(current.getDate() + 1);
        }

        return logs;
    }

    /**
     * Arrêter le logger proprement
     */
    async stop() {
        // Arrêter le flush automatique
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }

        // Flush final
        await this.flush();

        console.log('[AS-RUN] Logger stopped');
    }
}

module.exports = AsRunLogger;
