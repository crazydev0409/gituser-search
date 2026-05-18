import { useEffect, useRef, useState } from 'react';
import Axios from '../utils/Axios';
import { toast, ToastContainer } from 'react-toastify';
import dayjs from 'dayjs';
import { Copy } from 'lucide-react';
import { ThrottledQueue } from '../utils/requestQueue';
import { loadStoredSearch, mergeStoredUsers, saveStoredSearch } from '../utils/browserStorage';

const DISCORD_PATTERNS = [
    /\bdiscord(?:\s*(?::|=|-|is|@|handle|user(?:name)?))\s*(@?[a-z0-9_.]{2,32}#\d{4}|@?[a-z0-9_.]{2,32})\b/i,
    /\b([a-z0-9_.]{2,32}#\d{4})\b/i,
    /\b((?:https?:\/\/)?(?:www\.)?discord(?:app)?\.com\/users\/\d{17,20})\b/i,
    /\b((?:https?:\/\/)?(?:www\.)?discord(?:app)?\.com\/invite\/[a-z0-9-]+)\b/i,
    /\b((?:https?:\/\/)?(?:www\.)?discord\.gg\/[a-z0-9-]+)\b/i,
    /\b((?:https?:\/\/)?(?:www\.)?(?:dsc\.gg|discord\.me|discord\.io)\/[a-z0-9-]+)\b/i,
];

const TELEGRAM_PATTERNS = [
    /\btelegram(?:\s*(?::|=|-|is|@|handle|user(?:name)?))\s*(@?[a-z0-9_]{5,32})\b/i,
    /\btg(?:\s*(?::|=|-|is|@|handle|user(?:name)?))\s*(@?[a-z0-9_]{5,32})\b/i,
    /\b((?:https?:\/\/)?(?:www\.)?t\.me\/[a-z0-9_]{5,32})\b/i,
    /\b((?:https?:\/\/)?(?:www\.)?telegram\.me\/[a-z0-9_]{5,32})\b/i,
    /\b((?:https?:\/\/)?(?:www\.)?telegram\.dog\/[a-z0-9_]{5,32})\b/i,
];

const PHONE_PATTERNS = [
    /\b(?:phone|mobile|cell|tel|telephone|whatsapp|wa)(?:\s*(?::|=|-|is))\s*((?:\+|00)?\d[\d\s().-]{6,}\d)\b/i,
    /\b((?:\+|00)\d[\d\s().-]{6,}\d)\b/,
];

const cleanContact = (contact) => contact.trim().replace(/[),.;]+$/, '');
const cleanPhoneNumber = (phone) => cleanContact(phone).replace(/\s+/g, ' ');

const isLikelyPhoneNumber = (phone) => {
    const digits = phone.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
};

const extractContact = (profile, patterns) => {
    const fields = [profile?.bio, profile?.blog, profile?.company].filter(Boolean);

    for (const field of fields) {
        for (const pattern of patterns) {
            const match = String(field).match(pattern);
            if (match?.[1]) return cleanContact(match[1]);
        }
    }

    return '';
};

const extractPhoneNumber = (profile) => {
    const fields = [profile?.bio, profile?.blog, profile?.company].filter(Boolean);

    for (const field of fields) {
        for (const pattern of PHONE_PATTERNS) {
            const match = String(field).match(pattern);
            if (match?.[1]) {
                const phone = cleanPhoneNumber(match[1]);
                if (isLikelyPhoneNumber(phone)) return phone;
            }
        }
    }

    return '';
};

const extractCommunicationContacts = (profile) => ({
    discord: extractContact(profile, DISCORD_PATTERNS),
    telegram: extractContact(profile, TELEGRAM_PATTERNS),
    phone: extractPhoneNumber(profile),
});

const hasContact = (user) => Boolean(user?.discord?.trim() || user?.telegram?.trim() || user?.phone?.trim());
const CONTACT_SEARCH_TERMS = [
    'discord',
    'discord.gg',
    'discord.com',
    'discordapp.com',
    'dsc.gg',
    'telegram',
    't.me',
    'telegram.me',
    'telegram.dog',
    'phone',
    'mobile',
    'whatsapp',
    'telephone',
];

const REQUEST_TIMEOUT_MS = 30000;
const secondaryLookupOptions = { stopOnRateLimit: false };

export default function Search() {
    const [users, setUsers] = useState([]);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [location, setLocation] = useState('Australia');
    const [language, setLanguage] = useState('');
    const [bioKeyword, setBioKeyword] = useState('');
    const [minFollowers, setMinFollowers] = useState(0);
    const [loading, setLoading] = useState(false);
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

    async function safeAxiosGet(url, options = {}, retries = 3, behavior = { stopOnRateLimit: true }) {
        try {
            return await Axios.get(url, {
                ...options,
                timeout: options.timeout ?? REQUEST_TIMEOUT_MS,
                headers: {
                    ...(options.headers || {}),
                },
            });
        } catch (err) {
            if (err?.response?.status === 403) {
                if (behavior.stopOnRateLimit) {
                    if (!rateLimitToastShown.current) {
                        toast.error('GitHub rate limit hit! Pausing...');
                        rateLimitToastShown.current = true;
                    }
                    stopRequested.current = true;
                    if (queueRef.current) queueRef.current.abort();
                }
                throw err;
            }
            const status = err?.response?.status;
            if (status >= 400 && status < 500) throw err;
            if (retries > 0) return safeAxiosGet(url, options, retries - 1, behavior);
            throw err;
        }
    }

    async function hydrateUsersWithProfiles(searchUsers) {
        const detailQueue = new ThrottledQueue({ concurrency: 1, intervalMs: 2500 });
        const profileResults = await Promise.allSettled(
            searchUsers.map((user) => detailQueue.enqueue(async () => {
                const { data } = await safeAxiosGet(`/users/${user.login}`, {}, 1, secondaryLookupOptions);
                const contacts = extractCommunicationContacts(data);
                return {
                    ...user,
                    name: data?.name || user.login,
                    ...contacts,
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
                discord: '',
                telegram: '',
                phone: '',
                location: searchUsers[index]?.location || '',
            };
        });
    }

    const findContacts = async (user) => {
        try {
            const profileRes = await safeAxiosGet(`/users/${user.login}`, {}, 1, secondaryLookupOptions);
            const contacts = extractCommunicationContacts(profileRes.data);

            if (hasContact(contacts)) {
                updateStoredUsers((prev) => prev.map((item) => item.id === user.id ? {
                    ...item,
                    name: profileRes.data?.name || user.login,
                    ...contacts,
                    location: profileRes.data?.location || '',
                    company: profileRes.data?.company || '',
                    bio: profileRes.data?.bio || '',
                } : item));
                toast.success('Communication contact found!');
            } else {
                toast.warning('No Discord, Telegram, or phone contact found for this user');
            }
        } catch {
            toast.error('Contact lookup failed');
        }
    };

    const hideUser = async (user) => {
        updateStoredUsers((prev) => prev.filter((u) => u.id !== user.id));
        toast.success('User removed');
    };

    const copyContact = async (contact, label) => {
        try {
            await navigator.clipboard.writeText(contact);
            toast.success(`${label} copied!`);
        } catch {
            toast.error(`Failed to copy ${label}`);
        }
    };

    const makeLocalFetchedUsers = (newUsers) =>
        newUsers.map((user) => ({
            id: user.login,
            login: user.login ?? '',
            name: user.name || user.login || '',
            discord: user.discord || '',
            telegram: user.telegram || '',
            phone: user.phone || '',
            avatar_url: user.avatar_url,
            html_url: user.html_url,
            location: user.location ?? '',
            company: user.company || '',
            bio: user.bio || '',
            followers: user.followers ?? 0,
            public_repos: user.public_repos ?? 0,
        }));

    const getSearchParams = (status = 'running') => ({
        location: location.trim(),
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

        if (!location.trim()) {
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
        const searchQueries = monthRanges.flatMap((range) =>
            CONTACT_SEARCH_TERMS.map((contactTerm) => ({
                ...range,
                contactTerm,
            }))
        );

        setSearchProgress({
            totalMonths: searchQueries.length,
            completedMonths: 0,
            totalUsersFound: 0,
            newUsersDisplayed: 0,
        });

        const queue = new ThrottledQueue({ concurrency: 1, intervalMs: 2100 });
        queueRef.current = queue;

        let completedMonths = 0;
        let totalUsersFound = 0;
        let newUsersDisplayed = 0;
        let finalizedUsers = [];
        const knownLogins = new Set();

        const updateSearchProgress = () => {
            setSearchProgress({
                totalMonths: monthRanges.length,
                completedMonths,
                totalUsersFound,
                newUsersDisplayed,
            });
        };

        const tasks = searchQueries.map((range) => {
            return queue.enqueue(async () => {
                if (stopRequested.current) return [];

                const qStr = [
                    `location:${location}`,
                    `type:User`,
                    `created:${range.start}..${range.end}`,
                    minFollowers > 0 ? `followers:>=${minFollowers}` : null,
                    language ? `language:${language}` : null,
                    bioKeyword ? `in:bio ${bioKeyword}` : null,
                    range.contactTerm,
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
                completedMonths++;
                const newItems = items.filter((u) => !knownLogins.has(u.login));
                for (const u of newItems) knownLogins.add(u.login);
                totalUsersFound += newItems.length;
                updateSearchProgress();

                if (newItems.length > 0) {
                    const hydratedUsers = await hydrateUsersWithProfiles(newItems);
                    const localUsers = makeLocalFetchedUsers(hydratedUsers);
                    if (!localUsers.length) return;

                    newUsersDisplayed += localUsers.length;
                    finalizedUsers = [
                        ...finalizedUsers,
                        ...localUsers,
                    ];
                    updateSearchProgress();

                    updateStoredUsers((prev) => [
                        ...prev,
                        ...localUsers,
                    ]);
                }
            }).catch((err) => {
                if (err?.name === 'AbortError' || stopRequested.current) {
                    return;
                }
                if (completedMonths < searchQueries.length) completedMonths++;
                updateSearchProgress();
                console.error('Search month failed:', err);
                toast.error('A search month failed. Check the console for details.');
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
                        <span>Processing: {searchProgress.completedMonths}/{searchProgress.totalMonths} contact queries</span>
                        <span>Matched: {searchProgress.totalUsersFound} unique users</span>
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
                    <div className="bg-white p-3 rounded-lg shadow-sm hover:shadow-md transition-shadow" key={user.id}>
                        <div className="flex items-center gap-2 mb-2">
                            <a href={user.html_url} target="_blank" rel="noopener noreferrer">
                                <img src={user.avatar_url} className="w-10 h-10 rounded-full" alt={user.login} />
                            </a>
                            <div className="min-w-0">
                                <div className="text-sm font-semibold truncate">{user.name || user.login}</div>
                                <div className="text-xs text-gray-500 truncate">@{user.login}</div>
                                <div className="text-xs text-gray-500 truncate">{user.location || 'Unknown'}</div>
                                {user.discord && (
                                    <div className="flex items-center gap-1">
                                        <div className="text-xs text-gray-700 truncate">Discord: {user.discord}</div>
                                        <button
                                            type="button"
                                            onClick={() => copyContact(user.discord, 'Discord')}
                                            className="text-gray-400 hover:text-indigo-600 transition-colors flex-shrink-0"
                                            title="Copy Discord"
                                        >
                                            <Copy size={12} />
                                        </button>
                                    </div>
                                )}
                                {user.telegram && (
                                    <div className="flex items-center gap-1">
                                        <div className="text-xs text-gray-700 truncate">Telegram: {user.telegram}</div>
                                        <button
                                            type="button"
                                            onClick={() => copyContact(user.telegram, 'Telegram')}
                                            className="text-gray-400 hover:text-indigo-600 transition-colors flex-shrink-0"
                                            title="Copy Telegram"
                                        >
                                            <Copy size={12} />
                                        </button>
                                    </div>
                                )}
                                {user.phone && (
                                    <div className="flex items-center gap-1">
                                        <div className="text-xs text-gray-700 truncate">Phone: {user.phone}</div>
                                        <button
                                            type="button"
                                            onClick={() => copyContact(user.phone, 'Phone')}
                                            className="text-gray-400 hover:text-indigo-600 transition-colors flex-shrink-0"
                                            title="Copy Phone"
                                        >
                                            <Copy size={12} />
                                        </button>
                                    </div>
                                )}
                                {!user.discord && !user.telegram && !user.phone && (
                                    <div className="flex items-center gap-1">
                                        <div className="text-xs text-gray-700 truncate">No contact</div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-1.5">
                            <button
                                onClick={() => findContacts(user)}
                                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-1 rounded text-xs font-medium transition-colors"
                            >
                                Find Contact
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
