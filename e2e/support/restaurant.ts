import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const SETUP_CODE = 'E2E00001';
export const OWNER = {
  username: 'owner',
  fullName: 'Ananya Sen',
  password: 'Kolkata#Biryani2026',
  backupPassphrase: 'correct horse battery staple',
};
export const STAFF_PASSWORD = 'Staff#Pass2026';
export const STAFF = {
  captain: { username: 'rahul', fullName: 'Rahul Das', role: 'CAPTAIN', pin: '3917' },
  chef: { username: 'bose', fullName: 'Subrata Bose', role: 'KITCHEN', pin: '4826' },
  cashier: { username: 'meera', fullName: 'Meera Saha', role: 'CASHIER', pin: '8462' },
  manager: { username: 'mou', fullName: 'Moumita Paul', role: 'MANAGER', pin: '5173' },
  store: { username: 'gopal', fullName: 'Gopal Mondal', role: 'INVENTORY', pin: '6294' },
} as const;

/** The Hub's API, signed in as someone. */
export async function apiAs(request: APIRequestContext, username: string, password: string) {
  const login = await request.post('/api/v1/auth/login', { data: { username, password } });
  expect(login.ok(), await login.text()).toBe(true);
  const token = ((await login.json()) as { accessToken: string }).accessToken;
  return async <T = Record<string, unknown>>(method: string, path: string, data?: unknown) => {
    const res = await request.fetch(`/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
      ...(data !== undefined && { data }),
    });
    expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  };
}

/** Signs in through the login page with a password. */
export async function signIn(page: Page, username: string, password = STAFF_PASSWORD) {
  await page.goto('/login');
  // The Hub's own browser (localhost) offers the PIN pad first.
  const passwordMode = page.getByRole('radio', { name: 'Password' });
  await passwordMode.or(page.getByLabel('Username')).first().waitFor();
  if (await passwordMode.isVisible()) await passwordMode.click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
