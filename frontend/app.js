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
        requestGraphicsData();
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

        case 'HARD_START_ERROR':
            handleHardStartError(message.data);
            break;

        // Template/Graphics messages
        case 'TEMPLATE_LOADED':
        case 'TEMPLATE_PLAYING':
        case 'TEMPLATE_STOPPED':
        case 'TEMPLATE_UPDATED':
        case 'TEMPLATE_REMOVED':
            requestGraphicsData();
            break;

        case 'TEMPLATE_ACTIVE_LIST':
            activeTemplates = message.data.templates || [];
            renderActiveTemplates();
            break;

        case 'PRESET_SAVED':
        case 'PRESET_DELETED':
            // Presets will be sent via PRESET_LIST
            break;

        case 'PRESET_LIST':
            presets = message.data.presets || [];
            renderPresets();
            break;

        // Folder messages
        case 'FOLDER_LIST':
            folders = message.data.folders || [];
            renderFolders();
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
 * Update playlist rows visual state
 */
function updatePlaylistRows(playingItemId) {
    const rows = playlistBodyEl.querySelectorAll('tr');
    rows.forEach(row => {
        const itemId = row.dataset.itemId;
        const playBtn = row.querySelector('.btn-play');
        const onAirIndicator = row.querySelector('.on-air-indicator');

        if (itemId === playingItemId) {
            row.classList.add('playing');
            if (playBtn) playBtn.textContent = '⏸';
            if (onAirIndicator) onAirIndicator.style.display = 'inline-block';
        } else {
            row.classList.remove('playing');
            if (playBtn) playBtn.textContent = '▶';
            if (onAirIndicator) onAirIndicator.style.display = 'none';
        }
    });
}

/**
 * Handle playback status update
 */
function handlePlaybackStatus(data) {
    currentlyPlaying = data.itemId;

    // Update UI to show which item is playing
    if (data.status === 'playing') {
        updatePlaylistRows(currentlyPlaying);
    } else {
        updatePlaylistRows(null);
    }

    console.log('[PLAYBACK]', data.status, data.file || '');
}

/**
 * Render media library
 */
function renderMediaLibrary() {
    // Filter media by selected folder
    let filteredMedia = mediaLibrary;
    if (selectedFolderId !== null) {
        if (selectedFolderId === 1) {
            // Special case: "Non classé" (ID: 1) shows ALL unassigned media
            // This includes media with folderId === 1, null, undefined, or not in any other folder
            const otherFolderIds = folders
                .filter(f => f.id !== 1)
                .map(f => f.id);

            filteredMedia = mediaLibrary.filter(media =>
                !media.folderId ||
                media.folderId === 1 ||
                !otherFolderIds.includes(media.folderId)
            );
        } else {
            // Normal filtering for other folders
            filteredMedia = mediaLibrary.filter(media => media.folderId === selectedFolderId);
        }
    }

    console.log('[MEDIA] Total media:', mediaLibrary.length, '| Filtered:', filteredMedia.length, '| Selected folder:', selectedFolderId);
    if (selectedFolderId !== null && filteredMedia.length === 0) {
        console.warn('[MEDIA] No media found for folder', selectedFolderId);
        console.log('[MEDIA] Sample media folderIds:', mediaLibrary.slice(0, 5).map(m => ({ file: m.file, folderId: m.folderId })));
    }

    mediaCountEl.textContent = filteredMedia.length;
    mediaListEl.innerHTML = '';

    if (filteredMedia.length === 0) {
        const message = selectedFolderId !== null
            ? `<div class="empty-media">Aucun fichier dans ce dossier</div>`
            : '<div class="empty-media">Aucun fichier trouvé</div>';
        mediaListEl.innerHTML = message;
        return;
    }

    filteredMedia.forEach(media => {
        const item = document.createElement('div');
        item.className = 'media-item';
        item.draggable = true;
        item.dataset.file = media.file;
        item.dataset.name = media.name;
        item.dataset.duration = media.durationSeconds;
        item.dataset.folderId = media.folderId || 1;

        const duration = media.durationSeconds > 0
            ? safeFormatDuration(media.durationSeconds)
            : '--:--:--';

        const thumbnailHtml = media.thumbnail
            ? `<img src="${media.thumbnail}" class="media-thumbnail" alt="Thumbnail" onerror="this.style.display='none'">`
            : '';

        // Add folder indicator
        const folder = folders.find(f => f.id === (media.folderId || 1));
        const folderIndicator = folder
            ? `<div class="media-folder-badge" style="background: ${folder.color};" title="${folder.name}"></div>`
            : '';

        item.innerHTML = `
      ${thumbnailHtml}
      <div class="media-details">
        <div class="media-name">${escapeHtml(media.name)} ${folderIndicator}</div>
        <div class="media-info">
            <span class="media-duration">${duration}</span>
            <span class="media-file">${escapeHtml(media.file)}</span>
        </div>
      </div>
    `;

        // Right-click context menu for folder assignment
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showMediaContextMenu(e, media);
        });

        item.addEventListener('dragstart', handleMediaDragStart);
        item.addEventListener('click', () => addMediaToPlaylist(media));

        mediaListEl.appendChild(item);
    });
}

