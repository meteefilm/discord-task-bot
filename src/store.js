// file: src/store.js
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = path.join(process.cwd(), 'data', 'tasks');

export async function ensureStore() {
  await fs.mkdir(ROOT, { recursive: true });
}

function fileOf(storageId) {
  return path.join(ROOT, `${storageId}.json`);
}

// --- เพิ่มฟังก์ชันช่วยตรงหัวไฟล์เดิม ---
const norm = (s) => (s ?? '').toString().normalize('NFC').trim().toLowerCase();
const catNorm = (s) => (s ?? 'general').toString().normalize('NFC').trim();

// ... (โค้ดเดิม)

async function load(storageId) {
  const file = fileOf(storageId);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const db = JSON.parse(raw);
    // 🔧 migration: เติม category = 'general' ถ้าไม่มี
    db.tasks?.forEach(t => { if (!t.category) t.category = 'general'; });
    if (db.lastId == null) db.lastId = Math.max(0, ...(db.tasks?.map(t => t.id) || [0]));
    return db;
  } catch {
    return { tasks: [], lastId: 0 };
  }
}
async function save(storageId, data) {
  const file = fileOf(storageId);
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// ---------- CRUD ----------
export async function addTask(storageId, { title, note = '', authorId, category = 'general' }) {
  const db = await load(storageId);
  if (db.tasks.find((t) => norm(t.title) === norm(title))) throw new Error('duplicate');
  const id = (db.lastId ?? 0) + 1;
  db.lastId = id;

  db.tasks.push({
    id,
    title,
    note,
    authorId,
    assigneeId: null,
    status: 'todo',               // todo | doing | done
    category: catNorm(category),  // 👈 ใหม่
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await save(storageId, db);
  return id;
}

export async function listTasks(storageId, opts = {}) {
  // รองรับแบบเก่า listTasks(storageId, 'all')
  const status = typeof opts === 'string' ? opts : (opts.status ?? 'all');
  const category = typeof opts === 'string' ? undefined : opts.category;

  const db = await load(storageId);
  let items = db.tasks;
  if (status !== 'all') items = items.filter((t) => t.status === status);
  if (category && category !== 'all') items = items.filter((t) => catNorm(t.category) === catNorm(category));
  return items;
}

export async function setTaskStatus(storageId, titleOrId, status) {
  const db = await load(storageId);
  const byId = Number.isFinite(+titleOrId) ? db.tasks.find((x) => x.id === +titleOrId) : null;
  const t = byId ?? db.tasks.find((x) => norm(x.title) === norm(titleOrId));
  if (!t) throw new Error('not found');
  t.status = status;
  t.updatedAt = Date.now();
  await save(storageId, db);
}

export async function assignTask(storageId, titleOrId, userId) {
  const db = await load(storageId);
  const byId = Number.isFinite(+titleOrId) ? db.tasks.find((x) => x.id === +titleOrId) : null;
  const t = byId ?? db.tasks.find((x) => norm(x.title) === norm(titleOrId));
  if (!t) throw new Error('not found');
  t.assigneeId = userId;
  t.updatedAt = Date.now();
  await save(storageId, db);
}

// 👇 ใหม่: เปลี่ยนหมวดหมู่
export async function setTaskCategory(storageId, titleOrId, category) {
  const db = await load(storageId);
  const byId = Number.isFinite(+titleOrId) ? db.tasks.find((x) => x.id === +titleOrId) : null;
  const t = byId ?? db.tasks.find((x) => norm(x.title) === norm(titleOrId));
  if (!t) throw new Error('not found');
  t.category = catNorm(category || 'general');
  t.updatedAt = Date.now();
  await save(storageId, db);
}

export async function removeTask(storageId, titleOrId) {
  const db = await load(storageId);
  const before = db.tasks.length;
  db.tasks = db.tasks.filter((x) => {
    if (Number.isFinite(+titleOrId)) return x.id !== +titleOrId;
    return norm(x.title) !== norm(titleOrId);
  });
  if (db.tasks.length === before) throw new Error('not found');
  await save(storageId, db);
}