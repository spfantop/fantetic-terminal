const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const { randomBytes } = require('crypto');
const express = require('express');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const {
  addElectronNonceHeader,
  isAllowedPopupUrl,
  isTrustedRendererUrl,
} = require('./security');

const PROD_FRONTEND_PORT = 22457;
const PROD_BACKEND_PORT = 22458;

let mainWindow;
let frontendServer;
let backendProcess;
const electronRuntimeNonce = process.env.FANTETIC_ELECTRON_NONCE || randomBytes(32).toString('hex');

const isDevMode = () => process.argv.includes('--dev');

const normalizeAppNameForPath = (name) => (
  (name || 'Fantetic Terminal')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/gi, '')
);

const ensureDirectory = (targetPath) => {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
};

const installBackendNonceInjection = () => {
  session.defaultSession.webRequest.onBeforeSendHeaders({
    urls: [
      `http://localhost:${PROD_BACKEND_PORT}/*`,
      `ws://localhost:${PROD_BACKEND_PORT}/*`,
    ],
  }, (details, callback) => {
    callback({ requestHeaders: addElectronNonceHeader(details, electronRuntimeNonce) });
  });
};

const installWindowTrustSeam = (browserWindow, frontendUrl, { allowAboutBlank = false } = {}) => {
  browserWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (isTrustedRendererUrl(navigationUrl, frontendUrl)) return;
    if (allowAboutBlank && navigationUrl === 'about:blank') return;
    event.preventDefault();
  });

  browserWindow.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
    if (!isAllowedPopupUrl(popupUrl, frontendUrl)) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      },
    };
  });

  browserWindow.webContents.on('did-create-window', (childWindow) => {
    installWindowTrustSeam(childWindow, frontendUrl, { allowAboutBlank: true });
  });
};

const isTrustedIpcSender = (event) => Boolean(
  mainWindow
  && !mainWindow.isDestroyed()
  && event.sender === mainWindow.webContents
  && event.senderFrame === mainWindow.webContents.mainFrame
  && isTrustedRendererUrl(event.senderFrame.url, mainWindow.getURL()),
);

const createMainWindow = async () => {
  const Store = (await import('electron-store')).default;
  const store = new Store();
  const defaultBounds = { width: 1200, height: 800 };
  const lastWindowState = store.get('windowBounds', defaultBounds);

  mainWindow = new BrowserWindow({
    width: lastWindowState.width,
    height: lastWindowState.height,
    x: lastWindowState.x,
    y: lastWindowState.y,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const frontendUrl = isDevMode()
    ? `http://localhost:${PROD_FRONTEND_PORT}`
    : await startProductionServices();

  installBackendNonceInjection();
  installWindowTrustSeam(mainWindow, frontendUrl);
  mainWindow.loadURL(frontendUrl);

  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDevMode()) {
    mainWindow.webContents.openDevTools();
  }
};

const startProductionServices = async () => {
  const appNameForPath = normalizeAppNameForPath(app.getName());
  const backendDataPath = path.join(app.getPath('userData'), appNameForPath, 'backend-data');
  ensureDirectory(backendDataPath);

  startBackendProcess(backendDataPath);
  await startFrontendServer();

  return `http://localhost:${PROD_FRONTEND_PORT}`;
};

const pipeProcessOutput = (processName, childProcess) => {
  childProcess.stdout.on('data', (data) => {
    console.log(`[${processName} STDOUT] ${data.toString().trim()}`);
  });

  childProcess.stderr.on('data', (data) => {
    console.error(`[${processName} STDERR] ${data.toString().trim()}`);
  });
};

const startBackendProcess = (backendDataPath) => {
  const backendResourcesPath = path.join(process.resourcesPath, 'packages/backend');
  backendProcess = spawn(process.execPath, ['dist/index.js'], {
    cwd: backendResourcesPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      APP_BACKEND_DATA_PATH: backendDataPath,
      ELECTRON_RUN_AS_NODE: '1',
      FANTETIC_APP_MODE: 'electron',
      FANTETIC_ELECTRON_NONCE: electronRuntimeNonce,
      HOST: '127.0.0.1',
      PORT: String(PROD_BACKEND_PORT),
      RP_ORIGIN: `http://localhost:${PROD_FRONTEND_PORT}`,
      NODE_ENV: 'production',
    },
  });

  pipeProcessOutput('Backend', backendProcess);

  backendProcess.on('close', (code) => {
    console.log(`[Backend Process] exited with code ${code}`);
    backendProcess = null;
  });

  backendProcess.on('error', (error) => {
    console.error('[Backend Process] Failed to start:', error);
    app.quit();
  });
};

const startFrontendServer = async () => {
  const frontendApp = express();
  const staticPath = path.join(process.resourcesPath, 'packages/frontend/dist');

  frontendApp.use(express.static(staticPath));
  frontendApp.get(/^(?!\/api\/).*$/, (_req, res) => {
    res.sendFile(path.join(staticPath, 'index.html'));
  });

  frontendServer = http.createServer(frontendApp);

  await new Promise((resolve, reject) => {
    frontendServer
      .listen(PROD_FRONTEND_PORT, '127.0.0.1', resolve)
      .on('error', reject);
  });
};

const stopProductionServices = () => {
  if (frontendServer) {
    frontendServer.close();
    frontendServer = null;
  }

  if (backendProcess) {
    const processToStop = backendProcess;
    backendProcess = null;
    processToStop.kill('SIGINT');

    setTimeout(() => {
      if (!processToStop.killed) {
        processToStop.kill('SIGTERM');
      }
    }, 5000);
  }

};

app.on('ready', () => {
  createMainWindow().catch((error) => {
    console.error('Error during createMainWindow:', error);
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', stopProductionServices);

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});

ipcMain.on('toMain', (event, args) => {
  if (!isTrustedIpcSender(event)) return;
  console.log('Message from renderer:', args);
});

ipcMain.on('minimize-window', (event) => {
  if (!isTrustedIpcSender(event)) return;
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('close-window', (event) => {
  if (!isTrustedIpcSender(event)) return;
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.on('toggle-maximize-window', (event) => {
  if (!isTrustedIpcSender(event)) return;
  if (!mainWindow) return;

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
