import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHmac, timingSafeEqual } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '12mb', strict: false }));
app.use((q: Request, s: Response, n: NextFunction) => {
  if (q.path.startsWith('/api/')) {
    s.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    s.set('Pragma', 'no-cache');
    s.set('Expires', '0');
  }
  n();
});
app.use((q: Request, _s: Response, n: NextFunction) => {
  if (q.body === null) q.body = {};
  n();
});

// PASSWORDS & SECRETS
// Fix: ADMINISTRATOR_PASS was defaulting to empty string '', causing 401 error for any administrator login.
const PASS = process.env.ADMIN_PASS || 'admin123';
const ADMINISTRATOR_PASS = process.env.ADMINISTRATOR_PASS || PASS || 'admin123';
const CASHIER_PASS = process.env.CASHIER_PASS || PASS || 'admin123';
const KITCHEN_PASS = process.env.KITCHEN_PASS || PASS || 'admin123';
const SOMSACHI_PASS = process.env.SOMSACHI_PASS || KITCHEN_PASS;
const SALATCHI_PASS = process.env.SALATCHI_PASS || KITCHEN_PASS;
const OSHPAZ_PASS = process.env.OSHPAZ_PASS || KITCHEN_PASS;
const PRINT_KEY = process.env.ORZU_PRINT_KEY || 'ORZU-LOCAL-PRINT-KEY-9f42c7b1-2026-11';
const QR_SECRET = process.env.ORZU_QR_SECRET || PASS;
function makeTableQrToken(table: string) { return createHmac('sha256', QR_SECRET).update('orzu-table:' + table).digest('hex'); }
function validTableQrToken(table: string, token: string) {
  if (!table || !token || !/^[a-f0-9]{64}$/i.test(token)) return false;
  const expected = Buffer.from(makeTableQrToken(table), 'hex');
  const supplied = Buffer.from(token, 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
const SU = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SK = process.env.SUPABASE_KEY;

const DEFAULT_CATS = [
  '1-chi taom',
  '2-chi taom',
  'Salat va ichimliklar',
  'Boshqa'
];

// Robust public directory resolution (supports clean /public and legacy /mnt/user-data/... structure)
const P = __dirname;
const PUB = fs.existsSync(path.join(__dirname, 'public', 'waiter', 'index.html'))
  ? path.join(__dirname, 'public')
  : (fs.existsSync(path.join(__dirname, 'mnt', 'user-data', 'outputs', 'orzu', 'public'))
    ? path.join(__dirname, 'mnt', 'user-data', 'outputs', 'orzu', 'public')
    : path.join(__dirname, 'public'));

const LF = path.join(P, 'data.json');
const HD: Record<string, string> = {
  apikey: SK || '',
  Authorization: 'Bearer ' + (SK || ''),
  'Content-Type': 'application/json'
};

interface MenuItem {
  id: number;
  name: string;
  price: number;
  cat: number;
  img?: string;
  hidden?: boolean;
}

interface Waiter {
  id: number;
  name: string;
  pin: string;
}

interface OrderItem {
  name: string;
  price: number;
  qty: number;
  img?: string;
  kitchenStatus?: 'new' | 'preparing' | 'ready' | 'served';
  station?: 'somsachi' | 'salatchi' | 'oshpaz';
}

interface Order {
  id: number;
  table: string;
  waiter: number;
  waiterName: string;
  items: OrderItem[];
  total: number;
  status: 'new' | 'accepted' | 'served' | 'paid';
  time: number;
  paidAt?: number;
  paidBy?: string;
  paymentMethod?: string;
}

interface WaiterSession {
  start: number;
  end: number;
}

interface WaiterShift {
  online: boolean;
  onlineAt: number;
  offlineAt: number;
  sessions: WaiterSession[];
}

interface PrintJob {
  id: string;
  printerIp: string;
  order: Order;
}

interface AppConfig {
  cats: string[];
  menu: MenuItem[];
  waiters: Waiter[];
}

interface AppOrders {
  list: Order[];
  seq: number;
  nextWaiterIndex: number;
  statsResetAt?: number;
  dayClosures: {
    waiters: Record<number, number>;
    cashier: number;
    administrator: number;
    admin: number;
  };
  waiterShifts: Record<number, WaiterShift>;
  cashierSettings: {
    printerIp: string;
  };
  printJobs?: PrintJob[];
}

// Initial Uzbek menu dishes for out-of-the-box readiness
const SEED_MENU: MenuItem[] = [
  { id: 101, name: "Qo'y go'shtli sho'rva", price: 32000, cat: 0, img: "https://images.unsplash.com/photo-1547592166-23ac45744acd?w=600&auto=format&fit=crop&q=80", hidden: false },
  { id: 102, name: "Uyg'ur lag'mon", price: 38000, cat: 0, img: "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=600&auto=format&fit=crop&q=80", hidden: false },
  { id: 103, name: "Mastava (qatiq bilan)", price: 28000, cat: 0, img: "https://images.unsplash.com/photo-1604152135912-04a022e23696?w=600&auto=format&fit=crop&q=80", hidden: false },
  { id: 104, name: "Chuchvara sho'rva", price: 30000, cat: 0, img: "https://images.unsplash.com/photo-1550547660-d9450f859349?w=600&auto=format&fit=crop&q=80", hidden: false },

  { id: 201, name: "To'y oshi / Palov (maxsus)", price: 42000, cat: 1, img: "https://images.unsplash.com/photo-1633964913295-ceb43826e7c9?w=600&auto=format&fit=crop&q=80", hidden: false },
  { id: 202, name: "Manti (go'shtli, 5 dona)", price: 35000, cat: 1, img: "https://images.unsplash.com/photo-1541696432-82c6da8ce7bf?w=600&auto=format&fit=crop&q=80", hidden: false },
  { id: 203, name: "Qiyma shashlik (2 dona)", price: 24000, cat: 1, img: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600&auto=format&fit=crop&q=80", hidden: false },
  { id: 204, name: "Qozon kabob (qo'y go'shti)", price: 58000, cat: 1, img: "https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80", hidden: false },

  { id: 301, name: "Achchiq-chuchuk salati", price: 14000, cat: 2, img: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=600&auto=format&fit=crop&q=80", hidden: false },
  { id: 302, name: "Bahor salati", price: 16000, cat: 2, img: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&auto=format&fit=crop&q=80", hidden: false },
  { id: 303, name: "Choynakda ko'k choy", price: 5000, cat: 2, img: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=600&auto=format&fit=crop&q=80", hidden: false },
  { id: 304, name: "Choynakda qora choy (limon bilan)", price: 7000, cat: 2, img: "https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=600&auto=format&fit=crop&q=80", hidden: false },
  { id: 305, name: "Coca-Cola 1.5L", price: 16000, cat: 2, img: "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&auto=format&fit=crop&q=80", hidden: false },
  { id: 306, name: "Muzdek Ayron (ko'katli)", price: 8000, cat: 2, img: "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=600&auto=format&fit=crop&q=80", hidden: false },

  { id: 401, name: "Tandir patir non", price: 8000, cat: 3, img: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&auto=format&fit=crop&q=80", hidden: false },
  { id: 402, name: "Go'shtli tandir somsa", price: 12000, cat: 3, img: "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=600&auto=format&fit=crop&q=80", hidden: false }
];

let CFG: AppConfig = {
  cats: [...DEFAULT_CATS],
  menu: [...SEED_MENU],
  waiters: [
    { id: 1, name: 'Ofitsiant 1', pin: '1111' },
    { id: 2, name: 'Ofitsiant 2', pin: '2222' }
  ]
};

let O: AppOrders = {
  list: [],
  seq: 10,
  nextWaiterIndex: 0,
  dayClosures: { waiters: {}, cashier: 0, administrator: 0, admin: 0 },
  waiterShifts: {
    1: { online: true, onlineAt: Date.now(), offlineAt: 0, sessions: [{ start: Date.now(), end: 0 }] },
    2: { online: true, onlineAt: Date.now(), offlineAt: 0, sessions: [{ start: Date.now(), end: 0 }] }
  },
  cashierSettings: { printerIp: '192.168.1.51' },
  printJobs: []
};

// DATABASE LOAD
async function load() {
  if (SU && SK) {
    // Never start with stale local defaults when Supabase is configured but unavailable.
    // Doing so could accept orders against the wrong data and overwrite the live store.
    for (const k of ['cfg', 'orders']) {
      const r = await fetch(
        `${SU}/rest/v1/store?key=eq.${k}&select=data`,
        { headers: HD }
      );
      if (!r.ok) throw new Error(`Supabase ${k} load failed (HTTP ${r.status})`);
      const j = await r.json();
      if (!Array.isArray(j)) throw new Error(`Supabase ${k} returned an invalid response`);
      if (j[0]) {
        if (k === 'cfg') CFG = j[0].data;
        else O = j[0].data;
      }
    }
  } else if (fs.existsSync(LF)) {
    try {
      const d = JSON.parse(fs.readFileSync(LF, 'utf8'));
      if (d.CFG) CFG = d.CFG;
      if (d.O) O = d.O;
    } catch (e) {
      console.warn('Local data.json read error:', e);
    }
  }
  // Sanitize configurations and recover safe defaults for malformed rows.
  if (!CFG || typeof CFG !== 'object') CFG = { cats: [...DEFAULT_CATS], menu: [...SEED_MENU], waiters: [] };
  if (!O || typeof O !== 'object') O = {
    list: [], seq: 10, nextWaiterIndex: 0,
    dayClosures: { waiters: {}, cashier: 0, administrator: 0, admin: 0 },
    waiterShifts: {}, cashierSettings: { printerIp: '192.168.1.51' }, printJobs: []
  };
  if (!Array.isArray(O.list)) O.list = [];
  if (!Number.isInteger(O.seq) || O.seq < 0) O.seq = Math.max(10, ...O.list.map(o => Number(o?.id) || 0));
  if (!Array.isArray(CFG.cats) || !CFG.cats.length) CFG.cats = [...DEFAULT_CATS];
  if (!Array.isArray(CFG.menu) || !CFG.menu.length) CFG.menu = [...SEED_MENU];
  if (!Array.isArray(CFG.waiters) || !CFG.waiters.length) {
    CFG.waiters = [
      { id: 1, name: 'Ofitsiant 1', pin: '1111' },
      { id: 2, name: 'Ofitsiant 2', pin: '2222' }
    ];
  }

  if (!Number.isInteger(O.nextWaiterIndex) || O.nextWaiterIndex < 0) {
    O.nextWaiterIndex = 0;
  }
  if (!O.dayClosures || typeof O.dayClosures !== 'object') {
    O.dayClosures = { waiters: {}, cashier: 0, administrator: 0, admin: 0 };
  }
  if (!O.dayClosures.waiters || typeof O.dayClosures.waiters !== 'object') {
    O.dayClosures.waiters = {};
  }
  if (!Number.isFinite(Number(O.dayClosures.admin))) O.dayClosures.admin = 0;
  if (!Number.isFinite(Number(O.dayClosures.cashier))) O.dayClosures.cashier = 0;
  if (!Number.isFinite(Number(O.dayClosures.administrator))) O.dayClosures.administrator = 0;
  if (!Number.isFinite(Number(O.statsResetAt))) O.statsResetAt = 0;
  if (!O.waiterShifts || typeof O.waiterShifts !== 'object') O.waiterShifts = {};
  if (!Array.isArray(O.printJobs)) O.printJobs = [];
  if (!O.cashierSettings || typeof O.cashierSettings !== 'object') {
    O.cashierSettings = { printerIp: '192.168.1.51' };
  }

  // Ensure default waiters have active shift initialized if empty
  for (const w of CFG.waiters) {
    if (!O.waiterShifts[w.id]) {
      O.waiterShifts[w.id] = {
        online: true,
        onlineAt: Date.now(),
        offlineAt: 0,
        sessions: [{ start: Date.now(), end: 0 }]
      };
    }
  }

  // Save sanitized initial data locally
  saveLocally();
}

function saveLocally(): boolean {
  try {
    fs.writeFileSync(LF, JSON.stringify({ CFG, O }, null, 2));
    return true;
  } catch (e) {
    console.error('Error writing data.json:', e);
    return false;
  }
}

// DATABASE SAVE
let q0: Promise<boolean> = Promise.resolve(true);
function save(k: 'cfg' | 'orders'): Promise<boolean> {
  if (!saveLocally()) return Promise.resolve(false);
  if (!SU || !SK) return Promise.resolve(true);

  const body = JSON.stringify({
    key: k,
    data: k === 'cfg' ? CFG : O
  });
  const operation = q0.catch(() => false).then(async () => {
    const r = await fetch(`${SU}/rest/v1/store`, {
      method: 'POST',
      headers: {
        ...HD,
        Prefer: 'resolution=merge-duplicates'
      },
      body
    });
    if (!r.ok) {
      console.error('Supabase save error:', await r.text());
      return false;
    }
    return true;
  }).catch(error => {
    console.error('Supabase save request failed:', error);
    return false;
  });
  q0 = operation;
  return operation;
}

// Decode UTF-8 passwords transported as base64 so non-Latin passwords are valid HTTP headers.
function secretHeaderMatches(q: Request, headerName: string, expected: string) {
  const raw = String(q.headers[headerName] || '');
  if (raw === expected) return true; // backward compatibility with existing ASCII passwords
  try { return Buffer.from(raw, 'base64').toString('utf8') === expected; }
  catch { return false; }
}

function stationForMenuItem(menu: MenuItem): 'somsachi' | 'salatchi' | 'oshpaz' {
  const name = String(menu.name || '').trim().toLowerCase();
  const category = String(CFG.cats[Number(menu.cat)] || '').trim().toLowerCase();
  // Menu name/category is the source of truth, including common "samsa" spelling.
  if (/(somsa|samsa)/i.test(name) || /(somsa|samsa)/i.test(category)) return 'somsachi';
  const isDrink = /(choy|cola|coca|pepsi|fanta|sprite|suv|ayron|sharbat|sok|limonad)/i.test(name);
  if (!isDrink && (name.includes('salat') || category.includes('salat'))) return 'salatchi';
  return 'oshpaz';
}
function stationForOrderItem(item: OrderItem): 'somsachi' | 'salatchi' | 'oshpaz' {
  // Recalculate against the current menu first: old/stale station tags must not
  // keep a somsa or salad trapped in the wrong production queue.
  const menu = CFG.menu.find(m => String(m.name || '').trim().toLowerCase() === String(item.name || '').trim().toLowerCase());
  if (menu) return stationForMenuItem(menu);
  if (item.station === 'somsachi' || item.station === 'salatchi' || item.station === 'oshpaz') return item.station;
  const name = String(item.name || '').toLowerCase();
  if (/(somsa|samsa)/i.test(name)) return 'somsachi';
  if (name.includes('salat')) return 'salatchi';
  return 'oshpaz';
}
function stationPass(station: string): string | null {
  if (station === 'somsachi') return SOMSACHI_PASS;
  if (station === 'salatchi') return SALATCHI_PASS;
  if (station === 'oshpaz') return OSHPAZ_PASS;
  return null;
}
function stationAuth(q: Request, s: Response, n: NextFunction) {
  const station = String(q.params.station || q.query.station || q.body.station || '');
  const pass = stationPass(station);
  if (pass && secretHeaderMatches(q, 'x-station', pass)) return n();
  return s.status(401).json({ error: 'Parol noto‘g‘ri yoki bo‘lim topilmadi' });
}

// ADMIN AUTH
function adm(q: Request, s: Response, n: NextFunction) {
  if (secretHeaderMatches(q, 'x-admin', PASS)) return n();
  return s.status(401).json({ error: 'auth' });
}

// ADMINISTRATOR AUTH (Fixed: now accepts ADMINISTRATOR_PASS or fallback to PASS)
function administrator(q: Request, s: Response, n: NextFunction) {
  if (secretHeaderMatches(q, 'x-administrator', ADMINISTRATOR_PASS)) return n();
  return s.status(401).json({ error: 'auth' });
}

// CASHIER AUTH
function cashier(q: Request, s: Response, n: NextFunction) {
  if (secretHeaderMatches(q, 'x-cashier', CASHIER_PASS)) return n();
  return s.status(401).json({ error: 'auth' });
}

// KITCHEN AUTH
function kitchen(q: Request, s: Response, n: NextFunction) {
  if (secretHeaderMatches(q, 'x-kitchen', KITCHEN_PASS)) return n();
  return s.status(401).json({ error: 'auth' });
}

// WAITER AUTH
interface WaiterRequest extends Request {
  w?: Waiter;
}

function wt(q: WaiterRequest, s: Response, n: NextFunction) {
  let headerCredentials: { id?: string | number; pin?: string } = {};
  const raw = String(q.headers['x-waiter'] || '');
  if (raw) {
    try {
      headerCredentials = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch { /* Keep legacy query/body authentication for older clients. */ }
  }
  const wid = headerCredentials.id ?? q.query.id ?? (q.body && q.body.id);
  const wpin = headerCredentials.pin ?? q.query.pin ?? (q.body && q.body.pin);
  const w = CFG.waiters.find(w => String(w.id) === String(wid) && String(w.pin) === String(wpin));
  if (!w) return s.status(401).json({ error: 'auth' });
  q.w = w;
  n();
}

// HEALTH
app.get(['/health', '/api/health'], (_q, s) => {
  s.json({
    ok: true,
    db: SU && SK ? 'supabase' : 'file',
    menu: CFG.menu.length,
    orders: O.list.length,
    waiters: CFG.waiters.length
  });
});

// CUSTOMER MENU
app.get('/api/menu', (_q, s) => {
  s.json({
    cats: CFG.cats,
    menu: CFG.menu.filter(m => !m.hidden)
  });
});

// TABLE QR: signed table links are generated by an authenticated admin.
app.get('/api/admin/table-qr/:table', adm, (q, s) => {
  const table = String(q.params.table || '').trim();
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(table)) return s.status(400).json({ error: 'Stol raqami noto‘g‘ri' });
  const token = makeTableQrToken(table);
  const url = new URL('/', `${q.protocol}://${q.get('host')}`);
  url.searchParams.set('table', table);
  url.searchParams.set('qr', token);
  s.json({ table, token, url: url.toString() });
});

app.get('/api/qr/verify', (q, s) => {
  const table = String(q.query.table || '').trim();
  const token = String(q.query.qr || '');
  if (!validTableQrToken(table, token)) return s.status(401).json({ valid: false, error: 'QR kod noto‘g‘ri yoki eskirgan' });
  s.json({ valid: true, table });
});

// CUSTOMER ORDER
app.post('/api/order', async (q, s) => {
  const table = String(q.body.table || '').trim();
  const qrToken = String(q.body.qr || '');
  const items: OrderItem[] = [];
  if (!table || table.length > 20) return s.status(400).json({ error: 'Stol raqami noto‘g‘ri' });
  // Backward compatibility: previously printed table QR codes contain ?table=<number>
  // but no signed token. Keep those public table links working while validating all new signed QR codes.
  // Older printed table QR codes have no signed token. They can only identify
  // the table, so accept a token-less request for a syntactically valid table.
  // If a token is supplied, it must always be valid (never downgrade invalid signed QR).
  const legacyTableQr = !qrToken && /^[A-Za-z0-9_-]{1,20}$/.test(table);
  if (!validTableQrToken(table, qrToken) && !legacyTableQr) {
    return s.status(403).json({ error: 'Buyurtma faqat stol QR kodi orqali beriladi. Stol ustidagi QR kodni skanerlang.' });
  }
  for (const i of q.body.items || []) {
    const m = CFG.menu.find(m => m.id == i.id);
    if (m && Number(i.qty) > 0) {
      items.push({
        name: m.name,
        price: m.price,
        img: m.img || '',
        station: stationForMenuItem(m),
        qty: Math.min(99, Number(i.qty) | 0)
      });
    }
  }
  if (!items.length) {
    return s.status(400).json({ error: "Savat bo'sh" });
  }
  if (!CFG.waiters.length) {
    return s.status(400).json({ error: "Ofitsiant yo'q" });
  }

  // Customer orders are accepted only while at least one waiter is on shift.
  const pool = CFG.waiters.filter(
    w => w && w.id != null && String(w.name || '').trim() && O.waiterShifts?.[w.id]?.online === true
  );
  if (!pool.length) return s.status(409).json({ error: 'Hozircha ofitsiantlar onlayn emas. Iltimos, xodimga murojaat qiling.' });
  const waiterIndex = O.nextWaiterIndex % pool.length;
  const w = pool[waiterIndex];
  const wid = w.id;
  O.nextWaiterIndex = (waiterIndex + 1) % pool.length;

  const o: Order = {
    id: ++O.seq,
    table,
    waiter: wid,
    waiterName: w.name,
    items,
    total: items.reduce((a, i) => a + i.price * i.qty, 0),
    status: 'new',
    time: Date.now()
  };
  O.list.push(o);
  const persisted = await save('orders');
  if (!persisted) {
    O.list = O.list.filter(existing => existing.id !== o.id);
    O.seq = Math.max(0, O.seq - 1);
    saveLocally();
    return s.status(500).json({ error: 'Buyurtma bazaga saqlanmadi. Qayta urinib ko‘ring.' });
  }
  s.json({ ok: true, id: o.id });
});

// WAITERS LIST
app.get('/api/waiters', (_q, s) => {
  s.json(CFG.waiters.map(({ id, name }) => ({ id, name })));
});

app.get('/api/station/orders', stationAuth, (q, s) => {
  const station = String(q.query.station || '');
  const orders = O.list.filter(o => o.status !== 'paid').slice().sort((a,b) => a.time - b.time).map(o => ({
    id: o.id, table: o.table, waiterName: o.waiterName, time: o.time, status: o.status,
    items: o.items.map((item, index) => ({ item, index })).filter(x => stationForOrderItem(x.item) === station).map(x => ({ index: x.index, name: x.item.name, qty: x.item.qty, kitchenStatus: x.item.kitchenStatus || 'new' }))
  })).filter(o => o.items.length);
  s.json({ station, orders });
});
app.post('/api/station/item-status', stationAuth, async (q, s) => {
  const station = String(q.body.station || '');
  const order = O.list.find(o => String(o.id) === String(q.body.orderId));
  const index = Number(q.body.itemIndex);
  const item = order?.items[index];
  const assigned = item ? stationForOrderItem(item) : '';
  const next = String(q.body.status || '');
  if (!order || order.status === 'paid' || !item || assigned !== station) return s.status(404).json({ error: 'Buyurtma yoki mahsulot topilmadi' });
  if (!['new', 'preparing', 'ready', 'served'].includes(next)) return s.status(400).json({ error: 'Holat noto‘g‘ri' });
  const previousStatus = item.kitchenStatus;
  item.kitchenStatus = next as OrderItem['kitchenStatus'];
  if (!await save('orders')) {
    if (previousStatus === undefined) delete item.kitchenStatus;
    else item.kitchenStatus = previousStatus;
    return s.status(500).json({ error: 'Holat saqlanmadi' });
  }
  s.json({ ok: true, orderId: order.id, itemIndex: index, status: next });
});

// KITCHEN DISPLAY: active orders and per-item preparation states
app.get('/api/kitchen/orders', kitchen, (_q, s) => {
  const orders = O.list
    .filter(o => o.status !== 'paid')
    .slice()
    .sort((a, b) => a.time - b.time)
    .map(o => ({
      id: o.id, table: o.table, waiterName: o.waiterName, time: o.time,
      status: o.status,
      items: o.items.map((item, index) => ({
        index, name: item.name, qty: item.qty,
        kitchenStatus: item.kitchenStatus || 'new'
      }))
    }));
  s.json({ orders });
});

app.post('/api/kitchen/item-status', kitchen, async (q, s) => {
  const order = O.list.find(o => String(o.id) === String(q.body.orderId));
  const index = Number(q.body.itemIndex);
  const next = String(q.body.status || '');
  if (!order || order.status === 'paid' || !Number.isInteger(index) || !order.items[index]) {
    return s.status(404).json({ error: 'Buyurtma yoki taom topilmadi' });
  }
  if (!['new', 'preparing', 'ready', 'served'].includes(next)) {
    return s.status(400).json({ error: 'Taom holati noto‘g‘ri' });
  }
  const previousStatus = order.items[index].kitchenStatus;
  order.items[index].kitchenStatus = next as OrderItem['kitchenStatus'];
  const saved = await save('orders');
  if (!saved) {
    if (previousStatus === undefined) delete order.items[index].kitchenStatus;
    else order.items[index].kitchenStatus = previousStatus;
    return s.status(500).json({ error: 'Holat saqlanmadi. Qayta urinib ko‘ring.' });
  }
  s.json({ ok: true, orderId: order.id, itemIndex: index, status: next });
});

// WAITER PRESENCE: GET
app.get('/api/waiter/presence', wt, (q: WaiterRequest, s: Response) => {
  const wid = q.w!.id;
  const shift = O.waiterShifts?.[wid] || { online: false, onlineAt: 0, offlineAt: 0, sessions: [] };
  s.json({
    online: !!shift.online,
    onlineAt: Number(shift.onlineAt || 0),
    offlineAt: Number(shift.offlineAt || 0),
    sessions: shift.sessions || []
  });
});

// WAITER PRESENCE: POST (Fix: Waiters can now start/stop their shift directly!)
app.post('/api/waiter/presence', wt, async (q: WaiterRequest, s: Response) => {
  const wid = q.w!.id;
  const waiter = q.w!;
  const currentShift = O.waiterShifts[wid] || (O.waiterShifts[wid] = { online: false, onlineAt: 0, offlineAt: 0, sessions: [] });
  const previousShift = JSON.parse(JSON.stringify(currentShift));
  const online = typeof q.body.online === 'boolean' ? q.body.online : !currentShift.online;
  const now = Date.now();

  if (online && !currentShift.online) {
    currentShift.online = true;
    currentShift.onlineAt = now;
    currentShift.offlineAt = 0;
    currentShift.sessions.push({ start: now, end: 0 });
    if (currentShift.sessions.length > 100) currentShift.sessions = currentShift.sessions.slice(-100);
  } else if (!online && currentShift.online) {
    currentShift.online = false;
    currentShift.offlineAt = now;
    const openSession = [...(currentShift.sessions || [])].reverse().find(x => !x.end);
    if (openSession) openSession.end = now;
  }

  const saved = await save('orders');
  if (!saved) {
    O.waiterShifts[wid] = previousShift;
    return s.status(500).json({ error: 'Smena holati bazaga saqlanmadi. Qayta urinib ko‘ring.' });
  }
  s.json({
    ok: true,
    waiterId: wid,
    name: waiter.name,
    online: !!currentShift.online,
    onlineAt: Number(currentShift.onlineAt || 0),
    offlineAt: Number(currentShift.offlineAt || 0)
  });
});

// WAITER ORDERS
app.get('/api/waiter/orders', wt, (q: WaiterRequest, s: Response) => {
  const wid = q.w!.id;
  const closedAt = Number(O.dayClosures.waiters[wid] || 0);
  s.json(
    O.list
      .filter(o => o.waiter === wid && Number(o.time || 0) >= closedAt)
      .slice(-80)
      .reverse()
  );
});

// WAITER CLOSE DAY
app.post('/api/waiter/close-day', wt, async (q: WaiterRequest, s: Response) => {
  const wid = q.w!.id;
  const previous = Number(O.dayClosures.waiters[wid] || 0);
  O.dayClosures.waiters[wid] = Date.now();
  if (!await save('orders')) {
    O.dayClosures.waiters[wid] = previous;
    return s.status(500).json({ error: 'Kun yopilishi bazaga saqlanmadi.' });
  }
  s.json({ ok: true, closedAt: O.dayClosures.waiters[wid] });
});

// WAITER STATUS
app.post('/api/waiter/status', wt, async (q: WaiterRequest, s: Response) => {
  const wid = q.w!.id;
  const o = O.list.find(o => o.id == q.body.orderId && o.waiter === wid);
  if (!o) return s.status(404).json({ error: 'Buyurtma topilmadi' });
  if (!['accepted', 'served'].includes(q.body.status)) return s.status(400).json({ error: 'Buyurtma holati noto‘g‘ri' });
  const previous = o.status;
  o.status = q.body.status;
  if (!await save('orders')) {
    o.status = previous;
    return s.status(500).json({ error: 'Buyurtma holati saqlanmadi.' });
  }
  s.json({ ok: 1 });
});

// WAITER ADD ITEMS
app.post('/api/waiter/add', wt, async (q: WaiterRequest, s: Response) => {
  const wid = q.w!.id;
  const items: OrderItem[] = [];
  for (const i of q.body.items || []) {
    const m = CFG.menu.find(m => m.id == i.id);
    const qty = Math.min(99, Number(i.qty) | 0);
    if (m && qty > 0) {
      // Every waiter-entered menu item is explicitly assigned to its production station.
      items.push({ name: m.name, price: m.price, img: m.img || '', station: stationForMenuItem(m), qty });
    }
  }
  if (!items.length) return s.status(400).json({ error: 'Taom tanlanmagan' });

  let o: Order | undefined;
  let previousOrder: Order | undefined;
  const isNewOrder = !q.body.orderId;
  if (!isNewOrder) {
    o = O.list.find(o => o.id == q.body.orderId && o.waiter === wid);
    if (!o || o.status === 'paid') return s.status(400).json({ error: 'Buyurtma topilmadi' });
    previousOrder = JSON.parse(JSON.stringify(o)) as Order;
    for (const it of items) {
      const ex = o.items.find(x => x.name === it.name && x.price === it.price);
      if (ex) {
        ex.qty = Math.min(99, ex.qty + it.qty);
        // Repair older items that were saved before station routing was introduced.
        ex.station = it.station;
      } else {
        o.items.push(it);
      }
    }
    if (o.status === 'served') o.status = 'accepted';
  } else {
    const table = String(q.body.table || '').trim();
    if (!table) return s.status(400).json({ error: 'Stol raqami kerak' });
    o = {
      id: ++O.seq, table, waiter: wid, waiterName: q.w!.name,
      items, total: 0, status: 'accepted', time: Date.now()
    };
    O.list.push(o);
  }

  o.total = o.items.reduce((a, i) => a + i.price * i.qty, 0);
  const persisted = await save('orders');
  if (!persisted) {
    if (isNewOrder) {
      O.list = O.list.filter(existing => existing.id !== o!.id);
      O.seq = Math.max(0, O.seq - 1);
    } else if (previousOrder) {
      const index = O.list.findIndex(existing => existing.id === previousOrder!.id);
      if (index >= 0) O.list[index] = previousOrder;
    }
    saveLocally();
    return s.status(500).json({ error: 'Buyurtma bazaga saqlanmadi. Qayta urinib ko‘ring.' });
  }
  s.json({ ok: true, id: o.id });
});

// WAITER PRINT
app.post('/api/waiter/print', wt, async (q: WaiterRequest, s: Response) => {
  const wid = q.w!.id;
  const o = O.list.find(x => String(x.id) === String(q.body.orderId) && x.waiter === wid);
  if (!o) return s.status(404).json({ error: 'Buyurtma topilmadi' });
  if (!Array.isArray(o.items) || !o.items.length) return s.status(400).json({ error: 'Buyurtmada taom yo‘q' });

  if (!Array.isArray(O.printJobs)) O.printJobs = [];
  const job: PrintJob = {
    id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
    printerIp: O.cashierSettings?.printerIp || '192.168.1.51',
    order: JSON.parse(JSON.stringify({ ...o, waiterName: o.waiterName || q.w!.name }))
  };
  O.printJobs.push(job);
  if (!await save('orders')) {
    O.printJobs = O.printJobs.filter(x => x.id !== job.id);
    return s.status(500).json({ error: 'Chek printer navbatiga saqlanmadi.' });
  }
  s.json({ ok: true, message: 'Chek printer navbatiga yuborildi', jobId: job.id });
});

// CASHIER PRINT (NEW: Allows Cashier to queue prints directly through server API, avoiding Mixed Content)
app.post('/api/cashier/print', cashier, async (q: Request, s: Response) => {
  const o = O.list.find(x => String(x.id) === String(q.body.orderId));
  if (!o) return s.status(404).json({ error: 'Buyurtma topilmadi' });

  if (!Array.isArray(O.printJobs)) O.printJobs = [];
  const job: PrintJob = {
    id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
    printerIp: String(q.body.printerIp || O.cashierSettings?.printerIp || '192.168.1.51'),
    order: JSON.parse(JSON.stringify(o))
  };
  O.printJobs.push(job);
  const persisted = await save('orders');
  if (!persisted) {
    O.printJobs = O.printJobs.filter(existing => existing.id !== job.id);
    saveLocally();
    return s.status(500).json({ error: 'Chek navbatga saqlanmadi. Qayta urinib ko‘ring.' });
  }
  s.json({ ok: true, message: 'Chek printer navbatiga qo‘yildi', jobId: job.id });
});

// LOCAL BRIDGE: fetch queued print jobs
app.get('/api/printer/jobs', async (q, s) => {
  if (q.headers['x-orzu-print-key'] !== PRINT_KEY) return s.status(401).json({ error: 'auth' });
  const cutoff = Date.now() - 10 * 60 * 1000;
  const previousJobs = O.printJobs || [];
  const fresh = previousJobs.filter(j => Number(String(j.id).split('-')[0]) >= cutoff);
  if (fresh.length !== previousJobs.length) {
    O.printJobs = fresh;
    if (!await save('orders')) {
      O.printJobs = previousJobs;
      return s.status(500).json({ error: 'Printer navbati yangilanmadi.' });
    }
  }
  s.json({ job: fresh[0] || null });
});

// LOCAL BRIDGE: ACK
app.post('/api/printer/jobs/ack', async (q, s) => {
  if (q.headers['x-orzu-print-key'] !== PRINT_KEY) return s.status(401).json({ error: 'auth' });
  const previousJobs = O.printJobs || [];
  const before = previousJobs.length;
  O.printJobs = previousJobs.filter(j => String(j.id) !== String(q.body.id));
  if (O.printJobs.length !== before && !await save('orders')) {
    O.printJobs = previousJobs;
    return s.status(500).json({ error: 'Chek navbati yangilanmadi.' });
  }
  s.json({ ok: true });
});

// CASHIER DATA
app.get('/api/cashier/data', cashier, (_q, s) => {
  const closedAt = Number(O.dayClosures.cashier || 0);
  s.set('Cache-Control', 'no-store');
  s.json({
    orders: O.list
      .filter(o => Number(o.time || 0) >= closedAt)
      .sort((a, b) => Number(b.time || 0) - Number(a.time || 0)),
    waiters: CFG.waiters.map(({ id, name }) => ({
      id,
      name,
      shift: O.waiterShifts?.[id] || { online: false, onlineAt: 0, offlineAt: 0, sessions: [] }
    })),
    settings: O.cashierSettings || { printerIp: '192.168.1.51' },
    menu: CFG.menu.filter(m => !m.hidden)
  });
});

// CASHIER WAITER PRESENCE
app.post('/api/cashier/waiter-presence', cashier, async (q, s) => {
  const waiter = CFG.waiters.find(w => String(w.id) === String(q.body.waiterId));
  if (!waiter) return s.status(404).json({ error: 'Ofitsiant topilmadi' });
  if (typeof q.body.online !== 'boolean') return s.status(400).json({ error: 'Onlayn yoki oflayn holatini tanlang' });

  const now = Date.now();
  const shift = O.waiterShifts[waiter.id] || (O.waiterShifts[waiter.id] = { online: false, onlineAt: 0, offlineAt: 0, sessions: [] });
  const previousShift = JSON.parse(JSON.stringify(shift));
  if (q.body.online && !shift.online) {
    shift.online = true;
    shift.onlineAt = now;
    shift.offlineAt = 0;
    shift.sessions.push({ start: now, end: 0 });
    if (shift.sessions.length > 100) shift.sessions = shift.sessions.slice(-100);
  } else if (!q.body.online && shift.online) {
    shift.online = false;
    shift.offlineAt = now;
    const openSession = [...(shift.sessions || [])].reverse().find(x => !x.end);
    if (openSession) openSession.end = now;
  }
  const saved = await save('orders');
  if (!saved) {
    O.waiterShifts[waiter.id] = previousShift;
    return s.status(500).json({ error: 'Ofitsiant smenasi bazaga saqlanmadi.' });
  }
  s.json({
    ok: true,
    waiterId: waiter.id,
    name: waiter.name,
    online: !!shift.online,
    onlineAt: Number(shift.onlineAt || 0),
    offlineAt: Number(shift.offlineAt || 0)
  });
});

// CASHIER SETTINGS
app.post('/api/cashier/settings', cashier, async (q, s) => {
  const ip = String(q.body.printerIp || '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || ip.split('.').some(x => Number(x) > 255)) {
    return s.status(400).json({ error: 'Printer IP manzilini to‘g‘ri kiriting' });
  }
  const previous = O.cashierSettings;
  O.cashierSettings = { ...(O.cashierSettings || {}), printerIp: ip };
  if (!await save('orders')) {
    O.cashierSettings = previous;
    return s.status(500).json({ error: 'Printer sozlamasi saqlanmadi.' });
  }
  s.json({ ok: true, settings: O.cashierSettings });
});

// CASHIER CREATE ORDER: cashier can open an order for any table without requiring an online waiter.
app.post('/api/cashier/create-order', cashier, async (q: Request, s: Response) => {
  const table = String(q.body.table || '').trim();
  if (!table || table.length > 20 || !/^[A-Za-z0-9_-]+$/.test(table)) return s.status(400).json({ error: 'Stol raqami noto‘g‘ri' });
  if (!Array.isArray(q.body.items) || !q.body.items.length) return s.status(400).json({ error: 'Menyu mahsulotlarini tanlang' });
  const items: OrderItem[] = [];
  for (const row of q.body.items) {
    const menu = CFG.menu.find(m => Number(m.id) === Number(row.menuId) && !m.hidden);
    const qty = Number(row.qty);
    if (!menu || !Number.isInteger(qty) || qty < 1 || qty > 99) return s.status(400).json({ error: 'Mahsulot yoki miqdor noto‘g‘ri' });
    const existing = items.find(i => i.name === menu.name && i.price === Number(menu.price));
    if (existing) existing.qty += qty;
    else items.push({ name: menu.name, price: Number(menu.price), img: menu.img || '', station: stationForMenuItem(menu), qty });
  }
  const order: Order = {
    id: ++O.seq, table, waiter: 0, waiterName: 'Kassir', items,
    total: Math.round(items.reduce((sum, item) => sum + item.price * item.qty, 0)),
    status: 'new', time: Date.now()
  };
  O.list.push(order);
  const persisted = await save('orders');
  if (!persisted) {
    O.list = O.list.filter(x => x.id !== order.id);
    O.seq = Math.max(0, O.seq - 1);
    saveLocally();
    return s.status(500).json({ error: 'Buyurtma bazaga saqlanmadi. Qayta urinib ko‘ring.' });
  }
  s.json({ ok: true, order });
});

// CASHIER EDIT ORDER: faqat to‘lanmagan buyurtma tarkibini o‘zgartirish.
app.post('/api/cashier/update-order', cashier, async (q: Request, s: Response) => {
  const order = O.list.find(x => String(x.id) === String(q.body.orderId));
  if (!order) return s.status(404).json({ error: 'Buyurtma topilmadi' });
  if (order.status === 'paid') return s.status(409).json({ error: 'To‘langan buyurtmani tahrirlab bo‘lmaydi' });

  const changes = Array.isArray(q.body.changes) ? q.body.changes : [];
  const addItems = Array.isArray(q.body.addItems) ? q.body.addItems : [];
  const qtyByIndex = new Map<number, number>();

  for (const change of changes) {
    const index = Number(change.index);
    const qty = Number(change.qty);
    if (!Number.isInteger(index) || index < 0 || index >= order.items.length ||
        !Number.isInteger(qty) || qty < 0 || qty > 99 || qtyByIndex.has(index)) {
      return s.status(400).json({ error: 'Mahsulot miqdori noto‘g‘ri' });
    }
    qtyByIndex.set(index, qty);
  }

  let updatedItems: OrderItem[] = order.items.flatMap((item, index) => {
    const qty = qtyByIndex.has(index) ? qtyByIndex.get(index)! : Number(item.qty);
    return qty > 0 ? [{ ...item, qty }] : [];
  });

  for (const addition of addItems) {
    const menuId = Number(addition.menuId);
    const qty = Number(addition.qty);
    const menuItem = CFG.menu.find(m => Number(m.id) === menuId && !m.hidden);
    if (!menuItem || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      return s.status(400).json({ error: 'Qo‘shilayotgan mahsulot yoki miqdor noto‘g‘ri' });
    }
    const existing = updatedItems.find(item => item.name === menuItem.name && Number(item.price) === Number(menuItem.price));
    if (existing) {
      if (existing.qty + qty > 99) return s.status(400).json({ error: 'Bir mahsulot miqdori 99 tadan oshmasin' });
      existing.qty += qty;
    } else {
      updatedItems.push({ name: menuItem.name, price: Number(menuItem.price), img: menuItem.img || '', station: stationForMenuItem(menuItem), qty });
    }
  }

  if (!updatedItems.length) return s.status(400).json({ error: 'Buyurtmada kamida bitta mahsulot qolishi kerak' });
  const previousItems = order.items;
  const previousTotal = order.total;
  order.items = updatedItems;
  order.total = Math.round(updatedItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0));
  const persisted = await save('orders');
  if (!persisted) {
    order.items = previousItems;
    order.total = previousTotal;
    saveLocally();
    return s.status(500).json({ error: 'O‘zgarishlar bazaga saqlanmadi. Buyurtma avvalgi holatiga qaytarildi.' });
  }
  s.json({ ok: true, order });
});

// CASHIER PAY: to‘lovni umumiy buyurtmalar bazasiga to‘liq saqlab, keyin tasdiqlash.
app.post('/api/cashier/pay', cashier, async (q, s) => {
  const o = O.list.find(x => String(x.id) === String(q.body.orderId));
  if (!o) return s.status(404).json({ error: 'Buyurtma topilmadi' });
  if (o.status === 'paid') return s.status(409).json({ error: 'Bu buyurtma avval to‘langan', order: o });

  const previous = {
    status: o.status,
    paidAt: o.paidAt,
    paidBy: o.paidBy,
    paymentMethod: o.paymentMethod
  };
  o.status = 'paid';
  o.paidAt = Date.now();
  o.paidBy = String(q.body.cashierName || 'Kassir').slice(0, 60);
  o.paymentMethod = String(q.body.paymentMethod || 'Naqd').slice(0, 30);
  try {
    const persisted = await save('orders');
    if (!persisted) throw new Error('Bazaga yozish muvaffaqiyatsiz tugadi');
  } catch (error) {
    console.error('Kassir to‘lovini saqlashda xato:', error);
    o.status = previous.status;
    if (previous.paidAt === undefined) delete o.paidAt;
    else o.paidAt = previous.paidAt;
    if (previous.paidBy === undefined) delete o.paidBy;
    else o.paidBy = previous.paidBy;
    if (previous.paymentMethod === undefined) delete o.paymentMethod;
    else o.paymentMethod = previous.paymentMethod;
    saveLocally();
    return s.status(500).json({ error: 'To‘lov bazaga saqlanmadi. Buyurtma avvalgi holatiga qaytarildi. Qayta urinib ko‘ring.' });
  }
  s.json({ ok: true, order: o });
});

// CASHIER CLOSE DAY
app.post('/api/cashier/close-day', cashier, async (_q, s) => {
  const closedAt = Number(O.dayClosures.cashier || 0);
  const currentOrders = O.list.filter(o => Number(o.time || 0) >= closedAt);
  const pending = currentOrders.filter(o => o.status !== 'paid');
  const paid = currentOrders.filter(o => o.status === 'paid');
  const summary = {
    orders: paid.length,
    pending: pending.length,
    total: paid.reduce((sum, o) => sum + Number(o.total || 0), 0)
  };
  O.dayClosures.cashier = Date.now();
  if (!await save('orders')) {
    O.dayClosures.cashier = closedAt;
    return s.status(500).json({ error: 'Kassir kuni yopilmadi: baza saqlamadi.' });
  }
  s.json({ ok: true, closedAt: O.dayClosures.cashier, summary, historyPreserved: true });
});

// ADMIN DATA
app.get('/api/admin/data', adm, (_q, s) => {
  const closedAt = Number(O.dayClosures.admin || 0);
  s.json({
    cats: CFG.cats,
    menu: CFG.menu,
    waiters: CFG.waiters.map(w => ({
      ...w,
      shift: O.waiterShifts?.[w.id] || { online: false, onlineAt: 0, offlineAt: 0, sessions: [] }
    })),
    orders: O.list.filter(o => Number(o.time || 0) >= closedAt),
    history: O.list,
    statsResetAt: Number(O.statsResetAt || 0)
  });
});

// ADMIN CLOSE DAY
app.post('/api/admin/close-day', adm, async (_q, s) => {
  const previous = O.dayClosures.admin;
  O.dayClosures.admin = Date.now();
  if (!await save('orders')) {
    O.dayClosures.admin = previous;
    return s.status(500).json({ error: 'Admin kuni yopilmadi: baza saqlamadi.' });
  }
  s.json({ ok: true, closedAt: O.dayClosures.admin });
});

// ADMINISTRATOR DATA (Fixed: now accessible!)
app.get('/api/administrator/data', administrator, (_q, s) => {
  const closedAt = Number(O.dayClosures.administrator || 0);
  s.json({
    waiters: CFG.waiters.map(({ id, name }) => ({ id, name })),
    orders: O.list.filter(o => Number(o.time || 0) >= closedAt)
  });
});

// ADMINISTRATOR CLOSE DAY
app.post('/api/administrator/close-day', administrator, async (_q, s) => {
  const previous = O.dayClosures.administrator;
  O.dayClosures.administrator = Date.now();
  if (!await save('orders')) {
    O.dayClosures.administrator = previous;
    return s.status(500).json({ error: 'Administrator kuni yopilmadi: baza saqlamadi.' });
  }
  s.json({ ok: true, closedAt: O.dayClosures.administrator });
});

// ADMIN CATEGORY ADD
app.post('/api/admin/category', adm, async (q, s) => {
  const name = String(q.body.name || '').trim();
  if (!name) return s.status(400).json({ error: 'Bo‘lim nomini kiriting' });
  if (name.length > 40) return s.status(400).json({ error: 'Bo‘lim nomi 40 belgidan oshmasin' });
  if (CFG.cats.some(c => c.toLowerCase() === name.toLowerCase())) {
    return s.status(400).json({ error: 'Bu bo‘lim allaqachon bor' });
  }
  CFG.cats.push(name);
  if (!await save('cfg')) {
    CFG.cats.pop();
    return s.status(500).json({ error: 'Bo‘lim bazaga saqlanmadi.' });
  }
  s.json({ ok: 1, cats: CFG.cats });
});

// ADMIN CATEGORY REORDER — preserve each menu item's category while changing display order.
app.post('/api/admin/categories/reorder', adm, async (q, s) => {
  const requested = q.body && q.body.order;
  if (!Array.isArray(requested) || requested.length !== CFG.cats.length ||
      requested.some(name => typeof name !== 'string') ||
      new Set(requested).size !== CFG.cats.length ||
      CFG.cats.some(name => !requested.includes(name))) {
    return s.status(400).json({ error: 'Bo‘limlar tartibi noto‘g‘ri yuborildi' });
  }
  const previous = CFG.cats.slice();
  const previousMenu = CFG.menu;
  const nextIndex = new Map(requested.map((name, index) => [name, index]));
  CFG.menu = CFG.menu.map(item => {
    const oldCategory = previous[Number(item.cat)];
    const newCategory = nextIndex.get(oldCategory);
    return { ...item, cat: newCategory === undefined ? 0 : newCategory };
  });
  CFG.cats = requested.slice();
  if (!await save('cfg')) {
    CFG.cats = previous;
    CFG.menu = previousMenu;
    return s.status(500).json({ error: 'Bo‘limlar tartibi bazaga saqlanmadi.' });
  }
  s.json({ ok: true, cats: CFG.cats });
});

// ADMIN CATEGORY DELETE
app.delete('/api/admin/category/:index', adm, async (q, s) => {
  const index = Number(q.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= CFG.cats.length) {
    return s.status(400).json({ error: 'Bo‘lim topilmadi' });
  }
  if (CFG.cats.length <= 1) {
    return s.status(400).json({ error: 'Kamida bitta bo‘lim qolishi kerak' });
  }
  const previousCats = CFG.cats.slice();
  const previousMenu = CFG.menu;
  const fallback = CFG.cats.findIndex((_, i) => i !== index);
  CFG.menu = CFG.menu.map(item => {
    let cat = Number(item.cat);
    if (cat === index) cat = fallback;
    else if (cat > index) cat -= 1;
    return { ...item, cat };
  });
  CFG.cats.splice(index, 1);
  if (!await save('cfg')) {
    CFG.cats = previousCats;
    CFG.menu = previousMenu;
    return s.status(500).json({ error: 'Bo‘lim o‘chirish saqlanmadi.' });
  }
  s.json({ ok: 1, cats: CFG.cats });
});

// ADMIN MENU ADD / EDIT
app.post('/api/admin/menu', adm, async (q, s) => {
  const previousMenu = CFG.menu.map(item => ({ ...item }));
  const b = q.body;
  const m = CFG.menu.find(m => m.id == b.id);
  if (m) {
    Object.assign(
      m,
      {
        name: b.name,
        price: +b.price,
        cat: +b.cat,
        hidden: !!b.hidden
      },
      b.img ? { img: b.img } : {}
    );
  } else {
    CFG.menu.push({
      id: Date.now(),
      name: b.name,
      price: +b.price,
      cat: +b.cat,
      img: b.img || '',
      hidden: false
    });
  }
  if (!await save('cfg')) {
    CFG.menu = previousMenu;
    return s.status(500).json({ error: 'Menyu bazaga saqlanmadi.' });
  }
  s.json({ ok: 1 });
});

// ADMIN RESET STATS AND CLEAR ALL ORDERS
app.post('/api/admin/reset-stats', adm, async (_q, s) => {
  // Preserve the complete order history; only move the reporting start point.
  const previous = O.statsResetAt;
  O.statsResetAt = Date.now();
  if (!await save('orders')) {
    O.statsResetAt = previous;
    return s.status(500).json({ error: 'Statistika yangilanmadi: baza saqlamadi.' });
  }
  s.json({ ok: true, statsResetAt: O.statsResetAt, ordersCleared: false });
});

// ADMIN DELETE MENU
app.delete('/api/admin/menu/:id', adm, async (q, s) => {
  const targetId = Number(q.params.id);
  const previousMenu = CFG.menu;
  CFG.menu = CFG.menu.filter(m => m.id !== targetId);
  if (!await save('cfg')) {
    CFG.menu = previousMenu;
    return s.status(500).json({ error: 'Taom o‘chirilishi saqlanmadi.' });
  }
  s.json({ ok: 1 });
});

// ADMIN WAITER PRESENCE
app.post('/api/admin/waiter-presence', adm, async (q, s) => {
  const waiter = CFG.waiters.find(w => String(w.id) === String(q.body.waiterId));
  if (!waiter) return s.status(404).json({ error: 'Ofitsiant topilmadi' });
  if (typeof q.body.online !== 'boolean') return s.status(400).json({ error: 'Onlayn yoki oflayn holatini tanlang' });

  const now = Date.now();
  const shift = O.waiterShifts[waiter.id] || (O.waiterShifts[waiter.id] = { online: false, onlineAt: 0, offlineAt: 0, sessions: [] });
  const previousShift = JSON.parse(JSON.stringify(shift));
  if (q.body.online && !shift.online) {
    shift.online = true;
    shift.onlineAt = now;
    shift.offlineAt = 0;
    shift.sessions.push({ start: now, end: 0 });
    if (shift.sessions.length > 100) shift.sessions = shift.sessions.slice(-100);
  } else if (!q.body.online && shift.online) {
    shift.online = false;
    shift.offlineAt = now;
    const openSession = [...(shift.sessions || [])].reverse().find(x => !x.end);
    if (openSession) openSession.end = now;
  }
  if (!await save('orders')) {
    O.waiterShifts[waiter.id] = previousShift;
    return s.status(500).json({ error: 'Ofitsiant smenasi bazaga saqlanmadi.' });
  }
  s.json({
    ok: true,
    waiterId: waiter.id,
    name: waiter.name,
    online: !!shift.online,
    onlineAt: Number(shift.onlineAt || 0),
    offlineAt: Number(shift.offlineAt || 0)
  });
});

// ADMIN ADD WAITER
app.post('/api/admin/waiter', adm, async (q, s) => {
  const id = Date.now();
  const previousWaiters = CFG.waiters.slice();
  const previousShift = O.waiterShifts[id];
  CFG.waiters.push({ id, name: q.body.name, pin: String(q.body.pin) });
  O.waiterShifts[id] = { online: true, onlineAt: Date.now(), offlineAt: 0, sessions: [{ start: Date.now(), end: 0 }] };
  const cfgSaved = await save('cfg');
  const ordersSaved = cfgSaved && await save('orders');
  if (!cfgSaved || !ordersSaved) {
    CFG.waiters = previousWaiters;
    if (previousShift) O.waiterShifts[id] = previousShift; else delete O.waiterShifts[id];
    if (cfgSaved) await save('cfg');
    return s.status(500).json({ error: 'Ofitsiant ma’lumotlari to‘liq saqlanmadi.' });
  }
  s.json({ ok: 1, id });
});

// ADMIN DELETE WAITER
app.delete('/api/admin/waiter/:id', adm, async (q, s) => {
  const targetId = Number(q.params.id);
  const previousWaiters = CFG.waiters;
  CFG.waiters = CFG.waiters.filter(w => w.id !== targetId);
  if (!await save('cfg')) {
    CFG.waiters = previousWaiters;
    return s.status(500).json({ error: 'Ofitsiant o‘chirilishi saqlanmadi.' });
  }
  s.json({ ok: 1 });
});

// HELPER: Serve HTML with fallbacks
function sendHtml(res: Response, subfolder: string, station?: 'somsachi' | 'salatchi' | 'oshpaz') {
  const candidates = [
    path.join(PUB, subfolder, 'index.html'),
    path.join(P, 'public', subfolder, 'index.html'),
    path.join(P, 'mnt', 'user-data', 'outputs', 'orzu', 'public', subfolder, 'index.html')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      if (station && subfolder === 'station') {
        const html = fs.readFileSync(c, 'utf8').replace('<link rel="manifest" id="appManifest">', `<link rel="manifest" href="/station/manifest-${station}.webmanifest">`);
        return res.type('html').send(html);
      }
      return res.sendFile(c);
    }
  }
  res.status(404).send(`Sahifa topilmadi: ${subfolder}`);
}

// APP PAGES
app.get('/', (_q, s) => {
  const candidates = [
    path.join(P, 'index.html'),
    path.join(PUB, 'index.html')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return s.sendFile(c);
  }
  s.send('ORZU Restoran Menyusi');
});

app.get(['/menyu', '/menyu/'], (_q, s) => sendHtml(s, 'menu-view'));
app.get(['/cashier', '/cashier/'], (_q, s) => sendHtml(s, 'cashier'));
app.get(['/waiter', '/waiter/'], (_q, s) => sendHtml(s, 'waiter'));
app.get(['/kitchen', '/kitchen/'], (_q, s) => sendHtml(s, 'kitchen'));
app.get(['/somsachi', '/somsachi/'], (_q, s) => sendHtml(s, 'station', 'somsachi'));
app.get(['/salatchi', '/salatchi/'], (_q, s) => sendHtml(s, 'station', 'salatchi'));
app.get(['/oshpaz', '/oshpaz/'], (_q, s) => sendHtml(s, 'station', 'oshpaz'));
app.get(['/admin', '/admin/'], (_q, s) => sendHtml(s, 'admin'));
app.get(['/administrator', '/administrator/'], (_q, s) => sendHtml(s, 'administrator'));

// STATIC FILES SERVING
app.use(express.static(PUB));
app.use(express.static(P));

// START SERVER
const PORT = Number(process.env.PORT) || 3000;
load()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`ORZU tizimi 0.0.0.0:${PORT} da ishga tushdi.`);
      console.log(`Baza: ${SU && SK ? 'Supabase' : 'Lokal fayl (data.json)'}`);
      console.log(`Xavfsizlik: parollar va PIN-kodlar logga chiqarilmaydi.`);
    });
  })
  .catch(err => {
    console.error('Serverni ishga tushirishda xato:', err);
    process.exit(1);
  });
