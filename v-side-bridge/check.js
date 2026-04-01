const OBSWebSocket = require('obs-websocket-js').default;
const obs = new OBSWebSocket();
async function run() {
    try {
        console.log("--- OBS フィルタ調査開始 ---");
        // OBS WebSocket (v5.x) に接続
        // パスワードが設定されている場合は、第2引数に入れてください
        await obs.connect('ws://127.0.0.1:4455', ''); 
        
        console.log("接続成功！ソースをスキャン中...");
        const { inputs } = await obs.call('GetInputList');
        
        for (const input of inputs) {
            const { filters } = await obs.call('GetSourceFilterList', { sourceName: input.inputName });
            if (filters.length > 0) {
                console.log(`\n🎧 ソース名: "${input.inputName}"`);
                filters.forEach(f => {
                    console.log(`  └ フィルタ名: "${f.filterName}" / 種類(Kind): "${f.filterKind}"`);
                });
            }
        }
        
        console.log("\n--- 調査終了 ---");
        await obs.disconnect();
        process.exit();
    } catch (e) {
        console.error("\n[エラー発生]:", e.message);
        console.log("原因: OBSが起動していないか、WebSocket設定がデフォルト(ポート4455/パスワードなし)ではない可能性があります。");
        process.exit();
    }
}
run();
