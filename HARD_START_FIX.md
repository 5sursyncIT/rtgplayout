# Hard Start - Correctif du problème d'activation accidentelle

## Problème identifié

L'utilisateur rapportait: **"je n'ai pas programmé de hard start mais le système est entrain de faire un calcul"**

### Cause racine

Le problème était dans l'interface utilisateur de la modal de configuration du hard start:

1. **Checkbox cochée par défaut** dans le HTML (`index.html` ligne 256):
   ```html
   <input type="checkbox" id="hardStartEnabledInput" checked>
   ```

2. **Scénario problématique**:
   - L'utilisateur clique sur l'icône ⏰ pour voir l'heure planifiée
   - La modal s'ouvre avec l'heure planifiée pré-remplie (ex: 20:05:00)
   - La checkbox "Activer le démarrage strict" était cochée par défaut
   - L'utilisateur clique sur "Appliquer" sans réaliser qu'il active le hard start
   - Résultat: Un hard start est créé avec l'heure planifiée actuelle
   - Comme l'heure hard start = heure planifiée, aucun ajustement n'est nécessaire
   - L'utilisateur voit l'indicateur ⏰ mais ne comprend pas pourquoi

## Solutions appliquées

### 1. Checkbox décochée par défaut (frontend/index.html)

**Avant**:
```html
<input type="checkbox" id="hardStartEnabledInput" checked>
```

**Après**:
```html
<input type="checkbox" id="hardStartEnabledInput">
```

Le JavaScript dans `app.js` (lignes 1583-1597) gère maintenant correctement l'état:
- Si l'élément a déjà un hard start: checkbox cochée
- Si l'élément n'a pas de hard start: checkbox décochée

### 2. Affichage du statut dans la modal (frontend/index.html + app.js)

Ajout d'une zone de statut qui affiche clairement:

**Cas 1 - Hard start actif**:
```
Démarrage strict actif
⏰ 12:00:00
Heure planifiée: 10:02:30
```

**Cas 2 - Pas de hard start**:
```
Heure planifiée actuelle
20:05:00
Aucun démarrage strict configuré
```

Cela permet à l'utilisateur de voir immédiatement:
- Si un hard start est déjà configuré
- Quelle est l'heure planifiée normale
- La différence entre les deux

### 3. Amélioration des styles (frontend/style.css)

Ajout de styles pour la zone de statut (lignes 1462-1480):
```css
.hard-start-status {
    background: var(--bg-darker);
    padding: 12px;
    border-radius: 6px;
    margin-bottom: 15px;
    font-size: 13px;
}
```

## Impact

### Avant le correctif
- ❌ Activation accidentelle du hard start
- ❌ Confusion sur l'état du système
- ❌ Badge ⏰ apparaît sans que l'utilisateur comprenne pourquoi

### Après le correctif
- ✅ Activation intentionnelle uniquement (checkbox décochée par défaut)
- ✅ Statut clair dans la modal
- ✅ Différenciation visuelle entre hard start actif et inactif
- ✅ Meilleure compréhension pour l'utilisateur

## Tests recommandés

1. **Ouvrir la modal sur un élément sans hard start**:
   - Vérifier que la checkbox est décochée
   - Vérifier que le statut indique "Aucun démarrage strict configuré"
   - Vérifier que l'heure affichée correspond à l'heure planifiée

2. **Activer un hard start**:
   - Cocher la checkbox
   - Modifier l'heure (ex: 12:00:00)
   - Cliquer sur "Appliquer"
   - Vérifier que le badge ⏰ apparaît
   - Vérifier les logs backend pour le calcul d'ajustement

3. **Rouvrir la modal sur un élément avec hard start**:
   - Vérifier que la checkbox est cochée
   - Vérifier que le statut indique "Démarrage strict actif"
   - Vérifier que les deux heures sont affichées (hard start + planifiée)

4. **Désactiver un hard start**:
   - Décocher la checkbox
   - Cliquer sur "Appliquer"
   - Vérifier que le badge ⏰ disparaît
   - Vérifier que `hardStartTime` est supprimé de l'objet item

## Fichiers modifiés

1. **frontend/index.html** (ligne 256):
   - Suppression de l'attribut `checked` sur la checkbox
   - Ajout de la div `hardStartStatus` (ligne 251)

