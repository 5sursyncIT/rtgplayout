# Manuel d'Exploitation Technique - RTG Playout

Ce document est destiné aux techniciens et opérateurs du Nodal pour l'exploitation du système de diffusion RTG Playout.

## 1. Accès au Système

*   **Interface Web** : [http://172.16.4.180:3000](http://172.16.4.180:3000)
*   **Serveur (Backend)** : Tourne sur la machine de diffusion (Z:\nodal\rtg-playout)
*   **Moteur de Diffusion** : CasparCG Server (Port 5250 pour AMCP)

## 2. Gestion de la Médiathèque

### Stockage des Fichiers
Les fichiers vidéo doivent être déposés dans le dossier :
`Z:\nodal\medias\`

*   **Organisation** : Vous pouvez créer des sous-dossiers pour organiser les médias.
*   **Détection Automatique** : Le système surveille ce dossier en temps réel. Tout fichier ajouté apparaît automatiquement dans l'interface web (sous quelques secondes).
*   **Vignettes** : Générées automatiquement lors du scan.

### Interface Médiathèque
*   **Filtrage** : Utilisez les dossiers virtuels (boutons colorés à gauche) pour filtrer les types de médias (Jingles, Pubs, Vidéos...).
*   **Assignation** : Clic-droit sur un média pour l'assigner à une catégorie (ex: "Publicités").
*   **Recherche** : La barre de recherche filtre les médias par nom.

## 3. Gestion de la Playlist (Conducteur)

### Construction de la Playlist
1.  **Ajout** : Glissez-déposez un fichier depuis la médiathèque vers la playlist (zone centrale).
2.  **Ordre** : Glissez-déposez les éléments dans la liste pour changer l'ordre de diffusion.
3.  **Suppression** : Cliquez sur la croix (X) à droite de l'élément.

### Fonctionnalités Avancées
*   **DIRECT (Live)** : Pour insérer un direct plateau ou extérieur.
    *   Utilise l'entrée DeckLink configurée.
*   **Heure Fixe (Hard Start)** :
    *   Cliquez sur l'icône "Réveil" (⏰).
    *   Définissez l'heure précise de démarrage.
    *   Le système affichera un compte à rebours et calculera les retards/avances (Backtiming).
*   **Trim (Découpe)** : Permet de définir un point d'entrée (IN) et de sortie (OUT) sans modifier le fichier original.

## 4. Contrôle de Diffusion (Playout)

### Modes de Lecture
Le système dispose de 3 modes (bouton en haut à droite) :

1.  **MANUEL** : La lecture s'arrête à la fin de chaque élément. L'opérateur doit lancer le suivant.
2.  **ASSISTÉ** : Enchaîne automatiquement, sauf si un "STOP" est marqué sur un élément.
3.  **AUTOMATIQUE** : Enchaînement continu de toute la playlist.

### Contrôles
*   **PLAY (▶)** : Lance l'élément sélectionné ou le suivant.
*   **STOP (■)** : Arrête la diffusion en cours (FADE OUT).
*   **NEXT (⏭)** : Passe immédiatement à l'élément suivant (CUT).

## 5. Habillage Graphique (Templates)

L'onglet "Habillage" permet de gérer les synthés (Lower Thirds), Logos, et Tickers.

### Utilisation
1.  **Sélection** : Choisissez un type de template (ex: "Lower Third").
2.  **Données** : Remplissez les champs (Titre, Sous-titre).
3.  **Prévisualisation** : (Si disponible) Affiche un aperçu.
4.  **DIFFUSER (F5)** : Affiche le template à l'antenne.
5.  **STOP (F6)** : Retire le template.

### Presets (Sauvegardes)
Pour les émissions récurrentes :
*   Remplissez les champs du template.
*   Entrez un nom de preset (ex: "Nom Invité 1").
*   Cliquez sur **"Sauvegarder Preset"**.
*   Les presets apparaissent en bas pour un rappel rapide. Ils sont stockés sur le disque et persistent après redémarrage.

### Layers (Couches)
*   **Couche 10** : Vidéo principale (Playlist).
*   **Couche 20+** : Habillages (Prioritaires sur la vidéo).

## 6. Dépannage Technique

### Le serveur ne répond pas
1.  Vérifier que la fenêtre terminal "Node.js" est ouverte sur le serveur.
2.  Si fermé, relancer avec : `cd Z:\nodal\rtg-playout` puis `npm start`.

### CasparCG déconnecté
*   L'indicateur "CasparCG" est rouge dans l'interface.
*   Vérifier que CasparCG Server est lancé (fenêtre console noire).
*   Le serveur tente une reconnexion automatique.

### Problème de médias (Erreur 404 / Vignettes manquantes)
*   Vérifier que le nom du fichier ne contient pas de caractères trop exotiques (bien que le système gère les espaces et accents).
*   Vérifier que le fichier est bien présent dans `Z:\nodal\medias\`.

### Logs
Pour un diagnostic approfondi, consulter les logs dans le terminal du serveur. Les erreurs sont affichées en rouge.

---
*Document mis à jour le 21/12/2025*
