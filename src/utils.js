const HTML_ENTITIES = {
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' ',
};

export function sanitizeText(value) {
    if (value === null || value === undefined) return null;

    const normalized = String(value)
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
        .replace(/&([a-z]+);/gi, (entity, name) => HTML_ENTITIES[name.toLowerCase()] ?? entity)
        .replace(/[\u200b-\u200d\ufeff]/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return normalized || null;
}

export function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;

    const normalized = String(value)
        .replace(/,/g, '')
        .replace(/[^0-9.-]/g, '');

    if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') return null;

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

export function toInteger(value) {
    const parsed = toNumber(value);
    return parsed === null ? null : Math.trunc(parsed);
}

export function parseCompactNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;

    const match = String(value)
        .replace(/,/g, '')
        .match(/(\d+(?:\.\d+)?)\s*([kmb])?/i);
    if (!match) return null;

    const amount = Number(match[1]);
    const unit = (match[2] || '').toLowerCase();
    const multiplier = unit === 'k' ? 1e3 : unit === 'm' ? 1e6 : unit === 'b' ? 1e9 : 1;

    if (!Number.isFinite(amount)) return null;
    return Math.round(amount * multiplier);
}

export function toBoolean(value, fallback = true) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;

    const normalized = String(value).trim().toLowerCase();
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;

    return fallback;
}

export function normalizeUrl(value, base = 'https://www.daraz.pk') {
    const text = sanitizeText(value);
    if (!text) return null;

    try {
        if (text.startsWith('//')) return new URL(`https:${text}`).href;
        const url = new URL(text, base);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url.href;
    } catch {
        return null;
    }
}

export function parseTraceMap(value) {
    const text = sanitizeText(value);
    if (!text) return {};

    return text
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .reduce((accumulator, entry) => {
            const separatorIndex = entry.indexOf(':');
            if (separatorIndex === -1) return accumulator;

            const key = entry.slice(0, separatorIndex).trim();
            const rawValue = entry.slice(separatorIndex + 1).trim();
            if (key) accumulator[key] = rawValue;

            return accumulator;
        }, {});
}

export function stripNullValues(value) {
    if (value === null || value === undefined) return undefined;

    if (Array.isArray(value)) {
        return value.map(stripNullValues).filter((item) => item !== undefined);
    }

    if (typeof value === 'object') {
        const cleaned = {};

        for (const [key, nestedValue] of Object.entries(value)) {
            const normalized = stripNullValues(nestedValue);
            if (normalized !== undefined) cleaned[key] = normalized;
        }

        return cleaned;
    }

    return value;
}

export function uniqueStrings(values) {
    const result = [];

    for (const value of values) {
        const normalized = sanitizeText(value);
        if (normalized && !result.includes(normalized)) result.push(normalized);
    }

    return result;
}

export function redactCredentials(value) {
    return String(value ?? '').replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//***:***@');
}

export function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
