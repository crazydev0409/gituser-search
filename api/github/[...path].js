const GITHUB_API_BASE_URL = 'https://api.github.com';

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ message: 'Method not allowed' });
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        return res.status(500).json({
            message: 'Missing GITHUB_TOKEN environment variable on the server.',
        });
    }

    const path = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(req.query)) {
        if (key === 'path') continue;
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
            if (item !== undefined) query.append(key, item);
        }
    }

    const githubUrl = `${GITHUB_API_BASE_URL}/${path || ''}${query.size ? `?${query}` : ''}`;

    try {
        const githubResponse = await fetch(githubUrl, {
            headers: {
                Accept: req.headers.accept || 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'User-Agent': 'gituser-search',
                'X-GitHub-Api-Version': '2022-11-28',
            },
        });

        for (const header of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
            const value = githubResponse.headers.get(header);
            if (value) res.setHeader(header, value);
        }

        const text = await githubResponse.text();
        res.status(githubResponse.status);

        if (!text) return res.end();

        res.setHeader('Content-Type', githubResponse.headers.get('content-type') || 'application/json');
        return res.send(text);
    } catch (error) {
        return res.status(502).json({
            message: 'GitHub request failed.',
        });
    }
};
