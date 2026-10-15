import { loadReviewIndex, type ReviewIndex } from './load';
import { Card, DemoBanner, Link, Message, Shell, sessionUrl, useLoad } from './ui';

export function ReviewView({ index }: { index: ReviewIndex }) {
  return (
    <>
      <Card title="Screens" wide>
        <ul className="dash-explain">
          <li>
            <b>Session debrief</b> shows where one session lost points, the per-threat timeline, a
            replay link for every lost decision and rule-based feedback.
          </li>
          <li>
            <b>Trainee progress</b> tracks competencies, Elo skill estimates, difficulty, novelty,
            confusion pairs and reaction time across repeated sessions.
          </li>
          <li>
            <b>Unit view</b> compares trainees on a heatmap, ranks them, shows the common exam and
            the conditions the unit handles worst.
          </li>
        </ul>
      </Card>

      {index.units.length === 0 && <Message>No units recorded yet.</Message>}

      <div className="dash-grid">
        {index.units.map(({ unit, trainees }) => (
          <Card key={unit.id} title={`Unit ${unit.name}`}>
            <p>
              <Link to={sessionUrl('unit', unit.id)} className="button">
                Open unit view
              </Link>
            </p>
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Trainee</th>
                  <th>Sessions</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {trainees.map(({ trainee, sessions, latestSessionId }) => (
                  <tr key={trainee.id}>
                    <td>
                      <Link to={sessionUrl('progress', trainee.id)}>{trainee.name}</Link>
                    </td>
                    <td className="num">{sessions}</td>
                    <td>
                      {latestSessionId && (
                        <Link to={sessionUrl('debrief', latestSessionId)}>Latest debrief</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>
    </>
  );
}

export function Review(_props: { params?: Record<string, string> }) {
  const state = useLoad(() => loadReviewIndex(), []);
  const index = state.data;
  const ids = index ? index.units.flatMap((u) => u.trainees.map((t) => t.trainee.id)) : [];

  return (
    <Shell
      title="After-action review"
      subtitle="Pick a unit, trainee or session"
      banner={index ? <DemoBanner ids={ids} onReset={state.reload} /> : undefined}
    >
      {state.loading && !index && <Message>Loading the store...</Message>}
      {state.error && <Message>{state.error}</Message>}
      {index && <ReviewView index={index} />}
    </Shell>
  );
}
