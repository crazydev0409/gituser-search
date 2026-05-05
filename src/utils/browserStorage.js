const USERS_STORAGE_KEY = 'gitscan.users.v1';

const emptyStoredSearch = {
    params: null,
    users: [],
};

export function loadStoredSearch() {
    try {
        const raw = window.localStorage.getItem(USERS_STORAGE_KEY);
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
    return loadStoredSearch().users;
}

export function saveStoredSearch(search) {
    try {
        window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify({
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
        const storedSearch = loadStoredSearch();
        return saveStoredSearch({
            ...storedSearch,
            users,
        });
    } catch (err) {
        console.error('Failed saving stored users:', err);
        return false;
    }
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
