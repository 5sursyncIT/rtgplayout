# Bugfix: STOP Ne Fonctionne Pas en Mode Lecture Automatique

**Date:** 2025-12-21
**Symptôme:** Le bouton STOP ne fonctionne pas en mode lecture automatique (AUTO). Après avoir cliqué sur STOP, la lecture reprend automatiquement.

## Problème Identifié

### Cause Racine

La méthode `stopPlayback()` de l'autoplay scheduler arrêtait bien la lecture CasparCG et réinitialisait l'état, **MAIS** ne changeait pas le mode de `AUTO` à `MANUAL`.

**Résultat:** Le scheduler continuait de tourner en mode AUTO et relançait automatiquement la lecture!

### Code Problématique (AVANT)

**Fichier:** `backend/scheduler/autoplayScheduler.js`

```javascript
// ❌ PROBLÈME: La méthode stopPlayback() ne change pas le mode
async stopPlayback() {
    try {
        await this.casparClient.stop(this.CASPAR_CHANNEL, this.CASPAR_LAYER);

        this.currentItemId = null;
        this.currentIndex = -1;
        this.stopStatusPolling();
        this.clearPlaybackTimeout();

        console.log('[AUTOPLAY] Playback stopped');
        // ❌ Le mode reste en AUTO!
    } catch (error) {
        console.error('[AUTOPLAY] Stop failed:', error.message);
    }
}
```

**Pendant ce temps, le scheduler tourne toujours:**

```javascript
// Ligne 41-46: Le scheduler tourne toutes les secondes
start() {
    this.scheduleTimer = setInterval(() => {
        this.checkSchedule();  // ← Appelle checkSchedule() chaque seconde
    }, this.SCHEDULE_CHECK_INTERVAL);
}

// Ligne 235-261: checkSchedule() vérifie et relance automatiquement
checkSchedule() {
    if (this.mode !== 'AUTO') return; // ← Le mode est toujours AUTO!

    // Donc il cherche et relance automatiquement un item...
    for (let i = 0; i < scheduled.items.length; i++) {
        if (this.shouldPlay(item, now, i)) {
            this.playItem(item, i);  // ← Relance automatiquement! ❌
            break;
        }
    }
}
```

### Scénario du Bug

1. **Utilisateur active le mode AUTO** → `mode = 'AUTO'`
2. **Scheduler commence à lire automatiquement** → Item 1, Item 2, Item 3...
3. **Utilisateur clique sur STOP** → Appelle `stopPlayback()`
4. **CasparCG arrête la lecture** ✓
5. **État réinitialisé** ✓
6. **Mais le mode reste AUTO** ❌
7. **1 seconde plus tard:** `checkSchedule()` tourne toujours...
8. **Trouve un item qui devrait être lu** → `shouldPlay()` retourne `true`
9. **Relance automatiquement la lecture** ❌

---

## Solution Implémentée

### Modification de `stopPlayback()`

**Fichier:** `backend/scheduler/autoplayScheduler.js` - Ligne 495-526

```javascript
/**
 * Stop current playback
 * IMPORTANT: This also switches to MANUAL mode to prevent auto-restart
 */
async stopPlayback() {
    try {
        console.log('[AUTOPLAY] stopPlayback() called - switching to MANUAL mode');

        // ✅ CRITICAL: Switch to MANUAL mode to prevent scheduler from restarting
        const previousMode = this.mode;
        this.mode = 'MANUAL';  // ← Force le passage en MANUAL

        await this.casparClient.stop(this.CASPAR_CHANNEL, this.CASPAR_LAYER);

        this.currentItemId = null;
        this.currentIndex = -1;
        this.stopStatusPolling();
        this.clearPlaybackTimeout();

        console.log(`[AUTOPLAY] Playback stopped and mode changed: ${previousMode} → MANUAL`);

        // ✅ Broadcast mode change to all clients
        if (this.broadcast) {
            this.broadcast({
                type: 'AUTOPLAY_STATUS',
                data: this.getStatus()  // Contient le nouveau mode MANUAL
            });
        }
    } catch (error) {
        console.error('[AUTOPLAY] Stop failed:', error.message);
    }
}
```

### Changements Apportés

1. **Sauvegarde du mode précédent:** `const previousMode = this.mode;`
2. **Force le mode MANUAL:** `this.mode = 'MANUAL';`
3. **Log du changement:** Affiche `AUTO → MANUAL`
4. **Broadcast du changement:** Envoie `AUTOPLAY_STATUS` avec le nouveau statut

### Effet de la Solution

Maintenant, après `stopPlayback()`:

```javascript
// 1. Mode passe à MANUAL
this.mode = 'MANUAL';

// 2. Le scheduler tourne toujours mais...
checkSchedule() {
    if (this.mode !== 'AUTO') return;  // ✅ Retourne immédiatement!
    // Ne cherche plus à relancer automatiquement
}
```

**Résultat:** Le scheduler ne relance plus automatiquement la lecture après un STOP!

---

## Comportement Attendu

### Scénario 1: STOP en Mode AUTO

**Avant le fix:**
1. Mode AUTO actif
2. Clic sur STOP
3. Lecture s'arrête
4. **1 seconde plus tard:** Lecture reprend automatiquement ❌

**Après le fix:**
1. Mode AUTO actif
2. Clic sur STOP
3. Lecture s'arrête
4. **Mode passe à MANUAL automatiquement** ✅
5. **Interface se met à jour:** Bouton "AUTO" redevient "MANUAL" ✅
6. **Aucune reprise automatique** ✅

### Scénario 2: STOP en Mode MANUAL

