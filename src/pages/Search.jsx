import { useEffect, useRef, useState } from 'react';
import Axios from '../utils/Axios';
import { toast, ToastContainer } from 'react-toastify';
import dayjs from 'dayjs';
import { Copy } from 'lucide-react';
import { ThrottledQueue } from '../utils/requestQueue';
import { loadCopiedUserId, loadStoredSearch, mergeStoredUsers, saveCopiedUserId, saveStoredSearch, clearCopiedUserId } from '../utils/browserStorage';

const isNoreply = (email) => {
    if (!email) return true;
    const e = email.toLowerCase();
    return e.includes('noreply') || e.includes('@users.noreply.github.com');
};

const normalizeLocation = (value) => value.trim().replace(/\s+/g, ' ');

const formatLocationQualifier = (rawLocation) => {
    const locationValue = normalizeLocation(rawLocation).toLowerCase();
    if (!locationValue) return null;
    return locationValue.includes(' ')
        ? `location:"${locationValue}"`
        : `location:${locationValue}`;
};

const matchesSearchLocation = (userLocation, rawLocation) => {
    const term = normalizeLocation(rawLocation).toLowerCase();
    if (!term) return true;
    return (userLocation || '').toLowerCase().includes(term);
};

const DEVELOPMENT_EXPERIENCE_QUALIFIER = 'repos:>0';

const REQUEST_TIMEOUT_MS = 30000;
const SEARCH_QUEUE_INTERVAL_MS = 2500;
const PROFILE_QUEUE_INTERVAL_MS = 3000;
const MAX_RATE_LIMIT_RETRIES = 15;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRateLimitError = (err) => {
    if (err?.response?.status !== 403) return false;
    const headers = err.response.headers || {};
    const remaining = headers['x-ratelimit-remaining'];
    if (remaining === '0') return true;
    const message = String(err.response.data?.message || '').toLowerCase();
    return message.includes('rate limit') || message.includes('secondary rate limit');
};

const getRateLimitWaitMs = (err) => {
    const headers = err?.response?.headers || {};
    const retryAfter = headers['retry-after'];
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (!Number.isNaN(seconds) && seconds > 0) {
            return (seconds + 1) * 1000;
        }
    }

    const reset = Number(headers['x-ratelimit-reset']);
    if (!Number.isNaN(reset) && reset > 0) {
        const wait = reset * 1000 - Date.now() + 1500;
        if (wait > 0) return Math.min(wait, 5 * 60 * 1000);
    }

    return 60000;
};