2. **frontend/app.js** (lignes 1561-1610):
   - Ajout de la référence à `hardStartStatusDiv`
   - Mise à jour de `openHardStartModal()` pour afficher le statut
   - Logique conditionnelle basée sur la présence de `item.hardStartTime`

3. **frontend/style.css** (lignes 1462-1480):
   - Ajout des styles pour `.hard-start-status`
   - Styles pour `.status-label` et `.status-time`

4. **HARD_START.md** (lignes 23-31):
   - Mise à jour de la documentation utilisateur
   - Ajout d'une note sur la checkbox décochée par défaut

## Correctifs supplémentaires (15 décembre 2025)

### Problème 2: Hard start impossible à réaliser

**Symptôme**: L'utilisateur configure un hard start mais aucun ajustement n'est visible, et aucun message d'erreur n'apparaît.

**Cause**: Si le temps de réduction nécessaire dépasse la durée de l'élément précédent (moins 10 secondes de sécurité), l'ajustement échoue silencieusement. Le système loggait l'erreur dans la console mais ne prévenait pas l'utilisateur.

**Exemple problématique**:
- Élément #1: 15 minutes (se termine à 20:40)
- Élément #2: Hard start configuré à 01:55 (le lendemain)
- Réduction nécessaire: environ 5h15m
- Réduction maximale possible: 14m50s (15min - 10s de sécurité)
- Résultat: **Échec silencieux**

**Solution appliquée**:

1. **Retour d'erreur structuré** (`backend/models/playlist.js`):
   - `recalculateWithHardStart()` retourne maintenant `{ success: boolean, errors: [] }`
   - Les erreurs incluent: itemId, itemName, hardStartTime, reason, trimNeeded, maxTrim

2. **Broadcast des erreurs** (`backend/server.js`):
   - Nouveau message WebSocket: `HARD_START_ERROR`
   - Envoyé aux clients quand l'ajustement échoue

3. **Affichage utilisateur** (`frontend/app.js`):
   - Handler `handleHardStartError()` qui affiche une notification détaillée
   - Message explicite avec les valeurs numériques
   - Conseil pour résoudre le problème

### Problème 3: Affichage erroné du "Prochain"

**Symptôme**: Le bandeau vert affiche "PROCHAIN: ... (01:55:58)" alors que l'élément actuel est en lecture. La durée affichée semble incorrecte ou confuse.

**Cause**: Quand un élément a un hard start, la fonction `updateNextItemInfo()` affichait `item.durationSeconds` au lieu de montrer l'heure de hard start, créant une confusion entre durée de l'élément et heure cible.

**Solution appliquée** (`frontend/app.js` lignes 920-927):

```javascript
// Avant
nextItemDuration.textContent = `(${safeFormatDuration(item.durationSeconds)})`;

// Après
if (item.hardStartTime) {
    nextItemDuration.textContent = `⏰ ${item.hardStartTime}`;
} else {
    nextItemDuration.textContent = `(${safeFormatDuration(item.durationSeconds)})`;
}
```

Maintenant l'affichage montre clairement:
- **Sans hard start**: `(01:55:58)` = durée de l'élément
- **Avec hard start**: `⏰ 01:55:58` = heure de démarrage stricte

## Fichiers modifiés (correctifs supplémentaires)

1. **backend/models/playlist.js** (lignes 159-252):
   - Ajout du retour structuré `{ success, errors }`
   - Collection des erreurs d'ajustement impossible
   - Documentation améliorée

2. **backend/server.js** (lignes 530-544):
   - Vérification du résultat de `recalculateWithHardStart()`
   - Broadcast `HARD_START_ERROR` en cas d'échec
   - Log des erreurs côté serveur

3. **frontend/app.js** (lignes 168-170, 920-927, 1671-1688):
   - Handler `HARD_START_ERROR` dans le switch WebSocket
   - Fonction `handleHardStartError()` pour afficher les erreurs
   - Modification de `updateNextItemInfo()` pour distinguer durée vs hard start

## Conclusion

Le correctif résout trois problèmes majeurs:

1. **Activation accidentelle**: Checkbox décochée par défaut + affichage du statut
2. **Échec silencieux**: Validation et notification quand le hard start est impossible
3. **Affichage confus**: Distinction claire entre durée et heure de hard start

L'utilisateur a maintenant:
- ✅ Contrôle explicite de l'activation du hard start
- ✅ Feedback immédiat si le hard start est impossible à réaliser
- ✅ Affichage clair de l'heure de hard start dans le bandeau "Prochain"
