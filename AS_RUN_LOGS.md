# As-Run Logs - Certification de Diffusion

## Vue d'ensemble

Le système **As-Run Logs** de RTG Playout enregistre automatiquement TOUT ce qui est diffusé à l'antenne avec horodatage précis, permettant la conformité réglementaire et la facturation publicitaire.

### Pourquoi As-Run Logs ?

**Obligations légales:**
- 🏛️ **CSA/ARCOM**: Prouver le respect des quotas (œuvres françaises, prod. indépendante)
- 💰 **Régies pub**: Certification des diffusions pour facturation
- 📊 **Reporting**: Statistiques d'audience et conformité des grilles

**Avantages opérationnels:**
- ✅ Audit complet de toutes les diffusions
- ✅ Détection des écarts entre prévu/réel
- ✅ Diagnostic des problèmes techniques
- ✅ Preuve en cas de litige

---

## Architecture

### Fichiers de Logs

**Localisation:** `backend/logs/as-run/`

**Format:**
- Un fichier par jour: `as-run-YYYY-MM-DD.log`
- Format JSON Lines (un JSON par ligne pour parsing facile)
- Encodage UTF-8

**Exemple de structure:**
```
backend/logs/as-run/
├── as-run-2025-12-21.log
├── as-run-2025-12-20.log
├── report-2025-12-21.txt
└── report-2025-12-20.txt
```

### Format des Entrées

Chaque ligne est un JSON avec:

```json
{
  "timestamp": "2025-12-21T14:30:15.123Z",
  "eventType": "PLAY_START",
  "itemId": "item-1234567890-abcdef",
  "fileName": "jingles/intro.mp4",
  "scheduledTime": "2025-12-21T14:30:00.000Z",
  "actualTime": "2025-12-21T14:30:15.123Z",
  "delayMs": 15123,
  "status": "started"
}
```

---

## Types d'Événements Loggés

### 1. PLAY_START - Début de diffusion
```json
{
  "timestamp": "ISO 8601",
  "eventType": "PLAY_START",
  "itemId": "Unique ID",
  "fileName": "Nom du fichier",
  "scheduledTime": "Heure prévue",
  "actualTime": "Heure réelle",
  "delayMs": "Retard en millisecondes",
  "status": "started"
}
```

**Utilité:** Vérifier le respect de la grille horaire

### 2. PLAY_END - Fin de diffusion
```json
{
  "timestamp": "ISO 8601",
  "eventType": "PLAY_END",
  "itemId": "Unique ID",
  "fileName": "Nom du fichier",
  "startTime": "Début effectif",
  "endTime": "Fin effective",
  "expectedDuration": "HH:MM:SS.mmm",
  "actualDuration": "HH:MM:SS.mmm",
  "varianceMs": "Écart durée",
  "status": "completed"
}
```

**Utilité:** Calcul durée réelle pour facturation pub

### 3. PLAY_STOP - Arrêt manuel
```json
{
  "timestamp": "ISO 8601",
  "eventType": "PLAY_STOP",
  "itemId": "Unique ID",
  "fileName": "Nom du fichier",
  "reason": "manual | error | timeout",
  "status": "stopped"
}
```

**Utilité:** Trace des interventions opérateur

### 4. PLAY_ERROR - Erreur de lecture
```json
{
  "timestamp": "ISO 8601",
  "eventType": "PLAY_ERROR",
  "itemId": "Unique ID",
  "fileName": "Nom du fichier",
  "error": "Message d'erreur",
  "errorStack": "Stack trace",
  "status": "error"
}
```

**Utilité:** Diagnostic technique, maintenance préventive

### 5. TEMPLATE_SHOW - Affichage graphic
```json
{
  "timestamp": "ISO 8601",
  "eventType": "TEMPLATE_SHOW",
  "templateName": "rtg-lower-third",
  "channel": 1,
  "layer": 20,
  "data": "{\"title\":\"Breaking News\"}",
  "status": "displayed"
}
```

