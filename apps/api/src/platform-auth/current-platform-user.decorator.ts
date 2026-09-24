import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** A platform operator (OudHealth's own team) - never has a tenantId, by construction. */
export interface PlatformAuthUser {
  platformUserId: string;
  email: string;
  fullName: string;
}

export const CurrentPlatformUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformAuthUser => ctx.switchToHttp().getRequest().user,
);
