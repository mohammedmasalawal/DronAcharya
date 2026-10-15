import { useEffect, useMemo, useRef, useState } from 'react';
import type { EffectorType, ScenarioSpec, ThreatClass } from '../schema';
import type { Observation } from '../sim';
import { getExam, resolveExam } from '../store';
import { navigate } from './router';
import { Scene, type SceneContact } from './Scene';
import { completeSession } from './session';
import {
  GUEST_UNIT_NAME,
  createGuestTrainee,
  listTraineeChoices,
  recallTrainee,
  rememberTrainee,
  type TraineeChoice,
} from './trainee';
import { useLiveWorld } from './useLiveWorld';
import { CLASS_LABEL, CLASS_ORDER, DETECTED_COLOR, UNDETECTED_COLOR } from './palette';

function formatClock(seconds: number): string {
  const whole = Math.floor(seconds);
  const mm = String(Math.floor(whole / 60)).padStart(2, '0');
  const ss = String(whole % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function statusOf(
  observation: Observation | undefined,
  detected: boolean,
  result: string | undefined,
) {
  if (result) return { label: result.toUpperCase(), tone: 'done' };
  if (!observation) return { label: 'LOST', tone: 'lost' };
  if (observation.classifiedAs)
    return { label: CLASS_LABEL[observation.classifiedAs], tone: 'classified' };
  if (detected) return { label: 'DETECTED', tone: 'detected' };
  return { label: 'UNCONFIRMED', tone: 'new' };
}

interface PlayData {
  spec: ScenarioSpec;
  registeredExam: boolean;
}

const NEW_TRAINEE = '__new__';

function StartScreen({
  examId,
  spec,
  onStart,
}: {
  examId: string;
  spec: ScenarioSpec;
  onStart: (choice: TraineeChoice) => void;
}) {
  const [choices, setChoices] = useState<TraineeChoice[] | null>(null);
  const [selected, setSelected] = useState<string>(NEW_TRAINEE);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listTraineeChoices()
      .then((list) => {
        if (cancelled) return;
        setChoices(list);
        const recalled = recallTrainee();
        if (recalled && list.some((choice) => choice.traineeId === recalled.traineeId)) {
          setSelected(recalled.traineeId);
        } else if (recalled) {
          setName(recalled.name);
        } else if (list.length > 0) {
          setSelected(list[0]!.traineeId);
        }
      })
      .catch(() => {
        if (!cancelled) setChoices([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const creating = selected === NEW_TRAINEE;
  const ready = creating ? name.trim().length > 0 : choices !== null;

  const start = () => {
    setBusy(true);
    setError(null);
    const resolve = creating
      ? createGuestTrainee(name)
      : Promise.resolve(choices!.find((choice) => choice.traineeId === selected)!);
    resolve
      .then((choice) => {
        rememberTrainee(choice);
        onStart(choice);
      })
      .catch((failure: unknown) => {
        setBusy(false);
        setError(failure instanceof Error ? failure.message : 'Could not start the session');
      });
  };

  return (
    <div className="home start-screen">
      <h1>Ready to start</h1>
      <p className="muted">
        Scenario {examId}: {spec.mapType} terrain, {spec.timeOfDay}, {spec.weather}, about{' '}
        {Math.round(spec.durationSec / 60)} minutes.
      </p>

      <label className="field">
        Trainee
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          disabled={choices === null}
        >
          {(choices ?? []).map((choice) => (
            <option key={choice.traineeId} value={choice.traineeId}>
              {choice.name} ({choice.unitName})
            </option>
          ))}
          <option value={NEW_TRAINEE}>New trainee ({GUEST_UNIT_NAME} unit)...</option>
        </select>
      </label>

      {creating && (
        <label className="field">
          Name
          <input
            value={name}
            placeholder="Type a name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && ready && !busy) start();
            }}
          />
        </label>
      )}

      {error && <p className="toast">{error}</p>}

      <div className="start-actions">
        <button className="primary" disabled={!ready || busy} onClick={start}>
          Start session
        </button>
        <button onClick={() => navigate('/')}>Back</button>
      </div>
    </div>
  );
}

export function Play({ examId }: { examId: string }) {
  const [data, setData] = useState<PlayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trainee, setTrainee] = useState<TraineeChoice | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setTrainee(null);
    Promise.all([resolveExam(examId), getExam(examId)])
      .then(([spec, exam]) => {
        if (!cancelled) setData({ spec, registeredExam: exam !== undefined });
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setError(failure instanceof Error ? failure.message : 'Could not load the scenario');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [examId]);

  if (error) {
    return (
      <div className="center">
        <p>{error}</p>
        <button onClick={() => navigate('/')}>Home</button>
      </div>
    );
  }
  if (!data) return <div className="center">Loading scenario...</div>;
  if (!trainee) return <StartScreen examId={examId} spec={data.spec} onStart={setTrainee} />;

  return (
    <PlaySession
      key={`${examId}:${trainee.traineeId}`}
      spec={data.spec}
      examId={data.registeredExam ? examId : undefined}
      trainee={trainee}
    />
  );
}

function PlaySession({
  spec,
  examId,
  trainee,
}: {
  spec: ScenarioSpec;
  examId: string | undefined;
  trainee: TraineeChoice;
}) {
  const live = useLiveWorld(spec);
  const { snapshot, send, view } = live;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(70);
  const [rankOrder, setRankOrder] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const saved = useRef(false);

  const observed = useMemo(
    () => new Map(snapshot.observations.map((o) => [o.threatId, o])),
    [snapshot.observations],
  );

  const knownIds = useMemo(() => {
    const ids = new Set<string>(snapshot.detectedIds);
    for (const id of observed.keys()) ids.add(id);
    return [...ids].sort();
  }, [snapshot.detectedIds, observed]);

  useEffect(() => {
    setRankOrder((current) => {
      const missing = snapshot.detectedIds.filter((id) => !current.includes(id));
      return missing.length === 0 ? current : [...current, ...missing];
    });
  }, [snapshot.detectedIds]);

  useEffect(() => {
    if (!snapshot.done || saved.current) return;
    saved.current = true;
    setSaveError(null);
    completeSession({
      spec,
      events: live.world.events,
      endedAtSec: live.world.t,
      traineeId: trainee.traineeId,
      unitId: trainee.unitId,
      examId,
    })
      .then((completed) => navigate(completed.debriefPath))
      .catch((error: unknown) => {
        saved.current = false;
        setSaveError(error instanceof Error ? error.message : 'Could not save the session');
      });
  }, [snapshot.done, spec, examId, trainee, live.world, saveAttempt]);

  const detectedSet = useMemo(() => new Set(snapshot.detectedIds), [snapshot.detectedIds]);

  const read = (id: string): SceneContact | undefined => {
    const observation = view.current.get(id);
    if (!observation) return undefined;
    return {
      x: observation.x,
      y: observation.y,
      alt: observation.altM,
      color: detectedSet.has(id) ? DETECTED_COLOR : UNDETECTED_COLOR,
      opacity: 0.95,
    };
  };

  const selected = selectedId ? observed.get(selectedId) : undefined;

  const moveRank = (id: string, delta: number) => {
    const index = rankOrder.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= rankOrder.length) return;
    const next = [...rankOrder];
    next.splice(index, 1);
    next.splice(target, 0, id);
    setRankOrder(next);
    send({ type: 'rank', order: next });
  };

  return (
    <div className="play">
      <header className="topbar">
        <strong>{spec.id}</strong>
        <span className="chip">{trainee.name}</span>
        <span>
          {spec.mapType} · {spec.timeOfDay} · {spec.weather}
        </span>
        <span className="clock">
          {formatClock(snapshot.t)} / {formatClock(spec.durationSec)}
        </span>
        <span className="spacer" />
        <button onClick={() => live.setPaused(!live.paused)}>
          {live.paused ? 'Resume' : 'Pause'}
        </button>
        {[1, 2, 4].map((value) => (
          <button
            key={value}
            className={live.speed === value ? 'active' : ''}
            onClick={() => live.setSpeed(value)}
          >
            {value}x
          </button>
        ))}
        <button className="danger" onClick={live.endNow}>
          End session
        </button>
      </header>

      <div className="stage">
        <div className="viewport">
          <Scene
            spec={spec}
            ids={knownIds}
            read={read}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {snapshot.done && (
            <div className="overlay">
              {saveError ? (
                <div className="overlay-box">
                  <p>Save failed: {saveError}</p>
                  <button className="primary" onClick={() => setSaveAttempt((n) => n + 1)}>
                    Retry save
                  </button>
                </div>
              ) : (
                'Session complete. Saving...'
              )}
            </div>
          )}
        </div>

        <aside className="panel">
          <section>
            <h3>Sensors</h3>
            <div className="chips">
              {spec.sensors.map((sensor, i) => {
                const failed = sensor.failAtSec !== undefined && snapshot.t >= sensor.failAtSec;
                return (
                  <span key={i} className={failed ? 'chip bad' : 'chip'}>
                    {sensor.type} {failed ? 'OFFLINE' : `${Math.round(sensor.health * 100)}%`}
                  </span>
                );
              })}
            </div>
          </section>

          <section>
            <h3>Contacts</h3>
            {knownIds.length === 0 && <p className="muted">No contacts yet. Scanning...</p>}
            <table className="contacts">
              <tbody>
                {knownIds.map((id) => {
                  const observation = observed.get(id);
                  const status = statusOf(observation, detectedSet.has(id), snapshot.results[id]);
                  return (
                    <tr
                      key={id}
                      className={id === selectedId ? 'selected' : ''}
                      onClick={() => setSelectedId(id)}
                    >
                      <td>{id}</td>
                      <td>{observation ? `${Math.round(observation.rangeM)} m` : '-'}</td>
                      <td>{observation ? `${Math.round(observation.bearingDeg)}°` : '-'}</td>
                      <td>{observation ? `${Math.round(observation.altM)} m` : '-'}</td>
                      <td>
                        <span className={`tag ${status.tone}`}>{status.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {selectedId && (
            <section>
              <h3>Contact {selectedId}</h3>
              <ActionPanel
                observation={selected}
                detected={detectedSet.has(selectedId)}
                resolved={snapshot.results[selectedId]}
                confidence={confidence}
                onConfidence={setConfidence}
                ammo={Object.fromEntries(snapshot.effectors.map((e) => [e.type, e.ammo]))}
                onDetect={() => send({ type: 'detect', threatId: selectedId })}
                onClassify={(cls) =>
                  send({
                    type: 'classify',
                    threatId: selectedId,
                    cls,
                    confidence: confidence / 100,
                  })
                }
                onEngage={(effector) => send({ type: 'engage', threatId: selectedId, effector })}
              />
            </section>
          )}

          <section>
            <h3>Priority</h3>
            {rankOrder.length === 0 && <p className="muted">Detect contacts to rank them.</p>}
            <ol className="rank">
              {rankOrder.map((id) => (
                <li key={id}>
                  <span>{id}</span>
                  <button onClick={() => moveRank(id, -1)}>▲</button>
                  <button onClick={() => moveRank(id, 1)}>▼</button>
                </li>
              ))}
            </ol>
            {rankOrder.length > 0 && (
              <button onClick={() => send({ type: 'rank', order: rankOrder })}>
                Confirm order
              </button>
            )}
          </section>

          {snapshot.lastRejection && <p className="toast">Rejected: {snapshot.lastRejection}</p>}
        </aside>
      </div>
    </div>
  );
}

interface ActionPanelProps {
  observation: Observation | undefined;
  detected: boolean;
  resolved: string | undefined;
  confidence: number;
  ammo: Record<string, number>;
  onConfidence: (value: number) => void;
  onDetect: () => void;
  onClassify: (cls: ThreatClass) => void;
  onEngage: (effector: EffectorType) => void;
}

function ActionPanel(props: ActionPanelProps) {
  const { observation, detected, resolved } = props;

  if (resolved) return <p className="muted">Resolved: {resolved}</p>;
  if (!observation) return <p className="muted">Contact lost. No sensor currently sees it.</p>;

  if (!detected) {
    return (
      <>
        <p className="muted">
          Seen by {observation.sensors.join(', ')} · {Math.round(observation.speedMps)} m/s
        </p>
        <button className="primary" onClick={props.onDetect}>
          Declare detection
        </button>
      </>
    );
  }

  return (
    <>
      <p className="muted">
        Seen by {observation.sensors.join(', ')} · {Math.round(observation.speedMps)} m/s
        {observation.assistantSuggestion && (
          <>
            {' '}
            · Assistant suggests <strong>{CLASS_LABEL[observation.assistantSuggestion]}</strong>
          </>
        )}
      </p>

      <label className="slider">
        Confidence {props.confidence}%
        <input
          type="range"
          min={0}
          max={100}
          value={props.confidence}
          onChange={(event) => props.onConfidence(Number(event.target.value))}
        />
      </label>

      <div className="grid">
        {CLASS_ORDER.map((cls) => (
          <button
            key={cls}
            className={observation.classifiedAs === cls ? 'active' : ''}
            onClick={() => props.onClassify(cls)}
          >
            {CLASS_LABEL[cls]}
            {observation.assistantSuggestion === cls ? ' (AI)' : ''}
          </button>
        ))}
      </div>

      <h4>Engage</h4>
      <div className="grid">
        {(['jammer', 'spoofer', 'gun', 'net', 'interceptor'] as EffectorType[]).map((effector) => (
          <button
            key={effector}
            className="danger"
            disabled={!observation.engageable.includes(effector)}
            onClick={() => props.onEngage(effector)}
          >
            {effector} ({props.ammo[effector] ?? 0})
          </button>
        ))}
      </div>
    </>
  );
}
