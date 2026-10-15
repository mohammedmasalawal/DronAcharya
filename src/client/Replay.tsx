import { useEffect, useMemo, useState } from 'react';
import type { SessionEvent } from '../schema';
import { replayEvents } from '../sim';
import { getSession, getTrainee, type SessionRecord } from '../store';
import { navigate, setQueryTime } from './router';
import { Scene, type SceneContact } from './Scene';
import { debriefPath } from './session';
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

interface Loaded {
  session: SessionRecord;
  traineeName: string;
}

export function Replay({ sessionId, t }: { sessionId: string; t: number }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'missing' } | ({ status: 'ready' } & Loaded)
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    getSession(sessionId)
      .then(async (session) => {
        if (cancelled) return;
        if (!session) {
          setState({ status: 'missing' });
          return;
        }
        const trainee = await getTrainee(session.traineeId);
        if (cancelled) return;
        setState({
          status: 'ready',
          session,
          traineeName: trainee ? trainee.name : session.traineeId,
        });
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
        <div className="start-actions">
          <button className="primary" onClick={() => navigate('/review')}>
            Open review
          </button>
          <button onClick={() => navigate('/')}>Home</button>
        </div>
      </div>
    );
  }

  return (
    <ReplayView
      key={`${sessionId}@${t}`}
      session={state.session}
      traineeName={state.traineeName}
      initialT={t}
    />
  );
}

function ReplayView({
  session,
  traineeName,
  initialT,
}: {
  session: SessionRecord;
  traineeName: string;
  initialT: number;
}) {
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
        <button className="primary" onClick={() => navigate(debriefPath(session.id))}>
          Back to debrief
        </button>
        <strong>Replay {spec.id}</strong>
        <span>trainee {traineeName}</span>
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
