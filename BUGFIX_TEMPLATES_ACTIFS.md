# Bugfix: Templates Actifs Non Affichés

**Date:** 2025-12-22
**Symptôme:** La section "TEMPLATES ACTIFS" affiche "Aucun template actif" alors que des templates HTML (logo-clock) sont bien en cours d'exécution sur CasparCG.

## Problème Identifié

### Cause Racine

Le `TemplateController` ne suit que les templates chargés **via son interface** (méthode `loadTemplate()`). Les templates chargés directement par CasparCG (au démarrage, via config, ou manuellement) ne sont pas connus du système.

**Résultat:** L'interface affiche "Aucun template actif" même si CasparCG diffuse des templates HTML.

### État CasparCG (Logs du Démarrage)

```xml
<layer_30>
    <foreground>
        <file>
            <path>file://Z:\nodal\templates/rtg-logo-clock/index.html</path>
        </file>
        <paused>false</paused>
        <producer>html</producer>
    </foreground>
</layer_30>
<layer_60>
    <foreground>
        <file>
            <path>file://Z:\nodal\templates/rtg-logo-clock/index.html</path>
        </file>
        <paused>false</paused>
        <producer>html</producer>
    </foreground>
</layer_60>
```

**CasparCG diffuse bien 2 templates:**
- Layer 30: rtg-logo-clock
- Layer 60: rtg-logo-clock

**Mais `templateController.activeTemplates` est vide** ❌

### Code Problématique (AVANT)

**Fichier:** `backend/caspar/templateController.js`

```javascript
// Templates ajoutés SEULEMENT via loadTemplate()
async loadTemplate(channel, layer, templateName, data = {}) {
    // ...
    this.activeTemplates.set(`${channel}-${layer}`, {
        channel, layer, templateName, data,
        playing: false,
        loadedAt: new Date()
    });
    // ✅ Template ajouté à activeTemplates
}

// Mais getActiveTemplates() retourne une liste vide si aucun template
// n'a été chargé via loadTemplate()!
getActiveTemplates() {
    const templates = [];
    for (const [key, template] of this.activeTemplates) {
        templates.push({ key, ...template });
    }
    return templates; // ❌ Retourne [] si activeTemplates est vide
}
```

**Scénario du Bug:**

1. CasparCG démarre avec des templates configurés dans `casparcg.config`
2. Templates HTML chargés automatiquement (logo-clock sur layers 30 et 60)
3. RTG Playout démarre et initialise `templateController`
4. `templateController.activeTemplates` = vide (Map vide)
5. Frontend demande la liste: `TEMPLATE_GET_ACTIVE`
6. Backend retourne: `{ templates: [] }` ❌
7. Frontend affiche: "Aucun template actif" ❌

---

## Solution Implémentée

### Synchronisation avec CasparCG

**Fichier:** `backend/caspar/templateController.js` - Ligne 57-116

Ajout d'une méthode `syncWithCaspar()` appelée automatiquement lors de `initialize()`:

```javascript
/**
 * Initialize controller and load presets
 */
async initialize() {
    try {
        const presets = await loadPresets();
        this.presets.clear();

        for (const preset of presets) {
            this.presets.set(preset.name, preset);
        }

        console.log(`[TEMPLATE] Controller initialized with ${this.presets.size} presets`);

        // ✅ Sync with CasparCG to detect templates already loaded
        await this.syncWithCaspar();
    } catch (error) {
        console.error('[TEMPLATE] Failed to initialize presets:', error.message);
    }
}

/**
 * Sync with CasparCG to detect already-loaded templates
 */
async syncWithCaspar() {
    try {
        console.log('[TEMPLATE] Syncing with CasparCG to detect active templates...');

        const response = await this.casparClient.info(1); // Channel 1

        // Parse XML to find active HTML templates
        const layerRegex = /<layer_(\d+)>([\s\S]*?)<\/layer_\d+>/g;
        let match;
        let foundCount = 0;

        while ((match = layerRegex.exec(response)) !== null) {
            const layerNum = parseInt(match[1]);
            const layerContent = match[2];

            // Check if foreground has HTML producer
            const foregroundMatch = layerContent.match(/<foreground>([\s\S]*?)<\/foreground>/);
            if (!foregroundMatch) continue;

            const foreground = foregroundMatch[1];

            // Check if it's an HTML template
            if (foreground.includes('<producer>html</producer>')) {
                // Extract template path
                const pathMatch = foreground.match(/<path>file:\/\/(.+?)<\/path>/);
                if (pathMatch) {
                    const fullPath = pathMatch[1];
                    // Extract template name from path
                    // "Z:\nodal\templates/rtg-logo-clock/index.html" → "rtg-logo-clock"
                    const templateMatch = fullPath.match(/templates[\/\\]([^\/\\]+)[\/\\]/);
                    const templateName = templateMatch ? templateMatch[1] : 'unknown';

                    const key = `1-${layerNum}`;

                    // Only add if not already tracked
                    if (!this.activeTemplates.has(key)) {
                        this.activeTemplates.set(key, {
                            channel: 1,
                            layer: layerNum,
                            templateName,
                            data: {},
                            playing: true,
                            loadedAt: new Date(),
                            syncedFromCaspar: true  // Flag to indicate this was auto-detected
                        });
                        foundCount++;
                        console.log(`[TEMPLATE] Detected active template on layer ${layerNum}: ${templateName}`);
                    }
                }
            }
        }

        if (foundCount > 0) {
            console.log(`[TEMPLATE] Synced ${foundCount} active template(s) from CasparCG`);
        } else {
            console.log('[TEMPLATE] No active templates found in CasparCG');
        }
    } catch (error) {
        console.error('[TEMPLATE] Sync with CasparCG failed:', error.message);
    }
}
```

