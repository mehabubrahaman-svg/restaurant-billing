import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { signInForTest, signOutForTest } from '../../test/session';
import { Can, hasPermission } from './permissions';

afterEach(signOutForTest);

describe('permissions', () => {
  it('hasPermission matches one code or any of several', () => {
    const s = { permissions: ['users.manage'] };
    expect(hasPermission(s, 'users.manage')).toBe(true);
    expect(hasPermission(s, ['roles.manage', 'users.manage'])).toBe(true);
    expect(hasPermission(s, 'roles.manage')).toBe(false);
    expect(hasPermission(null, 'users.manage')).toBe(false);
  });

  it('<Can> renders children only with the permission', () => {
    signInForTest(['users.manage']);
    render(
      <>
        <Can permission="users.manage">
          <p>Add staff</p>
        </Can>
        <Can permission="roles.manage" fallback={<p>No roles</p>}>
          <p>Edit roles</p>
        </Can>
      </>,
    );
    expect(screen.getByText('Add staff')).toBeInTheDocument();
    expect(screen.queryByText('Edit roles')).toBeNull();
    expect(screen.getByText('No roles')).toBeInTheDocument();
  });
});
