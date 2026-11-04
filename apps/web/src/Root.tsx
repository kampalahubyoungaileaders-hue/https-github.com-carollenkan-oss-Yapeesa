import { useEffect, useState } from 'react';
import App from './App';
import SecureApp from './SecureApp';
export default function Root() {
  const [live, setLive] = useState(() => location.hash.startsWith('#live'));
  useEffect(() => {
    const update = () => setLive(location.hash.startsWith('#live'));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return live ? <SecureApp /> : <App />;
}
