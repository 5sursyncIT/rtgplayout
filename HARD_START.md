# Hard Start Time - Démarrage Strict

## Vue d'ensemble

Le système de **Hard Start** permet de définir une heure de démarrage stricte pour certains éléments de la playlist. Si l'élément précédent déborde et risque de retarder le démarrage, il sera automatiquement ajusté (raccourci) pour respecter le timing strict.

## Cas d'usage

### Exemple concret

Vous avez une playlist avec :
1. **Film** (120 minutes) - débute à 10:00
2. **Journal télévisé** (30 minutes) - **DOIT** commencer à 12:00 (hard start)

Si le film déborde de 2 minutes (ex: publicités), le système va automatiquement :
- Détecter que le film se termine à 12:02
- Calculer le débordement : 2 minutes
- **Raccourcir le film de 2 minutes** pour qu'il se termine à 12:00
- Garantir que le JT démarre exactement à 12:00

## Fonctionnalités

### ✅ Configuration du hard start

1. Dans la playlist, cliquez sur l'icône **⏰** à côté de l'élément
2. La modal affiche l'heure planifiée actuelle de l'élément
3. **Important**: Cochez "Activer le démarrage strict" pour activer la fonctionnalité
4. Modifiez l'heure si nécessaire (ex: 12:00:00)
5. Cliquez sur "Appliquer"

**Note**: Par défaut, la case "Activer le démarrage strict" est décochée pour éviter les activations accidentelles.

### ✅ Indicateurs visuels

- **Icône ⏰** : Apparaît dans la colonne "Actions" si l'élément a un hard start
- **Badge bleu** : Affiche l'heure de hard start à côté du nom de l'élément
- **Icône active** : L'icône ⏰ devient bleue quand le hard start est actif

### ✅ Ajustement automatique

Lorsqu'un hard start est défini :
- Le système calcule si l'élément précédent va déborder
- Si débordement détecté : **ajustement automatique de la durée**
- L'élément précédent est raccourci via `trimOutSeconds`
- Limite de sécurité : au moins 10 secondes doivent rester

## Architecture technique

### Frontend

**Fichiers modifiés :**

1. **`frontend/index.html`** (lignes 241-268)
   - Modal de configuration du hard start
   - Input pour l'heure (HH:MM:SS)
   - Checkbox pour activer/désactiver

2. **`frontend/style.css`** (lignes 1384-1460)
   - Styles pour l'indicateur de hard start
   - Styles pour la modal
   - Bouton ⏰ avec état actif

3. **`frontend/app.js`** (lignes 431-461, 1547-1637)
   - Rendu de l'indicateur dans la playlist
   - Gestion de la modal
   - Envoi de la commande `PLAYLIST_SET_HARD_START`

### Backend

**Fichiers modifiés :**

1. **`backend/server.js`** (lignes 380-382, 508-545)
   - Handler `handleSetHardStart(data)`
   - Sauvegarde du hard start time sur l'item
   - Appel de `playlist.recalculateWithHardStart()`

2. **`backend/models/playlist.js`** (lignes 154-225, 255)
   - Méthode `recalculateWithHardStart()`
   - Calcul du delta temporel
   - Ajustement automatique des durées
   - Validation et limites de sécurité
   - Ajout de `hardStartTime` dans `_validateItem()`

### Messages WebSocket

#### Client → Serveur

```javascript
{
  type: 'PLAYLIST_SET_HARD_START',
  data: {
    itemId: 'item-1234567890',
    hardStartTime: '12:00:00'  // ou null pour désactiver
  }
}
```

#### Serveur → Client

```javascript
{
  type: 'PLAYLIST_UPDATED',
  data: {
    id: 'MAIN-CHANNEL-1',
    baseStartAt: '2025-12-15T10:00:00.000Z',
    items: [
      {
        id: 'item-1234567890',
        name: 'Journal télévisé',
        file: 'jt_12h.mp4',
        durationSeconds: 1800,
        hardStartTime: '12:00:00',  // Heure de hard start
        startAt: '2025-12-15T12:00:00.000Z',
        endAt: '2025-12-15T12:30:00.000Z'
      }
    ]
  }
}
```

## Algorithme de recalculation

### Étapes

1. **Identifier les items avec hard start**
   ```javascript
   const hardStartItems = items.filter(item => item.hardStartTime);
   ```

