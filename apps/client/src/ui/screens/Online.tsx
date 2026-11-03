import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PORT, normalizeRoomCode, ROOM_CODE_LENGTH } from '@chromashift/shared';
import { createRoom, joinByCode, mixedContentBlocked, normalizeEndpoint, quickPlay, setEndpoint, useNet } from '../../multiplayer/net';
import { useUi } from '../../state/ui';
import { Icon } from '../icons';
import { Button, Field, Header } from '../kit';
import { onlineIntent } from './Play';

type Status = { state: 'checking' | 'up' | 'down' | 'blocked' | 'none'; info?: { players: number; rooms: number; version: string } };

/** HTTP health probe derived from the WebSocket endpoint. */
async function probe(endpoint: string): Promise<Status> {
  if (!endpoint) return { state: 'none' };
  if (mixedContentBlocked(endpoint)) return { state: 'blocked' };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3500);
    const r = await fetch(`${endpoint.replace(/^ws/, 'http')}/health`, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!r.ok) return { state: 'down' };
    const j = await r.json();
    return { state: 'up', info: { players: j.players ?? 0, rooms: j.rooms ?? 0, version: j.version ?? '?' } };
  } catch {
    return { state: 'down' };
  }
}

export default function Online() {
  const net = useNet();
  const go = useUi((s) => s.go);
  const online = useUi((s) => s.online);
  const [status, setStatus] = useState<Status>({ state: 'checking' });
  const [code, setCode] = useState(() => sessionStorage.getItem('chromashift.join') ?? '');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [showDirect, setShowDirect] = useState(false);
  const busy = net.status === 'connecting';

  const refresh = useCallback(() => {
    setStatus({ state: 'checking' });
    void probe(useNet.getState().endpoint).then(setStatus);
  }, []);
  useEffect(refresh, [net.endpoint, refresh]);
  useEffect(() => {
    sessionStorage.removeItem('chromashift.join');
    const intent = onlineIntent.mode;
    onlineIntent.mode = null;
    if (intent === 'join') document.getElementById('room-code')?.focus();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      go('lobby');
    } catch {
      // error is shown from the store
    }
  };

  const connectDirect = () => {
    const e = normalizeEndpoint(port ? `${host.trim()}:${port}` : host);
    if (!e) return useNet.setState({ error: 'Enter a host name or IP address.' });
    setEndpoint(e);
    setShowDirect(false);
  };

  const label = net.endpoint ? net.endpoint.replace(/^wss?:\/\//, '') : 'No server set';
  const codeOk = !!normalizeRoomCode(code);

  return (
    <main className="screen">
      <Header title="Online" sub="Host private rooms, join friends by code, or play over your LAN." />
      <div className="col stagger">
        <section className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row" style={{ gap: 10 }}>
              <Icon.server />
              <div>
                <div style={{ fontWeight: 650 }}>{label}</div>
                <div className="muted small">
                  <span className={`dot ${status.state === 'up' ? 'dot--ok' : status.state === 'checking' ? '' : 'dot--bad'}`} />
                  {status.state === 'up' && `Online · ${status.info?.players} players in ${status.info?.rooms} rooms`}
                  {status.state === 'checking' && 'Checking…'}
                  {status.state === 'down' && (online ? 'Not reachable' : 'You’re offline')}
                  {status.state === 'blocked' && 'Needs a secure wss:// address on this HTTPS page'}
                  {status.state === 'none' && 'Set a server below to play online'}
                </div>
              </div>
            </div>
            <div className="row">
              <Button variant="ghost" onClick={refresh}>
                Retry
              </Button>
              <Button onClick={() => setShowDirect((v) => !v)}>Direct connect</Button>
            </div>
          </div>
          {showDirect && (
            <form
              style={{ marginTop: 16 }}
              onSubmit={(e) => {
                e.preventDefault();
                connectDirect();
              }}
            >
              <div className="grid2" style={{ gridTemplateColumns: '1fr 120px' }}>
                <Field label="Host or IP" hint="LAN example: 192.168.1.20 · internet: play.example.com">
                  <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.20" autoFocus />
                </Field>
                <Field label="Port">
                  <input className="input" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))} />
                </Field>
              </div>
              <Button variant="primary" type="submit">
                Use this server
              </Button>
              <p className="muted small" style={{ marginBottom: 0 }}>
                On a LAN, the easiest way is to open the game from the host’s address, e.g. <code>http://192.168.1.20:{DEFAULT_PORT}/game/</code> — this page then connects to it
                automatically.
              </p>
            </form>
          )}
        </section>

        <div className="options">
          <button className="option" disabled={busy || status.state !== 'up'} onClick={() => void run(() => quickPlay(net.endpoint))}>
            <span className="option__icon">
              <Icon.bolt />
            </span>
            <span>
              <span className="option__title" style={{ display: 'block' }}>
                Quick Play
              </span>
              <span className="option__desc" style={{ display: 'block' }}>
                Join an open Turf Control lobby. Bots fill the empty slots.
              </span>
            </span>
            <Icon.play size={14} />
          </button>
          <button className="option" disabled={busy || status.state !== 'up'} onClick={() => void run(() => createRoom(net.endpoint, {}))}>
            <span className="option__icon">
              <Icon.users />
            </span>
            <span>
              <span className="option__title" style={{ display: 'block' }}>
                Create private room
              </span>
              <span className="option__desc" style={{ display: 'block' }}>
                You’re the host: pick the map, mode and bots, then share the code.
              </span>
            </span>
            <Icon.play size={14} />
          </button>
        </div>

        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            if (codeOk) void run(() => joinByCode(net.endpoint, code));
          }}
        >
          <Field label="Join with a room code" hint="Codes are not case-sensitive.">
            <input
              id="room-code"
              className="input input--code"
              value={code}
              maxLength={ROOM_CODE_LENGTH + 1}
              autoComplete="off"
              spellCheck={false}
              placeholder="•••••"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </Field>
          <Button variant="primary" block type="submit" disabled={!codeOk || busy || status.state !== 'up'}>
            {busy ? 'Connecting…' : 'Join room'}
          </Button>
        </form>
        {net.error && <p className="field__error">{net.error}</p>}
      </div>
    </main>
  );
}
