import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Business } from '../businesses/entities/business.entity';
import { BusinessMembership } from '../businesses/entities/business-membership.entity';
import { BusinessLocation } from '../businesses/entities/business-location.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SystemRole } from './iam.constants';
import { Role } from './entities/role.entity';
import { User } from './entities/user.entity';
import { UserRole } from './entities/user-role.entity';

@Injectable()
export class IamService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserRole)
    private readonly userRolesRepository: Repository<UserRole>,
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
    @InjectRepository(Business)
    private readonly businessesRepository: Repository<Business>,
    @InjectRepository(BusinessMembership)
    private readonly membershipsRepository: Repository<BusinessMembership>,
    @InjectRepository(BusinessLocation)
    private readonly locationsRepository: Repository<BusinessLocation>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedSystemRoles();
  }

  async getMe(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    const roleRows = await this.userRolesRepository.find({ where: { userId } });

    // Find locationId if any
    const locationRole = roleRows.find((r) => r.roleCode === 'location-admin');
    const locationId = locationRole?.locationId;

    let business: Business | null = null;
    let tenantId: string | undefined = undefined;

    // Try to find business via membership
    const membership = await this.membershipsRepository.findOne({
      where: { userId },
      relations: ['business'],
    });

    if (membership?.business) {
      business = membership.business;
      tenantId = business.tenantId;
    } else if (locationId) {
      // If no membership but has location, find business via location
      const location = await this.locationsRepository.findOne({
        where: { id: locationId },
        relations: ['business'],
      });
      if (location?.business) {
        business = location.business;
        tenantId = business.tenantId;
      }
    }

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      profilePictureUrl: user.profilePictureUrl ?? null,
      isActive: user.isActive,
      roles: roleRows.map((r) => r.roleCode),
      locationId,
      tenantId,
      business: business
        ? {
            id: business.id,
            businessName: business.businessName,
            tenantId: business.tenantId,
          }
        : undefined,
    };
  }

  private async coworkerUserIdsFor(requesterUserId: string): Promise<string[]> {
    const myMemberships = await this.membershipsRepository.find({
      where: { userId: requesterUserId },
    });
    const businessIds = new Set(myMemberships.map((m) => m.businessId));

    // Also consider location-admin roles to find business memberships
    const myLocAdminRoles = await this.userRolesRepository.find({
      where: { userId: requesterUserId, roleCode: 'location-admin' },
    });
    const myLocIds = myLocAdminRoles
      .map((r) => r.locationId)
      .filter((id): id is string => !!id);

    if (myLocIds.length > 0) {
      const myLocations = await this.locationsRepository.find({
        where: { id: In(myLocIds) },
      });
      for (const loc of myLocations) {
        businessIds.add(loc.businessId);
      }
    }

    if (businessIds.size === 0) return [];

    const bIds = [...businessIds];
    const rows = await this.membershipsRepository.find({
      where: { businessId: In(bIds) },
    });
    const userIds = new Set(rows.map((r) => r.userId));

    // Also include users who are location-admin for any location in these businesses
    const allLocations = await this.locationsRepository.find({
      where: { businessId: In(bIds) },
    });
    const allLocationIds = allLocations.map((l) => l.id);
    if (allLocationIds.length > 0) {
      const locAdminRoles = await this.userRolesRepository.find({
        where: { roleCode: 'location-admin', locationId: In(allLocationIds) },
      });
      for (const r of locAdminRoles) {
        userIds.add(r.userId);
      }
    }

    return [...userIds];
  }

  private async assertCanManageUser(
    requesterId: string,
    targetUserId: string,
    isPlatformOwner: boolean,
    action: 'update' | 'delete',
  ): Promise<void> {
    if (isPlatformOwner) return;
    if (action === 'delete' && requesterId === targetUserId) {
      throw new BadRequestException('Cannot delete your own account');
    }
    if (requesterId === targetUserId) {
      return;
    }
    const myCoworkers = new Set(await this.coworkerUserIdsFor(requesterId));
    if (!myCoworkers.has(targetUserId)) {
      throw new ForbiddenException(
        'You can only manage users in your business',
      );
    }
    if (await this.hasAnyRole(targetUserId, ['platform-owner'])) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  async listUsers(
    requesterUserId: string,
    isPlatformOwner: boolean,
    input?: {
      tenantId?: string;
      search?: string;
      sortBy?: string;
      sortOrder?: string;
    },
  ) {
    const businessRoles: SystemRole[] = [
      'platform-owner',
      'business-admin',
      'location-admin',
      'business-staff',
      'customer-end-user',
    ];
    const businessRoleRows = await this.userRolesRepository.find({
      where: { roleCode: In(businessRoles) },
    });
    let businessUserIds = [...new Set(businessRoleRows.map((r) => r.userId))];
    const tenantId = (input?.tenantId ?? '').trim();
    if (tenantId && tenantId !== 'public') {
      const business = await this.businessesRepository.findOne({
        where: { tenantId },
      });
      if (!business) return [];
      const tenantMemberships = await this.membershipsRepository.find({
        where: { businessId: business.id },
      });
      const tenantUserIds = new Set(tenantMemberships.map((m) => m.userId));

      // Also include users who are location-admin for any location in this business
      const locations = await this.locationsRepository.find({
        where: { businessId: business.id },
      });
      const locationIds = locations.map((l) => l.id);
      if (locationIds.length > 0) {
        const locAdminRoles = await this.userRolesRepository.find({
          where: { roleCode: 'location-admin', locationId: In(locationIds) },
        });
        for (const r of locAdminRoles) {
          tenantUserIds.add(r.userId);
        }
      }

      if (!isPlatformOwner && !tenantUserIds.has(requesterUserId)) {
        throw new ForbiddenException(
          'You can only view users in your business',
        );
      }
      businessUserIds = businessUserIds.filter((id) => tenantUserIds.has(id));
    }
    if (!isPlatformOwner) {
      const coworkers = new Set(await this.coworkerUserIdsFor(requesterUserId));
      businessUserIds = businessUserIds.filter((id) => coworkers.has(id));
    }
    if (businessUserIds.length === 0) return [];

    const search = (input?.search ?? '').trim().toLowerCase();
    const sortByInput = (input?.sortBy ?? '').trim().toLowerCase();
    const sortOrderInput = (input?.sortOrder ?? '').trim().toUpperCase();

    const sortBy =
      sortByInput === 'fullname'
        ? 'fullName'
        : sortByInput === 'email'
          ? 'email'
          : sortByInput === 'createdat'
            ? 'createdAt'
            : 'createdAt';
    const sortOrder =
      sortOrderInput === 'ASC' || sortOrderInput === 'DESC'
        ? sortOrderInput
        : 'DESC';

    const query = this.usersRepository
      .createQueryBuilder('user')
      .where('user.id IN (:...ids)', { ids: businessUserIds });

    if (search) {
      query.andWhere(
        "(LOWER(user.fullName) LIKE :search OR LOWER(user.email) LIKE :search OR LOWER(COALESCE(user.phone, '')) LIKE :search)",
        { search: `%${search}%` },
      );
    }

    query.orderBy(`user.${sortBy}`, sortOrder);
    const users = await query.getMany();
    const userIds = users.map((u) => u.id);
    if (userIds.length === 0) return [];

    const userRoles = await this.userRolesRepository.find({
      where: { userId: In(userIds) },
    });
    return users.map((user) => ({
      ...user,
      roles: userRoles
        .filter((userRole) => userRole.userId === user.id)
        .map((userRole) => userRole.roleCode),
    }));
  }

  /** Users who have the customer-end-user role (plus their other roles). */
  async listEndUsers() {
    const endRows = await this.userRolesRepository.find({
      where: { roleCode: 'customer-end-user' },
    });
    const userIds = [...new Set(endRows.map((r) => r.userId))];
    if (userIds.length === 0) return [];
    const users = await this.usersRepository.find({
      where: { id: In(userIds) },
      order: { createdAt: 'DESC' },
    });
    const allRoles = await this.userRolesRepository.find({
      where: { userId: In(userIds) },
    });
    return users.map((user) => ({
      ...user,
      roles: allRoles
        .filter((r) => r.userId === user.id)
        .map((r) => r.roleCode),
    }));
  }

  async createUser(
    dto: CreateUserDto,
    opts?: { requesterId: string; isPlatformOwner: boolean; tenantId: string },
  ): Promise<User> {
    const email = dto.email.toLowerCase();
    const existing = await this.usersRepository.findOne({ where: { email } });
    if (existing) {
      throw new BadRequestException(
        `User with email ${dto.email} already exists`,
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const created = this.usersRepository.create({
      fullName: dto.fullName,
      email,
      phone: dto.phone,
      isActive: true,
      passwordHash,
    });
    const saved = await this.usersRepository.save(created);

    if (opts && !opts.isPlatformOwner) {
      const tid = (opts.tenantId ?? '').trim();
      if (!tid || tid === 'public') {
        throw new BadRequestException(
          'Send x-tenant-id for the business when creating users as a business admin',
        );
      }
      const business = await this.businessesRepository.findOne({
        where: { tenantId: tid },
      });
      if (!business) {
        throw new NotFoundException('Business not found for this tenant');
      }
      const requesterMember = await this.membershipsRepository.findOne({
        where: { businessId: business.id, userId: opts.requesterId },
      });
      if (!requesterMember) {
        throw new ForbiddenException('You are not a member of this business');
      }
      const membership = this.membershipsRepository.create({
        businessId: business.id,
        userId: saved.id,
        membershipRole: 'staff',
      });
      await this.membershipsRepository.save(membership);
    }

    return saved;
  }

  async updateUser(
    userId: string,
    dto: UpdateUserDto,
    opts: { requesterId: string; isPlatformOwner: boolean },
  ): Promise<User> {
    await this.assertCanManageUser(
      opts.requesterId,
      userId,
      opts.isPlatformOwner,
      'update',
    );
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    if (dto.email && dto.email.toLowerCase() !== user.email.toLowerCase()) {
      const exists = await this.usersRepository.findOne({
        where: { email: dto.email.toLowerCase() },
      });
      if (exists && exists.id !== userId) {
        throw new BadRequestException(
          `User with email ${dto.email} already exists`,
        );
      }
      user.email = dto.email.toLowerCase();
    }

    if (dto.fullName !== undefined) user.fullName = dto.fullName;
    if (dto.phone !== undefined) user.phone = dto.phone;
    if (dto.profilePictureUrl !== undefined) {
      user.profilePictureUrl = dto.profilePictureUrl.trim() || null;
    }
    if (dto.password !== undefined) {
      user.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    return this.usersRepository.save(user);
  }

  async deleteUser(
    userId: string,
    opts: { requesterId: string; isPlatformOwner: boolean },
  ): Promise<{ deactivated: true; userId: string }> {
    await this.assertCanManageUser(
      opts.requesterId,
      userId,
      opts.isPlatformOwner,
      'delete',
    );
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    if (!user.isActive) {
      return { deactivated: true, userId };
    }
    user.isActive = false;
    await this.usersRepository.save(user);
    return { deactivated: true, userId };
  }

  /** Platform-owner only (enforced in controller). */
  async activateUser(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    user.isActive = true;
    await this.usersRepository.save(user);
    return this.getMe(userId);
  }

  async assertRequesterActive(userId: string): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Invalid authentication');
    }
    if (!user.isActive) {
      throw new ForbiddenException('Account is deactivated');
    }
  }

  async ensureUser(input: CreateUserDto): Promise<User> {
    const email = input.email.toLowerCase();
    const existing = await this.usersRepository.findOne({ where: { email } });
    if (!existing) {
      return this.createUser({ ...input, email });
    }

    // Backfill password if the user was created before password support was added.
    if (!existing.passwordHash) {
      existing.passwordHash = await bcrypt.hash(input.password, 10);
      return this.usersRepository.save(existing);
    }

    return existing;
  }

  async assignRole(
    userId: string,
    roleCode: SystemRole,
    opts?: { requesterId: string; isPlatformOwner: boolean; locationId?: string },
  ): Promise<UserRole> {
    if (opts) {
      await this.assertCanManageUser(
        opts.requesterId,
        userId,
        opts.isPlatformOwner,
        'update',
      );
      if (!opts.isPlatformOwner && roleCode === 'platform-owner') {
        throw new ForbiddenException('Cannot assign platform-owner role');
      }
    }

    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException(`User ${userId} does not exist`);
    }

    const role = await this.rolesRepository.findOne({
      where: { code: roleCode },
    });
    if (!role) {
      throw new BadRequestException(`Role ${roleCode} does not exist`);
    }

    let existing = await this.userRolesRepository.findOne({
      where: { userId, roleCode },
    });

    if (roleCode === 'location-admin') {
      const effectiveLoc = (opts?.locationId ?? existing?.locationId ?? '')
        .toString()
        .trim();
      if (!effectiveLoc) {
        throw new BadRequestException(
          'locationId is required when assigning location-admin',
        );
      }
    }
    
    if (existing) {
      if (opts?.locationId && existing.locationId !== opts.locationId) {
        existing.locationId = opts.locationId;
        return this.userRolesRepository.save(existing);
      }
      return existing;
    }

    const record = this.userRolesRepository.create({
      userId,
      roleCode,
      locationId: opts?.locationId,
    });
    const saved = await this.userRolesRepository.save(record);

    // If it's a location-admin, ensure they have a membership in the business that owns the location.
    if (roleCode === 'location-admin' && opts?.locationId) {
      const location = await this.locationsRepository.findOne({
        where: { id: opts.locationId },
      });
      if (location) {
        const existingMembership = await this.membershipsRepository.findOne({
          where: { userId, businessId: location.businessId },
        });
        if (!existingMembership) {
          const membership = this.membershipsRepository.create({
            businessId: location.businessId,
            userId,
            membershipRole: 'staff',
          });
          await this.membershipsRepository.save(membership);
        }
      }
    }

    return saved;
  }

  async unassignRole(
    userId: string,
    roleCode: string,
    opts?: { requesterId: string; isPlatformOwner: boolean },
  ): Promise<void> {
    if (opts) {
      await this.assertCanManageUser(
        opts.requesterId,
        userId,
        opts.isPlatformOwner,
        'update',
      );
      if (!opts.isPlatformOwner && roleCode === 'platform-owner') {
        throw new ForbiddenException('Cannot unassign platform-owner role');
      }
    }

    await this.userRolesRepository.delete({
      userId,
      roleCode: roleCode as SystemRole,
    });
  }

  async hasAnyRole(userId: string, roles: SystemRole[]): Promise<boolean> {
    const count = await this.userRolesRepository.count({
      where: roles.map((roleCode) => ({ userId, roleCode })),
    });
    return count > 0;
  }

  async getLocationAdminConstraint(userId: string): Promise<string | null> {
    const roleRows = await this.userRolesRepository.find({ where: { userId } });
    const codes = roleRows.map(r => r.roleCode);
    if (codes.includes('platform-owner') || codes.includes('business-admin')) {
      return null; // Unconstrained
    }
    const locAdmin = roleRows.find(r => r.roleCode === 'location-admin');
    if (locAdmin && locAdmin.locationId) {
      return locAdmin.locationId;
    }
    return null; // For business-staff or others, they either have no access or access is scoped by tenant.
  }

  async seedSystemRoles(): Promise<void> {
    const seeds: Role[] = [
      { code: 'platform-owner', name: 'Platform Owner', createdAt: new Date() },
      { code: 'business-admin', name: 'Business Admin', createdAt: new Date() },
      { code: 'business-staff', name: 'Business Staff', createdAt: new Date() },
      {
        code: 'customer-end-user',
        name: 'Customer / End User',
        createdAt: new Date(),
      },
      {
        code: 'location-admin',
        name: 'Location Admin',
        createdAt: new Date(),
      },
    ];

    for (const role of seeds) {
      const exists = await this.rolesRepository.findOne({
        where: { code: role.code },
      });
      if (!exists) {
        const created = this.rolesRepository.create({
          code: role.code,
          name: role.name,
        });
        try {
          await this.rolesRepository.save(created);
        } catch (err) {
          // Serverless cold starts can run in parallel. Both instances may
          // pass the `exists` check, so ignore unique constraint violations.
          if (err instanceof QueryFailedError) {
            const code = (err as any).code;
            if (code === '23505') continue; // unique_violation
          }
          throw err;
        }
      }
    }
  }
}
