export function safeContactUrl(value) {
    try {
        const url = new URL(value);
        return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
}

const platforms = [
    ['Discord', /^(discord\.gg|discord(?:app)?\.com)$/],
    ['Telegram', /^(t\.me|telegram\.me|telegram\.dog)$/],
    ['WhatsApp', /^(wa\.me|(?:api|web)\.whatsapp\.com)$/],
    ['Signal', /^signal\.me$/],
    ['LinkedIn', /^linkedin\.com$/],
    ['X / Twitter', /^(twitter|x)\.com$/],
    ['Facebook', /^(facebook\.com|fb\.me|m\.me)$/],
    ['Instagram', /^instagram\.com$/],
    ['YouTube', /^(youtube\.com|youtu\.be)$/],
    ['Calendly', /^calendly\.com$/],
    ['Matrix', /^matrix\.to$/],
    ['Bluesky', /^bsky\.app$/],
    ['Reddit', /^reddit\.com$/],
    ['Twitch', /^twitch\.tv$/],
];

export function extractContacts({ profile = {}, socialAccounts = [], readme = '' } = {}) {
    const contacts = [];
    const profileSource = `https://github.com/${encodeURIComponent(profile.login || '')}`;
    const add = (type, value, url, source) => {
        if (!value || (type === 'Email' && /noreply/i.test(value))) return;
        const key = `${type}:${url || value}`.replace(/\/$/, '').toLowerCase();
        const existing = contacts.find((c) => c.key === key);
        if (existing) {
            if (!existing.sources.includes(source)) existing.sources.push(source);
        } else contacts.push({ key, type, value, url: safeContactUrl(url), sources: [source] });
    };
    const link = (raw, source, fallback = '') => {
        const safe = safeContactUrl(raw);
        if (!safe) return;
        const url = new URL(safe);
        if (url.protocol === 'mailto:') {
            url.pathname.split(/[,;]/).forEach((email) => add('Email', email, `mailto:${email}`, source));
            return;
        }
        if (url.protocol === 'tel:') {
            add('Phone', url.pathname, safe, source);
            return;
        }
        const host = url.hostname.replace(/^www\./, '');
        const type = platforms.find(([, pattern]) => pattern.test(host))?.[0] || fallback;
        if (type) add(type, safe.replace(/\/$/, ''), safe, source);
    };
    const scan = (text, source) => {
        if (typeof text !== 'string') return;
        const decoded = text.replace(/&amp;/g, '&').replace(/&#64;|&commat;/g, '@')
            .replace(/\*\*/g, '')
            .replace(/\s*\[at\]\s*/gi, '@').replace(/\s*\[dot\]\s*/gi, '.');
        for (const match of decoded.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
            add('Email', match[0], `mailto:${match[0]}`, source);
        }
        for (const match of decoded.matchAll(/(?:https?:\/\/|mailto:|tel:)[^\s<>"'\])]+/gi)) {
            link(match[0].replace(/[.,;!]+$/, ''), source);
        }
        for (const match of decoded.matchAll(/\b(?:t\.me|discord\.gg|wa\.me)\/[A-Za-z0-9_+./-]+/gi)) {
            link(`https://${match[0]}`, source);
        }
        // Require a contact label so dates, repository IDs and statistics aren't phone numbers.
        for (const match of decoded.matchAll(/\b(?:phone|mobile|tel(?:ephone)?|whatsapp)\s*[:：=]\s*(\+?\d[\d ().-]{5,}\d)/gi)) {
            const value = match[1].replace(/[^\d+]/g, '');
            if (/^\+?\d{7,15}$/.test(value)) add('Phone', value, `tel:${value}`, source);
        }
        for (const match of decoded.matchAll(/\b(discord|telegram)(?:\s+(?:id|username|handle))?\s*[:：=]\s*`?@?([A-Za-z0-9_.]+(?:#\d{4})?)/gi)) {
            const value = match[2];
            if (/^(https?|www)$/i.test(value)) continue;
            const type = match[1].toLowerCase() === 'discord' ? 'Discord' : 'Telegram';
            add(type, value, type === 'Telegram' && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value) ? `https://t.me/${value}` : '', source);
        }
        for (const match of decoded.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi)) {
            if (/contact|reach|website|portfolio|book|schedule|mastodon/i.test(match[1])) link(match[2], source, 'Contact link');
        }
    };
    if (profile.email) add('Email', profile.email, `mailto:${profile.email}`, profileSource);
    scan(profile.bio, profileSource);
    if (profile.blog) link(/^[\w+.-]+:/.test(profile.blog) ? profile.blog : `https://${profile.blog}`, profileSource, 'Website');
    if (profile.twitter_username) link(`https://twitter.com/${profile.twitter_username}`, profileSource);
    for (const account of socialAccounts) link(account.url, profileSource, account.provider || 'Social');
    scan(readme, `${profileSource}/${encodeURIComponent(profile.login || '')}#readme`);
    return contacts;
}

export async function discoverContacts(profile, get) {
    const username = encodeURIComponent(profile.login);
    const results = await Promise.allSettled([
        get(`/users/${username}/social_accounts`, { params: { per_page: 100 } }, 1),
        get(`/repos/${username}/${username}/readme`, { headers: { Accept: 'application/vnd.github.raw+json' } }, 1),
    ]);
    const unavailable = results.some((r) => r.status === 'rejected' && r.reason?.response?.status !== 404);
    return {
        contacts: extractContacts({
            profile,
            socialAccounts: results[0].status === 'fulfilled' && Array.isArray(results[0].value.data) ? results[0].value.data : [],
            readme: results[1].status === 'fulfilled' ? results[1].value.data : '',
        }),
        contactLookupIncomplete: unavailable,
    };
}
