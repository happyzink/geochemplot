import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { resolveClient } from './lib/api';

async function bootstrap() {
  const container = document.getElementById('root');
  if (!container) throw new Error('缺少 #root 容器');
  const resolution = await resolveClient();
  createRoot(container).render(<App resolution={resolution} />);
}

void bootstrap();
