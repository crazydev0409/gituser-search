export class ThrottledQueue {
    constructor({ concurrency = 2, intervalMs = 2100 } = {}) {
        this._concurrency = concurrency;
        this._intervalMs = intervalMs;
        this._queue = [];
        this._active = 0;
        this._aborted = false;
        this._timestamps = [];
    }

    get pending() {
        return this._queue.length;
    }

    get isAborted() {
        return this._aborted;
    }

    enqueue(fn) {
        if (this._aborted) {
            return Promise.reject(new DOMException('Queue aborted', 'AbortError'));
        }

        return new Promise((resolve, reject) => {
            this._queue.push({ fn, resolve, reject });
            this._scheduleNext();
        });
    }

    abort() {
        this._aborted = true;
        const pending = this._queue.splice(0);
        for (const item of pending) {
            item.reject(new DOMException('Queue aborted', 'AbortError'));
        }
    }

    _scheduleNext() {
        if (this._aborted || this._active >= this._concurrency || this._queue.length === 0) {
            return;
        }

        const now = Date.now();
        this._timestamps = this._timestamps.filter((t) => now - t < this._intervalMs);

        if (this._timestamps.length >= this._concurrency) {
            const oldest = this._timestamps[0];
            const wait = this._intervalMs - (now - oldest);
            setTimeout(() => this._scheduleNext(), wait + 10);
            return;
        }

        this._run();
    }

    async _run() {
        if (this._aborted || this._queue.length === 0) return;

        const item = this._queue.shift();
        if (!item) return;

        this._active++;
        this._timestamps.push(Date.now());

        try {
            const result = await item.fn();
            item.resolve(result);
        } catch (err) {
            item.reject(err);
        } finally {
            this._active--;
            this._scheduleNext();
        }
    }
}
