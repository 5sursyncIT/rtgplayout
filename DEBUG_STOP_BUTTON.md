# Debug: Bouton STOP Ne Fonctionne Plus

**Date:** 2025-12-21
**Symptôme:** Le bouton STOP du playout ne répond pas aux clics

## Modifications Apportées

### 1. Ajout de Logs Frontend ([app.js](frontend/app.js))

**Ligne 646-658:**
```javascript
function stopPlayback() {
    console.log('[STOP] Stop button clicked');

    if (confirm('Arrêter la diffusion en cours ?')) {
        console.log('[STOP] User confirmed, sending STOP_PLAYBACK message');
        sendMessage({
            type: 'STOP_PLAYBACK',
            data: {}
        });
    } else {
        console.log('[STOP] User cancelled');
    }
}
```

**Ligne 1029-1034:**
```javascript
if (stopPlaybackBtn) {
    console.log('[INIT] stopPlaybackBtn found, attaching listener');
    stopPlaybackBtn.addEventListener('click', stopPlayback);
} else {
    console.error('[INIT] stopPlaybackBtn NOT FOUND!');
}
```

### 2. Ajout de Logs Backend ([server.js](backend/server.js))

**Ligne 1028-1037:**
```javascript
async function handleStopPlayback(data) {
    logger.info('[STOP] handleStopPlayback called with data:', data);

    try {
        if (!casparConnected) {
            logger.error('[STOP] CasparCG not connected');
            throw new Error('CasparCG not connected');
        }

        logger.info(`[CASPAR] Stopping playback on ${CASPAR_CHANNEL}-${CASPAR_LAYER}`);
        // ...
```

## Procédure de Diagnostic

### Étape 1: Vérifier que le Bouton Existe

**Dans la console du navigateur (F12):**
```javascript
document.getElementById('stopPlaybackBtn')
```

**Résultat attendu:** L'élément `<button>` doit être retourné, pas `null`

### Étape 2: Vérifier l'Initialisation

**Dans la console au chargement de la page:**

✅ Si le bouton existe:
```
[INIT] stopPlaybackBtn found, attaching listener
```

❌ Si le bouton n'existe pas:
```
[INIT] stopPlaybackBtn NOT FOUND!
```

### Étape 3: Vérifier le Clic

**Cliquer sur le bouton STOP:**

✅ Si le listener est attaché:
```
[STOP] Stop button clicked
```

❌ Si rien ne s'affiche: Le listener n'est pas attaché

### Étape 4: Vérifier la Popup de Confirmation

**Après le clic:**

✅ Si l'utilisateur confirme:
```
[STOP] User confirmed, sending STOP_PLAYBACK message
```

✅ Si l'utilisateur annule:
```
[STOP] User cancelled
```

### Étape 5: Vérifier Réception Serveur

**Dans les logs du serveur backend:**

✅ Si le message arrive:
```
[INFO] [STOP] handleStopPlayback called with data: {}
[INFO] [CASPAR] Stopping playback on 1-10
[INFO] [CASPAR] Playback stopped
```

❌ Si CasparCG est déconnecté:
```
[ERROR] [STOP] CasparCG not connected
```

## Causes Possibles

### 1. Bouton Non Trouvé
**Symptôme:** `[INIT] stopPlaybackBtn NOT FOUND!` dans la console

**Causes:**
- Le fichier index.html a été modifié
- L'ID `stopPlaybackBtn` a changé
- Le script `app.js` se charge avant le DOM

**Solution:**
```javascript
// Charger le script après le DOM
document.addEventListener('DOMContentLoaded', () => {
    // Initialisation ici
});
```

### 2. Listener Non Attaché
**Symptôme:** Pas de log au clic

**Causes:**
- Erreur JavaScript avant l'attachement du listener
- Le bouton est dans un élément qui se recharge (ex: innerHTML)

**Solution:** Vérifier la console pour les erreurs JavaScript

### 3. WebSocket Déconnecté
**Symptôme:** Clic fonctionne, mais rien côté serveur

**Causes:**
- WebSocket déconnecté
- Serveur backend arrêté

**Solution:** Vérifier l'état de la connexion:
```javascript
// Dans la console
ws.readyState === WebSocket.OPEN  // Doit être true
```

### 4. CasparCG Déconnecté
**Symptôme:** Erreur `CasparCG not connected` dans les logs serveur

**Causes:**
- CasparCG Server arrêté
- Problème de connexion réseau

**Solution:**
```bash
# Vérifier que CasparCG écoute
telnet 127.0.0.1 5250
```

### 5. Commande STOP Échoue
**Symptôme:** Message arrive au serveur mais erreur lors de l'envoi à CasparCG

**Causes:**
- Timeout de commande
- CasparCG ne répond pas

**Solution:** Vérifier les logs CasparCG pour les erreurs

## Tests Manuels

### Test 1: Bouton Existe
```javascript
// Console navigateur
console.log(document.getElementById('stopPlaybackBtn'));
// Résultat: <button id="stopPlaybackBtn" ...>
```

### Test 2: Fonction Existe
```javascript
// Console navigateur
console.log(typeof stopPlayback);
// Résultat: "function"
```

### Test 3: Appel Direct
```javascript
// Console navigateur
stopPlayback();
// Popup de confirmation doit apparaître
```

### Test 4: WebSocket Actif
```javascript
// Console navigateur
console.log(ws.readyState);
// Résultat: 1 (OPEN)
```

### Test 5: CasparCG Connecté
**Console serveur (backend):**
```
[CASPAR] Connected to CasparCG Server
```

## Vérification Rapide

**Checklist 30 secondes:**

1. [ ] Ouvrir la console du navigateur (F12)
2. [ ] Recharger la page (Ctrl+R)
3. [ ] Chercher: `[INIT] stopPlaybackBtn`
4. [ ] Cliquer sur STOP
5. [ ] Chercher: `[STOP] Stop button clicked`
6. [ ] Vérifier les logs serveur backend

## Solutions Rapides

### Si le Bouton N'Existe Pas
```html
<!-- Vérifier dans index.html ligne 70 -->
<button id="stopPlaybackBtn" class="btn-stop btn-small">⏹ STOP</button>
```

### Si le Listener N'Est Pas Attaché
```javascript
// Réattacher manuellement dans la console
document.getElementById('stopPlaybackBtn').addEventListener('click', stopPlayback);
```

### Si WebSocket Est Déconnecté
```javascript
// Reconnecter dans la console
connectWebSocket();
```

## Prochaines Étapes

1. **Redémarrer le serveur backend** pour appliquer les logs
2. **Recharger la page frontend** (Ctrl+R ou Ctrl+Shift+R pour vider le cache)
3. **Ouvrir la console du navigateur** (F12)
4. **Cliquer sur STOP** et observer les logs
5. **Consulter les logs serveur** pour voir si le message arrive

**Si le problème persiste:** Partager les logs complets de la console et du serveur.

---

**Fichiers Modifiés:**
- `frontend/app.js` - Ajout de logs de debug
- `backend/server.js` - Ajout de logs de debug
