export const SEA_ICE_VOLUME_DATA_URL = 'https://psc.apl.uw.edu/wordpress/wp-content/uploads/schweiger/ice_volume/PIOMAS.2sst.monthly.Current.v2.1.txt';
export const SEA_ICE_MAX_VOLUME = 40;
export const SEA_ICE_VOLUME_TICKS = [10, 20, 30, 40];

export const seaIceVolumeToSpiralValue = volume => volume * 3 / SEA_ICE_MAX_VOLUME;
export const spiralValueToSeaIceVolume = value => value * SEA_ICE_MAX_VOLUME / 3;

export function parseSeaIceVolumeData(text) {
    const entries = [];
    const years = new Set();
    for (const line of text.replace(/^\ufeff/, '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const columns = trimmed.split(/\s+/);
        if (columns.length !== 13 || !/^\d{4}$/.test(columns[0])
            || columns.slice(1).some(value => !/^-?\d+(?:\.\d+)?$/.test(value))) return [];
        const [year, ...volumes] = columns.map(Number);
        if (year < 1979 || years.has(year)
            || volumes.some(volume => volume !== -1 && (volume < 0 || volume > 100))) return [];
        years.add(year);
        const entry = { year, anomalies: [], displayValues: [], fractions: [] };
        volumes.forEach((volume, month) => {
            // PIOMAS marks unavailable months with -1; retain each later month's calendar position.
            if (volume === -1) return;
            entry.anomalies.push(seaIceVolumeToSpiralValue(volume));
            entry.displayValues.push(volume);
            entry.fractions.push(month / 12);
        });
        if (entry.anomalies.length) entries.push(entry);
    }
    return entries.sort((a, b) => a.year - b.year);
}
