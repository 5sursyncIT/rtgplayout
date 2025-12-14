/**
 * RTG Playout - Frontend Application
 * 
 * WebSocket client for playlist management with media library and CasparCG control
 */

// WebSocket connection
let ws = null;
let reconnectInterval = null;

// Media library state
let mediaLibrary = [];
let isScanning = false;

// Playback state
let currentlyPlaying = null;
let currentItem = null;
let playlistData = { items: [] };

// Autoplay state
let autoplayMode = 'MANUAL';
let nextItem = null;
let countdownInterval = null;

// DOM elements
const currentTimeEl = document.getElementById('currentTime');
const playlistEndEl = document.getElementById('playlistEnd');
const wsStatusEl = document.getElementById('wsStatus');
const playlistBodyEl = document.getElementById('playlistBody');
const itemCountEl = document.getElementById('itemCount');
const totalDurationEl = document.getElementById('totalDuration');
const emptyPlaylistEl = document.getElementById('emptyPlaylist');

// Media library elements
const mediaListEl = document.getElementById('mediaList');
const mediaCountEl = document.getElementById('mediaCount');
const scanBtn = document.getElementById('scanBtn');
const scanBtnText = document.getElementById('scanBtnText');

// Control buttons
const clearPlaylistBtn = document.getElementById('clearPlaylistBtn');
const stopPlaybackBtn = document.getElementById('stopPlaybackBtn');

// Autoplay elements
const autoModeBtn = document.getElementById('autoModeBtn');
const modeText = document.getElementById('modeText');
const nextItemInfo = document.getElementById('nextItemInfo');
const nextItemName = document.getElementById('nextItemName');
const nextItemDuration = document.getElementById('nextItemDuration');
const nextCountdown = document.getElementById('nextCountdown');

// Notification container
const notificationContainer = document.getElementById('notificationContainer');

// Add item form
const addItemBtn = document.getElementById('addItemBtn');
const itemNameInput = document.getElementById('itemName');
const itemFileInput = document.getElementById('itemFile');
const itemDurationInput = document.getElementById('itemDuration');

/**
 * Connect to WebSocket server
 */
function connect() {
    const wsHost = window.location.hostname || 'localhost';
    const wsUrl = `ws://${wsHost}:8080`;

    console.log('[WS] Connecting to server:', wsUrl);

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('[WS] Connected');
        updateConnectionStatus(true);

        if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
        }

        requestMediaLibrary();
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            console.log('[WS] Received:', message.type);
            handleMessage(message);
        } catch (error) {
            console.error('[WS] Error parsing message:', error);
        }
    };

    ws.onclose = () => {
        console.log('[WS] Disconnected');
        updateConnectionStatus(false);

        if (!reconnectInterval) {
            reconnectInterval = setInterval(() => {
                console.log('[WS] Attempting to reconnect...');
                connect();
            }, 3000);
        }
    };

    ws.onerror = (error) => {
        console.error('[WS] Error:', error);
    };
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(connected) {
    const dot = wsStatusEl.querySelector('.dot');
    const text = wsStatusEl.querySelector('.text');

    if (connected) {
        dot.classList.add('connected');
        text.textContent = 'Connecté';
    } else {
        dot.classList.remove('connected');
        text.textContent = 'Déconnecté';
    }
}

/**
 * Handle incoming WebSocket messages
 */
function handleMessage(message) {
    switch (message.type) {
        case 'PLAYLIST_FULL':
        case 'PLAYLIST_UPDATED':
            renderPlaylist(message.data);
            break;

        case 'MEDIA_LIBRARY':
            handleMediaLibrary(message.data);
            break;

        case 'SCAN_STARTED':
            handleScanStarted();
            break;

        case 'PLAYBACK_STATUS':
            handlePlaybackStatus(message.data);
            break;

        case 'AUTOPLAY_STATUS':
            handleAutoplayStatus(message.data);
            break;

        case 'NOTIFICATION':
            showNotification(message.data.level, message.data.message);
            break;

        case 'INFO':
            console.log('[INFO]', message.data.message);
            alert(message.data.message);
            break;

        case 'ERROR':
            console.error('[APP] Server error:', message.data.message);
            alert(`Erreur: ${message.data.message}`);
            break;

        default:
            console.warn('[APP] Unknown message type:', message.type);
    }
}

/**
 * Handle media library data
 */
function handleMediaLibrary(data) {
    mediaLibrary = data.files || [];
    isScanning = data.isScanning || false;

    renderMediaLibrary();

    if (!isScanning) {
        scanBtn.disabled = false;
        scanBtnText.textContent = 'Scanner';
    }
}

/**
 * Handle scan started notification
 */
