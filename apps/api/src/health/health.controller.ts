import { Controller, Get, HttpCode, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger('Health');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Liveness: the process is up and serving. Cheap, no dependencies. */
  @Get()
  check() {
    return { status: 'ok', service: 'oudhealth-api', time: new Date().toISOString() };
  }

  /**
   * Readiness: dependencies (database, object storage) are actually reachable.
   * The response reports only "ok" / "unreachable" per check - the real error is
   * logged, not returned, since this endpoint is unauthenticated.
   */
  @Get('ready')
  @HttpCode(200)
  async ready() {
    const probe = async (name: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        return 'ok' as const;
      } catch (e) {
        this.logger.error(`readiness check "${name}" failed`, (e as Error)?.stack);
        return 'unreachable' as const;
      }
    };

    const checks = {
      database: await probe('database', () => this.prisma.$queryRaw`SELECT 1`),
      storage: await probe('storage', () => this.storage.ping()),
    };

    if (Object.values(checks).some((v) => v !== 'ok')) {
      throw new ServiceUnavailableException({ status: 'unavailable', checks });
    }
    return { status: 'ready', checks, time: new Date().toISOString() };
  }
}
