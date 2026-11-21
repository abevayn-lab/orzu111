'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { startBridge } = require(path.join(__dirname, '..', 'orzu-printer-bridge.cjs'));

const CASHIER_URL = 'https://orzu111-production.up.railway.app/cashier';
let mainWindow = null;
let printerService = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#100c09',
    title: 'ORZU KASSA',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(CASHIER_URL);
}

app.whenReady().then(() => {
  try {
    printerService = startBridge();
    console.log('ORZU printer xizmati Electron ichida ishga tushdi.');
  } catch (error) {
    console.error('Printer xizmatini ishga tushirib bo‘lmadi:', error);
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (printerService) {
    try { printerService.stop(); } catch (error) {
      console.error('Printer xizmatini to‘xtatish xatosi:', error);
    }
    printerService = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
