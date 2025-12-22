/**
 * Template Controller - CasparCG HTML Template Management
 *
 * Manages loading, playing, and controlling CasparCG HTML templates
 * Supports multiple layers, presets, and real-time updates
 */

const { savePresets, loadPresets } = require('../utils/presetPersistence');

class TemplateController {
    constructor(casparClient, broadcast) {
        this.casparClient = casparClient;
        this.broadcast = broadcast;

        // Layer assignments for different template types
        this.LAYERS = {
            LOWER_THIRD: 20,
            BUG: 30,
            FULL_SCREEN: 40,
            TICKER: 50,
            CLOCK: 60,
            COUNTDOWN: 70,
            CUSTOM: 80
        };

        // Active templates tracking
        this.activeTemplates = new Map();

        // Presets storage
        this.presets = new Map();
    }

    /**
     * Initialize controller and load presets
     * Note: Call syncWithCaspar() separately after CasparCG is connected
     */
    async initialize() {
        try {
            const presets = await loadPresets();
            this.presets.clear();

            for (const preset of presets) {
                this.presets.set(preset.name, preset);
            }

            console.log(`[TEMPLATE] Controller initialized with ${this.presets.size} presets`);

            // Note: syncWithCaspar() should be called after CasparCG connection
            // is established, not here during initialization
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
                        // Extract template name from path (e.g., "Z:\nodal\templates/rtg-logo-clock/index.html" → "rtg-logo-clock")
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
                                syncedFromCaspar: true
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

    /**
     * Persist current presets to disk
     */
    async persistPresets() {
        try {
            const presets = this.getPresets();
            await savePresets(presets);
        } catch (error) {
            console.error('[TEMPLATE] Failed to persist presets:', error.message);
        }
    }

    /**
     * Load a template on specified layer
     */
    async loadTemplate(channel, layer, templateName, data = {}) {
        try {
            console.log(`[TEMPLATE] Loading ${templateName} on ${channel}-${layer}`);

            const dataJson = JSON.stringify(data);
            
            // Construct URL if baseUrl is set and template doesn't look like a file path
            let templatePath = templateName;
            if (this.baseUrl && !templateName.includes('/') && !templateName.includes('\\')) {
                // Assuming templates are in templates/ folder relative to baseUrl
                templatePath = `${this.baseUrl}/templates/${templateName}.html`;
            }

            // CG ADD command: CG channel-layer ADD flashLayer templateName playOnLoad dataString
            // flashLayer 1 is standard for HTML templates (0 caused issues on some servers)
            await this.casparClient.cgAdd(
                channel,
                layer,
                1, 
                templatePath,
                false, // playOnLoad
                dataJson
            );

            this.activeTemplates.set(`${channel}-${layer}`, {
                channel,
                layer,
                templateName,
                data,
                playing: false,
                loadedAt: new Date()
            });

            this.broadcast({
                type: 'TEMPLATE_LOADED',
                data: { channel, layer, templateName }
            });

            console.log(`[TEMPLATE] Loaded ${templateName}`);
            return { success: true };

        } catch (error) {
            console.error('[TEMPLATE] Load failed:', error.message);
            throw error;
        }
    }

    /**
     * Play a template (show it with animation)
     */
    async playTemplate(channel, layer) {
        try {
            console.log(`[TEMPLATE] Playing ${channel}-${layer}`);

            await this.casparClient.cgPlay(channel, layer, 1);

            const key = `${channel}-${layer}`;
            const template = this.activeTemplates.get(key);
            if (template) {
                template.playing = true;
                template.playedAt = new Date();
            }

            this.broadcast({
                type: 'TEMPLATE_PLAYING',
                data: { channel, layer }
            });

            return { success: true };

        } catch (error) {
            console.error('[TEMPLATE] Play failed:', error.message);
            throw error;
        }
    }

    /**
     * Stop a template (hide it with animation)
     */
    async stopTemplate(channel, layer) {
        try {
            console.log(`[TEMPLATE] Stopping ${channel}-${layer}`);

            await this.casparClient.cgStop(channel, layer, 1);

            const key = `${channel}-${layer}`;
            const template = this.activeTemplates.get(key);
            if (template) {
                template.playing = false;
            }

            this.broadcast({
                type: 'TEMPLATE_STOPPED',
                data: { channel, layer }
            });

            return { success: true };

        } catch (error) {
            console.error('[TEMPLATE] Stop failed:', error.message);
            throw error;
        }
    }

    /**
     * Update template data without replaying
     */
    async updateTemplate(channel, layer, data) {
        try {
            console.log(`[TEMPLATE] Updating ${channel}-${layer}`);

            const dataJson = JSON.stringify(data);

            await this.casparClient.cgUpdate(channel, layer, 1, dataJson);

            const key = `${channel}-${layer}`;
            const template = this.activeTemplates.get(key);
            if (template) {
                template.data = { ...template.data, ...data };
            }

            this.broadcast({
                type: 'TEMPLATE_UPDATED',
                data: { channel, layer, data }
            });

            return { success: true };

        } catch (error) {
            console.error('[TEMPLATE] Update failed:', error.message);
            throw error;
        }
    }

    /**
     * Remove template from layer
     */
    async removeTemplate(channel, layer) {
        try {
            console.log(`[TEMPLATE] Removing ${channel}-${layer}`);

            await this.casparClient.cgClear(channel, layer);

            const key = `${channel}-${layer}`;
            this.activeTemplates.delete(key);

            this.broadcast({
                type: 'TEMPLATE_REMOVED',
                data: { channel, layer }
            });

            return { success: true };

        } catch (error) {
            console.error('[TEMPLATE] Remove failed:', error.message);
            throw error;
        }
    }

    /**
     * Load and play in one action
     */
    async loadAndPlay(channel, layer, templateName, data = {}) {
        await this.loadTemplate(channel, layer, templateName, data);
        await this.playTemplate(channel, layer);
        return { success: true };
    }

    /**
     * Get list of active templates
     */
    getActiveTemplates() {
        const templates = [];
        for (const [key, template] of this.activeTemplates) {
            templates.push({
                key,
                ...template
            });
        }
        return templates;
    }

    /**
     * Save a preset (template + data combination)
     */
    savePreset(name, channel, layer, templateName, data) {
        this.presets.set(name, {
            name,
            channel,
            layer,
            templateName,
            data,
            savedAt: new Date()
        });

        // Persist to disk
        this.persistPresets();

        // Broadcast full list
        this.broadcast({
            type: 'PRESET_LIST',
            data: { presets: this.getPresets() }
        });

        console.log(`[TEMPLATE] Preset saved: ${name}`);
        return { success: true };
    }

    /**
     * Load a preset
     */
    async loadPreset(name, play = true) {
        const preset = this.presets.get(name);

        if (!preset) {
            throw new Error(`Preset "${name}" not found`);
        }

        const { channel, layer, templateName, data } = preset;

        if (play) {
            await this.loadAndPlay(channel, layer, templateName, data);
        } else {
            await this.loadTemplate(channel, layer, templateName, data);
        }

        console.log(`[TEMPLATE] Preset loaded: ${name}`);
        return { success: true, preset };
    }

    /**
     * Get all presets
     */
    getPresets() {
        const presets = [];
        for (const [name, preset] of this.presets) {
            presets.push(preset);
        }
        return presets;
    }

    /**
     * Delete a preset
     */
    async deletePreset(name) {
        if (this.presets.delete(name)) {
            // Persist changes to disk
            await this.persistPresets();

            this.broadcast({
                type: 'PRESET_DELETED',
                data: { name }
            });
            return { success: true };
        }
        throw new Error(`Preset "${name}" not found`);
    }

    /**
     * Import presets from JSON
     */
    async importPresets(newPresets, overwrite = false) {
        let importedCount = 0;
        
        for (const preset of newPresets) {
            if (!preset.name || !preset.templateName) continue;
            
            if (overwrite || !this.presets.has(preset.name)) {
                this.presets.set(preset.name, {
                    ...preset,
                    savedAt: new Date()
                });
                importedCount++;
            }
        }

        if (importedCount > 0) {
            await this.persistPresets();
            this.broadcast({
                type: 'PRESET_LIST',
                data: { presets: this.getPresets() }
            });
        }

        return { success: true, count: importedCount };
    }

    /**
     * Clear all templates from channel
     */
    async clearChannel(channel) {
        try {
            console.log(`[TEMPLATE] Clearing all templates on channel ${channel}`);

            // Remove tracked templates for this channel
            for (const [key, template] of this.activeTemplates) {
                if (template.channel === channel) {
                    await this.removeTemplate(channel, template.layer);
                }
            }

            return { success: true };

        } catch (error) {
            console.error('[TEMPLATE] Clear channel failed:', error.message);
            throw error;
        }
    }

    /**
     * Get template info
     */
    getTemplateInfo(channel, layer) {
        const key = `${channel}-${layer}`;
        return this.activeTemplates.get(key) || null;
    }

    /**
     * Check if template is playing
     */
    isPlaying(channel, layer) {
        const template = this.getTemplateInfo(channel, layer);
        return template ? template.playing : false;
    }
}

module.exports = TemplateController;
