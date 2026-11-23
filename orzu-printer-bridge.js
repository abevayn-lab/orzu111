// ORZU local thermal-printer bridge for Windows laptops
// Run: node orzu-printer-bridge.cjs

const http = require('http');
const net = require('net');

const HOST = '127.0.0.1';
const PORT = 17891;

// 80 mm thermal paper: standard ESC/POS Font A is typically 48 columns.
const RECEIPT_WIDTH = 48;
const divider = (char = '-') => line(char.repeat(RECEIPT_WIDTH));

const API_BASE = (
  process.env.APP_URL ||
  process.env.API_BASE ||
  process.argv[2] ||
  'https://orzu111-production.up.railway.app'
).replace(/\/$/, '');

const PRINT_KEY = process.env.ORZU_PRINT_KEY || 'ORZU-LOCAL-PRINT-KEY-9f42c7b1-2026-11';

let polling = false;
let lastIdleLog = 0;

const CYRILLIC = {
  'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'Yo','Ж':'J','З':'Z','И':'I','Й':'Y',
  'К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F',
  'Х':'X','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Shch','Ъ':'','Ы':'Y','Ь':'','Э':'E','Ю':'Yu','Я':'Ya',
  'Қ':'Q','Ғ':'G','Ў':'O','Ҳ':'H',
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'j','з':'z','и':'i','й':'y',
  'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
  'х':'x','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
  'қ':'q','ғ':'g','ў':'o','ҳ':'h'
};
const esc = s => String(s ?? '').normalize('NFKD')
  .replace(/[‘’ʻʼ`]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/[А-Яа-яЁёҚқҒғЎўҲҳЪъЬьЫыЭэЮюЯя]/g, ch => CYRILLIC[ch] ?? '')
  .replace(/[^\x20-\x7E]/g, '');

const money = n =>
  Math.round(Number(n) || 0).toLocaleString('en-US') + ' som';

function line(s = '') {
  return Buffer.from(esc(s) + '\n', 'ascii');
}

// ORZU 80 mm receipt: compact layout matching the reference receipt.
const fit = (value, width) => {
  const s = esc(value);
  return s.length > width ? s.slice(0, width) : s.padEnd(width, ' ');
};
const amount = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

function makeReceipt(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  const receiptTotal = items.reduce((sum, it) => {
    const qty = Math.max(0, Number(it.qty) || 0);
    const price = Math.max(0, Number(it.price) || 0);
    return sum + price * qty;
  }, 0);
  // Jami va 5% xizmat haqi faqat to'liq yuzliklarda olinadi:
  // 190 -> 100, 120 -> 100, 200 -> 200.
  const floorHundred = n => Math.floor((Number(n) || 0) / 100) * 100;
  const displayedTotal = floorHundred(receiptTotal);
  const serviceFee = floorHundred(receiptTotal * 0.05);
  const grandTotal = displayedTotal + serviceFee;

  const out = [
    Buffer.from([0x1b, 0x40]),
    Buffer.from([0x1b, 0x61, 0x01]),
    Buffer.from([0x1b, 0x45, 0x01]),
    line('ORZU RESTAURANT'),
    Buffer.from([0x1b, 0x45, 0x00]),
    line(''),
    line(''),
    Buffer.from([0x1b, 0x61, 0x00]),
    line('Chek #' + (o.id ?? '-')),
    line('Stol: ' + (o.table ?? '-') + '    Gostey: ' + (o.guests ?? 0)),
    line('Sana: ' + new Date(o.paidAt || o.time || Date.now()).toLocaleDateString('uz-UZ')),
    line('Ochildi: ' + (o.openedAt || '-') + '   Pechat: ' + new Date().toLocaleTimeString('uz-UZ', {hour:'2-digit', minute:'2-digit'})),
    line('Kassir: ' + (o.cashierName || o.cashier || 'Admin')),
    line('Ofitsiant: ' + (o.waiterName || 'Admin')),
    divider('-'),
    line(fit('Блюдо', 25) + fit('Кол-во', 8) + fit('Сумма', 15)),
    divider('-')
  ];

  for (const it of items) {
    const name = esc(it.name || 'Mahsulot');
    const qty = Math.max(0, Number(it.qty) || 0);
    const price = Math.max(0, Number(it.price) || 0);
    const rowTotal = qty * price;
    out.push(line(fit(name, 25) + fit(qty.toFixed(2), 8) + amount(rowTotal).padStart(15, ' ')));
  }

  out.push(
    divider('-'),
    line(fit('Всего:', 33) + amount(displayedTotal).padStart(15, ' ')),
    line(fit('Xizmat 5 %:', 33) + amount(serviceFee).padStart(15, ' ')),
    divider('-'),
    Buffer.from([0x1b, 0x45, 0x01]),
    line(fit('Сум', 25) + amount(grandTotal).padStart(23, ' ')),
    Buffer.from([0x1b, 0x45, 0x00]),
    divider('-'),
    Buffer.from([0x1b, 0x61, 0x01]),
    line(''),
    line('TASHRIFINGIZ UCHUN RAHMAT!'),
    line('INSTAGRAM sahifamizga obuna'),
    line("bo'lgan bo'lsangiz xizmat haqqi"),
    line("olinmaydi!!! @Orzu_Arnasoy"),
    line(''),
    Buffer.from([0x1d, 0x56, 0x42, 0x00])
  );

  return Buffer.concat(out);
}

function send(ip, bytes) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(
      { host: ip, port: 9100, timeout: 5000 },
      () => socket.end(bytes, () => resolve())
    );

    socket.on('error', reject);
    socket.on('timeout', () =>
      socket.destroy(new Error('Printer ulanish vaqti tugadi'))
    );
  });
}

async function pollPrintJobs() {
  if (polling) return;
  polling = true;

  try {
    const r = await fetch(API_BASE + '/api/printer/jobs', {
      headers: { 'x-orzu-print-key': PRINT_KEY }
    });

    if (!r.ok) throw new Error('Print queue HTTP ' + r.status);

    const data = await r.json();

    if (data.job) {
      const job = data.job;

      if (!job.order || !Array.isArray(job.order.items) || !job.order.items.length) {
        throw new Error('Buyurtma ma’lumoti noto‘g‘ri');
      }

      console.log('ORZU buyurtma topildi:', job.order.id);

      await send(
        job.printerIp || '192.168.1.51',
        makeReceipt(job.order)
      );

      const ack = await fetch(API_BASE + '/api/printer/jobs/ack', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-orzu-print-key': PRINT_KEY
        },
        body: JSON.stringify({ id: data.job.id })
      });

      if (!ack.ok) throw new Error('Print acknowledgement failed');

      console.log('ORZU chek muvaffaqiyatli chiqarildi:', job.order.id);

    } else if (Date.now() - lastIdleLog > 30000) {
      console.log('ORZU: server bilan aloqa bor, navbat bo‘sh.');
      lastIdleLog = Date.now();
    }

  } catch (e) {
    if (Date.now() - lastIdleLog > 15000) {
      console.warn('ORZU printer xabari:', e.message);
      lastIdleLog = Date.now();
    }
  } finally {
    polling = false;
  }
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '*';

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-orzu-print-key');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      service: 'ORZU printer bridge',
      targetServer: API_BASE
    }));
  }

  if (req.method !== 'POST' || req.url !== '/print') {
    res.writeHead(404);
    return res.end('Not found');
  }

  let raw = '';

  req.on('data', c => {
    raw += c;

    if (raw.length > 1000000) {
      res.writeHead(413);
      res.end('Too large');
      req.destroy();
    }
  });

  req.on('end', async () => {
    try {
      const body = JSON.parse(raw || '{}');
      const ip = String(body.printerIp || '192.168.1.51');
      const o = body.order;

      if (!o || !Array.isArray(o.items)) {
        throw new Error('Chek ma’lumoti noto‘g‘ri');
      }

      await send(ip, makeReceipt(o));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));

    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: e.message || 'Printer xatosi'
      }));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log('ORZU printer bridge ishga tushdi: http://' + HOST + ':' + PORT);
  console.log('Bog‘langan server manzili: ' + API_BASE);

  pollPrintJobs();
  setInterval(pollPrintJobs, 1000);
});
