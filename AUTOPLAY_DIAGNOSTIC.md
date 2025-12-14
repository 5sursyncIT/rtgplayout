# Diagnostic Autoplay - Problèmes Identifiés

## Problèmes trouvés:

### 1. Bug dans isFinished() - Variable non définie
**Ligne ~334**: `return remaining <= this.timeTolerance;`
**Erreur**: `this.timeTolerance` n'existe pas
**Solution**: Utiliser `this.TIME_TOLERANCE`

### 2. Logique shouldPlay() trop restrictive
**Problème**: La fenêtre de tolérance de ±2 secondes peut rater des items si:
- Le serveur est occupé
- L'item précédent se termine en retard
- Il y a un délai dans le check

**Solution**: Vérifier si l'item devrait déjà être en cours de lecture

### 3. Pas de mécanisme de "catch-up"
**Problème**: Si un item est manqué, il ne sera jamais lu
**Solution**: Ajouter une logique pour passer au prochain item si on est en retard

## Corrections à appliquer:

1. Corriger `this.timeTolerance` → `this.TIME_TOLERANCE`
2. Améliorer la logique de `shouldPlay()` pour gérer les retards
3. Ajouter des logs de debug pour le troubleshooting

## Test après correction:
1. Activer le mode AUTO
2. Vérifier les logs console pour voir les checks
3. Observer si les vidéos démarrent automatiquement
