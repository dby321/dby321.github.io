/* 水草笔记 — 客户端解密与密码门。classic script，挂在 globalThis.WGCrypto。 */
(() => {
    const subtle = crypto.subtle;
    const SESSION_KEY = 'wg.key';
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bytesToB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

    async function loadMeta() {
        const res = await fetch('data/meta.json', {cache: 'no-store'});
        if (!res.ok) throw new Error(`站点配置加载失败 (${res.status})`);
        return res.json();
    }

    async function deriveKey(password, saltB64, iterations) {
        const material = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
        return subtle.deriveKey(
            {name: 'PBKDF2', salt: b64ToBytes(saltB64), iterations, hash: 'SHA-256'},
            material,
            {name: 'AES-GCM', length: 256},
            true,
            ['encrypt', 'decrypt'],
        );
    }

    async function decryptBytes(key, buf) {
        const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        const plain = await subtle.decrypt(
            {name: 'AES-GCM', iv: bytes.subarray(0, 12)},
            key,
            bytes.subarray(12),
        );
        return new Uint8Array(plain);
    }

    async function decryptJson(key, buf) {
        return JSON.parse(decoder.decode(await decryptBytes(key, buf)));
    }

    async function exportKey(key) {
        return bytesToB64(await subtle.exportKey('raw', key));
    }

    async function importKey(b64) {
        return subtle.importKey('raw', b64ToBytes(b64), {name: 'AES-GCM'}, true, ['encrypt', 'decrypt']);
    }

    const gate = () => document.getElementById('gate');
    const gateError = () => document.getElementById('gateError');

    function showGate(message) {
        gate().hidden = false;
        const err = gateError();
        err.hidden = !message;
        err.textContent = message || '';
        document.getElementById('gatePassword').focus();
    }

    function hideGate() {
        gate().hidden = true;
        document.getElementById('gatePassword').value = '';
        document.getElementById('main').focus?.();
    }

    function clearSession() {
        try {
            sessionStorage.removeItem(SESSION_KEY);
        } catch { /* 隐私模式下 sessionStorage 不可用：每次重新输入 */
        }
    }

    async function fetchIndex(meta, key) {
        const res = await fetch(`data/${meta.indexFile}`);
        if (!res.ok) throw Object.assign(new Error(`索引加载失败 (${res.status})`), {http: true});
        return decryptJson(key, await res.arrayBuffer());
    }

    async function unlock() {
        const meta = await loadMeta();
        let stored = null;
        try {
            stored = sessionStorage.getItem(SESSION_KEY);
        } catch { /* 忽略 */
        }
        if (stored) {
            try {
                const key = await importKey(stored);
                const index = await fetchIndex(meta, key);
                hideGate();
                return {key, index};
            } catch (err) {
                clearSession();
                if (err.http) throw err;
                showGate('站点已更新，请重新输入密码');
            }
        } else {
            showGate('');
        }

        return new Promise((resolve, reject) => {
            const form = document.getElementById('gateForm');
            const input = document.getElementById('gatePassword');
            const button = document.getElementById('gateSubmit');
            const onSubmit = async (event) => {
                event.preventDefault();
                const password = input.value;
                if (!password) return;
                button.disabled = true;
                button.dataset.loading = 'true';
                button.textContent = '解锁中…';
                gateError().hidden = true;
                try {
                    const key = await deriveKey(password, meta.salt, meta.iterations);
                    const index = await fetchIndex(meta, key);
                    try {
                        sessionStorage.setItem(SESSION_KEY, await exportKey(key));
                    } catch { /* 忽略：本次会话仍可用 */
                    }
                    form.removeEventListener('submit', onSubmit);
                    hideGate();
                    resolve({key, index});
                } catch (err) {
                    if (err.http) {
                        form.removeEventListener('submit', onSubmit);
                        reject(err);
                        return;
                    }
                    showGate('密码不正确');
                } finally {
                    button.disabled = false;
                    delete button.dataset.loading;
                    button.textContent = '解锁';
                }
            };
            form.addEventListener('submit', onSubmit);
        });
    }

    globalThis.WGCrypto = {loadMeta, deriveKey, decryptBytes, decryptJson, exportKey, importKey, unlock};
})();