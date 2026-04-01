import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useMotionValue } from 'framer-motion';
import { Activity } from 'lucide-react';

const RELAY_URL = window.location.protocol === 'https:' ? `wss://${window.location.host}` : `ws://${window.location.host}`;
const DB_MIN = -30.0;
const DB_MAX = 30.0;
const TRACK_HEIGHT = 280;

// --- CYBER UI COMPONENTS ---

const CyberMeter = ({ value }: { value: number }) => {
  const norm = Math.max(0, Math.min(1, (value - DB_MIN) / (DB_MAX - DB_MIN)));
  return (
    <div className="h-[280px] w-4 bg-black/80 border-x border-cyan-500/20 relative overflow-hidden">
      <motion.div 
        animate={{ height: `${norm * 100}%` }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="absolute bottom-0 w-full bg-gradient-to-t from-cyan-600 via-cyan-400 to-white shadow-[0_0_20px_#06b6d4]"
      />
      <div className="absolute inset-0 flex flex-col justify-between p-0.5 opacity-20 pointer-events-none">
        {Array.from({ length: 14 }).map((_, i) => <div key={i} className="w-full h-[1px] bg-cyan-300" />)}
      </div>
    </div>
  );
};

// --- PRO-STYLE KNOB COMPONENT (Mouse + iPad Touch対応) ---
const CyberKnob = ({ label, value, onChange, isEnabled }: { label: string, value: number, onChange: (val: number) => void, isEnabled: boolean }) => {
    const isDragging = useRef(false);
    const lastY = useRef(0);

    // --- PointerEvents: マウスとタッチを統一処理 ---
    const onPointerDown = (e: React.PointerEvent) => {
        if (!isEnabled) return;
        isDragging.current = true;
        lastY.current = e.clientY;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!isDragging.current || !isEnabled) return;
        const delta = lastY.current - e.clientY;
        lastY.current = e.clientY;
        const newVal = Math.max(0, Math.min(1, value + delta / 200));
        onChange(newVal);
        e.preventDefault();
    };

    const onPointerUp = () => {
        isDragging.current = false;
    };

    const angle = (value * 270) - 135;
    
    // SVG Arc for visual feedback
    const radius = 16;
    const circumference = 2 * Math.PI * radius;

    return (
        <div className="flex flex-col items-center gap-2 group/knob">
            <div className={`text-[11px] font-black mb-1 transition-all ${isEnabled ? 'text-cyan-400 group-hover/knob:scale-110' : 'text-white/10'}`}>{label}</div>
            <div 
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onDoubleClick={() => isEnabled && onChange(0.5)}
                style={{ touchAction: 'none' }}
                className={`relative w-14 h-14 rounded-full transition-all cursor-ns-resize flex items-center justify-center ${isEnabled ? 'bg-black/60 border-2 border-cyan-500/30' : 'bg-transparent border-white/5 cursor-not-allowed'}`}
            >
                {/* SVG Ring */}
                <svg className="absolute inset-0 w-full h-full -rotate-[225deg]" viewBox="0 0 40 40">
                    <circle
                        cx="20" cy="20" r={radius}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="text-white/5"
                        strokeDasharray={circumference}
                        strokeDashoffset={circumference * 0.25}
                    />
                    {isEnabled && (
                        <motion.circle
                            cx="20" cy="20" r={radius}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="text-cyan-400 shadow-[0_0_10px_#22d3ee]"
                            strokeDasharray={circumference}
                            animate={{ strokeDashoffset: circumference - (value * 0.75 * circumference) }}
                            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                            strokeLinecap="round"
                        />
                    )}
                </svg>

                {/* Knob Body */}
                <motion.div 
                    style={{ rotate: angle }}
                    className={`w-8 h-8 rounded-full border flex items-center justify-center relative shadow-xl ${isEnabled ? 'bg-gradient-to-br from-cyan-900 to-black border-cyan-500/40' : 'bg-transparent border-white/10'}`}
                >
                    {/* Indicator Dot */}
                    <div className={`absolute top-1 w-1 h-1.5 rounded-full ${isEnabled ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]' : 'bg-white/10'}`} />
                </motion.div>

                {/* Value Text (Floating on hover or always) */}
                <div className={`absolute -bottom-5 text-[10px] font-mono font-black tabular-nums whitespace-nowrap transition-all ${isEnabled ? 'text-cyan-400 opacity-80 group-hover/knob:opacity-100' : 'text-white/10 opacity-0'}`}>
                    {value > 0.51 ? '+' : value < 0.49 ? '' : ''}{Math.round((value * 24 - 12) * 10) / 10}<span className="text-[7px] ml-0.5 opacity-50">dB</span>
                </div>
            </div>
        </div>
    );
};

