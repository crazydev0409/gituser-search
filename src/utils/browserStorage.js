const USERS_STORAGE_KEY = 'gitscan.users.v1';
const SEARCH_STORAGE_KEY = 'gitscan.search.v1';

const emptyStoredSearch = {
    params: null,
    users: [],
};

export function loadStoredSearch() {
    try {
        const raw = window.localStorage.getItem(SEARCH_STORAGE_KEY);
        if (!raw) {
            const legacyRaw = window.localStorage.getItem(USERS_STORAGE_KEY);
            const legacyStored = legacyRaw ? JSON.parse(legacyRaw) : emptyStoredSearch;

            if (!Array.isArray(legacyStored) && legacyStored?.params) {
                return {
                    params: legacyStored.params,
                    users: Array.isArray(legacyStored.users) ? legacyStored.users : [],
                };
            }

            return emptyStoredSearch;
        }

        const stored = raw ? JSON.parse(raw) : emptyStoredSearch;

        if (Array.isArray(stored)) {
            return {
                ...emptyStoredSearch,
                users: stored,
            };
        }

        return {
            params: stored?.params || null,
            users: Array.isArray(stored?.users) ? stored.users : [],
        };
    } catch (err) {
        console.error('Failed loading stored search:', err);
        return emptyStoredSearch;
    }
}

export function loadStoredUsers() {
    try {
        const raw = window.localStorage.getItem(USERS_STORAGE_KEY);
        const stored = raw ? JSON.parse(raw) : [];

        if (Array.isArray(stored)) return stored;
        return Array.isArray(stored?.users) ? stored.users : [];
    } catch (err) {
        console.error('Failed loading stored users:', err);
        return [];
    }
}

export function saveStoredSearch(search) {
    try {
        window.localStorage.setItem(SEARCH_STORAGE_KEY, JSON.stringify({
            params: search?.params || null,
            users: Array.isArray(search?.users) ? search.users : [],
        }));
        return true;
    } catch (err) {
        console.error('Failed saving stored search:', err);
        return false;
    }
}

export function saveStoredUsers(users) {
    try {
        window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(Array.isArray(users) ? users : []));
        return true;
    } catch (err) {
        console.error('Failed saving stored users:', err);
        return false;
    }
}

export function mergeStoredUsers(users) {
    const existingUsers = loadStoredUsers();
    const knownUserIds = new Set(existingUsers.map((user) => user.id || user.login).filter(Boolean));
    const usersToAdd = (Array.isArray(users) ? users : []).filter((user) => {
        const userId = user?.id || user?.login;
        if (!userId || knownUserIds.has(userId)) return false;
        knownUserIds.add(userId);
        return true;
    });

    if (!usersToAdd.length) return true;
    return saveStoredUsers([...existingUsers, ...usersToAdd]);
}

export function clearStoredUsers() {
    try {
        window.localStorage.removeItem(USERS_STORAGE_KEY);
        return true;
    } catch (err) {
        console.error('Failed clearing stored users:', err);
        return false;
    }
}
