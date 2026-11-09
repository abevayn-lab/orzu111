import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '12mb' }));

// PASSWORDS & SECRETS
// Fix: ADMINISTRATOR_PASS was defaulting to empty string '', causing 401 error for any administrator login.
const PASS = process.env.ADMIN_PASS || 'admin123';
const ADMINISTRATOR_PASS = process.env.ADMINISTRATOR_PASS || PASS || 'admin123';
const CASHIER_PASS = process.env.CASHIER_PASS || PASS || 'admin123';
const PRINT_KEY = process.env.ORZU_PRINT_KEY || 'ORZU-LOCAL-PRINT-KEY-9f42c7b1-2026-11';
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
    try {
      for (const k of ['cfg', 'orders']) {
        const r = await fetch(
          `${SU}/rest/v1/store?key=eq.${k}&select=data`,
          { headers: HD }
        );
        if (r.ok) {
          const j = await r.json();
          if (j[0]) {
            if (k === 'cfg') CFG = j[0].data;
            else O = j[0].data;
          }
        }
      }
    } catch (e) {
      console.warn('Supabase fetch failed, falling back to local file:', e);
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

  // Sanitize configurations
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

function saveLocally() {
  try {
    fs.writeFileSync(LF, JSON.stringify({ CFG, O }, null, 2));
  } catch (e) {
    console.error('Error writing data.json:', e);
  }
}

// DATABASE SAVE
let q0: Promise<any> = Promise.resolve();
function save(k: 'cfg' | 'orders') {
  saveLocally();
  if (!SU || !SK) {
    return Promise.resolve();
  }
  const body = JSON.stringify({
    key: k,
    data: k === 'cfg' ? CFG : O
  });
  const operation = q0.catch(() => {}).then(async () => {
    const r = await fetch(`${SU}/rest/v1/store`, {
      method: 'POST',
      headers: {
        ...HD,
        Prefer: 'resolution=merge-duplicates'
      },
      body
    });
    if (!r.ok) console.warn('Supabase save error:', await r.text());
  });
  q0 = operation;
  return operation;
}

// ADMIN AUTH
function adm(q: Request, s: Response, n: NextFunction) {
  if (q.headers['x-admin'] === PASS) return n();
  return s.status(401).json({ error: 'auth' });
}

// ADMINISTRATOR AUTH (Fixed: now accepts ADMINISTRATOR_PASS or fallback to PASS)
function administrator(q: Request, s: Response, n: NextFunction) {
  if (q.headers['x-administrator'] === ADMINISTRATOR_PASS) return n();
  return s.status(401).json({ error: 'auth' });
}

// CASHIER AUTH
function cashier(q: Request, s: Response, n: NextFunction) {
  if (q.headers['x-cashier'] === CASHIER_PASS) return n();
  return s.status(401).json({ error: 'auth' });
}

// WAITER AUTH
interface WaiterRequest extends Request {
  w?: Waiter;
}

function wt(q: WaiterRequest, s: Response, n: NextFunction) {
  const wid = q.query.id || (q.body && q.body.id);
  const wpin = q.query.pin || (q.body && q.body.pin);
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

// CUSTOMER ORDER
app.post('/api/order', (q, s) => {
  const table = String(q.body.table || '').trim();
  const items: OrderItem[] = [];
  if (!table) {
    return s.status(400).json({ error: 'Stol raqami kerak' });
  }
  for (const i of q.body.items || []) {
    const m = CFG.menu.find(m => m.id == i.id);
    if (m && Number(i.qty) > 0) {
      items.push({
        name: m.name,
        price: m.price,
        img: m.img || '',
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

  // Active online waiters
  const activeWaiters = CFG.waiters.filter(
    w => w && w.id != null && String(w.name || '').trim() && O.waiterShifts?.[w.id]?.online === true
  );

  // Fallback: If no waiter is explicitly marked online, don't fail with 503!
  // Assign to all registered waiters so orders are never lost!
  const pool = activeWaiters.length > 0 ? activeWaiters : CFG.waiters;
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
  save('orders');
  s.json({ ok: true, id: o.id });
});

// WAITERS LIST
app.get('/api/waiters', (_q, s) => {
  s.json(CFG.waiters.map(({ id, name }) => ({ id, name })));
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

  await save('orders');
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
app.post('/api/waiter/close-day', wt, (q: WaiterRequest, s: Response) => {
  const wid = q.w!.id;
  O.dayClosures.waiters[wid] = Date.now();
  save('orders');
  s.json({ ok: true, closedAt: O.dayClosures.waiters[wid] });
});

// WAITER STATUS
app.post('/api/waiter/status', wt, (q: WaiterRequest, s: Response) => {
  const wid = q.w!.id;
  const o = O.list.find(o => o.id == q.body.orderId && o.waiter === wid);
  if (o && ['accepted', 'served'].includes(q.body.status)) {
    o.status = q.body.status;
    save('orders');
  }
  s.json({ ok: 1 });
});

// WAITER ADD ITEMS
app.post('/api/waiter/add', wt, (q: WaiterRequest, s: Response) => {
  const wid = q.w!.id;
  const items: OrderItem[] = [];
  for (const i of q.body.items || []) {
    const m = CFG.menu.find(m => m.id == i.id);
    const qty = Math.min(99, Number(i.qty) | 0);
    if (m && qty > 0) items.push({ name: m.name, price: m.price, img: m.img || '', qty });
  }
  if (!items.length) {
    return s.status(400).json({ error: 'Taom tanlanmagan' });
  }
  let o: Order | undefined;
  if (q.body.orderId) {
    o = O.list.find(o => o.id == q.body.orderId && o.waiter === wid);
    if (!o || o.status === 'paid') {
      return s.status(400).json({ error: 'Buyurtma topilmadi' });
    }
    for (const it of items) {
      const ex = o.items.find(x => x.name === it.name && x.price === it.price);
      if (ex) ex.qty = Math.min(99, ex.qty + it.qty);
      else o.items.push(it);
    }
    if (o.status === 'served') o.status = 'accepted';
  } else {
    const table = String(q.body.table || '').trim();
    if (!table) {
      return s.status(400).json({ error: 'Stol raqami kerak' });
    }
    o = {
      id: ++O.seq,
      table,
      waiter: wid,
      waiterName: q.w!.name,
      items,
      total: 0,
      status: 'accepted',
      time: Date.now()
    };
    O.list.push(o);
  }
  o.total = o.items.reduce((a, i) => a + i.price * i.qty, 0);
  save('orders');
  s.json({ ok: true, id: o.id });
});

// WAITER PRINT
app.post('/api/waiter/print', wt, (q: WaiterRequest, s: Response) => {
  const wid = q.w!.id;
  const o = O.list.find(x => String(x.id) === String(q.body.orderId) && x.waiter === wid);
  if (!o) return s.status(404).json({ error: 'Buyurtma topilmadi' });
  if (!Array.isArray(o.items) || !o.items.length) return s.status(400).json({ error: 'Buyurtmada taom yo‘q' });

  if (!Array.isArray(O.printJobs)) O.printJobs = [];
  const job: PrintJob = {
    id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
    printerIp: O.cashierSettings?.printerIp || '192.168.1.51',
    order: { ...o, waiterName: o.waiterName || q.w!.name }
  };
  O.printJobs.push(job);
  save('orders');
  s.json({ ok: true, message: 'Chek printerga yuborildi', jobId: job.id });
});

// CASHIER PRINT (NEW: Allows Cashier to queue prints directly through server API, avoiding Mixed Content)
app.post('/api/cashier/print', cashier, (q: Request, s: Response) => {
  const o = O.list.find(x => String(x.id) === String(q.body.orderId));
  if (!o) return s.status(404).json({ error: 'Buyurtma topilmadi' });

  if (!Array.isArray(O.printJobs)) O.printJobs = [];
  const job: PrintJob = {
    id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
    printerIp: String(q.body.printerIp || O.cashierSettings?.printerIp || '192.168.1.51'),
    order: { ...o }
  };
  O.printJobs.push(job);
  save('orders');
  s.json({ ok: true, message: 'Chek printer navbatiga qo‘yildi', jobId: job.id });
});

// LOCAL BRIDGE: fetch queued print jobs
app.get('/api/printer/jobs', (q, s) => {
  if (q.headers['x-orzu-print-key'] !== PRINT_KEY) return s.status(401).json({ error: 'auth' });
  const cutoff = Date.now() - 10 * 60 * 1000;
  const fresh = (O.printJobs || []).filter(j => Number(String(j.id).split('-')[0]) >= cutoff);
  if (fresh.length !== (O.printJobs || []).length) {
    O.printJobs = fresh;
    save('orders');
  }
  s.json({ job: fresh[0] || null });
});

// LOCAL BRIDGE: ACK
app.post('/api/printer/jobs/ack', (q, s) => {
  if (q.headers['x-orzu-print-key'] !== PRINT_KEY) return s.status(401).json({ error: 'auth' });
  const before = (O.printJobs || []).length;
  O.printJobs = (O.printJobs || []).filter(j => String(j.id) !== String(q.body.id));
  if (O.printJobs.length !== before) save('orders');
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
    settings: O.cashierSettings || { printerIp: '192.168.1.51' }
  });
});

// CASHIER WAITER PRESENCE
app.post('/api/cashier/waiter-presence', cashier, async (q, s) => {
  const waiter = CFG.waiters.find(w => String(w.id) === String(q.body.waiterId));
  if (!waiter) return s.status(404).json({ error: 'Ofitsiant topilmadi' });
  if (typeof q.body.online !== 'boolean') return s.status(400).json({ error: 'Onlayn yoki oflayn holatini tanlang' });

  const now = Date.now();
  const shift = O.waiterShifts[waiter.id] || (O.waiterShifts[waiter.id] = { online: false, onlineAt: 0, offlineAt: 0, sessions: [] });
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
  await save('orders');
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
app.post('/api/cashier/settings', cashier, (q, s) => {
  const ip = String(q.body.printerIp || '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || ip.split('.').some(x => Number(x) > 255)) {
    return s.status(400).json({ error: 'Printer IP manzilini to‘g‘ri kiriting' });
  }
  O.cashierSettings = { ...(O.cashierSettings || {}), printerIp: ip };
  save('orders');
  s.json({ ok: true, settings: O.cashierSettings });
});

// CASHIER PAY
app.post('/api/cashier/pay', cashier, (q, s) => {
  const o = O.list.find(x => String(x.id) === String(q.body.orderId));
  if (!o) return s.status(404).json({ error: 'Buyurtma topilmadi' });
  if (o.status === 'paid') return s.status(409).json({ error: 'Bu buyurtma avval to‘langan', order: o });

  o.status = 'paid';
  o.paidAt = Date.now();
  o.paidBy = String(q.body.cashierName || 'Kassir').slice(0, 60);
  o.paymentMethod = String(q.body.paymentMethod || 'Naqd').slice(0, 30);
  save('orders');
  s.json({ ok: true, order: o });
});

// CASHIER CLOSE DAY
app.post('/api/cashier/close-day', cashier, (_q, s) => {
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
  save('orders');
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
app.post('/api/admin/close-day', adm, (_q, s) => {
  O.dayClosures.admin = Date.now();
  save('orders');
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
app.post('/api/administrator/close-day', administrator, (_q, s) => {
  O.dayClosures.administrator = Date.now();
  save('orders');
  s.json({ ok: true, closedAt: O.dayClosures.administrator });
});

// ADMIN CATEGORY ADD
app.post('/api/admin/category', adm, (q, s) => {
  const name = String(q.body.name || '').trim();
  if (!name) return s.status(400).json({ error: 'Bo‘lim nomini kiriting' });
  if (name.length > 40) return s.status(400).json({ error: 'Bo‘lim nomi 40 belgidan oshmasin' });
  if (CFG.cats.some(c => c.toLowerCase() === name.toLowerCase())) {
    return s.status(400).json({ error: 'Bu bo‘lim allaqachon bor' });
  }
  CFG.cats.push(name);
  save('cfg');
  s.json({ ok: 1, cats: CFG.cats });
});

// ADMIN CATEGORY DELETE
app.delete('/api/admin/category/:index', adm, (q, s) => {
  const index = Number(q.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= CFG.cats.length) {
    return s.status(400).json({ error: 'Bo‘lim topilmadi' });
  }
  if (CFG.cats.length <= 1) {
    return s.status(400).json({ error: 'Kamida bitta bo‘lim qolishi kerak' });
  }
  const fallback = CFG.cats.findIndex((_, i) => i !== index);
  CFG.menu = CFG.menu.map(item => {
    let cat = Number(item.cat);
    if (cat === index) cat = fallback;
    else if (cat > index) cat -= 1;
    return { ...item, cat };
  });
  CFG.cats.splice(index, 1);
  save('cfg');
  s.json({ ok: 1, cats: CFG.cats });
});

// ADMIN MENU ADD / EDIT
app.post('/api/admin/menu', adm, (q, s) => {
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
  save('cfg');
  s.json({ ok: 1 });
});

// ADMIN RESET STATS AND CLEAR ALL ORDERS
app.post('/api/admin/reset-stats', adm, async (_q, s) => {
  O.list = [];
  O.statsResetAt = Date.now();
  await save('orders');
  s.json({ ok: true, statsResetAt: O.statsResetAt, ordersCleared: true });
});

// ADMIN DELETE MENU
app.delete('/api/admin/menu/:id', adm, (q, s) => {
  const targetId = Number(q.params.id);
  CFG.menu = CFG.menu.filter(m => m.id !== targetId);
  save('cfg');
  s.json({ ok: 1 });
});

// ADMIN WAITER PRESENCE
app.post('/api/admin/waiter-presence', adm, async (q, s) => {
  const waiter = CFG.waiters.find(w => String(w.id) === String(q.body.waiterId));
  if (!waiter) return s.status(404).json({ error: 'Ofitsiant topilmadi' });
  if (typeof q.body.online !== 'boolean') return s.status(400).json({ error: 'Onlayn yoki oflayn holatini tanlang' });

  const now = Date.now();
  const shift = O.waiterShifts[waiter.id] || (O.waiterShifts[waiter.id] = { online: false, onlineAt: 0, offlineAt: 0, sessions: [] });
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
  await save('orders');
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
app.post('/api/admin/waiter', adm, (q, s) => {
  const id = Date.now();
  CFG.waiters.push({ id, name: q.body.name, pin: String(q.body.pin) });
  O.waiterShifts[id] = { online: true, onlineAt: Date.now(), offlineAt: 0, sessions: [{ start: Date.now(), end: 0 }] };
  save('cfg');
  save('orders');
  s.json({ ok: 1, id });
});

// ADMIN DELETE WAITER
app.delete('/api/admin/waiter/:id', adm, (q, s) => {
  const targetId = Number(q.params.id);
  CFG.waiters = CFG.waiters.filter(w => w.id !== targetId);
  save('cfg');
  s.json({ ok: 1 });
});

// HELPER: Serve HTML with fallbacks
function sendHtml(res: Response, subfolder: string) {
  const candidates = [
    path.join(PUB, subfolder, 'index.html'),
    path.join(P, 'public', subfolder, 'index.html'),
    path.join(P, 'mnt', 'user-data', 'outputs', 'orzu', 'public', subfolder, 'index.html')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
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

app.get(['/cashier', '/cashier/'], (_q, s) => sendHtml(s, 'cashier'));
app.get(['/waiter', '/waiter/'], (_q, s) => sendHtml(s, 'waiter'));
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
      console.log(`Admin paroli: ${PASS} | Kassir: ${CASHIER_PASS} | Administrator: ${ADMINISTRATOR_PASS}`);
      console.log(`Ofitsiantlar: ${CFG.waiters.map(w => `${w.name} (PIN: ${w.pin})`).join(', ')}`);
    });
  })
  .catch(err => {
    console.error('Serverni ishga tushirishda xato:', err);
    process.exit(1);
  });
