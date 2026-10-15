import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DEFAULT_TREE } from '../engine/defaultTree';
import type { SessionRecord } from '../store/records';
import { COMPETENCY_KEYS, pointsLost, stageTotals, threatTimeline, trustBreakdown } from './data';
import { feedback } from './feedback';
import {
  COMPETENCY_COLOR,
  COMPETENCY_LABEL,
  CLASS_LABEL,
  Card,
  DemoBanner,
  Link,
  Message,
  OUTCOME_COLOR,
  STAGE_LABEL,
  Shell,
  fixed,
  replayUrl,
  sessionUrl,
  useLoad,
} from './ui';
import { loadSessionView } from './load';

function capText(session: SessionRecord): string[] {
  return session.report.critical.map((entry) => {
    const fail = DEFAULT_TREE.criticalFails.find((candidate) => candidate.id === entry.id);
    const cap = fail?.scoreCap !== undefined ? `, which caps the score at ${fail.scoreCap}` : '';
    const where = entry.threatId ? ` (${entry.threatId})` : '';
    return `${entry.label}${where}${cap}`;
  });
}

function Timeline({ session }: { session: SessionRecord }) {
  const rows = threatTimeline(session.spec, session.log);
  const span = Math.max(session.endedAtSec, session.spec.durationSec, 1);
  const at = (t: number) => `${Math.min(100, Math.max(0, (t / span) * 100))}%`;

  return (
    <div className="dash-timeline">
      <div className="dash-legend">
        <span>
          <i className="mk mk-observable" /> observable
        </span>
        <span>
          <i className="mk mk-detect" /> detect
        </span>
        <span>
          <i className="mk mk-classify" /> classify
        </span>
        <span>
          <i className="mk mk-engage" /> engage
        </span>
        <span>
          <i className="mk mk-result" /> result
        </span>
      </div>
      {rows.map((row) => {
        const wrong = row.chosen !== null && row.chosen !== row.cls;
        return (
          <div className="dash-tl-row" key={row.threatId}>
            <div className="dash-tl-label">
              <strong>{row.threatId}</strong>
              <span className={wrong ? 'bad' : ''}>
                {CLASS_LABEL[row.cls]}
                {' → '}
                {row.chosen ? CLASS_LABEL[row.chosen] : 'not classified'}
              </span>
            </div>
            <div className="dash-tl-track">
              <span
                className="dash-tl-span"
                style={{
                  left: at(row.observableAt),
                  width: `calc(${at(row.resultAt ?? span)} - ${at(row.observableAt)})`,
                  background: row.outcome ? OUTCOME_COLOR[row.outcome] : undefined,
                }}
              />
              <i
                className="mk mk-observable"
                style={{ left: at(row.observableAt) }}
                title={`observable ${fixed(row.observableAt)}s`}
              />
              {row.detectAt !== null && (
                <i
                  className="mk mk-detect"
                  style={{ left: at(row.detectAt) }}
                  title={`detect ${fixed(row.detectAt)}s`}
                />
              )}
              {row.classifyAt !== null && (
                <i
                  className="mk mk-classify"
                  style={{ left: at(row.classifyAt) }}
                  title={`classify ${fixed(row.classifyAt)}s`}
                />
              )}
              {row.engageAt !== null && (
                <i
                  className="mk mk-engage"
                  style={{ left: at(row.engageAt) }}
                  title={`engage ${fixed(row.engageAt)}s`}
                />
              )}
              {row.resultAt !== null && row.outcome && (
                <i
                  className="mk mk-result"
                  style={{ left: at(row.resultAt), background: OUTCOME_COLOR[row.outcome] }}
                  title={`${row.outcome} ${fixed(row.resultAt)}s`}
                />
              )}
            </div>
            <div
              className="dash-tl-outcome"
              style={{ color: row.outcome ? OUTCOME_COLOR[row.outcome] : undefined }}
            >
              {row.outcome ?? 'no result'}
            </div>
          </div>
        );
      })}
      <div className="dash-tl-axis">
        <span>0 s</span>
        <span>{fixed(span, 0)} s</span>
      </div>
    </div>
  );
}

