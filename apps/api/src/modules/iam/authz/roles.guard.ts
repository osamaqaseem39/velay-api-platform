import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { SystemRole } from '../iam.constants';
import { IamService } from '../iam.service';
import { ROLES_KEY } from './roles.decorator';

const PLATFORM_ALLOWED_ROLES: ReadonlyArray<SystemRole> = ['platform-owner'];

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    // Keep bootstrap resilient if a feature module forgets to import IamModule.
    @Optional() private readonly iamService?: IamService,
    // Some modules may not import/export JwtModule, so keep boot resilient.
    // If Authorization bearer token is used but JwtService isn't available,
    // we will fail the request with a 401 instead of crashing the whole app.
    @Optional() private readonly jwtService?: JwtService,
  ) {}

  /**
   * Resolves the caller from Authorization (or optional dev header) and sets
   * `request.userId` so other guards (e.g. SaasFeatureGuard) can run even when
   * this route has no `@Roles` requirement.
   */
  private async resolveUserId(
    request: Request,
  ): Promise<string | undefined> {
    const authHeader = request.header('Authorization')?.trim();
    let userId: string | undefined;

    if (authHeader?.startsWith('Bearer ')) {
      if (!this.jwtService) {
        throw new UnauthorizedException(
          'Token verification not configured on server',
        );
      }
      const token = authHeader.slice('Bearer '.length);
      try {
        const payload = await this.jwtService.verifyAsync<{
          sub?: string;
          userId?: string;
          typ?: string;
        }>(token);
        if (payload.typ === 'refresh') {
          throw new UnauthorizedException('Use access token for API requests');
        }
        userId = payload.sub ?? payload.userId;
      } catch (e) {
        if (e instanceof UnauthorizedException) throw e;
        throw new UnauthorizedException('Invalid token');
      }
    }

    // Security: do not trust spoofable identity headers in normal environments.
    // Keep an explicit opt-in for local/dev troubleshooting only.
    const allowHeaderUserId =
      process.env.ALLOW_INSECURE_USER_ID_HEADER === 'true' ||
      process.env.ALLOW_INSECURE_USER_ID_HEADER === '1';
    if (!userId && allowHeaderUserId) {
      userId = request.header('x-user-id')?.trim();
    }

    return userId;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ext = request as Request & { userId?: string };

    const requiredRoles = this.reflector.getAllAndOverride<SystemRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!ext.userId?.trim()) {
      const userId = await this.resolveUserId(request);
      if (userId) {
        ext.userId = userId;
      }
    }

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const userId = ext.userId?.trim();
    const rolesToCheck = requiredRoles.filter((role) =>
      PLATFORM_ALLOWED_ROLES.includes(role),
    );

    if (!userId) {
      throw new UnauthorizedException('Missing authentication');
    }

    if (!this.iamService) {
      throw new InternalServerErrorException(
        'Authorization service is not configured on server',
      );
    }

    if (rolesToCheck.length === 0) {
      throw new ForbiddenException(
        'This API is restricted to platform-owner role only',
      );
    }

    await this.iamService.assertRequesterActive(userId);

    const allowed = await this.iamService.hasAnyRole(userId, rolesToCheck);
    if (!allowed) {
      throw new ForbiddenException(
        `User ${userId} does not have the required role to access this endpoint`,
      );
    }

    return true;
  }
}
