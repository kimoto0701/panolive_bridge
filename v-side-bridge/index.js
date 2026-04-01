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
let channelEqs = {
    0: { low: 0.0, mid: 0.0, high: 0.0 },
    1: { low: 0.0, mid: 0.0, high: 0.0 },
    2: { low: 0.0, mid: 0.0, high: 0.0 }
};
let autoConfig = { port: 4455, password: '' };

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const obs = new OBSWebSocket();

// --- UNIVERSAL DISTRIBUTION & DYNAMIC DISCOVERY ---
let detectedEQKind = 'basic_eq_filter'; // OBS 32.x confirmed correct
let detectedGainKind = 'gain_filter';
let obsVersionInfo = null;

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
        
        // --- 1. GET SYSTEM VERSION ---
        obsVersionInfo = await obs.call('GetVersion');
        logToUI('success', `🧬 OBS ${obsVersionInfo.obsVersion} CONNECTED.`);
        updateStatus('obs', 'connected');
        
        // --- 2. AUTO-DISCOVER CAPABILITIES ---
        await discoverSystemCapabilities();
        
        broadcastSources();
    } catch (err) {
        updateStatus('obs', 'offline');
        setTimeout(connectOBS, 5000);
    }
}

async function discoverSystemCapabilities() {
    try {
        logToUI('info', '[RESEARCH] OBS 環境の全数調査を開始します...');
        const { inputs } = await obs.call('GetInputList');
        
        let foundAnything = false;
        for (const input of inputs) {
            const { filters } = await obs.call('GetSourceFilterList', { sourceName: input.inputName });
            for (const f of filters) {
                foundAnything = true;
                const msg = `[調査] "${input.inputName}" に "${f.filterName}" を発見 (Kind: ${f.filterKind})`;
                logToUI('info', msg);
                
                // --- 究極の「何でもEQとみなす」ロジック ---
                const k = f.filterKind.toLowerCase();
                if (k.includes('eq') || k.includes('equalizer') || k.includes('band')) {
                    if (detectedEQKind !== f.filterKind) {
                        detectedEQKind = f.filterKind;
                        logToUI('success', `[確定] これを操作対象に指定しました: "${detectedEQKind}"`);
                    }
                }
            }
        }
        if (!foundAnything) {
            logToUI('warning', '[調査] 現在フィルタが1つもありません。OBSで手動でEQを追加すると自動学習します。');
        }
    } catch (e) {
        logToUI('error', `[調査失敗] ${e.message}`);
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

    } catch (err) { logToUI('error', `CH-0${id+1} Gain Sync: ${err.message}`); }
}

async function syncEQMulti(id, band, normalizedValue) {
    const mapping = channelMappings[id];
    if (!mapping || obsStatus !== 'connected') return;

    try {
        const sourceName = mapping.sourceName;
        const targetFilterName = `PANOLIVE EQ CH${id + 1}`;
        const dbValue = (normalizedValue * 24.0) - 12.0;

        // ✅ CONFIRMED CORRECT KEYS: low, mid, high (OBS 32.1.0 / basic_eq_filter)
        channelEqs[id][band] = dbValue;

        let exists = false;
        try {
            await obs.call('GetSourceFilter', { sourceName, filterName: targetFilterName });
            exists = true;
        } catch (e) {
            // Fallback chain: prioritize confirmed working kinds
            const kindsToTry = [
                detectedEQKind,
                'basic_eq_filter',       // ✅ OBS 32.x confirmed
                'three_band_eq_filter',  // OBS 29.x legacy
                'obs_three_band_eq_filter',
                'eq_filter',
                'exp_eq_filter',
            ];
            
            for (const kind of kindsToTry) {
                if (!kind) continue;
                try {
                    await obs.call('CreateSourceFilter', {
                        sourceName,
                        filterName: targetFilterName,
                        filterKind: kind,
                        filterSettings: { low: 0.0, mid: 0.0, high: 0.0 }
                    });
                    detectedEQKind = kind;
                    exists = true;
                    logToUI('success', `[EQ] フィルタ作成成功: "${kind}"`);
                    break;
                } catch (err) {
                    // Try next
                }
            }
        }

        if (exists) {
            // ✅ overlay:true to avoid resetting keys not in our payload
            await obs.call('SetSourceFilterSettings', {
                sourceName,
                filterName: targetFilterName,
                filterSettings: channelEqs[id],
                overlay: true
            });
        } else {
            logToUI('error', `[EQ] OBSで使えるEQフィルタ種類が見つかりませんでした。手動でEQを追加してください。`);
        }

    } catch (err) { 
        logToUI('error', `EQ Sync: ${err.message}`); 
    }
}