/**
 * Show context menu for media item (assign to folder)
 */
function showMediaContextMenu(e, media) {
    // Remove any existing context menu
    const existing = document.querySelector('.context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.position = 'fixed';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    let menuHTML = '<div class="context-menu-title">Déplacer vers...</div>';
    folders.forEach(folder => {
        menuHTML += `
            <div class="context-menu-item" data-folder-id="${folder.id}">
                <div class="folder-color" style="background: ${folder.color}; width: 10px; height: 10px; border-radius: 50%; display: inline-block;"></div>
                ${escapeHtml(folder.name)}
                ${media.folderId === folder.id ? '✓' : ''}
            </div>
        `;
    });
    menu.innerHTML = menuHTML;

    document.body.appendChild(menu);

    // Add click handlers
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const folderId = parseInt(item.dataset.folderId);
            sendFolderCommand('FOLDER_ASSIGN_MEDIA', {
                mediaFile: media.file,
                folderId
            });
            menu.remove();
        });
    });

    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        });
    }, 100);
}

/**
 * Render playlist to table
 */
function renderPlaylist(data) {
    console.log('[APP] Rendering playlist:', data.items.length, 'items');

    // Update global playlist data
    playlistData = data;

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

        // Check for hard start time
        const hardStartIndicator = item.hardStartTime
            ? `<div class="hard-start-indicator">
                <span class="hard-start-icon">⏰</span>
                <span class="hard-start-time">${item.hardStartTime}</span>
               </div>`
            : '';

        row.innerHTML = `
      <td class="col-index">${index + 1}</td>
      <td class="col-name">
        ${escapeHtml(item.name)}
        ${item.type === 'live' ? '<span class="live-badge">DIRECT</span>' : ''}
        ${hardStartIndicator}
      </td>
      <td class="col-file">${item.type === 'live' ? `DeckLink ${escapeHtml(item.file)}` : escapeHtml(item.file)}</td>
      <td class="col-duration">
        ${safeFormatDuration(item.durationSeconds)}
        ${item.trimOutSeconds > 0 ? `<span class="trim-info" title="Raccourci de ${item.trimOutSeconds}s">✂️ -${safeFormatDuration(item.trimOutSeconds)}</span>` : ''}
        ${item.trimOutSeconds < 0 ? `<span class="gap-info" title="Prolongé de ${Math.abs(item.trimOutSeconds)}s">⏳ +${safeFormatDuration(Math.abs(item.trimOutSeconds))}</span>` : ''}
      </td>
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
        <button class="btn-hard-start ${item.hardStartTime ? 'active' : ''}" data-item-id="${item.id}" title="Démarrage strict">⏰</button>
        <button class="btn-secondary btn-small btn-secondary-events" data-item-id="${item.id}" title="Événements Secondaires">⚡
            ${(item.secondaryEvents && item.secondaryEvents.length > 0) ? `<span class="event-badge">${item.secondaryEvents.length}</span>` : ''}
        </button>
        <button class="btn-delete" onclick="deleteItem('${item.id}')">✕</button>
      </td>
    `;

        playlistBodyEl.appendChild(row);
    });

    // Attach hard start button listeners
    document.querySelectorAll('.btn-hard-start').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const itemId = btn.dataset.itemId;
            openHardStartModal(itemId);
        });
    });

    // Attach secondary events button listeners
    document.querySelectorAll('.btn-secondary-events').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const itemId = btn.dataset.itemId;
            openSecondaryEventsModal(itemId);
        });
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
            durationSeconds: media.durationSeconds,
            thumbnail: media.thumbnail
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
 * Show notification toast
 */
function showNotification(level, message) {
    const notification = document.createElement('div');
    notification.className = `notification ${level}`;

    notification.innerHTML = `
        <div class="notification-message">${escapeHtml(message)}</div>
        <button class="notification-close">×</button>
    `;

    notificationContainer.appendChild(notification);

    // Close button handler
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => {
        notification.remove();
    });

    // Auto-remove after 5 seconds
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

/**
 * Update current time and offset display
 */
function updateCurrentTime() {
    const now = new Date();
    currentTimeEl.textContent = formatTime(now.toISOString());

    updateOffset(now);
    updateProgressBar(now);
}

/**
 * Update progress bar
 */
function updateProgressBar(now) {
    const progressBar = document.getElementById('progressBar');
    const progressContainer = document.getElementById('progressContainer');

    if (!progressBar || !progressContainer) return;

    if (currentItem && currentItem.startAt) {
        progressContainer.style.display = 'block';
        const start = new Date(currentItem.startAt).getTime();
        const duration = currentItem.durationSeconds * 1000;
        const nowMs = now.getTime();

        let progress = (nowMs - start) / duration * 100;
        progress = Math.max(0, Math.min(100, progress));

        progressBar.style.width = `${progress}%`;
    } else {
        progressContainer.style.display = 'none';
        progressBar.style.width = '0%';
    }
}

