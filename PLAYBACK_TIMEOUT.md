# Système de Timeout de Lecture

## Fonctionnalité

Le système RTG Playout intègre désormais un mécanisme de détection automatique des échecs de lecture. Si un fichier ne démarre pas correctement dans les **10 secondes** suivant la commande PLAY, le système passera automatiquement au fichier suivant.

## Comment ça fonctionne

### 1. Détection d'échec

Lorsqu'un fichier est lancé:
1. Un timer de 10 secondes démarre
2. Le système vérifie toutes les 500ms si la vidéo joue réellement
3. Si la vidéo démarre correctement (time > 0 dans CasparCG), le timer est annulé
4. Si après 10 secondes la vidéo ne joue toujours pas, le timeout se déclenche

### 2. Comportement selon le mode

#### Mode AUTO
```
[Fichier A] → Échec après 10s → [Fichier B] → Succès → Continue normalement
```
- Le système passe automatiquement au fichier suivant
- Une notification d'erreur est envoyée
- La lecture continue sans intervention

#### Mode MANUEL
```
[Fichier A] → Échec après 10s → STOP
```
- Le système s'arrête
- Une notification d'erreur est affichée
- L'opérateur doit intervenir manuellement

### 3. Notifications

Quand un timeout se produit:
- **Console serveur**:
  ```
  [AUTOPLAY] ⚠️  Playback timeout after 10s for: video_name.mp4
  [AUTOPLAY] File may be corrupted or not playing correctly: video_name.mp4
  ```

- **Interface utilisateur**:
  - Toast notification rouge: "Échec de lecture: video_name.mp4 (timeout 10s)"

## Cas d'usage

### Fichiers corrompus
```
Playlist:
1. video_ok.mp4 ✅
2. video_corrupt.mp4 ❌ (timeout après 10s)
3. video_ok2.mp4 ✅ (joue automatiquement)
```

### Fichiers manquants
```
Playlist:
1. intro.mp4 ✅
2. missing_file.mp4 ❌ (timeout après 10s)
3. outro.mp4 ✅ (joue automatiquement)
```

### Problèmes de codec
```
Playlist:
1. h264_video.mp4 ✅
2. incompatible_codec.mp4 ❌ (timeout après 10s)
3. h264_video2.mp4 ✅ (joue automatiquement)
```

## Détails techniques

### Configuration

Le timeout est défini dans `autoplayScheduler.js`:

```javascript
this.PLAYBACK_TIMEOUT_MS = 10000; // 10 secondes
```

Pour modifier le délai, changez cette valeur (en millisecondes):
- 5 secondes: `5000`
- 15 secondes: `15000`
- 30 secondes: `30000`

### Méthode de détection

Le système vérifie que:
1. Le layer CasparCG contient un foreground
2. Le producer est de type `ffmpeg` (pas `empty`)
3. Le timecode progresse (`time > 0`)

Code simplifié:
```javascript
isVideoPlaying(data) {
    // Parse XML from CasparCG INFO command
    const foregroundContent = extractForeground(data);

    // Check if ffmpeg producer is active
    if (foregroundContent.includes('<producer>ffmpeg</producer>')) {
        const time = extractTime(foregroundContent);
        return time > 0; // Video is playing
    }

    return false;
}
```

### Cycle de vie du timeout

```
PLAY command
    ↓
[Timer 10s START]
    ↓
Status check (every 500ms)
    ↓
Video playing? → YES → [Timer CANCEL] → Continue normal
    ↓
    NO
    ↓
10s elapsed?
    ↓
YES → [Timeout triggered]
    ↓
Mode AUTO? → YES → Play next item
    ↓
    NO
    ↓
STOP playback
```

## Logs utiles

### Timeout déclenché
```
[AUTOPLAY] Playing item: corrupted_video.mp4 (corrupted_video.mp4)
[CASPAR] Sending command: PLAY 1-10 "corrupted_video"
[AUTOPLAY] Playback timeout set for 10s
[AUTOPLAY] ⚠️  Playback timeout after 10s for: corrupted_video.mp4
[AUTOPLAY] File may be corrupted or not playing correctly: corrupted_video.mp4
[AUTOPLAY] Attempting to play next item...
[AUTOPLAY] Playing next: next_video.mp4
```

### Lecture réussie
```
[AUTOPLAY] Playing item: good_video.mp4 (good_video.mp4)
[CASPAR] Sending command: PLAY 1-10 "good_video"
[AUTOPLAY] Playback timeout set for 10s
[DEBUG isFinished] Video just started (<5s), returning false
[AUTOPLAY] Video is playing - timeout cleared ✅
```

## Compatibilité

- ✅ Mode AUTO (playlist automatique)
- ✅ Mode MANUEL (lecture manuelle)
- ✅ Tous types de fichiers vidéo supportés par CasparCG
- ✅ Fonctionne avec ErrorHandler existant

## Améliorations futures possibles

- [ ] Timeout configurable par fichier
- [ ] Retry automatique (X tentatives avant skip)
- [ ] Liste noire de fichiers problématiques
- [ ] Statistiques d'échecs de lecture
- [ ] Notification email/SMS en cas d'échecs répétés
- [ ] Fichier de fallback automatique (ex: "technical_difficulties.mp4")

## Résumé

Cette fonctionnalité garantit que la playlist continue de jouer même si un fichier pose problème, évitant ainsi les "écrans noirs" en diffusion. C'est particulièrement utile pour:

- Diffusions 24/7 non supervisées
- Fichiers provenant de sources multiples
- Environnements de production critiques
- Situations où l'intervention manuelle n'est pas possible immédiatement

Le délai de 10 secondes est un bon compromis entre:
- Laisser le temps au fichier de démarrer (certains codecs/résolutions peuvent prendre quelques secondes)
- Ne pas laisser un écran noir trop longtemps à l'antenne
