import { Home } from './Home';
import { Play } from './Play';
import { Replay } from './Replay';
import { matchDashboardRoute } from '../dashboard';
import { navigate, useRoute } from './router';

export function App() {
  const route = useRoute();

  switch (route.name) {
    case 'home':
      return <Home />;
    case 'play':
      return <Play examId={route.examId} />;
    case 'replay':
      return <Replay sessionId={route.sessionId} t={route.t} />;
    case 'notFound': {
      const match = matchDashboardRoute(window.location.pathname);
      if (match) {
        const Page = match.route.component;
        return <Page params={match.params} />;
      }
      return (
        <div className="center">
          <p>Page not found.</p>
          <button onClick={() => navigate('/')}>Home</button>
        </div>
      );
    }
  }
}
