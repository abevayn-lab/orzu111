
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(express.json({ limit: '12mb' }));

const PASS = process.env.ADMIN_PASS || 'admin123';
const ADMINISTRATOR_PASS = process.env.ADMINISTRATOR_PASS || '';
const CASHIER_PASS = process.env.CASHIER_PASS || PASS;
const PRINT_KEY = process.env.ORZU_PRINT_KEY || 'ORZU-LOCAL-PRINT-KEY-9f42c7b1-2026-11';
const SU = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SK = process.env.SUPABASE_KEY;

const DEFAULT_CATS = [
  '1-chi taom',
  '2-chi taom',
  'Salat va ichimliklar',
  'Boshqa'
];

const P = __dirname;
const PUB = path.join(__dirname, 'mnt', 'user-data', 'outputs', 'orzu', 'public');
const LF = path.join(P, 'data.json');

const HD = {
  apikey: SK,
  Authorization: 'Bearer ' + SK,
  'Content-Type': 'application/json'
};

let CFG = {
  cats: [...DEFAULT_CATS],
  menu: [],
  waiters: [
    { id: 1, name: 'Ofitsiant 1', pin: '1111' },
    { id: 2, name: 'Ofitsiant 2', pin: '2222' }
  ]
};

let O = {
  list: [],
  seq: 10,
  nextWaiterIndex: 0,
  dayClosures: { waiters: {}, cashier: 0, administrator: 0, admin: 0 },
  waiterShifts: {},
  cashierSettings: { printerIp: '192.168.1.51' }
};

// DATABASE LOAD
async function load() {
  if (SU) {
    for (const k of ['cfg', 'orders']) {
      const r = await fetch(
        `${SU}/rest/v1/store?key=eq.${k}&select=data`,
        { headers: HD }
      );

      if (!r.ok) throw new Error(await r.text());

      const j = await r.json();

      if (j[0]) {
        if (k === 'cfg') CFG = j[0].data;
        else O = j[0].data;
      }
    }
  } else if (fs.existsSync(LF)) {
    const d = JSON.parse(fs.readFileSync(LF, 'utf8'));
    CFG = d.CFG || CFG;
    O = d.O || O;
  }

  // Eski bazadagi kategoriyalarni saqlab, yangi sozlamaga moslashtiramiz.
  if (!Array.isArray(CFG.cats) || !CFG.cats.length) CFG.cats = [...DEFAULT_CATS];
  if (!Array.isArray(CFG.menu)) CFG.menu = [];
  if (!Array.isArray(CFG.waiters)) CFG.waiters = [];
  // Navbat indeksi eski bazalarda bo'lmasa, birinchi ofitsiantdan boshlaymiz.
  if (!Number.isInteger(O.nextWaiterIndex) || O.nextWaiterIndex < 0) {
    O.nextWaiterIndex = 0;
  }
  if (!O.dayClosures || typeof O.dayClosures !== 'object') O.dayClosures = { waiters: {}, administrator: 0, admin: 0 };
  if (!Number.isFinite(Number(O.statsResetAt))) O.statsResetAt = 0;
  if (!O.dayClosures.waiters || typeof O.dayClosures.waiters !== 'object') O.dayClosures.waiters = {};
  if (!Number.isFinite(Number(O.dayClosures.admin))) O.dayClosures.admin = 0;
  if (!Number.isFinite(Number(O.dayClosures.cashier))) O.dayClosures.cashier = 0;
  if (!O.waiterShifts || typeof O.waiterShifts !== 'object') O.waiterShifts = {};
  // Server qayta ishga tushganda ochiq smenalarni avtomatik yopamiz.
  let recoveredShift = false;
  const restartAt = Date.now();
  for (const w of CFG.waiters) {
    const shift = O.waiterShifts[w.id] || (O.waiterShifts[w.id] = { online: false, onlineAt: 0, offlineAt: 0, sessions: [] });
    if (!Array.isArray(shift.sessions)) shift.sessions = [];
    if (shift.online) {
      shift.online = false;
      shift.offlineAt = restartAt;
      const openSession = [...shift.sessions].reverse().find(x => !x.end);
      if (openSession) openSession.end = restartAt;
      recoveredShift = true;
    }
  }
  if (recoveredShift) save('orders');
  if (!Number.isFinite(Number(O.dayClosures.cashier))) O.dayClosures.cashier = 0;
  if (!Number.isFinite(Number(O.dayClosures.administrator))) O.dayClosures.administrator = 0;
  if (!O.cashierSettings || typeof O.cashierSettings !== 'object') O.cashierSettings = { printerIp: '192.168.1.51' };
  if (typeof O.cashierSettings.printerIp !== 'string') O.cashierSettings.printerIp = '192.168.1.51';
  if (!Array.isArray(O.printJobs)) O.printJobs = [];
}

