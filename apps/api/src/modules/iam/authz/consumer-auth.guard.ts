import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

@Injectable()
export class ConsumerAuthGuard implements CanActivate {
  constructor(@Optional() private readonly jwtService?: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ext = request as Request & { userId?: string };

    if (!ext.userId?.trim()) {
      const userId = await this.resolveUserId(request);
      if (userId) ext.userId = userId;
    }

    if (!ext.userId?.trim()) {
      throw new UnauthorizedException('Missing authentication');
    }
    return true;
  }

  private async resolveUserId(request: Request): Promise<string | undefined> {
    const authHeader = request.header('Authorization')?.trim();
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
        return payload.sub ?? payload.userId;
      } catch (e) {
        if (e instanceof UnauthorizedException) throw e;
        throw new UnauthorizedException('Invalid token');
      }
    }

    const allowHeader =
      process.env.ALLOW_INSECURE_USER_ID_HEADER === 'true' ||
      process.env.ALLOW_INSECURE_USER_ID_HEADER === '1';
    if (allowHeader) {
      return request.header('x-user-id')?.trim();
    }
    return undefined;
  }
}
