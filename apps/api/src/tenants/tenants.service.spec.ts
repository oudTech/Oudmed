import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TenantsService } from './tenants.service';

/**
 * Known issue #6: the public (unauthenticated) tenant lookup used by the
 * login page must tell a suspended hospital apart from one that never
 * existed, instead of collapsing both into the same "Workspace not found".
 */
function makeService(tenant: unknown) {
  const prisma = { tenant: { findFirst: jest.fn().mockResolvedValue(tenant) } };
  const files = { presignRef: jest.fn().mockResolvedValue(null) };
  const service = new TenantsService(
    prisma as any,
    {} as any,
    {} as any,
    files as any,
    {} as any,
  );
  return { service, prisma };
}

describe('TenantsService.resolvePublic', () => {
  it('throws TENANT_NOT_FOUND when no tenant matches the slug', async () => {
    const { service } = makeService(null);
    await expect(service.resolvePublic('nope')).rejects.toMatchObject({
      status: new NotFoundException().getStatus(),
      response: { code: 'TENANT_NOT_FOUND' },
    });
  });

  it('throws TENANT_SUSPENDED (403), not a 404, for a suspended tenant', async () => {
    const { service } = makeService({
      id: 't1', name: 'Demo', slug: 'demo', logoUrl: null, primaryColor: '#000', isActive: false,
    });
    await expect(service.resolvePublic('demo')).rejects.toMatchObject({
      status: new ForbiddenException().getStatus(),
      response: { code: 'TENANT_SUSPENDED' },
    });
  });

  it('resolves normally for an active tenant and never leaks isActive', async () => {
    const { service } = makeService({
      id: 't1', name: 'Demo', slug: 'demo', logoUrl: null, primaryColor: '#000', isActive: true,
    });
    const result = await service.resolvePublic('demo');
    expect(result).toEqual({ id: 't1', name: 'Demo', slug: 'demo', logoUrl: null, primaryColor: '#000' });
    expect(result).not.toHaveProperty('isActive');
  });
});
