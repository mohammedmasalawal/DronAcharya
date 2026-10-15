import { useEffect, useState } from 'react';
import { matchDashboardRoute } from '../dashboard';
import { listAllSessions, type SessionRecord } from '../store';
import { navigate } from './router';
import { debriefPath, replayPath } from './session';

const SAMPLE_EXAMS = ['1', '2', '3', '4', '5'];
const RECENT_SESSIONS = 8;
const INSTRUCTOR_PATH = '/instructor';

export function Home() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const instructorReady = matchDashboardRoute(INSTRUCTOR_PATH) !== null;

  useEffect(() => {
    listAllSessions()
      .then((rows) => setSessions(rows.slice(0, RECENT_SESSIONS)))
      .catch(() => setSessions([]));
  }, []);

  return (
    <div className="home">
      <h1>DronAcharya</h1>
      <p className="muted">Drone and counter-drone threat simulation trainer.</p>

      <div className="entry-grid">
        <section className="entry-card">
          <h2>Trainee</h2>
          <p className="muted">Play a scenario. You choose who you are on the next screen.</p>
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
        </section>

        <section className="entry-card">
          <h2>Review</h2>
          <p className="muted">
            Debriefs, trainee progress and unit performance, with demo data if the store is empty.
          </p>
          <button className="primary" onClick={() => navigate('/review')}>
            Open review
          </button>
        </section>

        <section className="entry-card">
          <h2>Instructor</h2>
          {instructorReady ? (
            <>
              <p className="muted">Set up units, trainees and unit exams.</p>
              <button className="primary" onClick={() => navigate(INSTRUCTOR_PATH)}>
                Open instructor
              </button>
            </>
          ) : (
            <p className="muted">Coming soon.</p>
          )}
        </section>
      </div>

      <h2>Recent sessions</h2>
      {sessions.length === 0 && <p className="muted">No saved sessions yet.</p>}
      <ul className="sessions">
        {sessions.map((session) => (
          <li key={session.id} className="session-row">
            <span>
              {session.traineeId} · {session.scenarioId} · {session.report.total.toFixed(0)} points
              · {new Date(session.createdAt).toLocaleString()}
            </span>
            <span className="session-links">
              <button onClick={() => navigate(debriefPath(session.id))}>Debrief</button>
              <button onClick={() => navigate(replayPath(session.id))}>Replay</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
