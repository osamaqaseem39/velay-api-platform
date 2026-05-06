import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

const PLATFORM_ALLOWED_ROLES = ['platform-owner'] as const;

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user?: { roles?: string[] } }>();
    const roles = user?.roles ?? [];
    const effectiveRequired = requiredRoles.filter((role) =>
      PLATFORM_ALLOWED_ROLES.includes(role as (typeof PLATFORM_ALLOWED_ROLES)[number]),
    );
    if (!effectiveRequired.length) {
      return false;
    }
    return effectiveRequired.some((role) => roles.includes(role));
  }
}