// --- STABLE MOTION FADER ---
const CyberFader = ({ channelId, value, eq, label, trackName, onValueChange, onEQChange, meterValue }: any) => {
    const isDragging = useRef(false);
    const isEnabled = trackName && trackName !== 'UNLINKED';
    const y = useMotionValue((1 - (value - DB_MIN) / (DB_MAX - DB_MIN)) * TRACK_HEIGHT);

    useEffect(() => {
        if (!isDragging.current) {
            const targetY = (1 - (value - DB_MIN) / (DB_MAX - DB_MIN)) * TRACK_HEIGHT;
            y.set(targetY);
        }
    }, [value, y]);

    useEffect(() => {
        const unsubscribe = y.on('change', (latestY) => {
            if (isDragging.current && isEnabled) {
                const norm = 1 - (latestY / TRACK_HEIGHT);
                const dbVal = Math.round((norm * (DB_MAX - DB_MIN) + DB_MIN) * 10) / 10;
                onValueChange(channelId, dbVal);
            }
        });
        return unsubscribe;
    }, [channelId, onValueChange, y, isEnabled]);

    const handleDoubleClick = () => {
        if (!isEnabled) return;
        onValueChange(channelId, 0.0);
        y.set((1 - (0.0 - DB_MIN) / (DB_MAX - DB_MIN)) * TRACK_HEIGHT);
    };

    return (
        <div className={`flex flex-col items-center gap-6 bg-black/40 p-6 border rounded-xl transition-all select-none group ${isEnabled ? 'border-cyan-500/10 hover:border-cyan-400/40 shadow-lg' : 'border-white/5 opacity-30 grayscale'}`}>
            
            {/* EQ SECTION */}
            <div className="flex gap-3 pb-4 border-b border-cyan-500/10 mb-2">
                <CyberKnob label="LOW"  value={eq.low}  onChange={(v) => onEQChange(channelId, 'low', v)}  isEnabled={isEnabled} />
                <CyberKnob label="MID"  value={eq.mid}  onChange={(v) => onEQChange(channelId, 'mid', v)}  isEnabled={isEnabled} />
                <CyberKnob label="HIGH" value={eq.high} onChange={(v) => onEQChange(channelId, 'high', v)} isEnabled={isEnabled} />
            </div>

            <div className={`flex items-center gap-2 -mt-2 h-4 ${isEnabled ? 'text-cyan-400' : 'text-white/20'}`}>
                <Activity size={14} className={isEnabled ? "animate-pulse" : ""} />
                <span className="text-[10px] font-black tracking-widest uppercase">{label}</span>
            </div>

            <div className="flex gap-6 items-center">
                <CyberMeter value={isEnabled ? meterValue : DB_MIN} />
                <div className={`relative h-[280px] w-12 flex flex-col items-center ${!isEnabled && 'pointer-events-none'}`}>
                    <div className="absolute -left-12 h-full flex flex-col justify-between text-[7px] font-mono text-cyan-500/30 py-1.5 select-none pointer-events-none">
                        <span>+30.0</span><span>+20.0</span><span>+10.0</span><span className={isEnabled ? "text-cyan-400 font-black" : ""}>0.0</span><span>-10.0</span><span>-20.0</span><span>-30.0</span>
                    </div>

                    <div 
                        onDoubleClick={handleDoubleClick}
                        className={`w-1.5 h-full bg-black/95 border border-cyan-500/20 rounded-full relative ${isEnabled ? 'cursor-pointer' : ''}`}
                    >
                        <motion.div
                            drag={isEnabled ? "y" : false}
                            dragConstraints={{ top: 0, bottom: TRACK_HEIGHT }}
                            dragElastic={0}
                            dragMomentum={false}
                            onDragStart={() => { isDragging.current = true; }}
                            onDragEnd={() => { isDragging.current = false; }}
                            onDoubleClick={(e) => { e.stopPropagation(); handleDoubleClick(); }}
                            style={{ y }}
                            whileHover={isEnabled ? { scale: 1.05 } : {}}
                            className={`absolute -left-[27px] -top-[15px] w-14 h-8 z-20 ${isEnabled ? 'cursor-ns-resize' : 'cursor-not-allowed opacity-10'}`}
                        >
                            <div className={`w-full h-full bg-cyan-950 border-2 rounded flex items-center justify-center relative ${isEnabled ? 'border-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.5)] active:brightness-125' : 'border-white/20'}`}>
                                <div className={`w-10 h-[2px] ${isEnabled ? 'bg-white shadow-[0_0_10px_#fff]' : 'bg-white/10'}`} />
                                <div className={`absolute inset-y-0 left-0 w-1 ${isEnabled ? 'bg-cyan-400' : 'bg-white/5'}`} />
                                <div className={`absolute inset-y-0 right-0 w-1 ${isEnabled ? 'bg-cyan-400' : 'bg-white/5'}`} />
                            </div>
                        </motion.div>
                    </div>
                </div>
            </div>

            <div className={`mt-4 bg-black border px-6 py-2 rounded-sm w-full text-center transition-colors ${isEnabled ? 'border-cyan-400/40 group-hover:border-cyan-400' : 'border-white/5'}`}>
                <motion.span className={`text-xl font-mono font-black tracking-tighter block tabular-nums ${isEnabled ? 'text-cyan-400' : 'text-white/20'}`}>
                    {value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1)}
                </motion.span>
                <div className={`text-[9px] font-black tracking-widest uppercase mt-2 overflow-hidden text-ellipsis whitespace-nowrap max-w-[100px] ${isEnabled ? 'text-cyan-500' : 'text-white/10'}`}>
                    {trackName || 'UNLINKED'}
                </div>
            </div>
        </div>
    );
};