**Utilité:** Trace des synthés diffusés (mentions légales, crédits)

### 6. TEMPLATE_HIDE - Masquage graphic
```json
{
  "timestamp": "ISO 8601",
  "eventType": "TEMPLATE_HIDE",
  "templateName": "rtg-lower-third",
  "channel": 1,
  "layer": 20,
  "displayDuration": "00:00:15.500",
  "status": "hidden"
}
```

### 7. SYSTEM_EVENT - Événement système
```json
{
  "timestamp": "ISO 8601",
  "eventType": "SYSTEM_EVENT",
  "event": "SERVER_START | SERVER_SHUTDOWN | CONFIG_CHANGE",
  "details": { ... }
}
```

**Utilité:** Audit des arrêts/démarrages pour continuité de service

---

## Utilisation via WebSocket

### Récupérer les logs

**Message client → serveur:**
```javascript
ws.send(JSON.stringify({
  type: 'ASRUN_GET_LOGS',
  data: {
    startDate: '2025-12-21T00:00:00Z',
    endDate: '2025-12-21T23:59:59Z'  // Optionnel (défaut: maintenant)
  }
}));
```

**Réponse serveur → client:**
```javascript
{
  type: 'ASRUN_LOGS',
  data: {
    logs: [ /* Array de tous les événements */ ],
    count: 1234
  }
}
```

### Générer un rapport quotidien

**Message client → serveur:**
```javascript
ws.send(JSON.stringify({
  type: 'ASRUN_GENERATE_REPORT',
  data: {
    date: '2025-12-21'  // Optionnel (défaut: aujourd'hui)
  }
}));
```

**Réponse serveur → client:**
```javascript
{
  type: 'ASRUN_REPORT_GENERATED',
  data: {
    reportFile: '/path/to/report-2025-12-21.txt',
    stats: {
      totalEvents: 1500,
      playStarts: 250,
      playEnds: 245,
      playErrors: 2,
      playStops: 3,
      templatesShown: 100,
      systemEvents: 5
    }
  }
}
```

---

## Format des Rapports

Les rapports quotidiens sont générés au format texte lisible:

```
=================================================
  AS-RUN REPORT - 2025-12-21
  RTG Playout System
=================================================

SUMMARY
-------
Total Events:        1500
Videos Started:      250
Videos Completed:    245
Videos Stopped:      3
Playback Errors:     2
Graphics Displayed:  100
System Events:       5

HOURLY BREAKDOWN
----------------
06:00 - 06:59  =>  45 events
07:00 - 07:59  =>  68 events
08:00 - 08:59  =>  92 events
...

ERRORS LOG
----------
[14:23:15] pub/spot-123.mp4: File not found
[18:45:02] news/reportage.mp4: CasparCG timeout

COMPLETE BROADCAST LOG
----------------------
[06:00:00] START    | matinale/generique.mp4
[06:00:15] END      | matinale/generique.mp4
[06:00:16] START    | jingles/meteo.mp4
[06:00:26] END      | jingles/meteo.mp4
...

=================================================
End of Report
Generated: 2025-12-22T02:00:00.000Z
=================================================
```

---

## Conformité Réglementaire

### CSA/ARCOM (France)

**Quotas obligatoires:**
- 60% œuvres européennes
- 40% œuvres françaises
- 40% production indépendante

**Comment prouver:**
```javascript
// Filtrer les logs par type de contenu
const logs = await asRunLogger.getLogs(startDate, endDate);
const videoLogs = logs.filter(l => l.eventType === 'PLAY_END');

// Analyser les métadonnées (à ajouter dans playlist.items)
const stats = {
  totalDuration: 0,
  frenchWorks: 0,
  europeanWorks: 0,
  independentProd: 0
};

videoLogs.forEach(log => {
  // Parser actualDuration et calculer ratios
  // Basé sur métadonnées enrichies de chaque fichier
});
```

### Régies Publicitaires

**Preuves de diffusion:**
- Timestamp exact de début/fin
- Durée réelle diffusée
- Écarts par rapport au prévu

