import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { createQueryClient, Providers } from '../app/providers';
import { routes } from '../app/router';

/** Renders the real route tree at `path`, as the browser would. */
export function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = createQueryClient();
  const view = render(
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...view, router, client };
}