export default function App() {
    const [status, setStatus] = useState('OFFLINE');
    const [channels, setChannels] = useState<{ [id: number]: number }>({ 0: 0, 1: 0, 2: 0 });
    const [eqs, setEqs] = useState<{ [id: number]: { high: number, mid: number, low: number } }>({
        0: { high: 0.5, mid: 0.5, low: 0.5 },
        1: { high: 0.5, mid: 0.5, low: 0.5 },
        2: { high: 0.5, mid: 0.5, low: 0.5 }
    });
    const [meters, setMeters] = useState<{ [id: number]: number }>({ 0: -30, 1: -30, 2: -30 });
    const [trackNames, setTrackNames] = useState<{ [id: number]: string }>({ 0: '', 1: '', 2: '' });
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        const sid = new URLSearchParams(window.location.search).get('session');
        if (!sid) return;

        const connect = () => {
            const ws = new WebSocket(RELAY_URL);
            wsRef.current = ws;
            ws.onopen = () => { 
                setStatus('CONNECTED'); 
                ws.send(JSON.stringify({ type: 'join', room: sid }));
                ws.send(JSON.stringify({ type: 'get_track_names' }));
            };
            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'meter') setMeters(prev => ({ ...prev, [msg.id]: msg.value }));
                    if (msg.type === 'track_name') setTrackNames(prev => ({ ...prev, [msg.id]: msg.name }));
                } catch (err) {}
            };
            ws.onclose = () => { setStatus('RECONNECTING'); setTimeout(connect, 2000); };
        };
        connect();
        return () => wsRef.current?.close();
    }, []);

    const sendGain = useCallback((id: number, val: number) => {
        setChannels(prev => ({ ...prev, [id]: val }));
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            const normalized = (val - DB_MIN) / (DB_MAX - DB_MIN);
            wsRef.current.send(JSON.stringify({ type: 'gain', id, value: normalized }));
        }
    }, []);

    const sendEQ = useCallback((id: number, band: string, val: number) => {
        setEqs(prev => ({ ...prev, [id]: { ...prev[id], [band]: val } }));
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'eq', id, band, value: val }));
        }
    }, []);

    return (
        <div className="h-screen bg-[#010203] text-cyan-50 font-mono p-10 overflow-auto relative select-none uppercase tracking-widest">
            <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(#06b6d4 1px, transparent 1px), linear-gradient(90deg, #06b6d4 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
            
            <header className="flex justify-between items-start mb-10 relative z-10 border-b border-cyan-500/10 pb-6">
                <div>
                    <h1 className="text-4xl font-black italic tracking-tighter text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]">
                        PANOLIVE <span className="text-white">_SYNC</span>
                    </h1>
                    <div className="flex gap-4 mt-1 text-[8px] font-black text-cyan-500/40 tracking-[0.4em]">
                        <span>// P2P_NEURAL_LINK ACTIVE</span>
                        <span>// SCALE: -30.0 TO +30.0 DB</span>
                    </div>
                </div>
                <div className="bg-black/60 border border-cyan-400/30 px-8 py-3 rounded-none flex flex-col items-end">
                    <span className="text-xs font-black text-cyan-400">{status}</span>
                    <span className="text-[7px] text-cyan-700 font-bold tracking-widest mt-1">SESSION STABLE</span>
                </div>
            </header>

            <main className="flex gap-10 items-start relative z-10 pb-20">
                <CyberFader channelId={0} label="CH-01" trackName={trackNames[0]} value={channels[0]} eq={eqs[0]} meterValue={meters[0]} onValueChange={sendGain} onEQChange={sendEQ} />
                <CyberFader channelId={1} label="CH-02" trackName={trackNames[1]} value={channels[1]} eq={eqs[1]} meterValue={meters[1]} onValueChange={sendGain} onEQChange={sendEQ} />
                <CyberFader channelId={2} label="CH-03" trackName={trackNames[2]} value={channels[2]} eq={eqs[2]} meterValue={meters[2]} onValueChange={sendGain} onEQChange={sendEQ} />

                <div className="flex-1" />

                <div className="bg-cyan-950/10 p-6 border-l border-cyan-500/20 min-w-[200px] h-full flex flex-col justify-center">
                    <div className="text-[7px] text-cyan-500/40 mb-10 font-black tracking-[0.8em]">METRICS_STREAM</div>
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="text-[7px] text-cyan-900 mb-2 font-black tracking-widest italic animate-pulse">PANOLIVE_PKT_OK_{i}</div>
                    ))}
                </div>
            </main>

            <footer className="absolute bottom-8 left-10 right-10 flex justify-between text-[8px] font-black text-cyan-950 tracking-[0.8em] pointer-events-none">
                <span>// Remote_Control_Suite_v7.0</span>
                <span>// Secure Encrypted Pipe</span>
            </footer>
        </div>
    );
}