io.on('connection', (socket) => {
    socket.emit('session_token', { token: sessionToken, lSideUrl: L_SIDE_URL });
    socket.emit('status_update', { id: 'obs', status: obsStatus });
    socket.emit('status_update', { id: 'relay', status: relayStatus });
    broadcastSources();
    
    socket.on('set_active_filter_multi', async (data) => {
        if (!data.sourceName) {
            channelMappings[data.id] = null;
            logToUI('success', `CH-0${data.id + 1} UNLINKED (オフにしました)`);
            if (relayWs && relayWs.readyState === 1) relayWs.send(JSON.stringify({ type: 'track_name', id: data.id, name: 'UNLINKED' }));
        } else {
            channelMappings[data.id] = { sourceName: data.sourceName };
            logToUI('success', `CH-0${data.id + 1} LINKED: ${data.sourceName}`);
            if (relayWs && relayWs.readyState === 1) relayWs.send(JSON.stringify({ type: 'track_name', id: data.id, name: data.sourceName }));
            
            // --- REVERSE LOOKUP (Inspector) ---
            try {
                logToUI('info', `[RESEARCH] Analyzing filters for "${data.sourceName}"...`);
                const { filters } = await obs.call('GetSourceFilterList', { sourceName: data.sourceName });
                
                if (filters.length === 0) {
                    logToUI('info', `[RESEARCH] No filters found on this source.`);
                } else {
                    filters.forEach(f => {
                        logToUI('info', `[INSPECT] Filter: "${f.filterName}" (Kind: ${f.filterKind})`);
                        logToUI('info', `[INSPECT] Current Settings: ${JSON.stringify(f.filterSettings)}`);
                    });
                }
                logToUI('info', `[RESEARCH] Analysis complete.`);
            } catch (e) {
                logToUI('error', `[RESEARCH] Failed to analyze filters: ${e.message}`);
            }
        }
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
            if (msg.type === 'gain') {
                syncGainMulti(msg.id, msg.value); 
            } else if (msg.type === 'eq') {
                syncEQMulti(msg.id, msg.band, msg.value);
            } else if (msg.type === 'get_track_names') {
                console.log(`[リクエスト] 運営側からトラック名の同期要求が来ました`);
                [0, 1, 2].forEach(id => {
                    const mapping = channelMappings[id];
                    const name = (mapping && mapping.sourceName) ? mapping.sourceName : 'UNLINKED';
                    relayWs.send(JSON.stringify({ type: 'track_name', id, name }));
                });
            }
        } catch (err) {}
    });
    relayWs.on('close', () => {
        relayStatus = 'offline';
        updateStatus('relay', 'offline');
        setTimeout(connectRelay, 3000);
    });
    relayWs.on('error', (err) => {
        logToUI('error', `Relay Server Error: ${err.code}`);
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

function killProcessOnPort(port) {
    if (process.platform === 'win32') {
        try {
            const { execSync } = require('child_process');
            const output = execSync(`netstat -ano | findstr :${port}`).toString();
            const lines = output.trim().split('\n');
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                // TCP 0.0.0.0:3001 ... PID
                if (parts.length >= 5 && parts[1].endsWith(`:${port}`)) {
                    const pid = parts[parts.length - 1];
                    if (pid && pid !== '0' && pid != process.pid) {
                        execSync(`taskkill /F /PID ${pid}`);
                        console.log(`[クリア] 前回のプロセス(PID: ${pid})を終了し、ポートを解放しました。`);
                    }
                }
            }
        } catch (e) {
            // Nothing to kill
        }
    }
}

killProcessOnPort(WEB_PORT);

setTimeout(() => {
    httpServer.listen(WEB_PORT, () => {
        console.log(`\n================================`);
        console.log(`[起動成功] VTuber Bridge Monitor`);
        console.log(`================================`);
        console.log(`\n🔗 【招待URL】`);
        console.log(`${L_SIDE_URL}/?session=${sessionToken}\n`);
        console.log(`このURLをコピーして、親機（運営）にお伝えください！`);
        console.log(`--------------------------------`);
        console.log(`ブラウザで詳細画面を見たい場合は http://localhost:${WEB_PORT} を開いてください。\n`);
        console.log('終了する場合は、この黒いウィンドウ（コマンドプロンプト）の右上の×ボタンで閉じてください。\n');
        exec(`start http://localhost:${WEB_PORT}`).on('error', () => {});
    });
}, 500);


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