export default function Search() {
    const [users, setUsers] = useState([]);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [location, setLocation] = useState('Australia');
    const [language, setLanguage] = useState('');
    const [bioKeyword, setBioKeyword] = useState('');
    const [minFollowers, setMinFollowers] = useState(0);
    const [loading, setLoading] = useState(false);
    const [copiedUserId, setCopiedUserId] = useState(null);
    const [searchProgress, setSearchProgress] = useState({
        totalMonths: 0,
        completedMonths: 0,
        totalUsersFound: 0,
        newUsersDisplayed: 0,
    });

    const queueRef = useRef(null);
    const stopRequested = useRef(false);
    const rateLimitToastShown = useRef(false);

    useEffect(() => {
        const storedSearch = loadStoredSearch();
        setUsers(storedSearch.users);
        setCopiedUserId(loadCopiedUserId());

        if (storedSearch.params) {
            setLocation(storedSearch.params.location || 'Australia');
            setStartDate(storedSearch.params.startDate || '');
            setEndDate(storedSearch.params.endDate || '');
            setLanguage(storedSearch.params.language || '');
            setBioKeyword(storedSearch.params.bioKeyword || '');
            setMinFollowers(Number(storedSearch.params.minFollowers) || 0);
        }
    }, []);

    const updateStoredUsers = (updater) => {
        setUsers((prev) => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            if (!saveStoredSearch({
                params: getSearchParams('running'),
                users: next,
            })) {
                toast.error('Failed saving search results to browser storage.');
            }
            return next;
        });
    };

    async function safeAxiosGet(url, options = {}, retries = 3, rateLimitRetries = 0) {
        if (stopRequested.current) {
            throw new DOMException('Search stopped', 'AbortError');
        }

        try {
            return await Axios.get(url, {
                ...options,
                timeout: options.timeout ?? REQUEST_TIMEOUT_MS,
                headers: {
                    ...(options.headers || {}),
                },
            });
        } catch (err) {
            if (err?.name === 'AbortError') throw err;

            if (isRateLimitError(err) && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
                const waitMs = getRateLimitWaitMs(err);
                if (!rateLimitToastShown.current) {
                    const waitSeconds = Math.ceil(waitMs / 1000);
                    toast.info(`GitHub rate limit reached. Resuming in ${waitSeconds}s...`);
                    rateLimitToastShown.current = true;
                }
                await sleep(waitMs);
                rateLimitToastShown.current = false;
                return safeAxiosGet(url, options, retries, rateLimitRetries + 1);
            }

            const status = err?.response?.status;
            if (status >= 400 && status < 500) throw err;
            if (retries > 0) {
                await sleep(1500);
                return safeAxiosGet(url, options, retries - 1, rateLimitRetries);
            }
            throw err;
        }
    }

    async function searchUserCommitsGlobal(username) {
        try {
            const res = await safeAxiosGet('/search/commits', {
                params: { q: `author:${username}`, per_page: 30 },
                headers: { Accept: 'application/vnd.github.cloak-preview' },
            }, 1);

            const emails = new Set();
            for (const item of res.data.items || []) {
                const email = item.commit?.author?.email;
                if (email && !isNoreply(email)) emails.add(email);
            }
            return Array.from(emails);
        } catch {
            return [];
        }
    }

    async function getUserRepos(username) {
        const repos = [];
        let page = 1;
        while (true) {
            const { data } = await safeAxiosGet(`/users/${username}/repos`, {
                params: { per_page: 100, page },
            }, 1);
            if (!data?.length) break;
            repos.push(...data);
            if (data.length < 100 || page > 5) break;
            page++;
        }
        return repos;
    }

    async function getRepoCommits(owner, repo, author, maxPages = 2) {
        const emails = new Set();
        for (let page = 1; page <= maxPages; page++) {
            const { data } = await safeAxiosGet(`/repos/${owner}/${repo}/commits`, {
                params: { author, per_page: 100, page },
            }, 1);
            if (!data?.length) break;
            for (const c of data) {
                const gitEmail = c.commit?.author?.email;
                if (gitEmail && !isNoreply(gitEmail)) emails.add(gitEmail);
            }
        }
        return Array.from(emails);
    }

    async function collectEmailFromUser(username, knownProfileEmail) {
        if (knownProfileEmail && !isNoreply(knownProfileEmail)) {
            return knownProfileEmail;
        }

        if (knownProfileEmail === undefined) {
            const profile = await safeAxiosGet(`/users/${username}`, {}, 1);
            if (profile.data?.email && !isNoreply(profile.data.email)) {
                return profile.data.email;
            }
        }

        const global = await searchUserCommitsGlobal(username);
        if (global.length) return global[0];

        try {
            const repos = await getUserRepos(username);
            const repoEmailResults = await Promise.allSettled(
                repos.slice(0, 3).map((r) => getRepoCommits(r.owner.login, r.name, username, 1))
            );
            const repoEmails = repoEmailResults
                .filter((result) => result.status === 'fulfilled')
                .flatMap((result) => result.value);
            if (repoEmails.length) return repoEmails[0];
        } catch {
            return null;
        }
        return null;
    }

    async function hydrateUsersWithProfiles(searchUsers) {
        const detailQueue = new ThrottledQueue({ concurrency: 1, intervalMs: PROFILE_QUEUE_INTERVAL_MS });
        const profileResults = await Promise.allSettled(
            searchUsers.map((user) => detailQueue.enqueue(async () => {
                const { data } = await safeAxiosGet(`/users/${user.login}`, {}, 1);
                const email = await collectEmailFromUser(user.login, data?.email);
                return {
                    ...user,
                    name: data?.name || user.login,
                    email: email || '',
                    location: data?.location || user.location || '',
                    company: data?.company || '',
                    bio: data?.bio || '',
                    followers: data?.followers ?? user.followers ?? 0,
                    public_repos: data?.public_repos ?? 0,
                };
            }))
        );

        return profileResults.map((result, index) => {
            if (result.status === 'fulfilled') return result.value;
            console.warn('Failed loading profile for user:', searchUsers[index]?.login, result.reason);
            return {
                ...searchUsers[index],
                name: searchUsers[index]?.login || '',
                email: '',
                location: searchUsers[index]?.location || '',
            };
        });
    }

    const findEmail = async (user) => {
        try {
            const profileRes = await safeAxiosGet(`/users/${user.login}`, {}, 1);
            const email = profileRes.data?.email || (await collectEmailFromUser(user.login));

            if (email) {
                updateStoredUsers((prev) => prev.map((item) => item.id === user.id ? {
                    ...item,
                    name: profileRes.data?.name || user.login,
                    email,
                    location: profileRes.data?.location || '',
                } : item));
                toast.success('Email found!');
            } else {
                toast.warning('No email found for this user');
            }
        } catch {
            toast.error('Email lookup failed');
        }
    };

    const hideUser = async (user) => {
        updateStoredUsers((prev) => prev.filter((u) => u.id !== user.id));
        if (copiedUserId === user.id) {
            setCopiedUserId(null);
            clearCopiedUserId();
        }
        toast.success('User removed');
    };

    const copyEmail = async (user) => {
        try {
            await navigator.clipboard.writeText(user.email);
            setCopiedUserId(user.id);
            if (!saveCopiedUserId(user.id)) {
                toast.error('Failed saving copied highlight to browser storage.');
            }
            toast.success('Email copied!');
        } catch {
            toast.error('Failed to copy email');
        }
    };

    const makeLocalFetchedUsers = (newUsers) =>
        newUsers.map((user) => ({
            id: user.login,
            login: user.login ?? '',
            name: user.name || user.login || '',
            email: user.email || '',
            avatar_url: user.avatar_url,
            html_url: user.html_url,
            location: user.location ?? '',
            company: user.company || '',
            bio: user.bio || '',
            followers: user.followers ?? 0,
            public_repos: user.public_repos ?? 0,
        }));

    const getSearchParams = (status = 'running') => ({
        location: normalizeLocation(location),
        startDate,
        endDate,
        language: language.trim(),
        bioKeyword: bioKeyword.trim(),
        minFollowers,
        status,
        finalizedAt: new Date().toISOString(),
    });

    const handleSearch = async (e) => {
        e.preventDefault();

        if (!normalizeLocation(location)) {
            toast.error('Location is required');
            return;
        }
        if (!startDate || !endDate) {
            toast.error('Start and end dates are required');
            return;
        }
        if (dayjs(startDate).isAfter(dayjs(endDate))) {
            toast.error('Start date must be before end date');
            return;
        }

        setLoading(true);
        stopRequested.current = false;
        rateLimitToastShown.current = false;
        updateStoredUsers([]);

        const monthRanges = [];
        let current = dayjs(startDate);
        const end = dayjs(endDate);
        while (current.isBefore(end)) {
            const next = current.add(1, 'month');
            monthRanges.push({
                start: current.format('YYYY-MM-DD'),
                end: (next.isAfter(end) ? end : next).format('YYYY-MM-DD'),
            });
            current = next;
        }
        const searchQueries = monthRanges;

        setSearchProgress({
            totalMonths: searchQueries.length,
            completedMonths: 0,
            totalUsersFound: 0,
            newUsersDisplayed: 0,
        });

        const queue = new ThrottledQueue({ concurrency: 1, intervalMs: SEARCH_QUEUE_INTERVAL_MS });
        queueRef.current = queue;

        let completedMonths = 0;
        let totalUsersFound = 0;
        let newUsersDisplayed = 0;
        let finalizedUsers = [];
        const knownLogins = new Set();

        const updateSearchProgress = () => {
            setSearchProgress({
                totalMonths: searchQueries.length,
                completedMonths,
                totalUsersFound,
                newUsersDisplayed,
            });
        };

        const tasks = searchQueries.map((range) => {
            return queue.enqueue(async () => {
                if (stopRequested.current) return [];

                const qStr = [
                    formatLocationQualifier(location),
                    `type:User`,
                    `created:${range.start}..${range.end}`,
                    DEVELOPMENT_EXPERIENCE_QUALIFIER,
                    minFollowers > 0 ? `followers:>=${minFollowers}` : null,
                    language ? `language:${language}` : null,
                    bioKeyword ? `in:bio ${bioKeyword}` : null,
                ]
                    .filter(Boolean)
                    .join(' ');

                console.log('Searching:', qStr);
                const res = await safeAxiosGet('/search/users', {
                    params: { q: qStr, per_page: 100 },
                });
                console.log('Results:', res.data.total_count, 'items:', res.data.items?.length);

                return res.data.items || [];
            }).then(async (items) => {
                const newItems = items.filter((u) => !knownLogins.has(u.login));
                for (const u of newItems) knownLogins.add(u.login);

                if (newItems.length > 0) {
                    const hydratedUsers = await hydrateUsersWithProfiles(newItems);
                    const localUsers = makeLocalFetchedUsers(hydratedUsers)
                        .filter((user) => matchesSearchLocation(user.location, location));
                    if (!localUsers.length) return;

                    totalUsersFound += localUsers.length;
                    newUsersDisplayed += localUsers.length;
                    finalizedUsers = [
                        ...finalizedUsers,
                        ...localUsers,
                    ];

                    updateStoredUsers((prev) => [
                        ...prev,
                        ...localUsers,
                    ]);
                }
            }).catch((err) => {
                if (err?.name === 'AbortError' || stopRequested.current) {
                    return;
                }
                if (isRateLimitError(err)) {
                    console.warn('Search query exhausted rate-limit retries:', err);
                    return;
                }
                console.error('Search query failed:', err);
            }).finally(() => {
                completedMonths++;
                updateSearchProgress();
            });
        });

        await Promise.allSettled(tasks);
        const finalizedStatus = stopRequested.current ? 'stopped' : 'completed';
        const finalizedParams = getSearchParams(finalizedStatus);
        if (!saveStoredSearch({
            params: finalizedParams,
            users: finalizedUsers,
        })) {
            toast.error('Failed saving finalized search to browser storage.');
        }
        if (!mergeStoredUsers(finalizedUsers)) {
            toast.error('Failed merging new users into browser storage.');
        }
        setLoading(false);

        if (!stopRequested.current) {
            toast.success('Search completed!');
        } else {
            toast.info('Search stopped');
        }
    };

    const handleStop = () => {
        stopRequested.current = true;
        if (queueRef.current) queueRef.current.abort();
    };

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <form
                onSubmit={handleSearch}
                className="bg-white p-5 rounded-lg shadow-sm space-y-4"
            >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="flex flex-col">
                        <label className="text-xs font-medium text-gray-600 mb-1">Location</label>
                        <input
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            placeholder="e.g. Australia"
                            className="border border-gray-300 p-2 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            required
                            disabled={loading}
                        />
                    </div>
                    <div className="flex flex-col">
                        <label className="text-xs font-medium text-gray-600 mb-1">Start Date</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="border border-gray-300 p-2 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            required
                            disabled={loading}
                        />
                    </div>
                    <div className="flex flex-col">
                        <label className="text-xs font-medium text-gray-600 mb-1">End Date</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="border border-gray-300 p-2 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            required
                            disabled={loading}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="flex flex-col">
                        <label className="text-xs font-medium text-gray-600 mb-1">Language</label>
                        <input
                            value={language}
                            onChange={(e) => setLanguage(e.target.value)}
                            placeholder="e.g. JavaScript"
                            className="border border-gray-300 p-2 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            disabled={loading}
                        />
                    </div>
                    <div className="flex flex-col">
                        <label className="text-xs font-medium text-gray-600 mb-1">Bio Keyword</label>
                        <input
                            value={bioKeyword}
                            onChange={(e) => setBioKeyword(e.target.value)}
                            placeholder="e.g. developer"
                            className="border border-gray-300 p-2 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            disabled={loading}
                        />
                    </div>
                    <div className="flex flex-col">
                        <label className="text-xs font-medium text-gray-600 mb-1">Min Followers</label>
                        <input
                            type="number"
                            value={minFollowers}
                            onChange={(e) => setMinFollowers(Number(e.target.value))}
                            min="0"
                            className="border border-gray-300 p-2 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            disabled={loading}
                        />
                    </div>
                </div>

                <div className="flex gap-3">
                    <button
                        type="submit"
                        disabled={loading}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white py-2.5 rounded-md font-medium transition-colors"
                    >
                        {loading ? 'Searching...' : 'Search'}
                    </button>
                    {loading && (
                        <button
                            type="button"
                            onClick={handleStop}
                            className="px-6 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-md font-medium transition-colors"
                        >
                            Stop
                        </button>
                    )}
                </div>
            </form>

            {loading && searchProgress.totalMonths > 0 && (
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg mt-4">
                    <div className="flex justify-between text-sm text-blue-800 mb-2">
                        <span>Processing: {searchProgress.completedMonths}/{searchProgress.totalMonths} searches</span>
                        <span>Matched: {searchProgress.totalUsersFound} users</span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-2">
                        <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${(searchProgress.completedMonths / searchProgress.totalMonths) * 100}%` }}
                        />
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between mt-6 mb-3">
                <h2 className="text-lg font-semibold text-gray-800">Search Results</h2>
                <span className="text-sm text-gray-500">{users.length} users</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {users.map((user) => (
                    <div
                        className={`p-3 rounded-lg shadow-sm hover:shadow-md transition-colors ${
                            copiedUserId === user.id
                                ? 'bg-green-100 ring-2 ring-green-500'
                                : 'bg-white'
                        }`}
                        key={user.id}
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <a href={user.html_url} target="_blank" rel="noopener noreferrer">
                                <img src={user.avatar_url} className="w-10 h-10 rounded-full" alt={user.login} />
                            </a>
                            <div className="min-w-0">
                                <div className="text-sm font-semibold truncate">{user.name || user.login}</div>
                                <div className="text-xs text-gray-500 truncate">@{user.login}</div>
                                <div className="text-xs text-gray-500 truncate">{user.location || 'Unknown'}</div>
                                <div className="flex items-center gap-1">
                                    <div className="text-xs text-gray-700 truncate">{user.email || 'No email'}</div>
                                    {user.email && (
                                        <button
                                            type="button"
                                            onClick={() => copyEmail(user)}
                                            className="text-gray-400 hover:text-indigo-600 transition-colors flex-shrink-0"
                                            title="Copy email"
                                        >
                                            <Copy size={12} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-1.5">
                            <button
                                onClick={() => findEmail(user)}
                                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-1 rounded text-xs font-medium transition-colors"
                            >
                                Find Email
                            </button>
                            <button
                                onClick={() => hideUser(user)}
                                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-1 rounded text-xs font-medium transition-colors"
                            >
                                Hide
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <ToastContainer position="bottom-right" />
        </div>
    );
}
