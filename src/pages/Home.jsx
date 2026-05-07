import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, EyeOff } from 'lucide-react';
import { ToastContainer, toast } from 'react-toastify';
import { clearStoredUsers, loadStoredSearch, loadStoredUsers, saveStoredUsers } from '../utils/browserStorage';

const hasEmail = (user) => Boolean(user?.email?.trim());

export default function Home() {
    const [users, setUsers] = useState([]);
    const [searchParams, setSearchParams] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [selectAll, setSelectAll] = useState(false);

    useEffect(() => {
        const storedSearch = loadStoredSearch();
        setUsers(loadStoredUsers().filter(hasEmail));
        setSearchParams(storedSearch.params);

        const handleStorage = () => {
            const nextStoredSearch = loadStoredSearch();
            setUsers(loadStoredUsers().filter(hasEmail));
            setSearchParams(nextStoredSearch.params);
            setSelectedIds(new Set());
            setSelectAll(false);
        };

        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    const hideUser = async (id) => {
        setUsers((prev) => {
            const next = prev.filter((u) => u.id !== id);
            if (!saveStoredUsers(next)) {
                toast.error('Failed updating browser storage.');
            }
            return next;
        });
        setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
        toast.success('User removed');
    };

    const copyEmail = (email) => {
        navigator.clipboard.writeText(email);
        toast.success('Email copied!');
    };

    const toggleSelect = (id) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectAll) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredUsers.map((u) => u.id)));
        }
        setSelectAll(!selectAll);
    };

    const removeSelected = async () => {
        if (selectedIds.size === 0) return;

        const ids = Array.from(selectedIds);
        setUsers((prev) => {
            const next = prev.filter((user) => !selectedIds.has(user.id));
            if (!saveStoredUsers(next)) {
                toast.error('Failed updating browser storage.');
            }
            return next;
        });
        setSelectedIds(new Set());
        setSelectAll(false);
        toast.success(`Removed ${ids.length} users`);
    };

    const clearUsers = () => {
        if (!clearStoredUsers()) {
            toast.error('Failed clearing browser storage.');
            return;
        }

        setUsers([]);
        setSelectedIds(new Set());
        setSelectAll(false);
        toast.success('Stored users cleared');
    };

    const filteredUsers = users.filter((user) => {
        if (!hasEmail(user)) return false;
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            user.email?.toLowerCase().includes(q) ||
            user.name?.toLowerCase().includes(q) ||
            user.login?.toLowerCase().includes(q)
        );
    });

    const searchParamLabels = searchParams ? [
        ['Location', searchParams.location],
        ['Dates', searchParams.startDate && searchParams.endDate ? `${searchParams.startDate} to ${searchParams.endDate}` : null],
        ['Language', searchParams.language],
        ['Bio Keyword', searchParams.bioKeyword],
        ['Min Followers', searchParams.minFollowers > 0 ? searchParams.minFollowers : null],
        ['Status', searchParams.status],
        ['Finalized', searchParams.finalizedAt ? new Date(searchParams.finalizedAt).toLocaleString() : null],
    ].filter(([, value]) => value !== null && value !== undefined && value !== '') : [];

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="max-w-7xl mx-auto">
                {searchParamLabels.length > 0 && (
                    <div className="mb-4 rounded-lg bg-white p-4 shadow-sm">
                        <h2 className="text-sm font-semibold text-gray-800 mb-3">Stored Search Parameters</h2>
                        <div className="flex flex-wrap gap-2">
                            {searchParamLabels.map(([label, value]) => (
                                <span
                                    key={label}
                                    className="rounded-full bg-indigo-50 px-3 py-1 text-xs text-indigo-700"
                                >
                                    {label}: {value}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-4 flex-wrap bg-white p-4 rounded-lg shadow-sm">
                    <div className="flex-1 min-w-[200px]">
                        <label className="text-xs font-medium text-gray-600 mb-1 block">Filter Current Page</label>
                        <input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by name or email..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                </div>

                <section className="mt-6">
                    <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-4">
                            <h2 className="text-lg font-semibold text-gray-800">Users</h2>
                            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={selectAll}
                                    onChange={toggleSelectAll}
                                    className="rounded border-gray-300"
                                />
                                Select All
                            </label>
                        </div>

                        <div className="flex items-center gap-3">
                            {selectedIds.size > 0 && (
                                <button
                                    onClick={removeSelected}
                                    className="px-4 py-1.5 text-sm bg-cyan-600 hover:bg-cyan-700 text-white rounded-md font-medium transition-colors"
                                >
                                    Remove {selectedIds.size}
                                </button>
                            )}
                            {users.length > 0 && (
                                <button
                                    onClick={clearUsers}
                                    className="px-4 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md font-medium transition-colors"
                                >
                                    Clear Storage
                                </button>
                            )}
                            <span className="text-sm text-gray-500">{filteredUsers.length} total</span>
                        </div>
                    </div>

                    {users.length === 0 && (
                        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
                            No users are stored yet. Use the Search page to fetch GitHub users into browser storage.
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        <AnimatePresence>
                            {filteredUsers.map((user) => (
                                <motion.div
                                    key={user.id}
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.98 }}
                                    className="relative bg-white p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(user.id)}
                                        onChange={() => toggleSelect(user.id)}
                                        className="absolute top-3 right-3 rounded border-gray-300"
                                    />

                                    <div className="flex items-center gap-3 mb-3">
                                        <img
                                            src={user.avatar_url}
                                            alt={user.name}
                                            className="w-12 h-12 rounded-full"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <a
                                                href={user.html_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-sm font-semibold text-gray-900 hover:text-indigo-600 truncate block"
                                            >
                                                {user.name || user.login}
                                            </a>
                                            <p className="text-xs text-gray-500 truncate">@{user.login}</p>
                                        </div>
                                    </div>

                                    <div className="space-y-1 mb-3">
                                        <div className="flex items-center gap-1">
                                            <p className="text-xs text-gray-700 truncate flex-1">
                                                {user.email || 'No email'}
                                            </p>
                                            {user.email && (
                                                <button
                                                    onClick={() => copyEmail(user.email)}
                                                    className="text-gray-400 hover:text-indigo-600 transition-colors flex-shrink-0"
                                                    title="Copy email"
                                                >
                                                    <Copy size={13} />
                                                </button>
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-500">{user.location || 'Unknown location'}</p>
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => hideUser(user.id)}
                                            className="flex-1 px-2 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md font-medium transition-colors flex items-center justify-center gap-1"
                                        >
                                            <EyeOff size={12} /> Remove
                                        </button>
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </section>
            </div>

            <ToastContainer position="bottom-right" />
        </div>
    );
}
