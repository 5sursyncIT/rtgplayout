# Système de Gestion des Templates CasparCG

## Vue d'ensemble

Le système de gestion des templates permet de contrôler les graphiques HTML de CasparCG directement depuis l'interface RTG Playout.

### Fonctionnalités implémentées

✅ **Backend complet**
- Contrôleur de templates avec support AMCP complet (CG ADD, PLAY, STOP, UPDATE, REMOVE)
- Système de presets sauvegardés
- Suivi des templates actifs
- WebSocket pour communication temps réel

✅ **Interface frontend**
- Panneau latéral dédié aux graphics
- Formulaire de contrôle manuel des templates
- Gestion des presets (sauvegarder, charger, supprimer)
- Liste des templates actifs en temps réel
- Panneau repliable pour optimiser l'espace

✅ **Templates pré-configurés**
- Lower Third (rtg-lower-third)
- Clock (rtg-clock)
- Countdown (rtg-countdown)
- Full Title (rtg-full-title)
- Logo + Clock (rtg-logo-clock)
- Bug/Logo (rtg-bug)
- PIP Frame (rtg-pip)
- Credits Roll (rtg-roll)
- **Election Results (rtg-election)** ⭐

## Utilisation

### 1. Contrôle manuel d'un template

1. Ouvrir le panneau "Graphics / Templates" (côté droit de l'interface)
2. Sélectionner un template dans le menu déroulant
3. Choisir le layer (10-70 selon le type de graphic)
4. Choisir le channel (1 ou 2)
5. Entrer les données JSON dans le champ "Données"
6. Cliquer sur **"Load & Play"** pour charger et afficher directement

### 2. Boutons de contrôle

- **Load**: Charge le template sans l'afficher
- **Play**: Affiche le template avec animation
- **Stop**: Cache le template avec animation
- **Update**: Met à jour les données sans re-jouer l'animation
- **Remove**: Supprime complètement le template du layer
- **Load & Play**: Charge et affiche en une seule action

### 3. Système de presets

#### Sauvegarder un preset
1. Configurer un template avec ses données
2. Cliquer sur **"Sauvegarder comme preset"**
3. Entrer un nom descriptif (ex: "Breaking News Red")
4. Confirmer

#### Utiliser un preset
- Cliquer sur **"Load"** à côté du preset
- Le template sera chargé et affiché automatiquement

#### Supprimer un preset
- Cliquer sur **"×"** à côté du preset
- Confirmer la suppression

### 4. Templates actifs

La section "Templates actifs" affiche tous les templates chargés avec:
- Nom du template
- Channel et layer
- État (playing = bordure rouge, loaded = bordure verte)
- Boutons de contrôle rapide (Play/Stop/Remove)

## Exemples de données pour chaque template

### rtg-lower-third
```json
{
  "title": "Breaking News",
  "subtitle": "Live from Paris"
}
```

### rtg-election (Résultats électoraux)
```json
{
  "title": "Résultats Élections 2025",
  "candidates": [
    {"name": "Candidat A", "votes": 1234, "percent": 45.2},
    {"name": "Candidat B", "votes": 987, "percent": 36.1},
    {"name": "Candidat C", "votes": 567, "percent": 18.7}
  ]
}
```

### rtg-clock
```json
{
  "offset": 0
}
```
*Offset en secondes (+/- pour avance/retard)*

### rtg-countdown
```json
{
  "target": "2025-12-31T23:59:59"
}
```

### rtg-full-title
```json
{
  "title": "Programme Spécial"
}
```

### rtg-roll (Générique)
```json
{
  "lines": [
    "Producer: John Doe",
    "Director: Jane Smith",
    "Camera: Mike Johnson"
  ]
}
```

## Organisation des layers

Les layers sont organisés par type de graphic:

- **10**: Lower Third (tiers bas, noms/titres)
- **20**: Bug (logo persistant dans un coin)
- **30**: Full Screen (plein écran, titres importants)
- **40**: Ticker (bandeau défilant)
- **50**: Clock (horloge)
- **60**: Countdown (compte à rebours)
- **70**: Custom (personnalisé)

> **Conseil**: Respecter cette organisation permet d'éviter les conflits entre différents types de graphics.

## Test avec rtg-election

### Scénario de test complet

1. **Charger le template**
   - Template: `rtg-election/index`
   - Layer: `30` (Full Screen)
   - Channel: `1`
   - Données:
   ```json
   {
     "title": "Résultats Élections Municipales 2025",
     "candidates": [
       {"name": "Marie Dupont", "votes": 3456, "percent": 42.5},
       {"name": "Jean Martin", "votes": 2987, "percent": 36.7},
       {"name": "Pierre Durand", "votes": 1689, "percent": 20.8}
     ]
   }
   ```

2. **Cliquer sur "Load & Play"**
   - Le template devrait apparaître avec animation
   - Les résultats s'affichent avec les pourcentages

3. **Mettre à jour les résultats**
   - Modifier les votes/pourcentages dans le JSON
   - Cliquer sur **"Update"**
   - Les chiffres devraient se mettre à jour sans re-jouer l'animation

4. **Sauvegarder comme preset**
   - Cliquer sur "Sauvegarder comme preset"
   - Nom: "Élections Municipales 2025"
   - Le preset apparaît dans la liste

5. **Tester le stop/play**
   - Cliquer sur **"Stop"** → le graphic disparaît avec animation
   - Cliquer sur **"Play"** → il réapparaît

6. **Supprimer**
   - Cliquer sur **"Remove"** pour retirer complètement le template

## Architecture technique

### Backend
- **TemplateController** (`backend/caspar/templateController.js`)
  - Gère le cycle de vie des templates
  - Suit les templates actifs
  - Gère les presets

- **CasparClient** - Méthodes ajoutées:
  - `cgAdd()`: Charger un template
  - `cgPlay()`: Afficher
  - `cgStop()`: Cacher
  - `cgUpdate()`: Mettre à jour données
  - `cgClear()`: Nettoyer layer
  - `cgRemove()`: Supprimer template

### Frontend
- **Panneau Graphics** (`frontend/index.html`)
  - Interface de contrôle complète
  - Modal pour sauvegarder presets
  - Liste des templates actifs

- **JavaScript** (`frontend/app.js`)
  - Handlers WebSocket pour messages templates
  - Gestion UI presets et templates actifs
  - Exemples de données auto-remplis

### Messages WebSocket

#### Client → Server
- `TEMPLATE_LOAD` - Charger template
- `TEMPLATE_PLAY` - Afficher
- `TEMPLATE_STOP` - Cacher
- `TEMPLATE_UPDATE` - Mettre à jour
- `TEMPLATE_REMOVE` - Supprimer
- `TEMPLATE_LOAD_AND_PLAY` - Charger et afficher
- `TEMPLATE_GET_ACTIVE` - Demander liste actifs
- `PRESET_SAVE` - Sauvegarder preset
- `PRESET_LOAD` - Charger preset
- `PRESET_GET_ALL` - Demander tous presets
- `PRESET_DELETE` - Supprimer preset

#### Server → Client
- `TEMPLATE_LOADED` - Template chargé
- `TEMPLATE_PLAYING` - Template affiché
- `TEMPLATE_STOPPED` - Template caché
- `TEMPLATE_UPDATED` - Données mises à jour
- `TEMPLATE_REMOVED` - Template supprimé
- `TEMPLATE_ACTIVE_LIST` - Liste des actifs
- `PRESET_LIST` - Liste des presets
- `PRESET_SAVED` - Preset sauvegardé
- `PRESET_DELETED` - Preset supprimé

## Prochaines améliorations possibles

- [ ] Persistance des presets sur disque (actuellement en mémoire)
- [ ] Import/export de presets
- [ ] Raccourcis clavier pour presets fréquents
- [ ] Prévisualisation des templates
- [ ] Groupes de templates (ex: "Package élections complet")
- [ ] Timeline pour planifier l'affichage des graphics
- [ ] Intégration avec le système d'autoplay

## Notes importantes

⚠️ **Les presets sont actuellement stockés en mémoire** - Ils seront perdus au redémarrage du serveur. Pour une utilisation en production, implémenter la persistance sur disque.

✅ **Le système est complètement fonctionnel** pour contrôler tous les templates CasparCG HTML en temps réel.

✅ **Compatible avec tous les templates existants** dans `Z:\nodal\templates\`
