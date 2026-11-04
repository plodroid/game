import { useEffect } from 'react';
import {
  BOT_DIFFICULTIES,
  DURATION_OPTIONS,
  MAP_IDS,
  MAPS,
  MODES,
  MSG,
  SPECIAL_IDS,
  SPECIALS,
  TEAM_SIZE,
  WEAPON_IDS,
  WEAPONS,
  type LobbyPlayer,
  type LobbySettings,
  type ModeId,
} from '@chromashift/shared';
import { leaveRoom, send, useNet } from '../../multiplayer/net';
import { teamNames } from '../../rendering/palette';
import { useProfile } from '../../state/profile';
import { useUi } from '../../state/ui';
import { Avatar } from '../Avatar';
import { Icon, TeamShape } from '../icons';
import { Button, Header, Segmented, Setting, Toggle, useCopy } from '../kit';
import { DIFF_LABEL } from './Play';

export default function Lobby() {
  const net = useNet();
  const go = useUi((s) => s.go);
  const profile = useProfile();
  const [copiedCode, copyCode] = useCopy();
  const [copiedLink, copyLink] = useCopy();
  const lobby = net.lobby;

  useEffect(() => {
    if (!net.room && net.status !== 'connecting') go('online');
  }, [net.room, net.status, go]);

  if (!lobby)
    return (
      <main className="screen">
        <Header title="Lobby" onBack={() => (leaveRoom(), go('online'))} />
        <div className="loading">
          <div className="spinner" />
          Joining…
        </div>
      </main>
    );

  const me = lobby.players.find((p) => p.id === net.you);
  const host = lobby.hostId === net.you;
  const names = teamNames();
  const humans = lobby.players.filter((p) => !p.bot);
  const readyCount = humans.filter((p) => p.ready || p.id === lobby.hostId).length;
  const st = lobby.settings;
  const setSettings = (patch: Partial<LobbySettings>) => send(MSG.SETTINGS, patch);
  const setLoadout = (patch: { weapon?: string; special?: string }) => {
    profile.patch(patch as never);
    send(MSG.LOADOUT, { weapon: patch.weapon ?? profile.weapon, special: patch.special ?? profile.special, cosmetics: profile.cosmetics });
  };
  const invite = `${location.origin}${location.pathname}?join=${lobby.code}`;

  const slot = (p: LobbyPlayer | undefined, i: number, team: number) =>
    p ? (
      <div key={p.id} className="slot">
        <Avatar cosmetics={p.cosmetics} team={team} name={p.name} bot={p.bot} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="slot__name">
            {p.name} {p.id === net.you && <span className="muted small">(you)</span>}
          </div>
          <div className="slot__meta">
            {WEAPONS[p.weapon].name} · {SPECIALS[p.special].name}
            {!p.connected && ' · reconnecting'}
          </div>
        </div>
        {p.id === lobby.hostId && <span className="badge" title="Host"><Icon.crown size={12} /></span>}
        {p.verified && <span className="badge">Verified</span>}
        {p.bot ? <span className="badge">Bot</span> : p.ready || p.id === lobby.hostId ? <span className="badge badge--ok">Ready</span> : <span className="badge">Not ready</span>}
        {host && !p.bot && (
          <Button icon variant="ghost" aria-label={`Move ${p.name} to the other team`} title="Switch team" onClick={() => send(MSG.TEAM, { id: p.id, team: 1 - team })}>
            <Icon.swap />
          </Button>
        )}
      </div>
    ) : (
      <div key={`empty${i}`} className="slot slot--empty">
        {st.botFill ? `Open — a ${DIFF_LABEL[st.botDifficulty].toLowerCase()} bot will fill this slot` : 'Open slot'}
        {me && !host && me.team !== team && (
          <Button variant="ghost" style={{ marginLeft: 'auto' }} onClick={() => send(MSG.TEAM, { id: me.id, team })}>
            Join
          </Button>
        )}
      </div>
    );

  return (
    <main className="screen screen--solid">
      <Header
        title={lobby.quick ? 'Quick Play' : 'Private room'}
        sub={lobby.quick ? (lobby.startsIn != null ? `Match starts in ${lobby.startsIn}s — bots fill empty slots.` : 'Starting…') : host ? 'You’re the host.' : 'Waiting for the host to start.'}
        onBack={() => (leaveRoom(), go('online'))}
        end={
          <Button variant="danger" onClick={() => (leaveRoom(), go('online'))}>
            Leave
          </Button>
        }
      />
      <div className="col--wide stagger" style={{ display: 'grid', gap: 14 }}>
        <section className="panel row" style={{ justifyContent: 'space-between' }}>
          <div>
            <p className="eyebrow" style={{ margin: 0 }}>
              Room code
            </p>
            <div className="code num">{lobby.code}</div>
          </div>
          <div className="row">
            <Button onClick={() => copyCode(lobby.code)}>{copiedCode ? <Icon.check /> : <Icon.copy />} Copy code</Button>
            <Button onClick={() => copyLink(invite)}>{copiedLink ? <Icon.check /> : <Icon.copy />} Copy invite link</Button>
          </div>
        </section>

        <div className="teams">
          {[0, 1].map((t) => {
            const list = lobby.players.filter((p) => p.team === t);
            return (
              <section key={t} className="team">
                <div className="team__head">
                  <TeamShape team={t} /> {names[t]}
                  <span className="muted small" style={{ marginLeft: 'auto' }}>
                    {list.length}/{TEAM_SIZE}
                  </span>
                </div>
                {Array.from({ length: TEAM_SIZE }, (_, i) => slot(list[i], i, t))}
              </section>
            );
          })}
        </div>

        <section className="panel">
          <h2 className="panel__title">Your loadout</h2>
          <Setting name="Weapon" hint={WEAPONS[me?.weapon ?? profile.weapon].tagline}>
            <Segmented value={me?.weapon ?? profile.weapon} onChange={(w) => setLoadout({ weapon: w })} label="Weapon" options={WEAPON_IDS.map((w) => ({ value: w, label: WEAPONS[w].name }))} />
          </Setting>
          <Setting name="Special" hint={SPECIALS[me?.special ?? profile.special].description}>
            <Segmented value={me?.special ?? profile.special} onChange={(s) => setLoadout({ special: s })} label="Special" options={SPECIAL_IDS.map((s) => ({ value: s, label: SPECIALS[s].name }))} />
          </Setting>
        </section>

        <section className="panel">
          <h2 className="panel__title">Match settings {host ? '' : '(set by the host)'}</h2>
          <fieldset disabled={!host} style={{ border: 0, padding: 0, margin: 0 }}>
            <Setting name="Map" hint={MAPS[st.map].description}>
              <Segmented value={st.map} onChange={(map) => setSettings({ map })} label="Map" options={MAP_IDS.map((m) => ({ value: m, label: MAPS[m].name, disabled: !host }))} />
            </Setting>
            <Setting name="Mode" hint={MODES[st.mode].description}>
              <Segmented
                value={st.mode}
                onChange={(mode) => setSettings({ mode, duration: MODES[mode].duration || st.duration })}
                label="Mode"
                options={(['turf', 'zones', 'knockout'] as ModeId[]).map((m) => ({ value: m, label: MODES[m].name, disabled: !host }))}
              />
            </Setting>
            <Setting name="Length">
              <Segmented value={st.duration} onChange={(duration) => setSettings({ duration })} label="Length" options={DURATION_OPTIONS.map((d) => ({ value: d, label: `${d / 60} min`, disabled: !host }))} />
            </Setting>
            <Setting name="Fill empty slots with bots">
              <Toggle label="Bot fill" checked={st.botFill} onChange={(botFill) => host && setSettings({ botFill })} />
            </Setting>
            <Setting name="Bot difficulty">
              <Segmented value={st.botDifficulty} onChange={(botDifficulty) => setSettings({ botDifficulty })} label="Bot difficulty" options={BOT_DIFFICULTIES.map((d) => ({ value: d, label: DIFF_LABEL[d], disabled: !host }))} />
            </Setting>
          </fieldset>
        </section>

        <div className="row">
          {host ? (
            <>
              <Button variant="primary" size="lg" onClick={() => send(MSG.START)}>
                <Icon.play size={16} /> Start match
              </Button>
              <Button onClick={() => send(MSG.BALANCE)}>Balance teams</Button>
              <span className="muted small">
                {readyCount}/{humans.length} ready
              </span>
            </>
          ) : lobby.quick ? (
            <span className="muted">Quick Play starts automatically{lobby.startsIn != null ? ` in ${lobby.startsIn}s` : ''}.</span>
          ) : (
            <Button variant={me?.ready ? 'default' : 'primary'} size="lg" onClick={() => send(MSG.READY, { ready: !me?.ready })}>
              {me?.ready ? 'Not ready' : 'Ready'}
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
