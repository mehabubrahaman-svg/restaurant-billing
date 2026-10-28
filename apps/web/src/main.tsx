import './fonts';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { createQueryClient, Providers } from './app/providers';
import { createAppRouter } from './app/router';

const container = document.getElementById('root');
if (container === null) throw new Error('#root element missing from index.html');

createRoot(container).render(
  <StrictMode>
    <Providers client={createQueryClient()}>
      <RouterProvider router={createAppRouter()} />
    </Providers>
  </StrictMode>,
);