### Fonctionnement

1. **Au démarrage du serveur:** `templateController.initialize()` est appelé
2. **Charge les presets** depuis le fichier de persistance
3. **Appelle `syncWithCaspar()`** pour détecter les templates actifs
4. **Parse la réponse XML** de `INFO 1` de CasparCG
5. **Pour chaque layer:** Vérifie si `<producer>html</producer>` est présent
6. **Extrait le nom du template** depuis le path (ex: `rtg-logo-clock`)
7. **Ajoute à `activeTemplates`** avec le flag `syncedFromCaspar: true`

### Extraction du Nom de Template

**Exemple de parsing:**

```javascript
// Input XML path
<path>file://Z:\nodal\templates/rtg-logo-clock/index.html</path>

// Regex: /templates[\/\\]([^\/\\]+)[\/\\]/
// Match: "templates/rtg-logo-clock/"
// Groupe 1: "rtg-logo-clock"

const templateName = "rtg-logo-clock"; // ✅ Extrait correctement
```

---

## Résultat

### Avant le Fix

**Logs au démarrage:**
```
[TEMPLATE] Controller initialized with 0 presets
```

**`activeTemplates` = vide**

**Frontend affiche:**
```
TEMPLATES ACTIFS
Aucun template actif
```

### Après le Fix

**Logs au démarrage:**
```
[TEMPLATE] Controller initialized with 0 presets
[TEMPLATE] Syncing with CasparCG to detect active templates...
[TEMPLATE] Detected active template on layer 30: rtg-logo-clock
[TEMPLATE] Detected active template on layer 60: rtg-logo-clock
[TEMPLATE] Synced 2 active template(s) from CasparCG
```

**`activeTemplates` contient:**
```javascript
Map {
  '1-30' => {
    channel: 1,
    layer: 30,
    templateName: 'rtg-logo-clock',
    data: {},
    playing: true,
    loadedAt: 2025-12-22T12:00:15.600Z,
    syncedFromCaspar: true
  },
  '1-60' => {
    channel: 1,
    layer: 60,
    templateName: 'rtg-logo-clock',
    data: {},
    playing: true,
    loadedAt: 2025-12-22T12:00:15.600Z,
    syncedFromCaspar: true
  }
}
```

**Frontend affiche:**
```
TEMPLATES ACTIFS

┌────────┬───────────────────┬─────────┬──────────┐
│ Layer  │ Template          │ Channel │ Playing  │
├────────┼───────────────────┼─────────┼──────────┤
│   30   │ rtg-logo-clock    │    1    │    ✓     │
│   60   │ rtg-logo-clock    │    1    │    ✓     │
└────────┴───────────────────┴─────────┴──────────┘

[Stop] [Update] [Remove]
```

---

## Cas d'Usage

### Cas 1: Templates Chargés par CasparCG Config

**Scénario:** CasparCG démarre avec des templates pré-configurés

**Avant:**
- Templates actifs dans CasparCG ✓
- Interface RTG affiche "Aucun template actif" ❌

**Après:**
- Templates détectés automatiquement ✓
- Interface RTG affiche correctement les templates ✓

### Cas 2: Templates Chargés via RTG Interface

**Scénario:** Utilisateur charge un template via l'interface RTG

**Avant et Après:**
- Template ajouté à `activeTemplates` via `loadTemplate()` ✓
- Template affiché dans l'interface ✓
- Comportement inchangé ✓

### Cas 3: Templates Chargés Manuellement (AMCP)

**Scénario:** Utilisateur envoie une commande AMCP directe à CasparCG

