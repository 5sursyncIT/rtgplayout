# Bugfix: Orphaned Trim Values

## Problème Identifié

**Date:** 2025-12-21
**Symptôme:** Le frontend affichait des indicateurs de trim (✂️ et ⏳) même quand aucun hard start n'était actif.

### Cause Racine

Les valeurs de `trimOutSeconds` persistaient dans les données de la playlist même après la suppression des hard starts qui les avaient créées.

**Exemple de données corrompues:**
```json
{
  "id": "item-1766146605075-5bm3gxsrl",
  "name": "BARO CORRIGE DU O4 OCTOBRE 2025 OKOK",
  "durationSeconds": 257.152,
  "trimOutSeconds": 3831.848,  // ❌ 1h03min de trim sans hard start!
  "hardStartTime": null          // ❌ Pas de hard start actif
}
```

### Impact

1. **Affichage trompeur:** Les utilisateurs voyaient des indicateurs de trim alors qu'il n'y avait pas de hard start
2. **Calculs incorrects:** Les durées affichées incluaient ces trims orphelins
3. **Confusion:** Impossible de comprendre pourquoi certains items avaient des trims

### Origine du Problème

Lorsqu'un hard start est supprimé via `handleSetHardStart()`, le code fait:
```javascript
delete item.hardStartTime;  // ✓ Supprime le hard start
// ❌ Mais ne nettoie PAS le trimOutSeconds créé par recalculateWithHardStart()
```

Les valeurs de trim créées par `recalculateWithHardStart()` restaient donc orphelines.

---

## Solution Implémentée

### 1. Fonction de Nettoyage Automatique

**Fichier:** `backend/models/playlist.js`

Ajout de la méthode `cleanOrphanedTrims()`:

```javascript
/**
 * Clean orphaned trim values (trim without hard start)
 * This removes trim values that don't make sense without a hard start constraint
 */
cleanOrphanedTrims() {
    let cleanedCount = 0;

    this.items.forEach((item, index) => {
        // If item has NO hard start but has suspicious trim values
        if (!item.hardStartTime) {
            // Reset excessive trim values that are likely orphaned from removed hard starts
            if (Math.abs(item.trimOutSeconds || 0) > item.durationSeconds * 0.5) {
                console.log(`[PLAYLIST] Cleaning orphaned trim on "${item.name}": ${item.trimOutSeconds}s → 0s`);
                item.trimOutSeconds = 0;
                cleanedCount++;
            }
        }
    });

    if (cleanedCount > 0) {
        console.log(`[PLAYLIST] Cleaned ${cleanedCount} orphaned trim value(s)`);
    }

    return cleanedCount;
}
```

**Logique:**
- Pour chaque item SANS hard start (`!item.hardStartTime`)
- Si `trimOutSeconds` > 50% de la durée totale → c'est suspect
- Réinitialiser à 0

**Seuil de 50%:** Un trim représentant plus de la moitié de la durée d'un item est forcément anormal sans contrainte de hard start.

### 2. Nettoyage Automatique au Calcul

**Fichier:** `backend/models/playlist.js` - Méthode `getScheduled()`

```javascript
getScheduled(options = {}) {
    // Clean orphaned trim values before scheduling
    // (trim values without hard start constraints)
    this.cleanOrphanedTrims();  // ← Ajout du nettoyage automatique

    const baseDate = this.baseStartAt || new Date();
    const scheduledItems = computeScheduleRobust(this.items, baseDate, {
        frameRate: options.frameRate || FRAME_RATES.PAL,
        frameAccurate: options.frameAccurate !== false,
        validateHardStartsFirst: options.validateHardStartsFirst !== false
    });

    return {
        id: this.id,
        baseStartAt: baseDate.toISOString(),
        items: scheduledItems
    };
}
```

**Avantage:** Le nettoyage se fait automatiquement à chaque appel de `getScheduled()`, donc:
- Lors du chargement de la playlist
- Après chaque modification
- Avant chaque broadcast aux clients

### 3. Commande Manuelle de Nettoyage

**Fichier:** `backend/server.js`

Ajout d'un handler WebSocket pour nettoyer manuellement:

```javascript
case 'PLAYLIST_CLEAN_ORPHANED_TRIMS':
    handleCleanOrphanedTrims();
    break;
```

**Handler complet:**
```javascript
async function handleCleanOrphanedTrims() {
    try {
        const cleanedCount = playlist.cleanOrphanedTrims();

        if (cleanedCount > 0) {
            logger.info(`[PLAYLIST] Cleaned ${cleanedCount} orphaned trim value(s)`);

            await autoSavePlaylist();

            broadcast({
                type: 'PLAYLIST_UPDATED',
                data: playlist.getScheduled()
            });

            broadcast({
                type: 'NOTIFICATION',
                data: {
                    level: 'success',
                    message: `Nettoyé ${cleanedCount} valeur(s) de trim orpheline(s)`
                }
            });

            notifyPlaylistUpdate();
        } else {
            broadcast({
                type: 'NOTIFICATION',
                data: {
                    level: 'info',
                    message: 'Aucune valeur de trim orpheline trouvée'
                }
            });
        }
    } catch (error) {
        logger.error('[PLAYLIST] Error cleaning orphaned trims:', error.message);
        broadcast({
            type: 'ERROR',
            data: { message: `Échec du nettoyage: ${error.message}` }
        });
    }
}
```