/**
 * Calculate and display time offset
 */
function updateOffset(now) {
    const offsetEl = document.getElementById('offsetTime');
    if (!offsetEl) return;

    // Only calculate offset when something is actually playing
    if (!currentItem || !currentItem.startAt) {
        offsetEl.textContent = '±00:00:00';
        offsetEl.className = 'time-display offset-display';
        return;
    }

    // Use current item's start time as reference
    const expectedTime = new Date(currentItem.startAt);

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

    // Sync currentlyPlaying ID and visual state
    if (currentItem && currentItem.status === 'PLAYING') {
        currentlyPlaying = currentItem.id;
        updatePlaylistRows(currentlyPlaying);
    } else {
        currentlyPlaying = null;
        updatePlaylistRows(null);
    }

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
            // Show hard start time if configured, otherwise show duration
            if (item.hardStartTime) {
                nextItemDuration.textContent = `⏰ ${item.hardStartTime}`;
            } else {
                nextItemDuration.textContent = `(${safeFormatDuration(item.durationSeconds)})`;
            }
        }

        const thumbnailEl = document.getElementById('nextItemThumbnail');
        if (thumbnailEl) {
            if (item.thumbnail) {
                thumbnailEl.src = item.thumbnail;
                thumbnailEl.style.display = 'block';
            } else {
                thumbnailEl.style.display = 'none';
            }
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

/**
 * ========================================
 * GRAPHICS/TEMPLATES MANAGEMENT
 * ========================================
 */

// Graphics panel state
let presets = [];
let activeTemplates = [];

// Graphics DOM elements
const templateNameEl = document.getElementById('templateName');
const templateLayerEl = document.getElementById('templateLayer');
const templateChannelEl = document.getElementById('templateChannel');
const templateDataEl = document.getElementById('templateData');
const presetListEl = document.getElementById('presetList');
const activeTemplateListEl = document.getElementById('activeTemplateList');

// Graphics buttons
const templateLoadBtn = document.getElementById('templateLoadBtn');
const templatePlayBtn = document.getElementById('templatePlayBtn');
const templateStopBtn = document.getElementById('templateStopBtn');
const templateUpdateBtn = document.getElementById('templateUpdateBtn');
const templateRemoveBtn = document.getElementById('templateRemoveBtn');
const templateLoadAndPlayBtn = document.getElementById('templateLoadAndPlayBtn');
const saveAsPresetBtn = document.getElementById('saveAsPresetBtn');
const toggleGraphicsBtn = document.getElementById('toggleGraphicsBtn');

// Modal elements
const presetModal = document.getElementById('presetModal');
const presetNameInput = document.getElementById('presetNameInput');
const confirmPresetBtn = document.getElementById('confirmPresetBtn');
const cancelPresetBtn = document.getElementById('cancelPresetBtn');
const closePresetModal = document.getElementById('closePresetModal');

/**
 * Send template command to server
 */
function sendTemplateCommand(type, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showNotification('error', 'WebSocket non connecté');
        return;
    }

    ws.send(JSON.stringify({ type, data }));
    console.log(`[TEMPLATE] Sent command: ${type}`, data);
}

/**
 * Get current template form data
 */
function getTemplateFormData() {
    const channel = parseInt(templateChannelEl.value);
    const layer = parseInt(templateLayerEl.value);
    const templateName = templateNameEl.value;

    let templateData = {};
    if (templateDataEl.value.trim()) {
        try {
            templateData = JSON.parse(templateDataEl.value);
        } catch (e) {
            showNotification('error', 'JSON invalide dans les données du template');
            throw new Error('Invalid JSON');
        }
    }

    return { channel, layer, templateName, templateData };
}

/**
 * Template control button handlers
 */
templateLoadBtn.addEventListener('click', () => {
    try {
        const data = getTemplateFormData();
        if (!data.templateName) {
            showNotification('error', 'Veuillez sélectionner un template');
            return;
        }
        sendTemplateCommand('TEMPLATE_LOAD', data);
    } catch (e) {
        // Error already shown
    }
});

templatePlayBtn.addEventListener('click', () => {
    const channel = parseInt(templateChannelEl.value);
    const layer = parseInt(templateLayerEl.value);
    sendTemplateCommand('TEMPLATE_PLAY', { channel, layer });
});

templateStopBtn.addEventListener('click', () => {
    const channel = parseInt(templateChannelEl.value);
    const layer = parseInt(templateLayerEl.value);
    sendTemplateCommand('TEMPLATE_STOP', { channel, layer });
});

templateUpdateBtn.addEventListener('click', () => {
    try {
        const data = getTemplateFormData();
        sendTemplateCommand('TEMPLATE_UPDATE', {
            channel: data.channel,
            layer: data.layer,
            templateData: data.templateData
        });
    } catch (e) {
        // Error already shown
    }
});

