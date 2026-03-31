const OBSWebSocket = require('obs-websocket-js').default;
const obs = new OBSWebSocket();
async function run() {
    try {
        await obs.connect('ws://127.0.0.1:4455', '');
        console.log('Connected');
    } catch (err) {
        console.log('Caught error in try/catch:', err.message);
    }
}
run();
