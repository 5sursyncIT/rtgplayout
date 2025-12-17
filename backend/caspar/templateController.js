/**
 * Template Controller - CasparCG HTML Template Management
 *
 * Manages loading, playing, and controlling CasparCG HTML templates
 * Supports multiple layers, presets, and real-time updates
 */

class TemplateController {
    constructor(casparClient, broadcast) {
        this.casparClient = casparClient;
        this.broadcast = broadcast;

        // Layer assignments for different template types
        this.LAYERS = {
            LOWER_THIRD: 10,
            BUG: 20,
            FULL_SCREEN: 30,
            TICKER: 40,
            CLOCK: 50,
            COUNTDOWN: 60,
            CUSTOM: 70
        };

        // Active templates tracking
        this.activeTemplates = new Map();

        // Presets storage
        this.presets = new Map();
    }

    /**
     * Load a template on specified layer
     */
    async loadTemplate(channel, layer, templateName, data = {}) {
        try {
            console.log(`[TEMPLATE] Loading ${templateName} on ${channel}-${layer}`);

            const dataJson = JSON.stringify(data);

            // CG ADD command: CG channel-layer ADD flashLayer templateName playOnLoad dataString
            await this.casparClient.cgAdd(
                channel,
                layer,
                0, // flashLayer (always 0 for HTML templates)
                templateName,
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

            await this.casparClient.cgPlay(channel, layer, 0);

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

            await this.casparClient.cgStop(channel, layer, 0);

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

            await this.casparClient.cgUpdate(channel, layer, 0, dataJson);

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

        this.broadcast({
            type: 'PRESET_SAVED',
            data: { name }
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
    deletePreset(name) {
        if (this.presets.delete(name)) {
            this.broadcast({
                type: 'PRESET_DELETED',
                data: { name }
            });
            return { success: true };
        }
        throw new Error(`Preset "${name}" not found`);
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