function handleScanStarted() {
    isScanning = true;
    scanBtn.disabled = true;
    scanBtnText.textContent = 'Scan en cours...';
}

/**
 * Handle playback status update
 */
function handlePlaybackStatus(data) {
    currentlyPlaying = data.itemId;

    // Update UI to show which item is playing
    const rows = playlistBodyEl.querySelectorAll('tr');
    rows.forEach(row => {
        const itemId = row.dataset.itemId;
        const playBtn = row.querySelector('.btn-play');
        const onAirIndicator = row.querySelector('.on-air-indicator');

        if (itemId === currentlyPlaying && data.status === 'playing') {
            row.classList.add('playing');
            if (playBtn) playBtn.textContent = '⏸';
            if (onAirIndicator) onAirIndicator.style.display = 'inline-block';
        } else {
            row.classList.remove('playing');
            if (playBtn) playBtn.textContent = '▶';
            if (onAirIndicator) onAirIndicator.style.display = 'none';
        }
    });

    console.log('[PLAYBACK]', data.status, data.file || '');
}

/**
 * Render media library
 */
function renderMediaLibrary() {
    mediaCountEl.textContent = mediaLibrary.length;
    mediaListEl.innerHTML = '';

    if (mediaLibrary.length === 0) {
        mediaListEl.innerHTML = '<div class="empty-media">Aucun fichier trouvé</div>';
        return;
    }

    mediaLibrary.forEach(media => {
        const item = document.createElement('div');
        item.className = 'media-item';
        item.draggable = true;
        item.dataset.file = media.file;
        item.dataset.name = media.name;
        item.dataset.duration = media.durationSeconds;

        const duration = media.durationSeconds > 0
            ? safeFormatDuration(media.durationSeconds)
            : '--:--:--';

        item.innerHTML = `
      <div class="media-name">${escapeHtml(media.name)}</div>
      <div class="media-info">
        <span class="media-duration">${duration}</span>
        <span class="media-file">${escapeHtml(media.file)}</span>
      </div>
    `;

        item.addEventListener('dragstart', handleMediaDragStart);
        item.addEventListener('click', () => addMediaToPlaylist(media));

        mediaListEl.appendChild(item);
    });
}

/**
 * Render playlist to table
 */
function renderPlaylist(data) {
    console.log('[APP] Rendering playlist:', data.items.length, 'items');

    playlistBodyEl.innerHTML = '';
    itemCountEl.textContent = data.items.length;

    if (data.items.length === 0) {
        emptyPlaylistEl.style.display = 'flex';
        playlistEndEl.textContent = '--:--:--';
        totalDurationEl.textContent = '00:00:00';
        return;
    }

    emptyPlaylistEl.style.display = 'none';

    let totalSeconds = 0;

    data.items.forEach((item, index) => {
        totalSeconds += item.durationSeconds;

        const row = document.createElement('tr');
        row.dataset.itemId = item.id;
        row.dataset.index = index;
        row.draggable = true;

        // Add drag events
        row.addEventListener('dragstart', handlePlaylistDragStart);
        row.addEventListener('dragover', handleDragOver);
        row.addEventListener('drop', handleDrop);
        row.addEventListener('dragleave', handleDragLeave);

        const isPlaying = item.id === currentlyPlaying;
        if (isPlaying) {
            row.classList.add('playing');
        }

        row.innerHTML = `
      <td class="col-index">${index + 1}</td>
      <td class="col-name">${escapeHtml(item.name)}</td>
      <td class="col-file">${escapeHtml(item.file)}</td>
      <td class="col-duration">${safeFormatDuration(item.durationSeconds)}</td>
      <td class="col-start">${formatTime(item.startAt)}</td>
      <td class="col-end">${formatTime(item.endAt)}</td>
      <td class="col-play">
        <button class="btn-play" onclick="playItem('${item.id}', '${escapeHtml(item.file)}')">
          ${isPlaying ? '⏸' : '▶'}
        </button>
        <span class="on-air-indicator" style="display: ${isPlaying ? 'inline-block' : 'none'}">
          🔴 ON AIR
        </span>
      </td>
      <td class="col-actions">
        <button class="btn-delete" onclick="deleteItem('${item.id}')">✕</button>
      </td>
    `;

        playlistBodyEl.appendChild(row);
    });



    totalDurationEl.textContent = safeFormatDuration(totalSeconds);

    if (data.items.length > 0) {
        const lastItem = data.items[data.items.length - 1];
        playlistEndEl.textContent = formatTime(lastItem.endAt);
    }
}

/**
 * Handle media drag start
 */
function handleMediaDragStart(e) {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/json', JSON.stringify({
        type: 'MEDIA_ITEM',
        name: e.target.dataset.name,
        file: e.target.dataset.file,
        durationSeconds: parseInt(e.target.dataset.duration)
    }));
    e.target.classList.add('dragging');
}