2. **Pour chaque hard start item :**

   a. Parser l'heure cible (HH:MM:SS)
   ```javascript
   const [hours, minutes, seconds] = item.hardStartTime.split(':');
   const targetStart = new Date(baseDate);
   targetStart.setHours(hours, minutes, seconds, 0);
   ```

   b. Calculer l'heure de démarrage planifiée
   ```javascript
   let cumulativeSeconds = 0;
   for (let i = 0; i < index; i++) {
     cumulativeSeconds += items[i].durationSeconds;
   }
   const scheduledStart = new Date(baseDate.getTime() + cumulativeSeconds * 1000);
   ```

   c. Calculer le delta
   ```javascript
   const timeDiffSeconds = (targetStart - scheduledStart) / 1000;
   ```

   d. Ajuster si nécessaire
   ```javascript
   if (timeDiffSeconds < 0) {
     // Retard détecté
     const trimNeeded = Math.abs(timeDiffSeconds);
     const prevItem = items[index - 1];
     const maxTrim = prevItem.durationSeconds - 10; // Garder au moins 10s

     if (trimNeeded <= maxTrim) {
       prevItem.durationSeconds -= trimNeeded;
       prevItem.trimOutSeconds += trimNeeded;
     }
   }
   ```

### Logs de débogage

```
[PLAYLIST] Applying 1 hard start constraint(s)
[PLAYLIST] Item 1 (Journal télévisé)
  Target start: 2025-12-15T12:00:00.000Z
  Scheduled start: 2025-12-15T12:02:00.000Z
  Difference: -120s
  ⚠️ Running 120s late - adjusting previous item
  ✓ Trimmed 120s from previous item "Film"
  New duration: 7080s (118 minutes)
[PLAYLIST] Hard start recalculation complete
```

## Limitations et sécurités

### Limites de sécurité

1. **Durée minimale** : 10 secondes minimum par élément
2. **Pas de hard start sur le 1er élément** : Ignoré avec warning
3. **Trim impossible** : Si le trim nécessaire dépasse la limite, erreur loggée

### Limitations actuelles

⚠️ **Pas d'ajustement multiple** : Si plusieurs items débordent, seul l'item immédiatement précédent est ajusté

⚠️ **Pas de padding automatique** : Si on est en avance, pas d'ajout de contenu de remplissage

⚠️ **Pas de hard start en cascade** : Un item ne peut pas avoir plusieurs contraintes

## Améliorations futures possibles

- [ ] Ajustement multi-niveaux (trim réparti sur plusieurs items précédents)
- [ ] Padding automatique avec contenu de remplissage
- [ ] Alertes visuelles si hard start impossible à respecter
- [ ] Hard start relatif ("30 minutes après le début")
- [ ] Hard stop (heure de fin stricte)
- [ ] Plages horaires fixes (ex: "entre 12:00 et 13:00")
- [ ] Prévisualisation du planning avec hard starts
- [ ] Historique des ajustements effectués

## Scénarios d'utilisation

### Scénario 1 : Journal télévisé quotidien

```
10:00 - Magazine (variable) → Hard Start à 12:00
12:00 - Journal (30 min) → Hard Start
12:30 - Météo (5 min)
12:35 - Émission (variable) → Hard Start à 13:00
13:00 - Film
```

### Scénario 2 : Grille horaire stricte

```
06:00 - Émission matinale → Hard Start
07:00 - Info trafic → Hard Start
08:00 - Matinale radio → Hard Start
09:00 - Talk-show
...
```

### Scénario 3 : Événement en direct

```
19:45 - Pré-générique
19:50 - Bande-annonce (variable)
20:00 - Début match EN DIRECT → Hard Start (CRITIQUE)
```

## Résumé

Le système de Hard Start garantit que les éléments critiques de votre programmation démarrent à l'heure exacte, en ajustant automatiquement les éléments précédents si nécessaire. C'est essentiel pour :

🎯 **Rendez-vous d'information** (JT, bulletins météo)
🎯 **Événements en direct** (matchs sportifs, cérémonies)
🎯 **Grilles horaires fixes** (radio, chaînes d'info)
🎯 **Synchronisation multi-canaux**

**Icône clé** : ⏰ = Hard Start actif
**Action** : Clic sur ⏰ pour configurer
**Effet** : Ajustement automatique des durées précédentes
