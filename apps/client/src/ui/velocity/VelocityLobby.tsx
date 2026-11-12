import { useEffect, useMemo, useState } from 'react';
import {
  BODIES, BOT_DIFFICULTIES, CAR_COLORS, DEFAULT_RACE_SETTINGS, LAP_OPTIONS, MAX_RACERS, MSG, RACE_IDENTITIES, trackDef, TRACK_IDS,
  type LobbyPlayer, type RaceSettings,
} from '@chromashift/shared';
import { leaveRoom, send, useNet } from '../../multiplayer/net';
import { useVoice } from '../../multiplayer/voice';
import { useProfile } from '../../state/profile';
import { useUi } from '../../state/ui';
import { useTracks } from '../../velocity/tracksState';
import { Avatar } from '../Avatar';
import { InviteFriends } from '../InviteFriends';
import { Icon } from '../icons';
import { Button, Header, Segmented, Setting, useCopy } from '../kit';
import { DIFF_LABEL } from '../screens/Play';
import { TrackOutline } from './VelocityPlay';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * A VELOCITY room: six grid slots for people and bots, the host's track and race settings, and the
 * same codes, invites, voice and ready checks as a CHROMASHIFT lobby.
 */
export function VelocityLobby() {
  const net = useNet();
  const vc = useVoice();
  const go = useUi((s) => s.go);
  const profile = useProfile();
  const publics = useTracks((t) => t.publics);
  const presets = useTracks((t) => t.presets);
  const custom = useMemo(() => [...publics, ...presets], [publics, presets]);
  const [copiedCode, copyCode] = useCopy();
  const [copiedLink, copyLink] = useCopy();
  const [inviting, setInviting] = useState(false);
  const lobby = net.lobby!;
  useEffect(() => {
    // Our current build goes with us into the room.
    send(MSG.LOADOUT, { weapon: profile.weapon, special: profile.special, cosmetics: profile.cosmetics, car: profile.racing.builds[profile.racing.active] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.racing.active]);
  const me = lobby.players.find((p) => p.id === net.you);
  const host = lobby.hostId === net.you;
  const st: RaceSettings = lobby.settings.race ?? DEFAULT_RACE_SETTINGS;
  const setRace = (patch: Partial<RaceSettings>) => send(MSG.SETTINGS, { race: { ...st, ...patch } });
  const humans = lobby.players.filter((p) => !p.bot);
  const bots = Math.max(0, Math.min(st.bots, MAX_RACERS - humans.length));
  const invite = `${location.origin}${location.pathname}?join=${lobby.code}`;
  const close = () => (leaveRoom(), go('play'));
  const track = trackDef(st.track);

  const slot = (p: LobbyPlayer, i: number) => {
    const car = p.car;
    return (
      <div key={p.id} className="slot" data-talking={!!vc.speaking[p.id]}>
        <span style={{ width: 10, alignSelf: 'stretch', borderRadius: 6, background: hex(RACE_IDENTITIES[i % 6].color) }} aria-label={RACE_IDENTITIES[i % 6].name} />
        <Avatar cosmetics={p.cosmetics} team={0} name={p.name} bot={p.bot} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="slot__name">
            {p.name} {p.id === net.you && <span className="muted small">(you)</span>}
          </div>
          <div className="slot__meta">
            {car ? (
              <>
                <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: hex(CAR_COLORS[car.paint]?.hex ?? 0xffffff), marginRight: 6 }} />
                {BODIES[car.body]?.name ?? car.body} · #{car.number}
              </>
            ) : (
              'Car'
            )}
            {!p.connected && ' · reconnecting'}
          </div>
        </div>
        {p.id === lobby.hostId && (
          <span className="badge" title="Host">
            <Icon.crown size={12} />
          </span>
        )}
        {p.ready || p.id === lobby.hostId ? <span className="badge badge--ok">Ready</span> : <span className="badge">Not ready</span>}
      </div>
    );
  };

  return (
    <main className="screen" data-pig="gold">
      <Header title="VELOCITY lobby" sub={`${humans.length} driver${humans.length === 1 ? '' : 's'} · ${bots} bot${bots === 1 ? '' : 's'} · ${MAX_RACERS} cars at most`} onBack={close} />
      <div className="col--wide stagger">
        <section className="panel">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span>
              <span className="muted small">Game code</span>
              <span className="code num" style={{ display: 'block' }}>
                {lobby.code}
              </span>
            </span>
            <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button onClick={() => copyCode(lobby.code)}>{copiedCode ? <Icon.check /> : <Icon.copy />} Copy code</Button>
              <Button onClick={() => copyLink(invite)}>{copiedLink ? <Icon.check /> : <Icon.copy />} Copy invite link</Button>
              <Button onClick={() => setInviting(true)}>Invite friends</Button>
            </span>
          </div>
        </section>
        <section className="panel">
          <h3 className="panel__title">Grid</h3>
          <div className="col" style={{ gap: 8 }}>
            {humans.map((p, i) => slot(p, i))}
            {Array.from({ length: bots }, (_, k) => (
              <div key={`bot${k}`} className="slot">
                <span style={{ width: 10, alignSelf: 'stretch', borderRadius: 6, background: hex(RACE_IDENTITIES[(humans.length + k) % 6].color) }} />
                <span className="slot__name">Bot</span>
                <span className="slot__meta" style={{ marginLeft: 'auto' }}>
                  {DIFF_LABEL[st.difficulty]}
                </span>
              </div>
            ))}
            {Array.from({ length: Math.max(0, MAX_RACERS - humans.length - bots) }, (_, k) => (
              <div key={`open${k}`} className="slot" style={{ opacity: 0.5 }}>
                <span className="slot__name">Open slot</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <Setting name="Your car" hint="Pick a saved build. Change builds in the Garage.">
            <div className="car-pick">
              {profile.racing.builds.map((b, i) => (
                <button key={i} aria-pressed={profile.racing.active === i} onClick={() => profile.setRacing({ active: i })}>
                  <i style={{ background: hex(CAR_COLORS[b.paint]?.hex ?? 0xffffff) }} />
                  {BODIES[b.body]?.name ?? b.body}
                </button>
              ))}
            </div>
          </Setting>
        </section>
        <section className="panel">
          <h3 className="panel__title">Track{host ? '' : `: ${track?.name ?? st.track}`}</h3>
          {host ? (
            <div className="track-grid">
              {[...TRACK_IDS, ...custom.map((t) => t.id)].map((id) => {
                const t = trackDef(id);
                if (!t) return null;
                return (
                  <button key={id} className="track-card" aria-pressed={st.track === id} onClick={() => setRace({ track: id, laps: t.laps })}>
                    <TrackOutline id={id} />
                    <span className="track-card__name">{t.name}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            track && (
              <div className="track-card" style={{ maxWidth: 220 }}>
                <TrackOutline id={st.track} />
                <span className="track-card__meta">{track.description}</span>
              </div>
            )
          )}
          <Setting name="Race">
            <Segmented value={st.preset} onChange={(preset) => host && setRace({ preset })} label="Race type" options={([{ value: 'classic', label: 'Classic' }, { value: 'arcade', label: 'Arcade' }] as const).map((o) => ({ ...o, disabled: !host }))} />
          </Setting>
          <Setting name="Laps">
            <Segmented value={st.laps} onChange={(laps) => host && setRace({ laps })} label="Laps" options={LAP_OPTIONS.map((n) => ({ value: n, label: String(n), disabled: !host }))} />
          </Setting>
          <Setting name="Damage">
            <Segmented value={st.damage} onChange={(damage) => host && setRace({ damage })} label="Damage" options={([{ value: 'full', label: 'Full' }, { value: 'visual', label: 'Visual' }, { value: 'off', label: 'Off' }] as const).map((o) => ({ ...o, disabled: !host }))} />
          </Setting>
          <Setting name="Bots" hint="Bots fill grid slots nobody is using.">
            <Segmented value={st.bots} onChange={(b) => host && setRace({ bots: b })} label="Bots" options={[0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n), disabled: !host }))} />
          </Setting>
          <Setting name="Bot difficulty">
            <Segmented value={st.difficulty} onChange={(difficulty) => host && setRace({ difficulty })} label="Bot difficulty" options={BOT_DIFFICULTIES.map((d) => ({ value: d, label: DIFF_LABEL[d], disabled: !host }))} />
          </Setting>
        </section>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {host ? (
            <>
              <Button variant="primary" size="lg" onClick={() => send(MSG.START)}>
                <Icon.play size={16} /> Start race
              </Button>
              <Button onClick={() => send(MSG.SETTINGS, { game: 'shooter' })}>
                <Icon.gun size={16} /> Switch to CHROMASHIFT
              </Button>
            </>
          ) : (
            <Button variant={me?.ready ? 'default' : 'primary'} size="lg" onClick={() => send(MSG.READY, { ready: !me?.ready })}>
              {me?.ready ? 'Not ready' : 'Ready'}
            </Button>
          )}
          <Button onClick={() => go('garage')}>
            <Icon.car size={16} /> Garage
          </Button>
          <Button variant="ghost" onClick={close}>
            Leave
          </Button>
        </div>
      </div>
      {inviting && <InviteFriends code={lobby.code} onClose={() => setInviting(false)} />}
    </main>
  );
}
