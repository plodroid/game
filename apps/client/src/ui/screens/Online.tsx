import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PORT, normalizeRoomCode, ROOM_CODE_LENGTH } from '@chromashift/shared';
import {
  createRoom,
  forgetRecent,
  hostFromMenu,
  joinByCode,
  joinGame,
  mixedContentBlocked,
  normalizeEndpoint,
  quickPlay,
  setEndpoint,
  takeInvite,
  useNet,
  type RecentGame,
} from '../../multiplayer/net';
import { useUi } from '../../state/ui';
import { Icon } from '../icons';
import { Button, Field, Header } from '../kit';
import { onlineIntent } from './Play';

type Status = {
  state: 'checking' | 'up' | 'down' | 'blocked' | 'none';
  info?: { players: number; rooms: number; version: string };
};

/** HTTP health probe derived from the WebSocket endpoint. */
async function probe(endpoint: string): Promise<Status> {
  if (!endpoint) return { state: 'none' };
  if (mixedContentBlocked(endpoint)) return { state: 'blocked' };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3500);
    const r = await fetch(`${endpoint.replace(/^ws/, 'http')}/health`, {
      signal: ctl.signal,
      cache: 'no-store',
    });
    clearTimeout(t);
    if (!r.ok) return { state: 'down' };
    const j = await r.json();
    return { state: 'up', info: { players: j.players ?? 0, rooms: j.rooms ?? 0, version: j.version ?? '?' } };
  } catch {
    return { state: 'down' };
  }
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(t: number) {
  const m = Math.round((t - Date.now()) / 60_000);
  if (m > -1) return 'just now';
  if (m > -60) return rtf.format(m, 'minute');
  if (m > -60 * 24) return rtf.format(Math.round(m / 60), 'hour');
  return rtf.format(Math.round(m / 1440), 'day');
}

export default function Online() {
  const net = useNet();
  const go = useUi((s) => s.go);
  const online = useUi((s) => s.online);
  const [code, setCode] = useState('');
  const [showServer, setShowServer] = useState(() => useNet.getState().sameOrigin);
  const busy = net.status === 'connecting';
  const codeOk = !!normalizeRoomCode(code);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        go('lobby');
      } catch {
        // the reason is shown from the store
      }
    },
    [go],
  );

  useEffect(() => {
    const intent = onlineIntent.mode;
    onlineIntent.mode = null;
    // Invite links join straight away: one click from a friend's message to their lobby.
    const invite = takeInvite();
    if (invite) {
      setCode(invite.code);
      void run(() => joinGame(invite.code, invite.server));
    } else if (intent === 'join') document.getElementById('room-code')?.focus();
  }, [run]);

  return (
    <main className="screen">
      <Header
        title="Online"
        sub="Host a game right here in your browser, or join a friend’s with their code."
      />
      <div className="col stagger" style={{ display: 'grid', gap: 14 }}>
        <div className="options">
          <button className="option" disabled={busy || !online} onClick={() => void hostFromMenu()}>
            <span className="option__icon">
              <Icon.users />
            </span>
            <span>
              <span className="option__title" style={{ display: 'block' }}>
                Host a game
              </span>
              <span className="option__desc" style={{ display: 'block' }}>
                Your browser runs the game and friends join with your code. Nothing to install or set up.
              </span>
            </span>
            <Icon.play size={14} />
          </button>
        </div>

        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            if (codeOk) void run(() => joinGame(code));
          }}
        >
          <Field label="Join a game" hint="Enter the host’s 5-character code. Codes aren’t case-sensitive.">
            <input
              id="room-code"
              className="input input--code"
              value={code}
              maxLength={ROOM_CODE_LENGTH + 1}
              autoComplete="off"
              spellCheck={false}
              placeholder="•••••"
              aria-label="Game code"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </Field>
          <Button variant="primary" block type="submit" disabled={!codeOk || busy || !online}>
            {busy ? 'Connecting…' : 'Join'}
          </Button>
        </form>
        {net.error && (
          <p className="field__error" role="alert">
            {net.error}
          </p>
        )}
        {!online && (
          <p className="muted small">
            You’re offline. Online games need an internet connection; Practice and Custom matches still work.
          </p>
        )}

        {net.recent.length > 0 && (
          <section className="panel">
            <h2 className="panel__title">Recent games</h2>
            <div>
              {net.recent.map((g) => (
                <Recent
                  key={`${g.code}${g.server ?? ''}`}
                  game={g}
                  disabled={busy || !online}
                  onJoin={() => void run(() => joinGame(g.code, g.server))}
                />
              ))}
            </div>
          </section>
        )}

        <section className="panel">
          <button className="disclosure" aria-expanded={showServer} onClick={() => setShowServer((v) => !v)}>
            <Icon.server />
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontWeight: 650 }}>Dedicated servers</span>
              <span className="muted small">For LAN parties and always-on servers you run yourself.</span>
            </span>
            <span className="disclosure__chev" aria-hidden>
              <Icon.play size={12} />
            </span>
          </button>
          {showServer && <Dedicated busy={busy} run={run} />}
        </section>
      </div>
    </main>
  );
}