templateRemoveBtn.addEventListener('click', () => {
    const channel = parseInt(templateChannelEl.value);
    const layer = parseInt(templateLayerEl.value);
    sendTemplateCommand('TEMPLATE_REMOVE', { channel, layer });
});

templateLoadAndPlayBtn.addEventListener('click', () => {
    try {
        const data = getTemplateFormData();
        if (!data.templateName) {
            showNotification('error', 'Veuillez sélectionner un template');
            return;
        }
        sendTemplateCommand('TEMPLATE_LOAD_AND_PLAY', data);
    } catch (e) {
        // Error already shown
    }
});

/**
 * Preset management
 */
saveAsPresetBtn.addEventListener('click', () => {
    const templateName = templateNameEl.value;
    if (!templateName) {
        showNotification('error', 'Veuillez sélectionner un template');
        return;
    }

    presetNameInput.value = '';
    presetModal.style.display = 'flex';
    presetNameInput.focus();
});

confirmPresetBtn.addEventListener('click', () => {
    const name = presetNameInput.value.trim();
    if (!name) {
        showNotification('error', 'Veuillez entrer un nom pour le preset');
        return;
    }

    try {
        const data = getTemplateFormData();
        if (!data.templateName) {
            showNotification('error', 'Veuillez sélectionner un template');
            return;
        }

        sendTemplateCommand('PRESET_SAVE', {
            name,
            channel: data.channel,
            layer: data.layer,
            templateName: data.templateName,
            templateData: data.templateData
        });

        presetModal.style.display = 'none';
        showNotification('success', `Preset "${name}" sauvegardé`);
    } catch (e) {
        // Error already shown
    }
});

cancelPresetBtn.addEventListener('click', () => {
    presetModal.style.display = 'none';
});

closePresetModal.addEventListener('click', () => {
    presetModal.style.display = 'none';
});

/**
 * Toggle graphics panel
 */
toggleGraphicsBtn.addEventListener('click', () => {
    const panel = document.querySelector('.graphics-panel');
    const icon = document.getElementById('graphicsToggleIcon');

    panel.classList.toggle('collapsed');
    icon.textContent = panel.classList.contains('collapsed') ? '▶' : '◀';
});

/**
 * Render preset list
 */
