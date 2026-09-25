import { describe, expect, it, beforeEach } from 'vitest';
import { authenticate, signUser } from './auth.js';

beforeEach(() => {
  process.env.OWNER_USERNAME = 'admin-test';
  process.env.OWNER_PASSWORD = 'secret-test';
  process.env.JWT_SECRET = 'test-secret';
});

describe('ZEEOR authentication', () => {
  it('authenticates the configured owner', () => {
    const user = authenticate('admin-test', 'secret-test');
    expect(user).toMatchObject({ id: 'owner', role: 'owner' });
  });

  it('rejects invalid credentials', () => {
    expect(authenticate('admin-test', 'wrong')).toBeNull();
  });

  it('signs a role-bearing token', () => {
    const token = signUser({ id: 'owner', username: 'owner-test', role: 'owner' });
    expect(token.split('.')).toHaveLength(3);
  });
});
