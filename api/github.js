const GITHUB_API_BASE_URL = 'https://api.github.com';

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ message: 'Method not allowed' });
    }

    const token = process.env.GITHUB_TOKEN?.trim();
    if (!token) {
        return res.status(500).json({
            message: 'Missing GITHUB_TOKEN environment variable on the server.',
        });
    }

    const githubPath = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path;
    if (!githubPath || !githubPath.startsWith('/')) {
        return res.status(400).json({ message: 'Missing GitHub API path.' });
    }

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
        if (key === 'path') continue;
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
            if (item !== undefined) query.append(key, item);
        }
    }

    const githubUrl = `${GITHUB_API_BASE_URL}${githubPath}${query.size ? `?${query}` : ''}`;

    try {
        const githubResponse = await fetch(githubUrl, {
            headers: {
                Accept: req.headers.accept || 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'User-Agent': 'gituser-search',
                'X-GitHub-Api-Version': '2022-11-28',
            },
        });

        for (const header of [
            'x-ratelimit-limit',
            'x-ratelimit-remaining',
            'x-ratelimit-reset',
            'x-ratelimit-used',
            'x-ratelimit-resource',
            'retry-after',
        ]) {
            const value = githubResponse.headers.get(header);
            if (value) res.setHeader(header, value);
        }

        const text = await githubResponse.text();
        const contentType = githubResponse.headers.get('content-type') || 'application/json';

        if (githubResponse.status === 401) {
            let githubMessage = 'Unauthorized';
            try {
                githubMessage = JSON.parse(text).message || githubMessage;
            } catch {
                if (text) githubMessage = text;
            }

            return res.status(401).json({
                message: 'GitHub rejected the server token. Create a new GitHub token, update GITHUB_TOKEN in Vercel, and redeploy.',
                githubMessage,
            });
        }

        res.status(githubResponse.status);

        if (!text) return res.end();

        res.setHeader('Content-Type', contentType);
        return res.send(text);
    } catch (error) {
        return res.status(502).json({
            message: 'GitHub request failed.',
        });
    }
};