function renderPresets() {
    if (presets.length === 0) {
        presetListEl.innerHTML = '<div class="empty-presets">Aucun preset sauvegardé</div>';
        return;
    }

    presetListEl.innerHTML = presets.map(preset => `
        <div class="preset-item" data-preset="${escapeHtml(preset.name)}">
            <div>
                <div class="preset-name">${escapeHtml(preset.name)}</div>
                <div class="preset-info">${escapeHtml(preset.templateName)} @ ${preset.channel}-${preset.layer}</div>
            </div>
            <div class="preset-actions">
                <button class="btn-primary btn-small preset-load">Load</button>
                <button class="btn-danger btn-small preset-delete">×</button>
            </div>
        </div>
    `).join('');

    // Add event listeners
    document.querySelectorAll('.preset-load').forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            sendTemplateCommand('PRESET_LOAD', { name: presets[index].name, play: true });
        });
    });

    document.querySelectorAll('.preset-delete').forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Supprimer le preset "${presets[index].name}" ?`)) {
                sendTemplateCommand('PRESET_DELETE', { name: presets[index].name });
            }
        });
    });
}

/**
 * Render active templates
 */
function renderActiveTemplates() {
    if (activeTemplates.length === 0) {
        activeTemplateListEl.innerHTML = '<div class="empty-active">Aucun template actif</div>';
        return;
    }

    activeTemplateListEl.innerHTML = activeTemplates.map(tmpl => `
        <div class="active-template-item ${tmpl.playing ? 'playing' : ''}">
            <div class="active-template-header">
                <div class="active-template-name">${escapeHtml(tmpl.templateName)}</div>
                <div class="active-template-layer">${tmpl.channel}-${tmpl.layer}</div>
            </div>
            <div class="active-template-controls">
                ${!tmpl.playing ? `<button class="btn-primary btn-small" data-channel="${tmpl.channel}" data-layer="${tmpl.layer}" data-action="play">Play</button>` : ''}
                ${tmpl.playing ? `<button class="btn-warning btn-small" data-channel="${tmpl.channel}" data-layer="${tmpl.layer}" data-action="stop">Stop</button>` : ''}
                <button class="btn-danger btn-small" data-channel="${tmpl.channel}" data-layer="${tmpl.layer}" data-action="remove">Remove</button>
            </div>
        </div>
    `).join('');

    // Add event listeners
    document.querySelectorAll('.active-template-controls button').forEach(btn => {
        btn.addEventListener('click', () => {
            const channel = parseInt(btn.dataset.channel);
            const layer = parseInt(btn.dataset.layer);
            const action = btn.dataset.action;

            if (action === 'play') {
                sendTemplateCommand('TEMPLATE_PLAY', { channel, layer });
            } else if (action === 'stop') {
                sendTemplateCommand('TEMPLATE_STOP', { channel, layer });
            } else if (action === 'remove') {
                sendTemplateCommand('TEMPLATE_REMOVE', { channel, layer });
            }
        });
    });
}

/**
 * ========================================
 * SECONDARY EVENTS MANAGEMENT
 * ========================================
 */

// Modal elements
const secondaryEventsModal = document.getElementById('secondaryEventsModal');
const closeSecondaryEventsModal = document.getElementById('closeSecondaryEventsModal');
const closeSecondaryEventsBtn = document.getElementById('closeSecondaryEventsBtn');
const secondaryEventsItemId = document.getElementById('secondaryEventsItemId');
const eventsList = document.getElementById('eventsList');

// Form elements
const eventTypeInput = document.getElementById('eventTypeInput');
const eventTriggerInput = document.getElementById('eventTriggerInput');
const eventOffsetInput = document.getElementById('eventOffsetInput');
const eventLayerInput = document.getElementById('eventLayerInput');
const eventTemplateInput = document.getElementById('eventTemplateInput');
const eventDataInput = document.getElementById('eventDataInput');
const eventTemplateOptions = document.getElementById('eventTemplateOptions');
const addEventBtn = document.getElementById('addEventBtn');

// Open modal
window.openSecondaryEventsModal = function (itemId) {
    const item = playlistData.items.find(i => i.id === itemId);
    if (!item) return;

    secondaryEventsItemId.value = itemId;
    renderSecondaryEvents(item.secondaryEvents || []);
    
    // Populate templates dropdown from main dropdown
    if (eventTemplateInput.options.length === 0) {
        Array.from(templateNameEl.options).forEach(opt => {
            if (opt.value) {
                const newOpt = document.createElement('option');
                newOpt.value = opt.value;
                newOpt.textContent = opt.textContent;
                eventTemplateInput.appendChild(newOpt);
            }
        });
    }

    // Reset form
    eventTypeInput.value = 'CG_ADD';
    eventTriggerInput.value = 'START';
    eventOffsetInput.value = '0';
    eventLayerInput.value = '20';
    eventDataInput.value = '';
    updateEventFormVisibility();

    secondaryEventsModal.style.display = 'flex';
};

// Render events list
function renderSecondaryEvents(events) {
    if (!events || events.length === 0) {
        eventsList.innerHTML = '<div class="empty-state-small">Aucun événement configuré</div>';
        return;
    }

    eventsList.innerHTML = events.map(evt => {
        let details = `Trigger: ${evt.trigger} ${evt.offsetMs >= 0 ? '+' : ''}${evt.offsetMs}ms | Layer: ${evt.layer}`;
        if (evt.type === 'CG_ADD') details += ` | Tpl: ${evt.template.split('/').pop()}`;

        return `
            <div class="event-item type-${evt.type}">
                <div class="event-info">
                    <div class="event-title">${evt.type}</div>
                    <div class="event-details">${details}</div>
                </div>
                <button class="event-delete" onclick="removeSecondaryEvent('${evt.id}')">🗑️</button>
            </div>
        `;
    }).join('');
}

// Update form visibility based on type
function updateEventFormVisibility() {
    const type = eventTypeInput.value;
    if (type === 'CG_ADD') {
        eventTemplateOptions.style.display = 'block';
    } else {
        eventTemplateOptions.style.display = 'none';
    }
}

eventTypeInput.addEventListener('change', updateEventFormVisibility);

// Add event handler
addEventBtn.addEventListener('click', () => {
    const itemId = secondaryEventsItemId.value;
    const type = eventTypeInput.value;
    const trigger = eventTriggerInput.value;
    const offsetMs = parseInt(eventOffsetInput.value) || 0;
    const layer = parseInt(eventLayerInput.value) || 20;

    const event = {
        type,
        trigger,
        offsetMs,
        layer
    };

    if (type === 'CG_ADD') {
        const template = eventTemplateInput.value;
        if (!template) {
            alert('Veuillez sélectionner un template');
            return;
        }
        event.template = template;

        try {
            const dataStr = eventDataInput.value.trim();
            event.data = dataStr ? JSON.parse(dataStr) : {};
        } catch (e) {
            alert('JSON invalide');
            return;
        }
    }

    // Send to server
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'SECONDARY_EVENT_ADD',
            data: { itemId, event }
        }));
    }
});

// Remove event handler
window.removeSecondaryEvent = function (eventId) {
    const itemId = secondaryEventsItemId.value;
    if (confirm('Supprimer cet événement ?')) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'SECONDARY_EVENT_REMOVE',
                data: { itemId, eventId }
            }));
        }
    }
};

// Close modal handlers
closeSecondaryEventsModal.addEventListener('click', () => secondaryEventsModal.style.display = 'none');
closeSecondaryEventsBtn.addEventListener('click', () => secondaryEventsModal.style.display = 'none');

/**
 * ========================================
 * END SECONDARY EVENTS MANAGEMENT
 * ========================================
 */

/**
 * Request presets and active templates from server
 */
function requestGraphicsData() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        sendTemplateCommand('PRESET_GET_ALL', {});
        sendTemplateCommand('TEMPLATE_GET_ACTIVE', {});
    }
}

/**
 * Template example data by template type
 */
templateNameEl.addEventListener('change', () => {
    const templateName = templateNameEl.value;
    const examples = {
        'rtg-lower-third/index': '{\n  "title": "Breaking News",\n  "subtitle": "Live from Paris"\n}',
        'rtg-clock/index': '{\n  "offset": 0\n}',
        'rtg-countdown/index': '{\n  "target": "2025-12-31T23:59:59"\n}',
        'rtg-full-title/index': '{\n  "title": "Programme Spécial"\n}',
        'rtg-logo-clock/index': '{\n  "offset": 0\n}',
        'rtg-bug/index': '{}',
        'rtg-pip/index': '{}',
        'rtg-roll/index': '{\n  "lines": ["Producer: John Doe", "Director: Jane Smith"]\n}',
        'rtg-election/index': '{\n  "title": "Résultats Élections 2025",\n  "candidates": [\n    {"name": "Candidat A", "votes": 1234, "percent": 45.2},\n    {"name": "Candidat B", "votes": 987, "percent": 36.1}\n  ]\n}'
    };

    if (examples[templateName]) {
        templateDataEl.value = examples[templateName];
    }
});

/**
 * ========================================
 * MEDIA FOLDERS MANAGEMENT
 * ========================================
 */

// Folders state
let folders = [];
let selectedFolderId = null; // null = show all

// Folder DOM elements
const folderListEl = document.getElementById('folderList');
const createFolderBtn = document.getElementById('createFolderBtn');
const selectedFolderNameEl = document.getElementById('selectedFolderName');

// Folder modal elements
const folderModal = document.getElementById('folderModal');
const folderModalTitle = document.getElementById('folderModalTitle');
const folderNameInput = document.getElementById('folderNameInput');
const folderColorInput = document.getElementById('folderColorInput');
const folderIdInput = document.getElementById('folderIdInput');
const confirmFolderBtn = document.getElementById('confirmFolderBtn');
const cancelFolderBtn = document.getElementById('cancelFolderBtn');
const closeFolderModal = document.getElementById('closeFolderModal');

/**
 * Send folder command to server
 */
function sendFolderCommand(type, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showNotification('error', 'WebSocket non connecté');
        return;
    }

    ws.send(JSON.stringify({ type, data }));
    console.log(`[FOLDER] Sent command: ${type}`, data);
}

/**
 * Render folders list
 */
function renderFolders() {
    console.log('[FOLDERS] Rendering', folders.length, 'folders');
    folderListEl.innerHTML = '';

    folders.forEach(folder => {
        const item = document.createElement('div');
        item.className = 'folder-item' + (folder.isDefault ? ' default' : '');
        if (selectedFolderId === folder.id) {
            item.classList.add('active');
        }

        item.innerHTML = `
            <div class="folder-main">
                <div class="folder-color" style="background: ${folder.color};"></div>
                <div class="folder-name">${escapeHtml(folder.name)}</div>
            </div>
            <span class="folder-count">${folder.mediaCount || 0}</span>
            ${!folder.isDefault ? `
            <div class="folder-actions">
                <button class="folder-action-btn edit" data-id="${folder.id}" title="Éditer">✏️</button>
                <button class="folder-action-btn delete" data-id="${folder.id}" title="Supprimer">🗑️</button>
            </div>
            ` : ''}
        `;

        // Click to select folder
        item.addEventListener('click', (e) => {
            console.log('[FOLDERS] Clicked on folder:', folder.name, folder.id);
            if (!e.target.classList.contains('folder-action-btn')) {
                selectFolder(folder.id);
            } else {
                console.log('[FOLDERS] Clicked on action button, ignoring');
            }
        });

        // Edit button
        const editBtn = item.querySelector('.edit');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openFolderModal(folder);
            });
        }

        // Delete button
        const deleteBtn = item.querySelector('.delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Supprimer le dossier "${folder.name}" ?\nLes médias seront déplacés vers "Non classé".`)) {
                    sendFolderCommand('FOLDER_DELETE', { id: folder.id });
                }
            });
        }

        // Drag and drop support
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            item.classList.add('drag-over');
        });

        item.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            item.classList.remove('drag-over');
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            item.classList.remove('drag-over');

            // Get dragged media file
            const jsonData = e.dataTransfer.getData('application/json');
            if (jsonData) {
                try {
                    const data = JSON.parse(jsonData);
                    if (data.type === 'MEDIA_ITEM' && data.file) {
                        // Assign media to this folder
                        sendFolderCommand('FOLDER_ASSIGN_MEDIA', {
                            mediaFile: data.file,
                            folderId: folder.id
                        });
                        showNotification('success', `"${data.name}" déplacé vers "${folder.name}"`);
                    }
                } catch (err) {
                    console.error('Error parsing drag data:', err);
                }
            }
        });

        folderListEl.appendChild(item);
    });
}

