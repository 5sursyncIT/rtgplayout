/**
 * Timing calculation module for RTG Playout
 * 
 * Computes start and end times for playlist items based on duration
 * and a base start time.
 */

/**
 * Computes schedule for playlist items
 * 
 * @param {Array} items - Array of playlist items with durationSeconds
 * @param {Date} baseDate - Base start date/time for the playlist
 * @returns {Array} - New array of items enriched with startAt and endAt (ISO strings)
 */
function computeSchedule(items, baseDate) {
  if (!Array.isArray(items)) {
    throw new Error('[TIMING] items must be an array');
  }

  if (!(baseDate instanceof Date) || isNaN(baseDate.getTime())) {
    throw new Error('[TIMING] baseDate must be a valid Date object');
  }

  const scheduledItems = [];
  let currentTime = new Date(baseDate);

  for (const item of items) {
    // Validate duration
    if (typeof item.durationSeconds !== 'number' || item.durationSeconds <= 0) {
      console.warn(`[TIMING] Invalid duration for item ${item.id || 'unknown'}, skipping`);
      continue;
    }

    // Create new item with calculated times
    const startAt = new Date(currentTime);
    const endAt = new Date(currentTime.getTime() + (item.durationSeconds * 1000));

    const scheduledItem = {
      ...item,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString()
    };

    scheduledItems.push(scheduledItem);

    // Move current time to end of this item
    currentTime = endAt;
  }

  return scheduledItems;
}

/**
 * Formats seconds to HH:MM:SS
 * 
 * @param {number} seconds - Duration in seconds
 * @returns {string} - Formatted time string (HH:MM:SS)
 */
function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':');
}

/**
 * Formats ISO datetime to HH:MM:SS
 * 
 * @param {string} isoString - ISO datetime string
 * @returns {string} - Formatted time string (HH:MM:SS)
 */
function formatTime(isoString) {
  const date = new Date(isoString);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

module.exports = {
  computeSchedule,
  formatDuration,
  formatTime
};
