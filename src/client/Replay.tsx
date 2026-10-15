import { useEffect, useMemo, useState } from 'react';
import type { SessionEvent } from '../schema';
import { replayEvents } from '../sim';
import { navigate, setQueryTime } from './router';
import { Scene, type SceneContact } from './Scene';
import { loadSession, type StoredSession } from './storage';
import { useReplay } from './useReplay';
import { CLASS_LABEL, isResolved, truthColor } from './palette';

function describe(event: SessionEvent): string {
  switch (event.type) {
    case 'observable':
      return `${event.threatId} became observable`;
    case 'detect':
      return `${event.threatId} detected`;
    case 'classify':
      return `${event.threatId} classified as ${CLASS_LABEL[event.cls]} (${Math.round(
        event.confidence * 100,
      )}%)${event.followedAssistant ? ', followed assistant' : ''}${
        event.assistantCorrect ? '' : ', assistant wrong'
      }`;
    case 'rank':
      return `priority: ${event.order.join(' > ')}`;
    case 'engage':
      return `${event.threatId} engaged with ${event.effector}`;
    case 'result':
      return `${event.threatId} ${event.outcome}`;
  }
}

function formatTime(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

export function Replay({ sessionId, t }: { sessionId: string; t: number }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'missing' } | { status: 'ready'; session: StoredSession }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    loadSession(sessionId)
      .then((session) => {
        if (cancelled) return;
        setState(session ? { status: 'ready', session } : { status: 'missing' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'missing' });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (state.status === 'loading') return <div className="center">Loading session...</div>;
  if (state.status === 'missing') {
    return (
      <div className="center">
        <p>No session found for {sessionId}.</p>
        <button onClick={() => navigate('/')}>Home</button>
      </div>
    );
  }

  return <ReplayView key={sessionId} session={state.session} initialT={t} />;
}

function ReplayView({ session, initialT }: { session: StoredSession; initialT: number }) {
  const { spec, log, endedAtSec } = session;
  const replay = useReplay(spec, log, endedAtSec, initialT);
  const { snapshot, view } = replay;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const consistent = useMemo(
    () => JSON.stringify(replayEvents(spec, log, endedAtSec)) === JSON.stringify(log.events),
    [spec, log, endedAtSec],
  );

  const ids = useMemo(() => snapshot.truth.map((item) => item.threatId), [snapshot.truth]);

  const read = (id: string): SceneContact | undefined => {
    const truth = view.current.get(id);
    if (!truth) return undefined;
    return {
      x: truth.x,
      y: truth.y,
      alt: truth.altM,
      color: truthColor(truth),
      opacity: isResolved(truth.status) ? 0.25 : 0.95,
    };
  };

  const seek = (seconds: number) => {
    replay.seek(seconds);
    setQueryTime(seconds);
  };

  const togglePlay = () => {
    if (replay.playing) setQueryTime(snapshot.t);
    replay.setPlaying(!replay.playing);
  };

  return (
    <div className="play">
      <header className="topbar">
        <button onClick={() => navigate('/')}>Home</button>
        <strong>Replay {spec.id}</strong>
        <span>trainee {session.traineeId}</span>
        <span className={consistent ? 'chip' : 'chip bad'}>
          {consistent ? 'replay matches log' : 'replay differs from log'}
        </span>
        <span className="spacer" />
        <button className="primary" onClick={togglePlay}>
          {replay.playing ? 'Pause' : 'Play'}
        </button>
        {[1, 2, 4, 8].map((value) => (
          <button
            key={value}
            className={replay.speed === value ? 'active' : ''}
            onClick={() => replay.setSpeed(value)}
          >
            {value}x
          </button>
        ))}
      </header>

      <div className="scrub">
        <span>{formatTime(snapshot.t)}</span>
        <input
          type="range"
          min={0}
          max={endedAtSec}
          step={0.05}
          value={snapshot.t}
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span>{formatTime(endedAtSec)}</span>
      </div>

      <div className="stage">
        <div className="viewport">
          <Scene
            spec={spec}
            ids={ids}
            read={read}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        <aside className="panel">
          <section>
            <h3>Ground truth</h3>
            <table className="contacts">
              <tbody>
                {snapshot.truth.map((item) => (
                  <tr
                    key={item.threatId}
                    className={item.threatId === selectedId ? 'selected' : ''}
                    onClick={() => setSelectedId(item.threatId)}
                  >
                    <td>{item.threatId}</td>
                    <td>{CLASS_LABEL[item.cls]}</td>
                    <td>{item.hostile ? 'hostile' : 'non-threat'}</td>
                    <td>{item.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3>Timeline</h3>
            <ul className="timeline">
              {log.events.map((event, index) => (
                <li
                  key={index}
                  className={event.t <= snapshot.t ? 'past' : ''}
                  onClick={() => seek(event.t)}
                >
                  <span className="time">{formatTime(event.t)}</span> {describe(event)}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