**Export pour facturation:**
```javascript
// Filtrer uniquement les pubs
const pubLogs = logs.filter(l =>
  l.eventType === 'PLAY_END' &&
  l.fileName.includes('pub/')
);

// Générer CSV pour la régie
const csv = pubLogs.map(l =>
  `${l.timestamp},${l.fileName},${l.actualDuration},${l.status}`
).join('\n');
```

---

## Maintenance et Archivage

### Rotation des Logs

**Automatique:** Un nouveau fichier est créé chaque jour à minuit.

**Manuel - Script de nettoyage:**
```bash
# Garder 90 jours de logs
find backend/logs/as-run/ -name "as-run-*.log" -mtime +90 -delete
find backend/logs/as-run/ -name "report-*.txt" -mtime +90 -delete
```

**Avec cron (Linux):**
```bash
# Chaque jour à 3h du matin
0 3 * * * find /path/to/rtg-playout/backend/logs/as-run/ -name "*.log" -mtime +90 -delete
```

### Archivage Long Terme

**Recommandations:**
1. **Compression:** Compresser les logs de plus de 30 jours
   ```bash
   gzip backend/logs/as-run/as-run-2025-11-*.log
   ```

2. **Sauvegarde externe:** Copier sur NAS ou cloud
   ```bash
   # Exemple avec rsync
   rsync -avz backend/logs/as-run/ nas:/backup/rtg-playout/as-run/
   ```

3. **Durée de rétention légale:**
   - **France:** 3 ans minimum (ARCOM)
   - **Pubs:** 5 ans recommandé (litiges possibles)

### Génération Automatique de Rapports

**Script cron pour rapport quotidien:**
```bash
#!/bin/bash
# generate_daily_report.sh

DATE=$(date -d "yesterday" +%Y-%m-%d)

curl -X POST http://localhost:3000/asrun/report \
  -H "Content-Type: application/json" \
  -d "{\"date\": \"$DATE\"}"

# Envoyer le rapport par email
mail -s "As-Run Report $DATE" admin@rtg.tv < \
  /path/to/backend/logs/as-run/report-$DATE.txt
```

**Crontab:**
```bash
# Tous les jours à 1h du matin
0 1 * * * /path/to/generate_daily_report.sh
```

---

## API Programmatique

### Utilisation directe dans Node.js

```javascript
const AsRunLogger = require('./backend/utils/asRunLogger');

// Initialiser
const logger = new AsRunLogger('/custom/path/logs');
await logger.initialize();

// Logger un événement
await logger.logPlayStart(
  'item-123',
  'jingles/intro.mp4',
  new Date('2025-12-21T14:00:00Z'),
  new Date()
);

// Récupérer les logs
const logs = await logger.getLogs(
  new Date('2025-12-21'),
  new Date('2025-12-21T23:59:59')
);

// Générer rapport
const report = await logger.generateDailyReport(new Date());
console.log(report.stats);

// Arrêter proprement
await logger.stop();
```

---

## Analyse et Statistiques

### Exemples d'Analyses

**1. Taux de réussite de diffusion:**
```javascript
const starts = logs.filter(l => l.eventType === 'PLAY_START').length;
const errors = logs.filter(l => l.eventType === 'PLAY_ERROR').length;
const successRate = ((starts - errors) / starts * 100).toFixed(2);
console.log(`Taux de réussite: ${successRate}%`);
```

**2. Retard moyen de diffusion:**
```javascript
const delays = logs
  .filter(l => l.eventType === 'PLAY_START' && l.delayMs)
  .map(l => l.delayMs);

const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
console.log(`Retard moyen: ${avgDelay.toFixed(0)} ms`);
```

**3. Heures de pointe:**
```javascript
const hourly = {};
logs.forEach(l => {
  const hour = new Date(l.timestamp).getHours();
  hourly[hour] = (hourly[hour] || 0) + 1;
});

const peakHour = Object.entries(hourly)
  .sort((a, b) => b[1] - a[1])[0];
console.log(`Heure de pointe: ${peakHour[0]}h (${peakHour[1]} événements)`);
```

