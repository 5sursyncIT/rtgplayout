/**
 * Timing Calculation Module - Production Broadcast Grade
 *
 * Gestion précise du temps pour diffusion professionnelle 24/7
 * - Précision milliseconde (frame-accurate à 25/30/50/60 FPS)
 * - Gestion robuste des Hard Starts
 * - Validation des contraintes temporelles
 * - Compensation du drift
 */

/**
 * Frame rates standards broadcast
 */
const FRAME_RATES = {
    PAL: 25,      // Europe (PAL/SECAM)
    NTSC: 29.97,  // USA/Japon (NTSC)
    P50: 50,      // HD Progressive 50fps
    P60: 59.94    // HD Progressive 60fps
};

/**
 * Arrondir au frame le plus proche pour frame-accuracy
 * @param {number} milliseconds - Temps en ms
 * @param {number} fps - Frame rate (25, 29.97, 50, 59.94)
 * @returns {number} - Temps arrondi au frame
 */
function roundToFrame(milliseconds, fps = FRAME_RATES.PAL) {
    const frameDurationMs = 1000 / fps;
    return Math.round(milliseconds / frameDurationMs) * frameDurationMs;
}

/**
 * Convertir frames en millisecondes
 * @param {number} frames - Nombre de frames
 * @param {number} fps - Frame rate
 * @returns {number} - Durée en ms
 */
function framesToMs(frames, fps = FRAME_RATES.PAL) {
    return (frames / fps) * 1000;
}

/**
 * Convertir millisecondes en frames
 * @param {number} milliseconds - Durée en ms
 * @param {number} fps - Frame rate
 * @returns {number} - Nombre de frames
 */
function msToFrames(milliseconds, fps = FRAME_RATES.PAL) {
    return Math.floor(milliseconds / (1000 / fps));
}

/**
 * Valider qu'une date est dans un range acceptable
 * @param {Date} date - Date à valider
 * @param {number} maxDaysInFuture - Jours max dans le futur
 * @param {number} maxDaysInPast - Jours max dans le passé
 * @returns {boolean}
 */
function isDateInValidRange(date, maxDaysInFuture = 7, maxDaysInPast = 1) {
    const now = new Date();
    const futureLimit = new Date(now.getTime() + maxDaysInFuture * 24 * 3600 * 1000);
    const pastLimit = new Date(now.getTime() - maxDaysInPast * 24 * 3600 * 1000);

    return date >= pastLimit && date <= futureLimit;
}

/**
 * Parser un hard start time (HH:MM:SS ou HH:MM:SS.mmm)
 * @param {string} timeStr - Time string
 * @returns {Object} - { hours, minutes, seconds, milliseconds }
 */
function parseHardStartTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') {
        throw new Error('Invalid hard start time format');
    }

    // Format: HH:MM:SS ou HH:MM:SS.mmm
    const parts = timeStr.split(':');
    if (parts.length < 2 || parts.length > 3) {
        throw new Error('Hard start time must be HH:MM or HH:MM:SS or HH:MM:SS.mmm');
    }

    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);

    let seconds = 0;
    let milliseconds = 0;

    if (parts.length >= 3) {
        const secParts = parts[2].split('.');
        seconds = parseInt(secParts[0], 10);
        if (secParts.length > 1) {
            milliseconds = parseInt(secParts[1].padEnd(3, '0'), 10);
        }
    }

    // Validation
    if (isNaN(hours) || hours < 0 || hours > 23) {
        throw new Error('Hours must be 0-23');
    }
    if (isNaN(minutes) || minutes < 0 || minutes > 59) {
        throw new Error('Minutes must be 0-59');
    }
    if (isNaN(seconds) || seconds < 0 || seconds > 59) {
        throw new Error('Seconds must be 0-59');
    }
    if (isNaN(milliseconds) || milliseconds < 0 || milliseconds > 999) {
        throw new Error('Milliseconds must be 0-999');
    }

    return { hours, minutes, seconds, milliseconds };
}

/**
 * Calculer le target time pour un hard start en gérant le wrap de jour
 * @param {Date} referenceDate - Date de référence (scheduled start)
 * @param {string} hardStartTimeStr - HH:MM:SS
 * @returns {Date} - Target date avec gestion intelligente du wrap
 */