// DATABASE SAVE
let q0 = Promise.resolve();

function save(k) {
  if (!SU) {
    fs.writeFileSync(LF, JSON.stringify({ CFG, O }));
    return Promise.resolve();
  }

  const body = JSON.stringify({
    key: k,
    data: k === 'cfg' ? CFG : O
  });

  // Oldingi saqlash xatosi navbatdagi saqlashlarni bloklab qo'ymasligi kerak.
  const operation = q0.catch(() => {}).then(async () => {
    const r = await fetch(`${SU}/rest/v1/store`, {
      method: 'POST',
      headers: {
        ...HD,
        Prefer: 'resolution=merge-duplicates'
      },
      body
    });

    if (!r.ok) throw new Error('Saqlash xato: ' + await r.text());
  });
  q0 = operation;
  return operation;
}

// ADMIN AUTH
function adm(q, s, n) {
  if (q.headers['x-admin'] === PASS) return n();
  return s.status(401).json({ error: 'auth' });
}

// SEPARATE ADMINISTRATOR AUTH
function administrator(q, s, n) {
  if (ADMINISTRATOR_PASS && q.headers['x-administrator'] === ADMINISTRATOR_PASS) return n();
  return s.status(401).json({ error: ADMINISTRATOR_PASS ? 'auth' : 'Administrator paroli Railway Variables’da sozlanmagan' });
}

// CASHIER AUTH
function cashier(q, s, n) {
  if (q.headers['x-cashier'] === CASHIER_PASS) return n();
  return s.status(401).json({ error: 'auth' });
}

// WAITER AUTH
function wt(q, s, n) {
  const w = CFG.waiters.find(
    w => w.id == q.query.id && w.pin == q.query.pin
  );

  if (!w) return s.status(401).json({ error: 'auth' });

  q.w = w;
  n();
}

// HEALTH
app.get('/health', (q, s) => {
  s.json({
    ok: true,
    db: SU ? 'supabase' : 'file',
    menu: CFG.menu.length,
    orders: O.list.length
  });
});

// CUSTOMER MENU
app.get('/api/menu', (q, s) => {
  s.json({
    cats: CFG.cats,
    menu: CFG.menu.filter(m => !m.hidden)
  });
});

