# Système de Dossiers Virtuels pour la Médiathèque

## Vue d'ensemble

Le système de dossiers virtuels permet d'organiser la médiathèque sans modifier l'arborescence physique des fichiers. Vous pouvez créer des catégories logiques et assigner vos médias à ces dossiers pour une meilleure organisation.

## Fonctionnalités

### ✅ Organisation complète

- **Dossiers virtuels**: Créez des catégories personnalisées
- **Dossiers par défaut**: 5 dossiers pré-configurés
  - Non classé (gris)
  - Vidéos (bleu)
  - Jingles (vert)
  - Publicités (rouge)
  - Génériques (orange)
- **Couleurs personnalisables**: 6 couleurs disponibles
- **Compteur automatique**: Nombre de fichiers par dossier
- **Filtrage en temps réel**: Cliquez sur un dossier pour filtrer les médias

### ✅ Gestion intuitive

- **Clic droit**: Menu contextuel pour déplacer un média vers un dossier
- **Badge visuel**: Indicateur coloré sur chaque média
- **Édition rapide**: Bouton ✏️ pour renommer/changer couleur
- **Suppression**: Bouton 🗑️ (les médias retournent vers "Non classé")

### ✅ Persistance

- **Sauvegarde automatique**: Toutes les modifications sont sauvegardées
- **Fichier**: `backend/data/mediaFolders.json`
- **Chargement au démarrage**: Structure restaurée automatiquement

## Utilisation

### Créer un nouveau dossier

1. Cliquer sur le bouton **+** à côté de "Dossiers"
2. Entrer un nom (ex: "Interviews")
3. Choisir une couleur
4. Cliquer sur **"Créer"**

### Assigner un média à un dossier

**Méthode 1 - Menu contextuel** (recommandé):
1. Faire un **clic droit** sur un fichier média
2. Sélectionner le dossier de destination dans le menu
3. Le fichier est déplacé instantanément

**Méthode 2 - Glisser-déposer** (à venir):
- Glisser un fichier sur un dossier

### Filtrer les médias par dossier

1. Cliquer sur un dossier dans la liste
2. Seuls les médias de ce dossier s'affichent
3. Le nom du dossier apparaît à côté du compteur
4. Cliquer à nouveau sur le même dossier pour désélectionner (afficher tout)

### Éditer un dossier

1. Survoler le dossier (sauf dossiers par défaut)
2. Cliquer sur l'icône **✏️**
3. Modifier le nom et/ou la couleur
4. Cliquer sur **"Modifier"**

⚠️ **Note**: Les dossiers par défaut ne peuvent pas être renommés ou supprimés

### Supprimer un dossier

1. Survoler le dossier (sauf dossiers par défaut)
2. Cliquer sur l'icône **🗑️**
3. Confirmer la suppression
4. Tous les médias du dossier retournent vers "Non classé"

## Interface

### Liste des dossiers

```
┌──────────────────────────┐
│ DOSSIERS              [+]│
├──────────────────────────┤
│ ● Non classé          12 │ (défaut)
│ ● Vidéos              45 │
│ ● Jingles              8 │ ✏️ 🗑️
│ ● Publicités          23 │ ✏️ 🗑️
│ ● Génériques           5 │ ✏️ 🗑️
│ ● Interviews          15 │ ✏️ 🗑️ (personnalisé)
└──────────────────────────┘
```

### Badge sur les médias

Chaque fichier média affiche un petit point coloré correspondant à son dossier:

```
video_intro.mp4 ● (point bleu = Vidéos)
jingle_news.mp4 ● (point vert = Jingles)
pub_marque.mp4  ● (point rouge = Publicités)
```

### Menu contextuel (clic droit)

```
┌─────────────────────────┐
│ Déplacer vers...        │
├─────────────────────────┤
│ ● Non classé            │
│ ● Vidéos             ✓  │  ← Actuel
│ ● Jingles               │
│ ● Publicités            │
│ ● Génériques            │
│ ● Interviews            │
└─────────────────────────┘
```

## Architecture technique

### Backend

**Fichiers créés**:

1. **`backend/models/mediaFolders.js`**
   - Classe `MediaFolders`
   - Gestion complète des dossiers
   - Map des assignations médias → dossiers
   - Méthodes: create, update, delete, assign, etc.

2. **`backend/utils/folderPersistence.js`**
   - Sauvegarde/chargement JSON
   - Fichier: `backend/data/mediaFolders.json`

3. **`backend/server.js`** (modifié)
   - 5 nouveaux handlers WebSocket:
     - `FOLDER_CREATE`
     - `FOLDER_UPDATE`
     - `FOLDER_DELETE`
     - `FOLDER_ASSIGN_MEDIA`
     - `FOLDER_GET_ALL`
   - Initialisation au démarrage
   - Enrichissement des médias avec `folderId`

### Frontend

**Fichiers modifiés**:

1. **`frontend/index.html`**
   - Section "Dossiers" dans la médiathèque
   - Modal création/édition de dossier
   - Sélecteur de couleurs

2. **`frontend/style.css`**
   - Styles pour liste de dossiers
   - Badges colorés
   - Menu contextuel
   - Modal et color picker

