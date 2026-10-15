import { useEffect, useState } from 'react';
import { navigate } from './router';
import { getTraineeId, listSessions, setTraineeId, type StoredSession } from './storage';

const SAMPLE_EXAMS = ['1', '2', '3', '4', '5'];

export function Home() {
  const [trainee, setTrainee] = useState(getTraineeId);
  const [sessions, setSessions] = useState<StoredSession[]>([]);

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  return (
    <div className="home">
      <h1>DronAcharya</h1>
      <p className="muted">Drone and counter-drone threat simulation trainer.</p>

      <label className="field">
        Trainee ID
        <input
          value={trainee}
          onChange={(event) => {
            setTrainee(event.target.value);
            setTraineeId(event.target.value.trim() || 'trainee');
          }}
        />
      </label>

      <h2>Start an exam</h2>
      <div className="grid">
        {SAMPLE_EXAMS.map((examId) => (
          <button key={examId} className="primary" onClick={() => navigate(`/play/${examId}`)}>
            Exam {examId}
          </button>
        ))}
        <button onClick={() => navigate(`/play/${Math.floor(Math.random() * 1_000_000)}`)}>
          Random scenario
        </button>
      </div>

      <h2>Past sessions</h2>
      {sessions.length === 0 && <p className="muted">No saved sessions yet.</p>}
      <ul className="sessions">
        {sessions.map((session) => (
          <li key={session.id}>
            <button onClick={() => navigate(`/replay/${session.id}`)}>
              {session.examId} · {session.traineeId} · {new Date(session.savedAt).toLocaleString()}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