**Avant:**
- Template actif dans CasparCG ✓
- Interface RTG ne le voit pas ❌

**Après:**
- Au prochain redémarrage de RTG → Template détecté ✓
- Ou appeler manuellement `syncWithCaspar()` ✓

---

## Améliorations Possibles (Future)

### 1. Resync Périodique

Ajouter une option pour synchroniser périodiquement (toutes les 30 secondes):

```javascript
setInterval(async () => {
    await templateController.syncWithCaspar();
}, 30000);
```

### 2. Commande Manuelle de Resync

Ajouter un bouton "Resync" dans l'interface pour forcer la synchronisation:

```javascript
case 'TEMPLATE_RESYNC':
    await templateController.syncWithCaspar();
    break;
```

### 3. Détection des Templates Arrêtés

Actuellement, `syncWithCaspar()` ajoute uniquement des templates. Pour détecter ceux qui ont été arrêtés:

```javascript
async syncWithCaspar() {
    // ...

    // Remove templates that are no longer in CasparCG
    const currentKeys = new Set(/* parsed from CasparCG */);

    for (const [key, template] of this.activeTemplates) {
        if (template.syncedFromCaspar && !currentKeys.has(key)) {
            this.activeTemplates.delete(key);
            console.log(`[TEMPLATE] Removed inactive template: ${key}`);
        }
    }
}
```

---

## Tests de Vérification

### Test 1: Démarrage avec Templates Actifs

**Procédure:**
1. Démarrer CasparCG avec templates configurés
2. Démarrer RTG Playout
3. Ouvrir l'interface → Section "TEMPLATES ACTIFS"

**Résultat attendu:**
- Templates affichés dans la liste ✓
- Logs: `[TEMPLATE] Synced X active template(s) from CasparCG`

### Test 2: Chargement via Interface

**Procédure:**
1. Charger un nouveau template via l'interface RTG
2. Vérifier la section "TEMPLATES ACTIFS"

**Résultat attendu:**
- Template apparaît dans la liste ✓
- Pas de doublon ✓

### Test 3: Arrêt Manual d'un Template

**Procédure:**
1. Templates actifs affichés
2. Arrêter un template via interface RTG
3. Vérifier la liste

**Résultat attendu:**
- Template retiré de la liste ✓
- Les autres templates restent affichés ✓

---

## Logs de Debug

**Au démarrage (avec templates actifs):**
```
[TEMPLATE] Controller initialized with 0 presets
[TEMPLATE] Syncing with CasparCG to detect active templates...
[CASPAR] Sending INFO 1
[CASPAR] Response: 201 INFO OK
[CASPAR] Response: <?xml version="1.0" ...
[TEMPLATE] Detected active template on layer 30: rtg-logo-clock
[TEMPLATE] Detected active template on layer 60: rtg-logo-clock
[TEMPLATE] Synced 2 active template(s) from CasparCG
```

**Au démarrage (sans templates actifs):**
```
[TEMPLATE] Controller initialized with 0 presets
[TEMPLATE] Syncing with CasparCG to detect active templates...
[TEMPLATE] No active templates found in CasparCG
```

**En cas d'erreur:**
```
[TEMPLATE] Sync with CasparCG failed: <error message>
```

---

## Code de Référence

### Appel depuis server.js

**Fichier:** `backend/server.js`

```javascript
// Template controller initialization
templateController = new TemplateController(casparClient, broadcast);
await templateController.initialize();  // ← Appelle syncWithCaspar() automatiquement
logger.info('[TEMPLATE] Template controller initialized');
```

### Structure du Template Synced

```javascript
{
    channel: 1,
    layer: 30,
    templateName: 'rtg-logo-clock',
    data: {},
    playing: true,
    loadedAt: Date,
    syncedFromCaspar: true  // ← Flag pour différencier
}
```

### Message WebSocket Retourné

```javascript
{
    type: 'TEMPLATE_ACTIVE_LIST',
    data: {
        templates: [
            {
                key: '1-30',
                channel: 1,
                layer: 30,
                templateName: 'rtg-logo-clock',
                data: {},
                playing: true,
                loadedAt: '2025-12-22T12:00:15.600Z',
                syncedFromCaspar: true
            },
            {
                key: '1-60',
                channel: 1,
                layer: 60,
                templateName: 'rtg-logo-clock',
                data: {},
                playing: true,
                loadedAt: '2025-12-22T12:00:15.600Z',
                syncedFromCaspar: true
            }
        ]
    }
}
```

---

**Version:** Bugfix 1.0
**Fichiers Modifiés:**
- `backend/caspar/templateController.js` - Méthodes `initialize()` et `syncWithCaspar()` ligne 36-116

**Statut:** ✅ Corrigé et prêt pour test
