# RTG Playout

Application de gestion de playlist professionnelle pour CasparCG Server.

## 🎯 Fonctionnalités

### ✅ Implémenté (Phases 1-4)
- **Gestion de playlist** : Ajout, suppression, calcul automatique des horaires
- **Médiathèque** : Scan des fichiers vidéo avec FFprobe
- **Contrôle CasparCG** : Commandes PLAY/STOP via AMCP
- **Interface web** : Design professionnel broadcast
- **Persistance** : Sauvegarde automatique de la playlist
- **Réseau** : Accessible depuis d'autres machines

### 🚧 En cours (Phase 5)
- **Lecture automatique** : Mode AUTO/MANUEL avec scheduler
- **Détection de fin** : Passage automatique au suivant
- **Queue de lecture** : Gestion automatique de la playlist

## 📋 Prérequis

- **Node.js** 14+ 
- **CasparCG Server** 2.3+
- **FFmpeg/FFprobe** (pour les durées vidéo)
- **Windows** 10+ ou **Linux**

## 🚀 Installation

### 1. Cloner le projet
```bash
git clone <votre-repo>
cd rtg-playout
```

### 2. Installer les dépendances
```bash
cd backend
npm install
```

### 3. Configuration

#### CasparCG Server
Éditer `C:\SERVER\casparcg.config` :
```xml
<media-path>Z:\nodal\medias</media-path>
```

#### RTG Playout
Éditer `backend/server.js` :
```javascript
const PREFERRED_IP = '172.16.4.180';  // Votre IP
const CASPAR_HOST = '127.0.0.1';      // IP CasparCG
```

### 4. Lancer l'application

```bash
# Terminal 1: CasparCG Server
cd C:\SERVER
casparcg.exe

# Terminal 2: RTG Playout
cd Z:\nodal\rtg-playout\backend
node server.js
```

### 5. Accéder à l'interface

```
http://172.16.4.180:3000
```

## 📁 Structure du projet

```
rtg-playout/
├── backend/
│   ├── caspar/
│   │   └── casparClient.js      # Client AMCP
│   ├── models/
│   │   └── playlist.js          # Modèle de playlist
│   ├── scheduler/
│   │   └── autoplayScheduler.js # Lecture automatique
│   ├── utils/
│   │   ├── mediaScanner.js      # Scanner de médias
│   │   ├── persistence.js       # Sauvegarde/chargement
│   │   ├── timing.js            # Calculs horaires
│   │   └── xmlParser.js         # Parser XML CasparCG
│   ├── data/
│   │   └── playlist.json        # Playlist sauvegardée
│   ├── package.json
│   └── server.js                # Serveur principal
├── frontend/
│   ├── index.html               # Interface utilisateur
│   ├── app.js                   # Logique frontend
│   ├── style.css                # Styles
│   └── caspar-styles.css        # Styles CasparCG
└── README.md
```

## 🎮 Utilisation

### Ajouter des vidéos
1. Placer les fichiers dans `Z:\nodal\medias\`
2. Cliquer sur **"Scanner"** dans l'interface
3. Cliquer sur les vidéos pour les ajouter à la playlist

### Contrôle manuel
- **▶ PLAY** : Lancer une vidéo
- **⏹ STOP** : Arrêter la diffusion
- **✕** : Supprimer un élément

### Mode automatique (Phase 5 - En cours)
- **MODE AUTO** : Lecture automatique selon les horaires
- **MODE MANUEL** : Contrôle manuel uniquement

## 🔧 Configuration avancée

### Ports
- **HTTP** : 3000 (interface web)
- **WebSocket** : 8080 (communication temps réel)
- **CasparCG AMCP** : 5250

### CasparCG
- **Channel** : 1
- **Layer** : 10

## 📝 Messages WebSocket

### Client → Serveur
- `ADD_ITEM` : Ajouter un élément
- `REMOVE_ITEM` : Supprimer un élément
- `PLAY_ITEM` : Lancer la diffusion
- `STOP_PLAYBACK` : Arrêter
- `SET_AUTOPLAY_MODE` : Changer le mode
- `SCAN_MEDIA` : Scanner les médias

### Serveur → Client
- `PLAYLIST_UPDATED` : Playlist modifiée
- `PLAYBACK_STATUS` : État de diffusion
- `MEDIA_LIBRARY` : Liste des médias
- `AUTOPLAY_STATUS` : État du mode auto

## 🐛 Dépannage

### "CasparCG not connected"
1. Vérifier que CasparCG Server est lancé
2. Tester : `telnet 127.0.0.1 5250`
3. Vérifier l'IP dans `server.js`

### "FFprobe not found"
1. Installer FFmpeg
2. Ajouter au PATH système
3. Redémarrer le terminal

### Playlist ne se sauvegarde pas
1. Vérifier les permissions sur `backend/data/`
2. Créer le dossier si nécessaire

## 📚 Documentation

- [CasparCG Wiki](https://github.com/CasparCG/help/wiki)
- [AMCP Protocol](https://github.com/CasparCG/help/wiki/AMCP-Protocol)
- [Plan d'implémentation complet](docs/complete-implementation-plan.md)

## 🗺️ Roadmap

- [x] Phase 1-2 : Playlist & Interface
- [x] Phase 3 : Intégration CasparCG
- [x] Phase 4 : Scanner de médias
- [ ] Phase 5 : Lecture automatique (en cours)
- [ ] Phase 6 : Gestion des erreurs
- [ ] Phase 7 : Synchronisation horaire
- [ ] Phase 8 : Drag & Drop
- [ ] Phase 9 : Preview & Monitoring
- [ ] Phase 10 : Contrôles avancés

## 📄 Licence

Projet interne RTG

## 👥 Contributeurs

- Développement initial : Équipe RTG

---

**Version** : 0.5.0 (Phase 5 en cours)  
**Dernière mise à jour** : 2025-12-14