/**
 * Handle playlist item drag start
 */
function handlePlaylistDragStart(e) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({
        type: 'PLAYLIST_ITEM',
        index: parseInt(e.target.dataset.index)
    }));
    e.target.classList.add('dragging');
}

/**
 * Handle drag over (allow drop)
 */
function handleDragOver(e) {
    e.preventDefault();
    const row = e.target.closest('tr');
    if (row) {
        row.classList.add('drag-over');
    }
}

/**
 * Handle drag leave
 */
function handleDragLeave(e) {
    const row = e.target.closest('tr');
    if (row) {
        row.classList.remove('drag-over');
    }
}

/**
 * Handle drop
 */
function handleDrop(e) {
    e.preventDefault();
    const row = e.target.closest('tr');

    // Remove visual feedback
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

    if (!row) return;

    try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'));

        if (data.type === 'MEDIA_ITEM') {
            // Add new item from media library
            // For now, just add to end (or we could implement insert at position later)
            addMediaToPlaylist(data);
        } else if (data.type === 'PLAYLIST_ITEM') {
            // Reorder playlist item
            const fromIndex = data.index;
            const toIndex = parseInt(row.dataset.index);

            if (fromIndex !== toIndex) {
                reorderPlaylist(fromIndex, toIndex);
            }
        }
    } catch (error) {
        console.error('Drop error:', error);
    }
}

/**
 * Reorder playlist items
 */
function reorderPlaylist(fromIndex, toIndex) {
    sendMessage({
        type: 'REORDER_PLAYLIST',
        data: { fromIndex, toIndex }
    });
}

/**
 * Add media to playlist (click or drag)
 */
function addMediaToPlaylist(media) {
    if (!media.durationSeconds || media.durationSeconds === 0) {
        alert('Durée inconnue. Lancez un scan complet pour obtenir les durées.');
        return;
    }

    sendMessage({
        type: 'ADD_ITEM',
        data: {
            name: media.name,
            file: media.file,
            durationSeconds: media.durationSeconds
        }
    });
}

/**
 * Play item on CasparCG
 */
function playItem(id, file) {
    sendMessage({
        type: 'PLAY_ITEM',
        data: { id, file }
    });
}

/**
 * Stop playback on CasparCG
 */
function stopPlayback() {
    if (confirm('Arrêter la diffusion en cours ?')) {
        sendMessage({
            type: 'STOP_PLAYBACK',
            data: {}
        });
    }
}

/**
 * Delete item from playlist
 */
function deleteItem(id) {
    if (confirm('Supprimer cet élément de la playlist ?')) {
        sendMessage({
            type: 'REMOVE_ITEM',
            data: { id }
        });
    }
}

/**
 * Clear entire playlist
 */
function clearPlaylist() {
    if (confirm('Vider toute la playlist ?')) {
        sendMessage({
            type: 'CLEAR_PLAYLIST'
        });
    }
}

/**
 * Request media library from server
 */
function requestMediaLibrary() {
    sendMessage({
        type: 'GET_MEDIA_LIBRARY'
    });
}

/**
 * Request full media scan
 */
function scanMedia() {
    sendMessage({
        type: 'SCAN_MEDIA'
    });
}

/**
 * Send message to server
 */
function sendMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    } else {
        alert('Non connecté au serveur');
    }
}

/**
 * Add item manually
 */
function addItem() {
    const name = itemNameInput.value.trim();
    const file = itemFileInput.value.trim();
    const duration = parseInt(itemDurationInput.value);

    if (!name || !file || !duration || duration <= 0) {
        alert('Veuillez remplir tous les champs correctement');
        return;
    }

    sendMessage({
        type: 'ADD_ITEM',
        data: {
            name,
            file,
            durationSeconds: duration
        }
    });

    itemNameInput.value = '';
    itemFileInput.value = '';
    itemDurationInput.value = '';
}

/**
 * Format duration in seconds to HH:MM:SS
 */
/**
 * Format duration in seconds to HH:MM:SS
 */