/**
 * Select a folder to filter media
 */
function selectFolder(folderId) {
    // Toggle selection if clicking on already selected folder
    if (selectedFolderId === folderId) {
        selectedFolderId = null;
        selectedFolderNameEl.textContent = '';
    } else {
        selectedFolderId = folderId;
        const folder = folders.find(f => f.id === folderId);
        if (folder) {
            selectedFolderNameEl.textContent = `- ${folder.name}`;
        } else {
            selectedFolderNameEl.textContent = '';
        }
    }

    console.log('[FOLDERS] Selected folder ID:', selectedFolderId);
    renderFolders();
    renderMediaLibrary();
}

/**
 * Open folder creation/edit modal
 */
function openFolderModal(folder = null) {
    if (folder) {
        // Edit mode
        folderModalTitle.textContent = 'Éditer le dossier';
        folderNameInput.value = folder.name;
        folderColorInput.value = folder.color;
        folderIdInput.value = folder.id;
        confirmFolderBtn.textContent = 'Modifier';
    } else {
        // Create mode
        folderModalTitle.textContent = 'Créer un dossier';
        folderNameInput.value = '';
        folderColorInput.value = '#118ab2';
        folderIdInput.value = '';
        confirmFolderBtn.textContent = 'Créer';
    }

    // Update color picker
    document.querySelectorAll('.color-option').forEach(option => {
        option.classList.toggle('selected', option.dataset.color === folderColorInput.value);
    });

    folderModal.style.display = 'flex';
    folderNameInput.focus();
}

