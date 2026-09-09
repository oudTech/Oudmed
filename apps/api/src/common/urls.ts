/**
 * Domain layout:
 *   APP_ROOT_DOMAIN  dev: "localhost:3001"   prod: "oudmed.com"
 *   APP_PROTOCOL     dev: "http"             prod: "https"
 *
 * Apex (marketing + new-clinic sign-up):  <protocol>://<root>
 * Tenant workspace:                        <protocol>://<slug>.<root>
 */
export function rootDomain(): string {
  return process.env.APP_ROOT_DOMAIN ?? 'localhost:3001';
}

export function appProtocol(): string {
  return process.env.APP_PROTOCOL ?? 'http';
}

export function apexUrl(): string {
  return `${appProtocol()}://${rootDomain()}`;
}

export function tenantUrl(slug: string): string {
  return `${appProtocol()}://${slug}.${rootDomain()}`;
}