**Comportement inchangé:**
1. Mode MANUAL actif
2. Clic sur STOP
3. Lecture s'arrête
4. Mode reste MANUAL ✅

---

## Tests de Vérification

### Test 1: STOP en Mode AUTO

**Procédure:**
1. Activer le mode AUTO (bouton "AUTO")
2. Attendre que la lecture automatique commence
3. Cliquer sur STOP
4. Observer

**Résultat attendu:**
- Lecture s'arrête immédiatement
- Bouton passe de "AUTO" à "MANUAL"
- Aucune reprise automatique après 1-2 secondes

**Logs attendus:**
```
[AUTOPLAY] stopPlayback() called - switching to MANUAL mode
[CASPAR] Stopping playback on 1-10
[AUTOPLAY] Playback stopped and mode changed: AUTO → MANUAL
```

### Test 2: Réactiver AUTO Après STOP

**Procédure:**
1. Suivre Test 1 (STOP en mode AUTO)
2. Cliquer à nouveau sur le bouton pour repasser en AUTO
3. Observer

**Résultat attendu:**
- Mode passe à AUTO
- Lecture automatique reprend depuis le dernier item arrêté

**Logs attendus:**
```
[AUTOPLAY] AUTO mode activated, checking schedule immediately...
[AUTOPLAY] Playing item: ...
```

### Test 3: STOP Multiple en Mode AUTO

**Procédure:**
1. Activer AUTO
2. STOP
3. Réactiver AUTO
4. STOP à nouveau
5. Observer

**Résultat attendu:**
- Chaque STOP passe en MANUAL
- Chaque activation AUTO reprend la lecture
- Aucune lecture parasite

---

## Impact sur le Frontend

Le frontend reçoit automatiquement le changement de mode via `AUTOPLAY_STATUS`:

```javascript
// Message WebSocket reçu après STOP
{
    type: 'AUTOPLAY_STATUS',
    data: {
        mode: 'MANUAL',  // ← Changé de AUTO à MANUAL
        currentItem: null,
        nextItem: null
    }
}
```

**Résultat visuel:**
- Le bouton "🔴 AUTO" redevient "🎯 MANUAL"
- L'indicateur "PROCHAIN:" disparaît
- Le compteur de temps s'arrête

---

## Code de Référence

### Appel depuis server.js

**Fichier:** `backend/server.js` - Ligne 1046-1054

```javascript
// Sync autoplay scheduler state
if (autoplayScheduler) {
    // This will reset current item and stop polling
    autoplayScheduler.stopPlayback();  // ← Appelle la méthode corrigée

    broadcast({
        type: 'AUTOPLAY_STATUS',
        data: autoplayScheduler.getStatus()
    });
}
```

### Méthode getStatus()

**Fichier:** `backend/scheduler/autoplayScheduler.js` - Ligne 864-882

```javascript
getStatus() {
    return {
        mode: this.mode,  // ← Retourne 'MANUAL' après stopPlayback()
        currentItem: currentItem ? { ... } : null,
        nextItem: nextItem ? { ... } : null
    };
}
```

---

## Alternatives Considérées

### Alternative 1: Ajouter un Flag "paused"

```javascript
// ❌ Rejeté: Complexité supplémentaire
this.paused = true;

checkSchedule() {
    if (this.mode !== 'AUTO' || this.paused) return;
    // ...
}
```

**Raison du rejet:** Ajoute un état supplémentaire à gérer. Le mode MANUAL/AUTO suffit.

### Alternative 2: Arrêter le Scheduler Complètement

```javascript
// ❌ Rejeté: Perd le suivi de l'état
stop() {
    clearInterval(this.scheduleTimer);
    this.scheduleTimer = null;
}
```

**Raison du rejet:** Le scheduler doit continuer pour gérer le polling de statut et les événements secondaires.

### Alternative 3: Solution Retenue

```javascript
// ✅ Solution simple et claire
this.mode = 'MANUAL';
```

**Avantages:**
- Utilise les mécanismes existants
- Pas de nouvel état à gérer
- Comportement prévisible
- Interface se met à jour automatiquement

---

## Logs de Debug

Pour vérifier que le fix fonctionne, chercher ces logs:

**Au moment du STOP:**
```
[STOP] handleStopPlayback called with data: {}
[CASPAR] Stopping playback on 1-10
[AUTOPLAY] stopPlayback() called - switching to MANUAL mode
[AUTOPLAY] Playback stopped and mode changed: AUTO → MANUAL
[CASPAR] Playback stopped
```

**Après le STOP (aucune reprise):**
```
[AUTOPLAY] Checking schedule, currentIndex: -1, items: 11
// ← Pas de log "Time to play" ni "Playing item"
// ← Le scheduler tourne mais ne relance rien
```

**Si l'utilisateur réactive AUTO:**
```
[AUTOPLAY] AUTO mode activated, checking schedule immediately...
[AUTOPLAY] Item "..." should play: startDiff=...s
[AUTOPLAY] Playing item: ...
```

---

## Prochaines Étapes

1. **Redémarrer le serveur backend** pour appliquer les modifications
2. **Tester le scénario:** AUTO → STOP → Vérifier qu'il n'y a pas de reprise
3. **Vérifier les logs** pour confirmer le passage AUTO → MANUAL
4. **Tester la réactivation AUTO** après un STOP

---

**Version:** Bugfix 1.0
**Fichiers Modifiés:**
- `backend/scheduler/autoplayScheduler.js` - Méthode `stopPlayback()` ligne 495-526

**Statut:** ✅ Corrigé et prêt pour test
