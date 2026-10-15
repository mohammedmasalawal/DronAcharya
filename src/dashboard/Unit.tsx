import {
  COMPETENCY_KEYS,
  conditionDifficulty,
  examComparison,
  ranking,
  unitHeatmap,
  type UnitData,
} from './data';
import { loadUnitData } from './load';
import {
  COMPETENCY_LABEL,
  Card,
  DemoBanner,
  Link,
  Message,
  Shell,
  fixed,
  heatColor,
  sessionUrl,
  useLoad,
} from './ui';

const DIMENSION_LABEL: Record<string, string> = {
  mapType: 'Terrain',
  timeOfDay: 'Time of day',
  weather: 'Weather',
};

export function UnitView({ data }: { data: UnitData }) {
  const heatmap = unitHeatmap(data);
  const conditions = conditionDifficulty(data);
  const exams = examComparison(data);
  const rows = ranking(data);

  return (
    <>
      <Card title="Competency heatmap (mean of each trainee's last 3 sessions, exam excluded)" wide>
        <div className="dash-scroll">
          <table className="dash-table dash-heatmap">
            <thead>
              <tr>
                <th>Trainee</th>
                {COMPETENCY_KEYS.map((key) => (
                  <th key={key}>{COMPETENCY_LABEL[key]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmap.map((row) => (
                <tr key={row.traineeId}>
                  <th>
                    <Link to={sessionUrl('progress', row.traineeId)}>{row.name}</Link>
                  </th>
                  {COMPETENCY_KEYS.map((key) => {
                    const value = row.competencies[key];
                    return (
                      <td
                        key={key}
                        className="num heat"
                        style={{ background: value === null ? undefined : heatColor(value) }}
                      >
                        <Link to={sessionUrl('progress', row.traineeId)}>
                          {value === null ? '–' : fixed(value, 0)}
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dash-scale">
          <span>0</span>
          <i />
          <span>100</span>
        </div>
      </Card>

      <div className="dash-grid">
        <Card title="Which conditions the unit handles worst">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Condition</th>
                <th>Sessions</th>
                <th>Mean total</th>
                {COMPETENCY_KEYS.map((key) => (
                  <th key={key}>{(COMPETENCY_LABEL[key] ?? key).slice(0, 4)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {conditions.map((row) => (
                <tr key={`${row.dimension}-${row.value}`} className={row.worst ? 'row-weak' : ''}>
                  <td>
                    <span className="muted">{DIMENSION_LABEL[row.dimension]} · </span>
                    {row.value}
                    {row.worst && <span className="badge badge-critical">Weakest</span>}
                  </td>
                  <td className="num">{row.sessions}</td>
                  <td className="num">
                    <b>{fixed(row.meanTotal, 0)}</b>
                  </td>
                  {COMPETENCY_KEYS.map((key) => (
                    <td
                      key={key}
                      className="num heat"
                      style={{ background: heatColor(row.competencies[key]) }}
                    >
                      {fixed(row.competencies[key], 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Common exam comparison">
          {exams.length === 0 ? (
            <Message>No exam sessions recorded for this unit.</Message>
          ) : (
            exams.map((exam) => (
              <div key={exam.examId} className="dash-exam">
                <p className="muted small">
                  {exam.examId}
                  {exam.seed !== null && ` · common seed ${exam.seed}`} · unit mean{' '}
                  <b>{fixed(exam.meanTotal, 0)}</b>
                </p>
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Trainee</th>
                      <th>Total</th>
                      <th>Critical fails</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {exam.rows.map((row) => (
                      <tr key={row.sessionId}>
                        <td>
                          <Link to={sessionUrl('progress', row.traineeId)}>{row.name}</Link>
                        </td>
                        <td className="num heat" style={{ background: heatColor(row.total) }}>
                          {fixed(row.total, 0)}
                        </td>
                        <td className="num">{row.criticalFails}</td>
                        <td className="no-print">
                          <Link to={sessionUrl('debrief', row.sessionId)}>Debrief</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </Card>
      </div>

      <Card title="Ranking (mean total of the last 3 non-exam sessions)" wide>
        <table className="dash-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Trainee</th>
              <th>Recent mean</th>
              <th>Critical fails</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.traineeId}>
                <td className="num">{row.rank}</td>
                <td>
                  <Link to={sessionUrl('progress', row.traineeId)}>{row.name}</Link>
                </td>
                <td className="num">
                  <b>{row.recentMean === null ? '–' : fixed(row.recentMean, 1)}</b>
                </td>
                <td className="num">{row.criticalFails}</td>
                <td className="num">{row.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

export function Unit({ params }: { params: Record<string, string> }) {
  const unitId = params.unitId ?? '';
  const state = useLoad(() => loadUnitData(unitId), [unitId]);
  const data = state.data;

  return (
    <Shell
      title={data ? `Unit ${data.unit.name}` : 'Unit view'}
      subtitle="Individual and unit performance over repeated sessions"
      banner={
        data ? (
          <DemoBanner ids={data.trainees.map((t) => t.id)} onReset={state.reload} />
        ) : undefined
      }
    >
      {state.loading && !data && <Message>Loading unit...</Message>}
      {state.error && <Message>{state.error}</Message>}
      {!state.loading && !state.error && !data && (
        <Message>
          No unit found for {unitId}. <Link to="/review">Back to review</Link>
        </Message>
      )}
      {data && <UnitView data={data} />}
    </Shell>
  );
}
