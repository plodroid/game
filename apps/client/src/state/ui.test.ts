import { beforeEach, describe, expect, it } from 'vitest';
import { afterLobby, uiHooks, useUi } from './ui';

const ui = () => useUi.getState();
const reset = () => useUi.setState({ screen: 'home', history: [] });
const at = () => `${ui().screen} <- [${ui().history.join(', ')}]`;

describe('screen history', () => {
  beforeEach(() => {
    reset();
    uiHooks.hasRoom = () => true;
  });

  it('host from Play, leave, then Back twice ends at the menu (never back in a lobby)', () => {
    ui().go('play');
    ui().go('lobby'); // hosting
    ui().go(afterLobby()); // the lobby's Leave button
    expect(ui().screen).toBe('play');
    uiHooks.hasRoom = () => false;
    ui().back();
    expect(ui().screen).toBe('home');
    ui().back();
    expect(ui().screen).toBe('home');
  });

  it('host from Online: Leave returns to Online, Back to the menu', () => {
    ui().go('online');
    ui().go('lobby');
    ui().go(afterLobby());
    expect(ui().screen).toBe('online');
    uiHooks.hasRoom = () => false;
    ui().back();
    expect(at()).toBe('home <- []');
  });

  it('after a whole game (lobby, match, results, back to lobby) Leave and Back still unwind cleanly', () => {
    for (const s of ['play', 'lobby', 'match', 'results', 'lobby'] as const) ui().go(s);
    expect(ui().history).toEqual(['home', 'play']);
    ui().go(afterLobby());
    expect(at()).toBe('play <- [home]');
    uiHooks.hasRoom = () => false;
    ui().back();
    expect(ui().screen).toBe('home');
  });

  it('a race (VELOCITY) behaves the same: results never become a place to go back to', () => {
    for (const s of ['play', 'lobby', 'match', 'raceResults', 'garage'] as const) ui().go(s);
    // From the garage on the results screen, Back must not land on the finished race.
    uiHooks.hasRoom = () => true;
    ui().back();
    expect(ui().screen).toBe('lobby');
    uiHooks.hasRoom = () => false;
    ui().go('home');
    ui().go('play');
    ui().back();
    expect(ui().screen).toBe('home');
  });

  it('Back skips a lobby whose room has closed', () => {
    ui().go('play');
    ui().go('lobby');
    ui().go('garage');
    uiHooks.hasRoom = () => false;
    ui().back();
    expect(ui().screen).toBe('play');
  });

  it('an offline match returns to Play and Back goes to the menu', () => {
    for (const s of ['play', 'match', 'results'] as const) ui().go(s);
    ui().go('play');
    expect(at()).toBe('play <- [home]');
    ui().back();
    expect(ui().screen).toBe('home');
  });

  it('going to a screen already behind you returns to it', () => {
    for (const s of ['online', 'social', 'profile'] as const) ui().go(s);
    ui().go('online');
    expect(at()).toBe('online <- [home]');
  });
});