export function DebriefView({
  session,
  traineeName,
}: {
  session: SessionRecord;
  traineeName: string;
}) {
  const { spec, log, report, extras } = session;
  const caps = capText(session);
  const lost = pointsLost(session);
  const trust = trustBreakdown(log);
  const sentences = feedback(spec, log, report, extras);
  const stages = stageTotals(session).map((row) => ({
    name: STAGE_LABEL[row.stage] ?? row.stage,
    points: Number(row.points.toFixed(1)),
    lost: Number(Math.max(0, row.max - row.points).toFixed(1)),
  }));
  const competencies = COMPETENCY_KEYS.map((key) => ({
    key,
    name: COMPETENCY_LABEL[key] ?? key,
    value: Number(report.competencies[key].toFixed(1)),
  }));

  return (
    <>
      <section className="dash-hero">
        <div className="dash-score">
          <span className="dash-score-value">{fixed(report.total, 0)}</span>
          <span className="dash-score-unit">/ 100</span>
        </div>
        <div className="dash-hero-body">
          <p className="dash-hero-line">
            <strong>{traineeName}</strong> · {session.id}
            {session.examId && <span className="badge badge-exam">Exam</span>}
          </p>
          {caps.length > 0 && (
            <p className="badge badge-critical" role="alert">
              Critical fail: {caps.join('; ')}
            </p>
          )}
          <p className="dash-meta">
            {spec.mapType} · {spec.timeOfDay} · {spec.weather} · difficulty{' '}
            {fixed(Object.values(spec.difficulty).reduce((a, b) => a + b, 0) / 7, 2)} · novelty{' '}
            {fixed(spec.noveltyScore, 2)} · {spec.durationSec}s · {spec.threats.length} contacts
          </p>
          <p className="dash-stats">
            <span>
              Kendall τ <b>{extras.kendallTau === null ? 'n/a' : fixed(extras.kendallTau, 2)}</b>
            </span>
            <span>
              Misses <b>{extras.misses.length}</b>
            </span>
            <span>
              Wasted effort <b>{extras.wastedEffort.length}</b>
            </span>
            <span>
              Heavy ammo <b>{extras.ammoHeavy.length}</b>
            </span>
          </p>
        </div>
        <div className="dash-hero-actions no-print">
          <Link to={replayUrl(session.id, 0)} className="button">
            Replay session
          </Link>
          <Link to={sessionUrl('progress', session.traineeId)} className="button">
            Trainee progress
          </Link>
        </div>
      </section>

      <Card title="What to work on" wide>
        <ul className="dash-feedback">
          {sentences.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      </Card>

      <Card title="Per-threat timeline" wide>
        <Timeline session={session} />
      </Card>

      <div className="dash-grid">
        <Card title="Score by stage (points over max)">
          <div className="dash-chart">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stages} layout="vertical" margin={{ left: 24, right: 16 }}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={110} />
                <Tooltip />
                <Legend />
                <Bar dataKey="points" name="Points" stackId="s" fill="#5aa9ff" />
                <Bar dataKey="lost" name="Lost" stackId="s" fill="#3a4766" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Competencies (0 to 100)">
          <div className="dash-chart">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={competencies} margin={{ left: 0, right: 16 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="value" name="Score">
                  {competencies.map((entry) => (
                    <Cell key={entry.key} fill={COMPETENCY_COLOR[entry.key]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="Why you lost points" wide>
        {lost.length === 0 ? (
          <Message>Every decision earned full points.</Message>
        ) : (
          <ol className="dash-lost">
            {lost.map((item) => (
              <li key={`${item.decision.threatId}-${item.decision.stage}`}>
                <div className="dash-lost-head">
                  <span className="dash-lost-points">−{fixed(item.lost, 1)}</span>
                  <span className="pill">{STAGE_LABEL[item.decision.stage]}</span>
                  <strong>{item.decision.threatId}</strong>
                  <span className="muted">
                    {item.trueClass ? CLASS_LABEL[item.trueClass] : 'unknown class'}
                  </span>
                  <Link
                    to={replayUrl(session.id, item.time)}
                    className="button button-small no-print"
                  >
                    Replay at {fixed(item.time)}s
                  </Link>
                </div>
                <p>{item.decision.reason}</p>
                <p className="muted small">
                  {fixed(item.decision.points, 1)} of {fixed(item.decision.max, 1)} ·{' '}
                  {item.decision.nodePath.join(' › ')}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title="Trust in the AI assistant" wide>
        <div className="dash-trust">
          <div className="trust-cell trust-bad">
            <b>{trust.followedWrong}</b>
            <span>Followed, assistant wrong</span>
          </div>
          <div className="trust-cell trust-good">
            <b>{trust.overrodeWrong}</b>
            <span>Overrode, assistant wrong</span>
          </div>
          <div className="trust-cell trust-ok">
            <b>{trust.followedRight}</b>
            <span>Followed, assistant right</span>
          </div>
          <div className="trust-cell trust-warn">
            <b>{trust.overrodeRight}</b>
            <span>Overrode, assistant right</span>
          </div>
        </div>
      </Card>
    </>
  );
}

export function Debrief({ params }: { params: Record<string, string> }) {
  const sessionId = params.sessionId ?? '';
  const state = useLoad(() => loadSessionView(sessionId), [sessionId]);
  const found = state.data;

  return (
    <Shell
      title="Session debrief"
      subtitle="Where the points went, and what to fix next"
      banner={
        found ? <DemoBanner ids={[found.session.traineeId]} onReset={state.reload} /> : undefined
      }
    >
      {state.loading && !found && <Message>Loading session...</Message>}
      {state.error && <Message>{state.error}</Message>}
      {!state.loading && !state.error && !found && (
        <Message>
          No session found for {sessionId}. <Link to="/review">Back to review</Link>
        </Message>
      )}
      {found && (
        <DebriefView
          session={found.session}
          traineeName={found.trainee ? found.trainee.name : found.session.traineeId}
        />
      )}
    </Shell>
  );
}