function Recent({ game, disabled, onJoin }: { game: RecentGame; disabled: boolean; onJoin: () => void }) {
  const where = game.server ? ` · ${game.server.replace(/^wss?:\/\//, '')}` : '';
  return (
    <div className="slot">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="slot__name">{game.host}</div>
        <div className="slot__meta">
          <span className="num">{game.code}</span>
          {where} · {ago(game.at)}
        </div>
      </div>
      <Button disabled={disabled} onClick={onJoin}>
        Join
      </Button>
      <Button
        icon
        variant="ghost"
        aria-label={`Remove ${game.host}’s game from recent games`}
        onClick={() => forgetRecent(game)}
      >
        <Icon.close />
      </Button>
    </div>
  );
}

function Dedicated({ busy, run }: { busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const net = useNet();
  const online = useUi((s) => s.online);
  const [status, setStatus] = useState<Status>({ state: 'checking' });
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [code, setCode] = useState('');
  const [showDirect, setShowDirect] = useState(false);

  const refresh = useCallback(() => {
    setStatus({ state: 'checking' });
    void probe(useNet.getState().endpoint).then(setStatus);
  }, []);
  useEffect(refresh, [net.endpoint, refresh]);

  const connectDirect = () => {
    const e = normalizeEndpoint(port ? `${host.trim()}:${port}` : host);
    if (!e) return useNet.setState({ error: 'Enter a host name or IP address.' });
    setEndpoint(e);
    setShowDirect(false);
  };

  const label = net.endpoint ? net.endpoint.replace(/^wss?:\/\//, '') : 'No server set';
  const up = status.state === 'up';
  const codeOk = !!normalizeRoomCode(code);

  return (
    <div style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 650 }}>{label}</div>
          <div className="muted small">
            <span className={`dot ${up ? 'dot--ok' : status.state === 'checking' ? '' : 'dot--bad'}`} />
            {up && `Online · ${status.info?.players} players in ${status.info?.rooms} rooms`}
            {status.state === 'checking' && 'Checking…'}
            {status.state === 'down' && (online ? 'Not reachable' : 'You’re offline')}
            {status.state === 'blocked' && 'Needs a secure wss:// address on this HTTPS page'}
            {status.state === 'none' && 'Set a server address to use one'}
          </div>
        </div>
        <div className="row">
          <Button variant="ghost" onClick={refresh}>
            Retry
          </Button>
          <Button onClick={() => setShowDirect((v) => !v)}>Server address</Button>
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
              <input
                className="input"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.20"
                autoFocus
              />
            </Field>
            <Field label="Port">
              <input
                className="input"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
              />
            </Field>
          </div>
          <Button variant="primary" type="submit">
            Use this server
          </Button>
          <p className="muted small" style={{ marginBottom: 0 }}>
            On a LAN, the easiest way is to open the game from the server’s address, e.g.{' '}
            <code>http://192.168.1.20:{DEFAULT_PORT}/game/</code>. The page then uses that server
            automatically.
          </p>
        </form>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        <Button disabled={busy || !up} onClick={() => void run(() => quickPlay(net.endpoint))}>
          <Icon.bolt size={14} /> Quick Play
        </Button>
        <Button disabled={busy || !up} onClick={() => void run(() => createRoom(net.endpoint, {}))}>
          <Icon.users size={14} /> Create room
        </Button>
      </div>
      <form
        className="row"
        style={{ marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (codeOk) void run(() => joinByCode(net.endpoint, code));
        }}
      >
        <input
          className="input"
          style={{ flex: 1, minWidth: 0, letterSpacing: '0.2em', textTransform: 'uppercase' }}
          value={code}
          maxLength={ROOM_CODE_LENGTH + 1}
          autoComplete="off"
          spellCheck={false}
          placeholder="Room code on this server"
          aria-label="Room code on this server"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <Button type="submit" disabled={busy || !up || !codeOk}>
          Join
        </Button>
      </form>
    </div>
  );
}