// CUSTOMER ORDER
app.post('/api/order', (q, s) => {
  const table = String(q.body.table || '').trim();
  const items = [];

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

  // Yangi mijoz zakazlari faqat ONLAYN ofitsiantlarga navbat bilan beriladi.
  const activeWaiters = CFG.waiters.filter(w => w && w.id != null && String(w.name || '').trim() && O.waiterShifts?.[w.id]?.online === true);
  if (!activeWaiters.length) return s.status(503).json({ error: 'Hozir onlayn ofitsiant yo‘q. Iltimos, birozdan keyin urinib ko‘ring.' });
  const waiterIndex = O.nextWaiterIndex % activeWaiters.length;
  const w = activeWaiters[waiterIndex];
  const wid = w.id;
  O.nextWaiterIndex = (waiterIndex + 1) % activeWaiters.length;

  const o = {
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
app.get('/api/waiters', (q, s) => {
  s.json(CFG.waiters.map(({ id, name }) => ({ id, name })));
});

// WAITER PRESENCE: ofitsiant smenasini boshlash/yakunlash va vaqtini qayd etish.
app.get('/api/waiter/presence', wt, (q, s) => {
  const shift = O.waiterShifts?.[q.w.id] || { online: false, onlineAt: 0, offlineAt: 0, sessions: [] };
  s.json({ online: !!shift.online, onlineAt: Number(shift.onlineAt || 0), offlineAt: Number(shift.offlineAt || 0), sessions: shift.sessions || [] });
});
app.post('/api/waiter/presence', wt, (q, s) => {
  return s.status(403).json({ error: 'Ofitsiant holatini faqat kassir o‘zgartira oladi.' });
});

// WAITER ORDERS
app.get('/api/waiter/orders', wt, (q, s) => {
  s.json(
    O.list
      .filter(o => o.waiter === q.w.id && Number(o.time || 0) >= Number(O.dayClosures.waiters[q.w.id] || 0))
      .slice(-80)
      .reverse()
  );
});

// WAITER CLOSE DAY: faqat shu ofitsiant ekranidagi buyurtmalarni yashiradi.
app.post('/api/waiter/close-day', (q, s, n) => { q.query = q.body; n(); }, wt, (q, s) => {
  O.dayClosures.waiters[q.w.id] = Date.now();
  save('orders');
  s.json({ ok: true, closedAt: O.dayClosures.waiters[q.w.id] });
});

// WAITER STATUS
app.post('/api/waiter/status', (q, s, n) => {
  q.query = q.body;
  n();
}, wt, (q, s) => {
  if (O.waiterShifts?.[q.w.id]?.online !== true) return s.status(403).json({ error: 'Buyurtma holatini o‘zgartirish uchun avval Onlayn bo‘ling.' });
  const o = O.list.find(
    o => o.id == q.body.orderId && o.waiter === q.w.id
  );

  if (o && ['accepted', 'served'].includes(q.body.status)) {
    o.status = q.body.status;
    save('orders');
  }

  s.json({ ok: 1 });
});

// WAITER ADD ITEMS (to an existing order, or a new order for a table)
app.post('/api/waiter/add', (q, s, n) => {
  q.query = q.body;
  n();
}, wt, (q, s) => {
  if (O.waiterShifts?.[q.w.id]?.online !== true) return s.status(403).json({ error: 'Yangi buyurtma olish uchun avval Onlayn bo‘ling.' });
  const items = [];

  for (const i of q.body.items || []) {
    const m = CFG.menu.find(m => m.id == i.id);
    const qty = Math.min(99, Number(i.qty) | 0);

    if (m && qty > 0) items.push({ name: m.name, price: m.price, img: m.img || '', qty });
  }

  if (!items.length) {
    return s.status(400).json({ error: "Taom tanlanmagan" });
  }

  let o;

  if (q.body.orderId) {
    o = O.list.find(
      o => o.id == q.body.orderId && o.waiter === q.w.id
    );

    if (!o || o.status === 'paid') {
      return s.status(400).json({ error: 'Buyurtma topilmadi' });
    }

    for (const it of items) {
      const ex = o.items.find(
        x => x.name === it.name && x.price === it.price
      );

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
      waiter: q.w.id,
      waiterName: q.w.name,
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


// WAITER PRINT: queue this waiter's own order for the laptop bridge
app.post('/api/waiter/print', (q, s, n) => { q.query = q.body; n(); }, wt, (q, s) => {
  if (O.waiterShifts?.[q.w.id]?.online !== true) return s.status(403).json({ error: 'Chek yuborish uchun avval Onlayn bo‘ling.' });
  const o = O.list.find(x => String(x.id) === String(q.body.orderId) && x.waiter === q.w.id);
  if (!o) return s.status(404).json({ error: 'Buyurtma topilmadi' });
  if (!Array.isArray(o.items) || !o.items.length) return s.status(400).json({ error: 'Buyurtmada taom yo‘q' });
  const job = {
    id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
    printerIp: O.cashierSettings?.printerIp || '192.168.1.51',
    order: { ...o, waiterName: o.waiterName || q.w.name }
  };
  O.printJobs.push(job);
  save('orders');
  s.json({ ok: true, message: 'Chek printerga yuborildi' });
});

// LOCAL BRIDGE: fetch one queued print job
app.get('/api/printer/jobs', (q, s) => {
  if (q.headers['x-orzu-print-key'] !== PRINT_KEY) return s.status(401).json({ error: 'auth' });
  // Drop jobs stuck for more than 10 minutes so one failed print can't block the queue.
  const cutoff = Date.now() - 10 * 60 * 1000;
  const fresh = (O.printJobs || []).filter(j => Number(String(j.id).split('-')[0]) >= cutoff);
  if (fresh.length !== (O.printJobs || []).length) { O.printJobs = fresh; save('orders'); }
  s.json({ job: fresh[0] || null });
});

// LOCAL BRIDGE: acknowledge a successfully printed job
app.post('/api/printer/jobs/ack', (q, s) => {
  if (q.headers['x-orzu-print-key'] !== PRINT_KEY) return s.status(401).json({ error: 'auth' });
  const before = (O.printJobs || []).length;
  O.printJobs = (O.printJobs || []).filter(j => String(j.id) !== String(q.body.id));
  if (O.printJobs.length !== before) save('orders');
  s.json({ ok: true });
});

// CASHIER: all orders and printer settings
app.get('/api/cashier/data', cashier, (q, s) => {
  const closedAt = Number(O.dayClosures.cashier || 0);
  s.set('Cache-Control', 'no-store');
  s.json({
    orders: O.list.filter(o => Number(o.time || 0) >= closedAt).sort((a, b) => Number(b.time || 0) - Number(a.time || 0)),
    waiters: CFG.waiters.map(({ id, name }) => ({ id, name, shift: O.waiterShifts?.[id] || { online: false, onlineAt: 0, offlineAt: 0, sessions: [] } })),
    settings: O.cashierSettings || { printerIp: '192.168.1.51' }
  });
});

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
  try {
    await save('orders');
  } catch (e) {
    console.error('Ofitsiant smenasini saqlashda xato:', e);
    return s.status(500).json({ error: 'Ofitsiant holati bazaga saqlanmadi. Qayta urinib ko‘ring.' });
  }
  s.json({ ok: true, waiterId: waiter.id, name: waiter.name, online: !!shift.online, onlineAt: Number(shift.onlineAt || 0), offlineAt: Number(shift.offlineAt || 0) });
});

app.post('/api/cashier/settings', cashier, (q, s) => {
  const ip = String(q.body.printerIp || '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || ip.split('.').some(x => Number(x) > 255)) {
    return s.status(400).json({ error: 'Printer IP manzilini to‘g‘ri kiriting' });
  }
  O.cashierSettings = { ...(O.cashierSettings || {}), printerIp: ip };
  save('orders');
  s.json({ ok: true, settings: O.cashierSettings });
});

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


// CASHIER CLOSE DAY: faqat kassirning kunlik ish oynasini yopadi; buyurtmalar tarixi saqlanadi.
app.post('/api/cashier/close-day', cashier, (q, s) => {
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

// CASHIER PAGE
app.get(['/cashier', '/cashier/'], (q, s) => {
  s.sendFile(path.join(PUB, 'cashier', 'index.html'));
});

// ADMIN DATA
app.get('/api/admin/data', adm, (q, s) => {
  const closedAt = Number(O.dayClosures.admin || 0);
  s.json({
    cats: CFG.cats,
    menu: CFG.menu,
    waiters: CFG.waiters.map(w => ({ ...w, shift: O.waiterShifts?.[w.id] || { online: false, onlineAt: 0, offlineAt: 0, sessions: [] } })),
    orders: O.list.filter(o => Number(o.time || 0) >= closedAt),
    history: O.list,
    statsResetAt: Number(O.statsResetAt || 0)
  });
});

// ADMIN CLOSE DAY: faqat Admin panelidagi joriy ro‘yxatni yashiradi, tarixni saqlaydi.
app.post('/api/admin/close-day', adm, (q, s) => {
  O.dayClosures.admin = Date.now();
  save('orders');
  s.json({ ok: true, closedAt: O.dayClosures.admin });
});

// SEPARATE ADMINISTRATOR: ALL ORDERS FROM ALL WAITERS
app.get('/api/administrator/data', administrator, (q, s) => {
  const closedAt = Number(O.dayClosures.administrator || 0);
  s.json({ waiters: CFG.waiters.map(({ id, name }) => ({ id, name })), orders: O.list.filter(o => Number(o.time || 0) >= closedAt) });
});

// ADMINISTRATOR CLOSE DAY: faqat Administrator ekranidagi buyurtmalarni yashiradi.
app.post('/api/administrator/close-day', administrator, (q, s) => {
  O.dayClosures.administrator = Date.now();
  save('orders');
  s.json({ ok: true, closedAt: O.dayClosures.administrator });
});

// ADMIN ADD CATEGORY
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

// ADMIN DELETE CATEGORY
app.delete('/api/admin/category/:index', adm, (q, s) => {
  const index = Number(q.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= CFG.cats.length) {
    return s.status(400).json({ error: 'Bo‘lim topilmadi' });
  }
  if (CFG.cats.length <= 1) {
    return s.status(400).json({ error: 'Kamida bitta bo‘lim qolishi kerak' });
  }

  // Taomlari o‘chirilgan bo‘limdagi taomlarni boshqa bo‘limga ko‘chiramiz.
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

// ADMIN ADD / EDIT MENU
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

app.post('/api/admin/reset-stats', adm, (q, s) => {
  O.statsResetAt = Date.now();
  save('orders');
  s.json({ ok: true, statsResetAt: O.statsResetAt, historyPreserved: true });
});

// Keep order history immutable through the Admin API.
app.delete('/api/admin/orders', adm, (q, s) => {
  s.status(410).json({ error: 'Buyurtmalar tarixi o‘chirilmaydi. Kunlik ishni yopish funksiyasidan foydalaning.' });
});

// ADMIN DELETE MENU
app.delete('/api/admin/menu/:id', adm, (q, s) => {
  CFG.menu = CFG.menu.filter(m => m.id != q.params.id);
  save('cfg');
  s.json({ ok: 1 });
});

// ADMIN ADD WAITER
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
  try {
    await save('orders');
  } catch (e) {
    console.error('Admin orqali ofitsiant smenasini saqlashda xato:', e);
    return s.status(500).json({ error: 'Ofitsiant holati bazaga saqlanmadi. Qayta urinib ko‘ring.' });
  }
  s.json({ ok: true, waiterId: waiter.id, name: waiter.name, online: !!shift.online, onlineAt: Number(shift.onlineAt || 0), offlineAt: Number(shift.offlineAt || 0) });
});

app.post('/api/admin/waiter', adm, (q, s) => {
  const id = Date.now();
  CFG.waiters.push({ id, name: q.body.name, pin: String(q.body.pin) });
  O.waiterShifts[id] = { online: false, onlineAt: 0, offlineAt: 0, sessions: [] };
  save('cfg');
  save('orders');
  s.json({ ok: 1 });
});

// ADMIN DELETE WAITER
app.delete('/api/admin/waiter/:id', adm, (q, s) => {
  CFG.waiters = CFG.waiters.filter(w => w.id != q.params.id);
  save('cfg');
  s.json({ ok: 1 });
});

// CUSTOMER PAGE
app.get('/', (q, s) => {
  s.sendFile(path.join(P, 'index.html'));
});

// SEPARATE ADMINISTRATOR PAGE — serve index.html directly from its own folder
const ADMINISTRATOR_PUBLIC = path.join(PUB, 'administrator');
app.use('/administrator', express.static(ADMINISTRATOR_PUBLIC, {
  index: 'index.html',
  fallthrough: true,
  extensions: ['html']
}));

// ADMIN PAGE
app.get(['/admin', '/admin/'], (q, s) => {
  s.sendFile(path.join(PUB, 'admin', 'index.html'));
});

// WAITER PAGE
app.get(['/waiter', '/waiter/'], (q, s) => {
  s.sendFile(path.join(PUB, 'waiter', 'index.html'));
});

// STATIC FILES
app.use(express.static(P));

// START SERVER
load()
  .then(() => {
    const PORT = process.env.PORT || 3000;

    app.listen(PORT, '0.0.0.0', () => {
      console.log(
        'Orzu ishga tushdi, baza:',
        SU ? 'Supabase' : 'fayl'
      );
      console.log('Administrator sahifasi:', fs.existsSync(path.join(ADMINISTRATOR_PUBLIC, 'index.html')) ? 'TOPILDI' : 'TOPILMADI', path.join(ADMINISTRATOR_PUBLIC, 'index.html'));
    });
  })
  .catch(e => {
    console.error('Bazaga ulanib bo‘lmadi:', e.message);
    process.exit(1);
  });