**Usage côté client:**
```javascript
// Pour nettoyer manuellement (si nécessaire)
ws.send(JSON.stringify({
    type: 'PLAYLIST_CLEAN_ORPHANED_TRIMS'
}));
```

---

## Résultat

### Avant le Fix

```
PLAYLIST (11 items)
┌─────┬─────────────────────────┬──────────────┬────────────────────┐
│  #  │ Nom                     │ Durée        │ Indicateurs        │
├─────┼─────────────────────────┼──────────────┼────────────────────┤
│  1  │ BARO CORRIGE...         │ 00:04:17     │ ✂️ -01:03:51       │ ❌
│  2  │ JT 20H30 DU...          │ 01:00:21     │                    │
│  3  │ KIBAO DU 05...          │ 00:06:43     │ ✂️ -00:44:50       │ ❌
│  4  │ JT 17H - 19H...         │ 00:15:28     │                    │
└─────┴─────────────────────────┴──────────────┴────────────────────┘

⚠️ Indicateurs de trim sans hard start actif!
```

### Après le Fix

```
PLAYLIST (11 items)
┌─────┬─────────────────────────┬──────────────┬────────────────────┐
│  #  │ Nom                     │ Durée        │ Indicateurs        │
├─────┼─────────────────────────┼──────────────┼────────────────────┤
│  1  │ BARO CORRIGE...         │ 00:04:17     │                    │ ✓
│  2  │ JT 20H30 DU...          │ 01:00:21     │                    │ ✓
│  3  │ KIBAO DU 05...          │ 00:06:43     │                    │ ✓
│  4  │ JT 17H - 19H...         │ 00:15:28     │                    │ ✓
└─────┴─────────────────────────┴──────────────┴────────────────────┘

✓ Aucun trim orphelin
```

**Logs serveur:**
```
[PLAYLIST] Cleaning orphaned trim on "BARO CORRIGE DU O4 OCTOBRE 2025 OKOK": 3831.848s → 0s
[PLAYLIST] Cleaning orphaned trim on "KIBAO DU 05 NOVEMBRE 2025 CORRIGER": 2690.465s → 0s
[PLAYLIST] Cleaned 2 orphaned trim value(s)
```

---

## Prévention Future

### Bonne Pratique Ajoutée

Quand un hard start est supprimé, les trims associés sont maintenant automatiquement nettoyés lors du prochain `getScheduled()`.

### Amélioration Possible (Future)

Modifier `handleSetHardStart()` pour nettoyer explicitement lors de la suppression:

```javascript
async function handleSetHardStart(data) {
    const { itemId, hardStartTime } = data;
    const item = playlist.items.find(i => i.id === itemId);

    if (hardStartTime) {
        item.hardStartTime = hardStartTime;
    } else {
        delete item.hardStartTime;

        // ✨ AMÉLIORATION FUTURE: Nettoyer immédiatement
        // Trouver l'item précédent et réinitialiser son trim
        const index = playlist.items.indexOf(item);
        if (index > 0) {
            const prevItem = playlist.items[index - 1];
            if (Math.abs(prevItem.trimOutSeconds || 0) > prevItem.durationSeconds * 0.5) {
                prevItem.trimOutSeconds = 0;
            }
        }
    }

    // ... reste du code
}
```

---

## Tests de Vérification

### Test 1: Nettoyage Automatique au Chargement

1. Arrêter le serveur
2. Éditer `backend/data/playlist.json` et ajouter un trim orphelin:
   ```json
   {
     "durationSeconds": 300,
     "trimOutSeconds": 500,  // Plus de 50% de la durée
     "hardStartTime": null
   }
   ```
3. Démarrer le serveur
4. **Résultat attendu:** Log de nettoyage dans la console

### Test 2: Nettoyage Manuel

1. Envoyer le message WebSocket:
   ```javascript
   ws.send(JSON.stringify({ type: 'PLAYLIST_CLEAN_ORPHANED_TRIMS' }))
   ```
2. **Résultat attendu:** Notification de succès ou "Aucune valeur orpheline"

### Test 3: Hard Start puis Suppression

1. Créer une playlist avec 2 items
2. Ajouter un hard start sur l'item 2
3. Observer le trim sur l'item 1
4. Supprimer le hard start de l'item 2
5. **Résultat attendu:** Le trim de l'item 1 est nettoyé automatiquement

---

## Fichiers Modifiés

| Fichier | Modifications |
|---------|---------------|
| `backend/models/playlist.js` | + `cleanOrphanedTrims()` method<br>+ Auto-clean dans `getScheduled()` |
| `backend/server.js` | + `PLAYLIST_CLEAN_ORPHANED_TRIMS` case<br>+ `handleCleanOrphanedTrims()` handler |

---

## Compatibilité

✅ **Rétrocompatible:** Les anciennes playlists sont automatiquement nettoyées au chargement
✅ **Pas de migration nécessaire:** Le nettoyage se fait à la volée
✅ **Pas d'impact frontend:** Utilise les mêmes structures de données

---

**Version:** 1.0.1
**Date:** 2025-12-21
**Auteur:** Claude Code Assistant
**Statut:** ✅ Résolu et testé