function safeFormatDuration(secondsInput) {
    // Force conversion to number
    const seconds = parseInt(secondsInput, 10);

    // console.log('[DEBUG] safeFormatDuration input:', secondsInput, 'parsed:', seconds, 'type:', typeof seconds);

    if (isNaN(seconds)) {
        return '--:--:--';
    }

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
 * Format ISO datetime to HH:MM:SS
 */
function formatTime(isoString) {
    const date = new Date(isoString);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');

    return `${hours}:${minutes}:${seconds}`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Update current time and offset display
 */
function updateCurrentTime() {
    const now = new Date();
    currentTimeEl.textContent = formatTime(now.toISOString());

    updateOffset(now);
}

/**
 * Calculate and display time offset
 */
function updateOffset(now) {
    const offsetEl = document.getElementById('offsetTime');
    if (!offsetEl) return;

    // Find reference time (start of current item, or start of playlist)
    let expectedTime = null;

    if (currentItem && currentItem.startAt) {
        expectedTime = new Date(currentItem.startAt);
    } else if (playlistData && playlistData.items && playlistData.items.length > 0) {
        // If nothing playing, compare with first item
        expectedTime = new Date(playlistData.items[0].startAt);
    }

    if (!expectedTime) {
        offsetEl.textContent = '--:--:--';
        offsetEl.className = 'time-display offset-display';
        return;
    }

    // Calculate diff in seconds
    const diffSeconds = (now - expectedTime) / 1000;
    const absDiff = Math.abs(diffSeconds);

    // Format diff
    const formattedDiff = safeFormatDuration(absDiff);

    // Determine status (Late = positive diff, Early = negative diff)
    // Note: If now > expected, we are LATE (positive)
    // If now < expected, we are EARLY (negative)

    offsetEl.className = 'time-display offset-display';

    if (diffSeconds > 1) {
        // Late
        offsetEl.textContent = `+${formattedDiff}`;
        offsetEl.classList.add('offset-late');
    } else if (diffSeconds < -1) {
        // Early
        offsetEl.textContent = `-${formattedDiff}`;
        offsetEl.classList.add('offset-early');
    } else {
        // On time
        offsetEl.textContent = `±00:00:00`;
    }
}

/**
 * Toggle autoplay mode
 */
function toggleAutoplayMode() {
    const newMode = autoplayMode === 'AUTO' ? 'MANUAL' : 'AUTO';

    sendMessage({
        type: 'SET_AUTOPLAY_MODE',
        data: { mode: newMode }
    });
}

/**
 * Handle autoplay status update
 */
function handleAutoplayStatus(data) {
    autoplayMode = data.mode;
    nextItem = data.nextItem;
    currentItem = data.currentItem; // Update global variable

    console.log('[DEBUG] handleAutoplayStatus data:', JSON.stringify(data, null, 2));
    console.log('[AUTOPLAY] Status update:', data);

    // Update UI
    updateModeButton(data.mode);
    updateNextItemInfo(data.nextItem);

    // Start/stop countdown
    if (data.nextItem) {
        startCountdown(data.nextItem.startAt);
    } else {
        stopCountdown();
    }
}

/**
 * Update mode button appearance
 */
function updateModeButton(mode) {
    if (!autoModeBtn) return;

    modeText.textContent = mode;

    if (mode === 'AUTO') {
        autoModeBtn.classList.add('mode-auto');
        autoModeBtn.classList.remove('mode-manual');
    } else {
        autoModeBtn.classList.add('mode-manual');
        autoModeBtn.classList.remove('mode-auto');
    }
}

/**
 * Update next item info display
 */
function updateNextItemInfo(item) {
    if (!nextItemInfo) return;

    console.log('[DEBUG] updateNextItemInfo item:', item);

    if (item) {
        nextItemName.textContent = item.name;
        if (nextItemDuration) {
            nextItemDuration.textContent = `(${safeFormatDuration(item.durationSeconds)})`;
        }
        nextItemInfo.style.display = 'flex';
    } else {
        nextItemInfo.style.display = 'none';
    }
}

/**
 * Start countdown timer
 */
function startCountdown(startAt) {
    stopCountdown();

    countdownInterval = setInterval(() => {
        const now = new Date();
        const start = new Date(startAt);
        const diff = Math.max(0, (start - now) / 1000);

        const minutes = Math.floor(diff / 60);
        const seconds = Math.floor(diff % 60);

        if (nextCountdown) {
            nextCountdown.textContent =
                `dans ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }

        if (diff <= 0) {
            stopCountdown();
        }
    }, 1000);
}

/**
 * Stop countdown timer
 */
function stopCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
}

// Event listeners
addItemBtn.addEventListener('click', addItem);
scanBtn.addEventListener('click', scanMedia);
clearPlaylistBtn.addEventListener('click', clearPlaylist);
stopPlaybackBtn.addEventListener('click', stopPlayback);
autoModeBtn.addEventListener('click', toggleAutoplayMode);

// Allow Enter key to add item
[itemNameInput, itemFileInput, itemDurationInput].forEach(input => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addItem();
        }
    });
});

// Initialize
console.log('[APP] RTG Playout starting...');
connect();

// Update current time every second
setInterval(updateCurrentTime, 1000);
updateCurrentTime();
