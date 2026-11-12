// 以 IndexedDB 保存使用者預設、LUT 資料與每張照片的編輯結果。
export type StoreName = 'presets' | 'luts' | 'edits';

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('ro-photo', 1);
    req.onupgradeneeded = () => {
      for (const name of ['presets', 'luts', 'edits']) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await open();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  get: <T>(store: StoreName, key: string) => run<T | undefined>(store, 'readonly', (s) => s.get(key)),
  set: (store: StoreName, key: string, value: unknown) => run<IDBValidKey>(store, 'readwrite', (s) => s.put(value, key)),
  del: (store: StoreName, key: string) => run<undefined>(store, 'readwrite', (s) => s.delete(key)),
  all: <T>(store: StoreName) => run<T[]>(store, 'readonly', (s) => s.getAll()),
};