---

## Troubleshooting

### Logs ne sont pas créés

**Diagnostic:**
```bash
# Vérifier que le dossier existe et est accessible
ls -la backend/logs/as-run/

# Vérifier les permissions
chmod 755 backend/logs/as-run/
```

**Solution:** Le dossier est créé automatiquement au démarrage. Vérifier les logs serveur pour erreurs d'initialisation.

### Fichiers trop volumineux

**Cause:** Logs verbeux ou très haut débit de diffusion

**Solutions:**
1. Rotation plus fréquente (par heure au lieu de par jour)
2. Filtrer les événements non critiques
3. Compression automatique

### Différence entre logs et réalité

**Vérification:**
```javascript
// Comparer avec les logs CasparCG
// Les timestamps doivent correspondre à ±500ms près
```

**Causes possibles:**
- Décalage horloge système (utiliser NTP)
- Latence réseau CasparCG
- Buffer flush pas immédiat (max 5s)

---

## Intégration Externe

### Export vers systèmes tiers

**Format CSV pour Excel:**
```javascript
const fs = require('fs');
const logs = await asRunLogger.getLogs(startDate, endDate);

const csv = [
  'Timestamp,Event,File,Duration,Status',
  ...logs.map(l =>
    `${l.timestamp},${l.eventType},${l.fileName || ''},${l.actualDuration || ''},${l.status}`
  )
].join('\n');

fs.writeFileSync('export.csv', csv);
```

**Format XML pour systèmes legacy:**
```javascript
const xml = `<?xml version="1.0"?>
<AsRunLog date="${date}">
${logs.map(l => `
  <Event type="${l.eventType}" timestamp="${l.timestamp}">
    <File>${l.fileName}</File>
    <Status>${l.status}</Status>
  </Event>
`).join('')}
</AsRunLog>`;
```

---

## Sécurité et Intégrité

### Protection des logs

**1. Permissions fichiers:**
```bash
# Logs lisibles seulement par le serveur
chmod 600 backend/logs/as-run/*.log
```

**2. Sommes de contrôle (optionnel):**
```bash
# Générer checksum quotidien
sha256sum as-run-2025-12-21.log > as-run-2025-12-21.log.sha256
```

**3. Signature numérique (haute sécurité):**
Pour prouver qu'un log n'a pas été modifié après coup:
```bash
# Signer avec GPG
gpg --detach-sign as-run-2025-12-21.log
```

### Audit trail

Tous les événements système sont loggés avec:
- Qui: IP client si applicable
- Quoi: Type d'événement
- Quand: Timestamp précis
- Pourquoi: Contexte (scheduled, manual, error)

---

## Performance

### Impact sur le système

- **CPU:** < 1% (écriture asynchrone)
- **Mémoire:** ~5-10 MB (buffer en mémoire)
- **Disque:** ~1-5 MB/jour (variable selon activité)
- **I/O:** Flush toutes les 5s ou événements critiques

### Optimisations

**Buffer size:** Ajustable dans `asRunLogger.js`
```javascript
this.bufferMaxSize = 100; // Flush après 100 entrées
```

**Flush interval:** Modifier le délai
```javascript
this.flushInterval = setInterval(..., 10000); // 10s au lieu de 5s
```

---

## Support et Contact

Pour questions techniques sur As-Run Logs:
1. Consulter ce document
2. Vérifier `backend/logs/as-run/` pour erreurs
3. Tester l'API WebSocket avec un client simple

**Checklist de diagnostic:**
- [ ] Le serveur RTG Playout est démarré
- [ ] Le dossier `backend/logs/as-run/` existe
- [ ] Des fichiers `.log` sont créés quotidiennement
- [ ] Les événements PLAY apparaissent dans les logs
- [ ] Les rapports se génèrent sans erreur

---

**Version:** 1.0.0
**Date:** 2025-12-21
**Conformité:** ARCOM, Régies publicitaires
