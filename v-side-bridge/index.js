const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const OBSWebSocket = require('obs-websocket-js').default;
const crypto = require('crypto');

// --- Runtime Configuration ---
const configPath = path.join(process.cwd(), 'config.json');
let fileConfig = {};
if (fs.existsSync(configPath)) {
    try { fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch(e) { console.error('config.json load error', e); }
}

const RELAY_URL = process.env.RELAY_URL || fileConfig.RELAY_URL || 'ws://localhost:8080';
const L_SIDE_URL = process.env.L_SIDE_URL || fileConfig.L_SIDE_URL || 'http://localhost:5173';
const WEB_PORT = 3001;

// Rebranded Session Token
const sessionToken = crypto.randomBytes(3).toString('hex').toUpperCase();
let obsStatus = 'offline';
let relayStatus = 'offline';

// Multi-Channel State (ID: 0, 1, 2)
let channelMappings = { 0: null, 1: null, 2: null };
let autoConfig = { port: 4455, password: '' };

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const obs = new OBSWebSocket();

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

function logToUI(type, message) {
    const timestamp = new Date().toLocaleTimeString();
    io.emit('log', { timestamp, type, message });
}

function updateStatus(id, status) {
    if (id === 'obs') obsStatus = status;
    if (id === 'relay') relayStatus = status;
    io.emit('status_update', { id, status });
}

// --- OBS Auto-Discovery ---
function findOBSSettings() {
    const configPath = process.platform === 'darwin' 
        ? path.join(os.homedir(), 'Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json')
        : path.join(process.env.APPDATA || '', 'obs-studio/plugin_config/obs-websocket/config.json');
    if (fs.existsSync(configPath)) {
        try {
            const json = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            autoConfig.port = json.server_port || 4455;
            autoConfig.password = json.server_password || '';
            return true;
        } catch (e) {}
    }
    return false;
}

async function connectOBS() {
    updateStatus('obs', 'connecting');
    try {
        await obs.connect(`ws://127.0.0.1:${autoConfig.port}`, autoConfig.password);
        logToUI('success', '🧬 PANOLIVE Bridge Fully Synchronized.');
        updateStatus('obs', 'connected');
        broadcastSources();
    } catch (err) {
        updateStatus('obs', 'offline');
        setTimeout(connectOBS, 5000);
    }
}

async function broadcastSources() {
    if (obsStatus !== 'connected') return;
    try {
        const { inputs } = await obs.call('GetInputList');
        io.emit('filter_list', inputs.map(i => ({ sourceName: i.inputName })));
    } catch (err) {}
}

const THROTTLE_MS = 40; 
let lastHandled = { 0: 0, 1: 0, 2: 0 };

async function syncGainMulti(id, normalizedValue) {
    const mapping = channelMappings[id];
    if (!mapping || obsStatus !== 'connected') return;
    
    const now = Date.now();
    if (now - lastHandled[id] < THROTTLE_MS) return;
    lastHandled[id] = now;

    try {
        const sourceName = mapping.sourceName;
        // --- NEW REBRANDED FILTER NAME ---
        const targetFilterName = `PANOLIVE Remote CH${id + 1}`;
        
        // --- ABSOLUTE SYNC MAPPING: -30.0 to +30.0 dB ---
        const dbValue = (normalizedValue * 60.0) - 30.0;

        try {
            await obs.call('GetSourceFilter', { sourceName, filterName: targetFilterName });
        } catch (e) {
            await obs.call('CreateSourceFilter', {
                sourceName,
                filterName: targetFilterName,
                filterKind: 'gain_filter',
                filterSettings: { db: 0.0 }
            });
        }

        await obs.call('SetSourceFilterSettings', {
            sourceName,
            filterName: targetFilterName,
            filterSettings: { db: dbValue }
        });

    } catch (err) { logToUI('error', `CH-0${id+1} Sync: ${err.message}`); }
}

io.on('connection', (socket) => {
    socket.emit('session_token', { token: sessionToken, lSideUrl: L_SIDE_URL });
    socket.emit('status_update', { id: 'obs', status: obsStatus });
    socket.emit('status_update', { id: 'relay', status: relayStatus });
    broadcastSources();
    
    socket.on('set_active_filter_multi', (data) => {
        channelMappings[data.id] = { sourceName: data.sourceName };
        logToUI('success', `CH-0${data.id + 1} LINKED: ${data.sourceName}`);
    });
});

let relayWs;
function connectRelay() {
    relayWs = new WebSocket(RELAY_URL);
    relayWs.on('open', () => {
        relayStatus = 'connected';
        updateStatus('relay', 'connected');
        relayWs.send(JSON.stringify({ type: 'join', room: sessionToken }));
    });
    relayWs.on('message', (data) => {
        try { 
            const msg = JSON.parse(data); 
            if (msg.type === 'gain') syncGainMulti(msg.id, msg.value); 
        } catch (err) {}
    });
    relayWs.on('close', () => {
        relayStatus = 'offline';
        updateStatus('relay', 'offline');
        setTimeout(connectRelay, 3000);
    });
}

findOBSSettings();
connectOBS();
connectRelay();

httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n[エラー] ポート ${WEB_PORT} が既に使用されています。`);
        console.error('既にアプリが起動しているか、バックグラウンドで動いている可能性があります。');
    } else {
        console.error(`\n[エラー] サーバーの起動に失敗しました:`, err.message);
    }
    console.log('\n何かキーを押すと終了します...');
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on('data', () => process.exit(1));
});

httpServer.listen(WEB_PORT, () => {
    console.log(`\n[起動成功] VTuber Bridge Monitorが起動しました。`);
    console.log(`ブラウザで http://localhost:${WEB_PORT} を開いてください。\n`);
    console.log('終了する場合は、この黒いウィンドウ（コマンドプロンプト）の右上の×ボタンで閉じてください。\n');
    exec(`start http://localhost:${WEB_PORT}`).on('error', () => {});
});

process.on('uncaughtException', (err) => {
    console.error('\n[予期せぬエラーが発生しました]');
    console.error(err);
    console.log('\n何かキーを押すと終了します...');
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on('data', () => process.exit(1));
});
