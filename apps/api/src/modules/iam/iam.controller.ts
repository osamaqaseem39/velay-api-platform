import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RolesGuard } from './authz/roles.guard';
import { Roles } from './authz/roles.decorator';
import { AssignRoleDto } from './dto/assign-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CurrentTenant } from '../../tenancy/tenant-context.decorator';
import type { TenantContext } from '../../tenancy/tenant-context.interface';
import { IamService } from './iam.service';
import { SYSTEM_ROLES } from './iam.constants';

@Controller('iam')
@UseGuards(RolesGuard)
export class IamController {
  constructor(private readonly iamService: IamService) {}

  private requesterUserId(req: Request): string {
    const userId = (req as Request & { userId?: string }).userId?.trim();
    if (!userId) {
      throw new UnauthorizedException('Missing user');
    }
    return userId;
  }

  @Get('me')
  @Roles(...SYSTEM_ROLES)
  async me(@Req() req: Request) {
    const userId = this.requesterUserId(req);
    return this.iamService.getMe(userId);
  }

  @Get('users')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  async listUsers(
    @Req() req: Request,
    @CurrentTenant() tenant: TenantContext,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    const requesterId = this.requesterUserId(req);
    const isPlatformOwner = await this.iamService.hasAnyRole(requesterId, [
      'platform-owner',
    ]);
    return this.iamService.listUsers(requesterId, isPlatformOwner, {
      tenantId: tenant.tenantId,
      search,
      sortBy,
      sortOrder,
    });
  }

  @Get('end-users')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  async listEndUsers() {
    return this.iamService.listEndUsers();
  }

  @Post('users')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  async createUser(
    @Req() req: Request,
    @Body() dto: CreateUserDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    const requesterId = this.requesterUserId(req);
    const isPlatformOwner = await this.iamService.hasAnyRole(requesterId, [
      'platform-owner',
    ]);
    return this.iamService.createUser(dto, {
      requesterId,
      isPlatformOwner,
      tenantId: tenant.tenantId,
    });
  }

  @Patch('users/:userId')
  @Roles(
    'platform-owner',
    'business-admin',
    'location-admin',
    'business-staff',
  )
  async updateUser(
    @Req() req: Request,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    const requesterId = this.requesterUserId(req);
    const isPlatformOwner = await this.iamService.hasAnyRole(requesterId, [
      'platform-owner',
    ]);
    return this.iamService.updateUser(userId, dto, {
      requesterId,
      isPlatformOwner,
    });
  }

  @Delete('users/:userId')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  async deleteUser(@Req() req: Request, @Param('userId') userId: string) {
    const requesterId = this.requesterUserId(req);
    const isPlatformOwner = await this.iamService.hasAnyRole(requesterId, [
      'platform-owner',
    ]);
    return this.iamService.deleteUser(userId, {
      requesterId,
      isPlatformOwner,
    });
  }

  @Post('users/:userId/activate')
  @Roles('platform-owner')
  async activateUser(@Param('userId') userId: string) {
    return this.iamService.activateUser(userId);
  }

  @Post('roles/assign')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  async assignRole(@Req() req: Request, @Body() dto: AssignRoleDto) {
    const requesterId = this.requesterUserId(req);
    const isPlatformOwner = await this.iamService.hasAnyRole(requesterId, [
      'platform-owner',
    ]);
    return this.iamService.assignRole(dto.userId, dto.role, {
      requesterId,
      isPlatformOwner,
      locationId: dto.locationId,
    });
  }

  @Post('roles/unassign')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  async unassignRole(@Req() req: Request, @Body() dto: AssignRoleDto) {
    const requesterId = this.requesterUserId(req);
    const isPlatformOwner = await this.iamService.hasAnyRole(requesterId, [
      'platform-owner',
    ]);
    return this.iamService.unassignRole(dto.userId, dto.role, {
      requesterId,
      isPlatformOwner,
    });
  }
}