/**
 * Close folder modal
 */
function closeFolderModalFunc() {
    folderModal.style.display = 'none';
}

/**
 * Create folder button
 */
createFolderBtn.addEventListener('click', () => {
    openFolderModal();
});

/**
 * Color picker
 */
document.querySelectorAll('.color-option').forEach(option => {
    option.addEventListener('click', () => {
        folderColorInput.value = option.dataset.color;

        document.querySelectorAll('.color-option').forEach(opt => {
            opt.classList.remove('selected');
        });
        option.classList.add('selected');
    });
});

/**
 * Confirm folder creation/edit
 */
confirmFolderBtn.addEventListener('click', () => {
    const name = folderNameInput.value.trim();
    const color = folderColorInput.value;
    const id = folderIdInput.value;

    if (!name) {
        showNotification('error', 'Veuillez entrer un nom de dossier');
        return;
    }

    if (id) {
        // Edit existing folder
        sendFolderCommand('FOLDER_UPDATE', {
            id: parseInt(id),
            updates: { name, color }
        });
    } else {
        // Create new folder
        sendFolderCommand('FOLDER_CREATE', {
            name,
            color,
            parentId: null
        });
    }

    closeFolderModalFunc();
});

/**
 * Cancel folder modal
 */
cancelFolderBtn.addEventListener('click', closeFolderModalFunc);
closeFolderModal.addEventListener('click', closeFolderModalFunc);

/**
 * ========================================
 * HARD START TIME MANAGEMENT
 * ========================================
 */

// Hard Start modal elements
const hardStartModal = document.getElementById('hardStartModal');
const hardStartTimeInput = document.getElementById('hardStartTimeInput');
const hardStartEnabledInput = document.getElementById('hardStartEnabledInput');
const hardStartItemIdInput = document.getElementById('hardStartItemId');
const hardStartStatusDiv = document.getElementById('hardStartStatus');
const confirmHardStartBtn = document.getElementById('confirmHardStartBtn');
const cancelHardStartBtn = document.getElementById('cancelHardStartBtn');
const closeHardStartModal = document.getElementById('closeHardStartModal');

/**
 * Open hard start modal
 */
function openHardStartModal(itemId) {
    // Find the item in playlist
    const item = playlistData.items.find(i => i.id === itemId);
    if (!item) {
        console.error('[HARD START] Item not found:', itemId);
        return;
    }

    hardStartItemIdInput.value = itemId;

    // Show scheduled start time
    const scheduledTime = new Date(item.startAt);
    const scheduledTimeStr = formatTimeInput(scheduledTime);

    if (item.hardStartTime) {
        hardStartTimeInput.value = item.hardStartTime;
        hardStartEnabledInput.checked = true;

        // Show status: hard start is active
        hardStartStatusDiv.style.display = 'block';
        hardStartStatusDiv.innerHTML = `
            <div class="status-label">Démarrage strict actif</div>
            <div class="status-time">⏰ ${item.hardStartTime}</div>
            <div class="status-label" style="margin-top: 8px;">Heure planifiée: ${scheduledTimeStr}</div>
        `;
    } else {
        // Default to the item's scheduled start time
        hardStartTimeInput.value = scheduledTimeStr;
        hardStartEnabledInput.checked = false;

        // Show status: no hard start
        hardStartStatusDiv.style.display = 'block';
        hardStartStatusDiv.innerHTML = `
            <div class="status-label">Heure planifiée actuelle</div>
            <div class="status-time">${scheduledTimeStr}</div>
            <div class="status-label" style="margin-top: 8px; color: var(--text-secondary);">Aucun démarrage strict configuré</div>
        `;
    }

    hardStartModal.style.display = 'flex';
    hardStartTimeInput.focus();
}