function calculateHardStartTarget(referenceDate, hardStartTimeStr) {
    const { hours, minutes, seconds, milliseconds } = parseHardStartTime(hardStartTimeStr);

    // Créer target basé sur le jour de référence
    const target = new Date(referenceDate);
    target.setHours(hours, minutes, seconds, milliseconds);

    // Calculer la différence
    let diff = target - referenceDate;

    // Si la différence est très grande (>20h), c'est probablement un wrap de jour
    // Exemples:
    // - Ref: 23:50, Target: 00:10 → Diff: -23h40m → Ajouter 1 jour au target
    // - Ref: 00:10, Target: 23:50 → Diff: +23h40m → Retirer 1 jour au target
    const WRAP_THRESHOLD = 20 * 3600 * 1000; // 20 heures en ms

    if (diff < -WRAP_THRESHOLD) {
        // Target est "hier" dans le calendrier mais devrait être "demain"
        target.setDate(target.getDate() + 1);
        diff = target - referenceDate;
    } else if (diff > WRAP_THRESHOLD) {
        // Target est "demain" dans le calendrier mais devrait être "hier"
        target.setDate(target.getDate() - 1);
        diff = target - referenceDate;
    }

    return target;
}

/**
 * Valider la cohérence des hard starts dans une playlist
 * @param {Array} items - Items de la playlist
 * @param {Date} baseDate - Date de début
 * @returns {Object} - { valid: boolean, errors: Array }
 */
function validateHardStarts(items, baseDate) {
    const errors = [];
    const hardStartItems = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.hardStartTime);

    if (hardStartItems.length === 0) {
        return { valid: true, errors: [] };
    }

    // Calculer les starts programmés pour tous les items
    let currentTime = new Date(baseDate);
    const scheduledStarts = [];

    for (let i = 0; i < items.length; i++) {
        scheduledStarts.push(new Date(currentTime));
        currentTime = new Date(currentTime.getTime() + items[i].durationSeconds * 1000);
    }

    // Vérifier chaque hard start
    const hardStartTargets = [];

    hardStartItems.forEach(({ item, index }) => {
        try {
            // Calculer le target time
            const scheduledStart = scheduledStarts[index];
            const targetStart = calculateHardStartTarget(scheduledStart, item.hardStartTime);

            hardStartTargets.push({
                index,
                itemId: item.id,
                itemName: item.name,
                hardStartTime: item.hardStartTime,
                scheduledStart,
                targetStart,
                diff: targetStart - scheduledStart
            });

            // Vérifier que le target est dans le futur proche (pas > 7 jours)
            if (!isDateInValidRange(targetStart, 7, 0)) {
                errors.push({
                    itemId: item.id,
                    itemName: item.name,
                    hardStartTime: item.hardStartTime,
                    reason: 'Hard start time is too far in the future or past',
                    targetStart: targetStart.toISOString()
                });
            }

        } catch (error) {
            errors.push({
                itemId: item.id,
                itemName: item.name,
                hardStartTime: item.hardStartTime,
                reason: `Invalid hard start time format: ${error.message}`
            });
        }
    });

    // Vérifier que les hard starts sont dans l'ordre chronologique
    for (let i = 1; i < hardStartTargets.length; i++) {
        const prev = hardStartTargets[i - 1];
        const curr = hardStartTargets[i];

        if (curr.targetStart <= prev.targetStart) {
            errors.push({
                itemId: curr.itemId,
                itemName: curr.itemName,
                reason: `Hard start time (${curr.targetStart.toISOString()}) is before or equal to previous hard start (${prev.targetStart.toISOString()})`,
                conflict: {
                    prevItem: prev.itemName,
                    prevTime: prev.targetStart.toISOString(),
                    currTime: curr.targetStart.toISOString()
                }
            });
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        hardStartTargets
    };
}

/**
 * Calcul de planning avec support précis des millisecondes et hard starts
 * @param {Array} items - Items de playlist
 * @param {Date} baseDate - Date de départ
 * @param {Object} options - Options de calcul
 * @returns {Array} - Items avec start/end calculés
 */
