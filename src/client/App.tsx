import { Home } from './Home';
import { Play } from './Play';
import { Replay } from './Replay';
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
    case 'notFound':
      return (
        <div className="center">
          <p>Page not found.</p>
          <button onClick={() => navigate('/')}>Home</button>
        </div>
      );
  }
}
