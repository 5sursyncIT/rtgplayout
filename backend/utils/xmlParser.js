/**
 * XML Playlist Parser - Parse CasparCG XML playlists
 */

const fs = require('fs').promises;
const xml2js = require('xml2js');
const path = require('path');

/**
 * Parse CasparCG XML playlist file
 * 
 * @param {string} xmlPath - Path to XML file
 * @returns {Promise<Object>} - Parsed playlist data
 */
async function parseXMLPlaylist(xmlPath) {
    try {
        console.log(`[XML] Parsing playlist: ${xmlPath}`);

        // Read XML file
        const xmlContent = await fs.readFile(xmlPath, 'utf8');

        // Parse XML
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(xmlContent);

        // Extract playlist items
        const items = [];

        if (result.playlist && result.playlist.item) {
            const xmlItems = Array.isArray(result.playlist.item)
                ? result.playlist.item
                : [result.playlist.item];

            for (const item of xmlItems) {
                items.push({
                    name: item.name ? item.name[0] : 'Unknown',
                    file: item.file ? item.file[0] : '',
                    durationSeconds: item.duration ? parseInt(item.duration[0]) : 0
                });
            }
        }

        console.log(`[XML] Parsed ${items.length} items from playlist`);
        return {
            items,
            source: path.basename(xmlPath)
        };
    } catch (error) {
        console.error('[XML] Error parsing playlist:', error.message);
        throw new Error(`Failed to parse XML playlist: ${error.message}`);
    }
}

/**
 * List available XML playlists in directory
 * 
 * @param {string} directory - Directory to scan
 * @returns {Promise<Array>} - List of XML files
 */
async function listXMLPlaylists(directory) {
    try {
        const files = await fs.readdir(directory);
        const xmlFiles = files.filter(file => path.extname(file).toLowerCase() === '.xml');

        console.log(`[XML] Found ${xmlFiles.length} XML playlist(s) in ${directory}`);
        return xmlFiles.map(file => ({
            name: path.basename(file, '.xml'),
            path: path.join(directory, file)
        }));
    } catch (error) {
        console.error('[XML] Error listing playlists:', error.message);
        return [];
    }
}

module.exports = {
    parseXMLPlaylist,
    listXMLPlaylists
};
