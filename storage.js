const DB_NAME = 'fieldmark-v1';
const STORE = 'projects';
let dbPromise;

function openDb() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('이 기기는 로컬 저장소를 지원하지 않아요.'));
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function transact(mode, operation) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = operation(tx.objectStore(STORE));
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('저장 작업이 중단됐어요.'));
  });
}

export const loadProjects = () => transact('readonly', store => store.getAll());
export const saveProject = project => transact('readwrite', store => store.put(project));
export const removeProject = id => transact('readwrite', store => store.delete(id));