3. **`frontend/app.js`**
   - État global: `folders`, `selectedFolderId`
   - Fonctions de rendu: `renderFolders()`, `renderMediaLibrary()`
   - Menu contextuel pour assignation
   - Handlers d'événements

### Messages WebSocket

#### Client → Serveur

```javascript
// Créer un dossier
{
  type: 'FOLDER_CREATE',
  data: {
    name: 'Interviews',
    color: '#118ab2',
    parentId: null
  }
}

// Modifier un dossier
{
  type: 'FOLDER_UPDATE',
  data: {
    id: 6,
    updates: { name: 'Interviews 2025', color: '#e63946' }
  }
}

// Supprimer un dossier
{
  type: 'FOLDER_DELETE',
  data: { id: 6 }
}

// Assigner un média
{
  type: 'FOLDER_ASSIGN_MEDIA',
  data: {
    mediaFile: 'interview_maire.mp4',
    folderId: 6
  }
}

// Demander liste des dossiers
{
  type: 'FOLDER_GET_ALL',
  data: {}
}
```

#### Serveur → Client

```javascript
// Liste des dossiers
{
  type: 'FOLDER_LIST',
  data: {
    folders: [
      {
        id: 1,
        name: 'Non classé',
        color: '#6c757d',
        isDefault: true,
        mediaCount: 12,
        createdAt: '2025-01-15T10:30:00.000Z'
      },
      {
        id: 6,
        name: 'Interviews',
        color: '#118ab2',
        isDefault: false,
        mediaCount: 15,
        createdAt: '2025-01-15T11:00:00.000Z'
      }
    ]
  }
}
```

### Modèle de données

**Structure d'un dossier**:
```javascript
{
  id: 1,                    // ID unique auto-incrémenté
  name: 'Vidéos',           // Nom du dossier
  parentId: null,           // ID du dossier parent (non utilisé actuellement)
  color: '#118ab2',         // Couleur hex
  isDefault: false,         // Protégé contre suppression/renommage
  createdAt: Date,          // Date de création
  mediaCount: 45            // Nombre de médias (calculé)
}
```

**Structure de l'assignation**:
```javascript
Map<mediaFile, folderId>
// Ex: 'video.mp4' => 2 (dossier Vidéos)
```

### Couleurs disponibles

```javascript
const COLORS = [
  '#118ab2', // Bleu (défaut)
  '#06d6a0', // Vert
  '#e63946', // Rouge
  '#f77f00', // Orange
  '#6c757d', // Gris
  '#8338ec'  // Violet
];
```

## Scénarios d'utilisation

### Cas 1: Organisation par type de contenu

```
📁 Non classé (12)
📁 Vidéos (45)
   - Reportages
   - Interviews
   - B-rolls
📁 Jingles (8)
   - Intro journal
   - Inter-blocs
📁 Publicités (23)
   - Sponsors
   - Autopromos
📁 Génériques (5)
   - Début émission
   - Fin émission
```

### Cas 2: Organisation par programme

```
📁 Non classé
📁 JT 20h (35)
📁 Matinale (28)
📁 Sport (42)
📁 Culture (19)
📁 Météo (12)
```

### Cas 3: Organisation temporelle

```
📁 Non classé
📁 Janvier 2025 (67)
📁 Février 2025 (54)
📁 Mars 2025 (42)
📁 Archive (145)
```

## Avantages

✅ **Pas de modification physique**: L'arborescence des fichiers reste intacte
✅ **Flexibilité totale**: Réorganisez sans contraintes
✅ **Multi-critères**: Un fichier peut être dans un seul dossier virtuel mais accessible de partout
✅ **Performance**: Filtrage instantané côté client
✅ **Visuel**: Couleurs et badges pour identification rapide
✅ **Persistant**: Sauvegarde automatique de toute la structure

## Limitations actuelles

⚠️ **Pas de hiérarchie**: Pas de sous-dossiers (parentId non utilisé)
⚠️ **Un média = un dossier**: Pas de multi-assignation (tags)
⚠️ **Pas de drag & drop**: Assignation uniquement par clic droit

## Améliorations futures possibles

- [ ] Support des sous-dossiers (hiérarchie)
- [ ] Drag & drop de fichiers vers dossiers
- [ ] Tags multiples au lieu d'un seul dossier
- [ ] Recherche par nom de dossier
- [ ] Tri personnalisé des dossiers
- [ ] Import/export de la structure
- [ ] Raccourcis clavier (1-9 pour dossiers fréquents)
- [ ] Dossiers intelligents (filtres automatiques par type/durée/date)
- [ ] Statistiques par dossier (durée totale, taille)

## Résumé

Le système de dossiers virtuels offre une organisation flexible et visuelle de votre médiathèque RTG Playout sans modifier vos fichiers. Créez, organisez et filtrez vos médias en quelques clics!

🎯 **Utilisation principale**: Clic droit sur un média → Choisir le dossier
🔍 **Filtrage**: Cliquer sur un dossier pour voir uniquement ses médias
🎨 **Personnalisation**: Noms et couleurs à votre convenance