/**
 * Close hard start modal
 */
function closeHardStartModalFunc() {
    hardStartModal.style.display = 'none';
    hardStartTimeInput.value = '';
    hardStartEnabledInput.checked = true;
    hardStartItemIdInput.value = '';
}

/**
 * Format time for input (HH:MM:SS)
 */
function formatTimeInput(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

/**
 * Confirm hard start time
 */
confirmHardStartBtn.addEventListener('click', () => {
    const itemId = hardStartItemIdInput.value;
    const enabled = hardStartEnabledInput.checked;
    const time = hardStartTimeInput.value;

    if (enabled && !time) {
        showNotification('error', 'Veuillez sélectionner une heure');
        return;
    }

    // Send to server
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'PLAYLIST_SET_HARD_START',
            data: {
                itemId: itemId,
                hardStartTime: enabled ? time : null
            }
        }));
    }

    closeHardStartModalFunc();
});

/**
 * Handle hard start error from server
 */
function handleHardStartError(data) {
    console.error('[HARD START] Errors:', data.errors);

    if (data.errors && data.errors.length > 0) {
        const error = data.errors[0]; // Show first error

        let message = `⚠️ Hard Start impossible pour "${error.itemName}":\n\n`;
        message += error.reason;

        if (error.trimNeeded && error.maxTrim) {
            message += `\n\nRéduction nécessaire: ${error.trimNeeded}s`;
            message += `\nRéduction maximale possible: ${error.maxTrim}s`;
            message += `\n\nConseil: Ajoutez plus de contenu avant cet élément ou choisissez une heure de hard start plus proche.`;
        }

        showNotification('error', message, 10000); // Show for 10 seconds
    }
}

/**
 * Cancel hard start modal
 */
cancelHardStartBtn.addEventListener('click', closeHardStartModalFunc);
closeHardStartModal.addEventListener('click', closeHardStartModalFunc);

// ==========================================
// LIVE INPUT MANAGEMENT
// ==========================================

const liveInputModal = document.getElementById('liveInputModal');
const addLiveBtn = document.getElementById('addLiveBtn');
const closeLiveInputModal = document.getElementById('closeLiveInputModal');
const cancelLiveBtn = document.getElementById('cancelLiveBtn');
const confirmLiveBtn = document.getElementById('confirmLiveBtn');
const liveNameInput = document.getElementById('liveNameInput');
const liveSourceInput = document.getElementById('liveSourceInput');
const liveDurationInput = document.getElementById('liveDurationInput');

if (addLiveBtn) {
    addLiveBtn.addEventListener('click', () => {
        if (liveInputModal) liveInputModal.style.display = 'flex';
    });
}

if (closeLiveInputModal) {
    closeLiveInputModal.addEventListener('click', () => {
        if (liveInputModal) liveInputModal.style.display = 'none';
    });
}

if (cancelLiveBtn) {
    cancelLiveBtn.addEventListener('click', () => {
        if (liveInputModal) liveInputModal.style.display = 'none';
    });
}

if (confirmLiveBtn) {
    confirmLiveBtn.addEventListener('click', () => {
        const name = liveNameInput.value.trim();
        const source = liveSourceInput.value;
        const durationStr = liveDurationInput.value.trim();

        if (!name) {
            showNotification('error', 'Le nom est requis');
            return;
        }

        // Parse duration HH:MM:SS
        const parts = durationStr.split(':').map(Number);
        if (parts.length !== 3 || parts.some(isNaN)) {
             showNotification('error', 'Format de durée invalide (HH:MM:SS)');
             return;
        }

        const durationSeconds = (parts[0] * 3600) + (parts[1] * 60) + parts[2];
        if (durationSeconds <= 0) {
            showNotification('error', 'La durée doit être supérieure à 0');
            return;
        }

        const newItem = {
            name: name,
            file: source,
            type: 'live',
            durationSeconds: durationSeconds
        };

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'ADD_ITEM',
                data: newItem
            }));
            showNotification('success', 'Entrée Direct ajoutée');
            if (liveInputModal) liveInputModal.style.display = 'none';
            
            // Reset form
            liveNameInput.value = '';
            liveDurationInput.value = '00:10:00';
        } else {
            showNotification('error', 'Non connecté au serveur');
        }
    });
}

// Initialize
console.log('[APP] RTG Playout starting...');
connect();

// Update current time every second
setInterval(updateCurrentTime, 1000);
updateCurrentTime();