function computeScheduleRobust(items, baseDate, options = {}) {
    const {
        frameRate = FRAME_RATES.PAL,
        frameAccurate = true,
        validateHardStartsFirst = true
    } = options;

    if (!Array.isArray(items)) {
        throw new Error('[TIMING] items must be an array');
    }

    if (!(baseDate instanceof Date) || isNaN(baseDate.getTime())) {
        throw new Error('[TIMING] baseDate must be a valid Date object');
    }

    // Validation des hard starts en amont
    if (validateHardStartsFirst) {
        const validation = validateHardStarts(items, baseDate);
        if (!validation.valid) {
            console.error('[TIMING] Hard start validation failed:', validation.errors);
            // On continue quand même mais on log les erreurs
        }
    }

    const scheduledItems = [];
    let currentTime = new Date(baseDate);

    for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Valider durée
        if (typeof item.durationSeconds !== 'number' || item.durationSeconds <= 0) {
            console.warn(`[TIMING] Invalid duration for item ${item.id || 'unknown'}, skipping`);
            continue;
        }

        // Calculer durée en ms (avec précision)
        let durationMs = item.durationSeconds * 1000;

        // Arrondir au frame si demandé (frame-accurate)
        if (frameAccurate) {
            durationMs = roundToFrame(durationMs, frameRate);
        }

        // Calculer start/end
        const startAt = new Date(currentTime);
        const endAt = new Date(currentTime.getTime() + durationMs);

        // Calculer backtiming (temps restant jusqu'au prochain hard start)
        let backtime = null;
        if (i < items.length - 1) {
            // Chercher le prochain hard start
            for (let j = i + 1; j < items.length; j++) {
                if (items[j].hardStartTime) {
                    try {
                        const targetStart = calculateHardStartTarget(endAt, items[j].hardStartTime);
                        const remainingMs = targetStart - endAt;
                        backtime = {
                            targetTime: targetStart.toISOString(),
                            remainingMs,
                            remainingSeconds: remainingMs / 1000,
                            formatted: formatDuration(remainingMs / 1000)
                        };
                        break;
                    } catch (error) {
                        console.error(`[TIMING] Error calculating backtime for item ${items[j].id}:`, error.message);
                    }
                }
            }
        }

        const scheduledItem = {
            ...item,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            durationMs,
            frames: msToFrames(durationMs, frameRate),
            backtime
        };

        scheduledItems.push(scheduledItem);

        // Avancer le temps
        currentTime = endAt;
    }

    return scheduledItems;
}

/**
 * Format duration en HH:MM:SS.mmm
 * @param {number} seconds - Durée en secondes (peut avoir décimales)
 * @returns {string} - Formatted time
 */
function formatDuration(seconds) {
    const totalMs = seconds * 1000;
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const ms = Math.floor(totalMs % 1000);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

/**
 * Format ISO datetime to HH:MM:SS.mmm
 * @param {string} isoString - ISO datetime
 * @returns {string} - Formatted time
 */
function formatTime(isoString) {
    const date = new Date(isoString);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const ms = date.getMilliseconds().toString().padStart(3, '0');

    return `${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Calculer le drift entre temps prévu et temps réel
 * @param {Date} scheduledTime - Temps prévu
 * @param {Date} actualTime - Temps réel (défaut: maintenant)
 * @returns {Object} - { driftMs, driftSeconds, driftFrames, status }
 */
function calculateDrift(scheduledTime, actualTime = new Date(), frameRate = FRAME_RATES.PAL) {
    const driftMs = actualTime - scheduledTime;
    const driftSeconds = driftMs / 1000;
    const driftFrames = msToFrames(Math.abs(driftMs), frameRate);

    let status = 'on-time';
    if (driftMs > 1000) status = 'late';
    else if (driftMs < -1000) status = 'early';

    return {
        driftMs,
        driftSeconds,
        driftFrames,
        status,
        formatted: formatDuration(Math.abs(driftSeconds)),
        sign: driftMs >= 0 ? '+' : '-'
    };
}

module.exports = {
    // Constants
    FRAME_RATES,

    // Frame-accurate functions
    roundToFrame,
    framesToMs,
    msToFrames,

    // Hard start functions
    parseHardStartTime,
    calculateHardStartTarget,
    validateHardStarts,

    // Scheduling
    computeScheduleRobust,

    // Formatting
    formatDuration,
    formatTime,

    // Drift
    calculateDrift,

    // Utilities
    isDateInValidRange
};
