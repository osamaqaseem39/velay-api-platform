import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'tournament_audit_logs' })
export class TournamentAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64 })
  entityType!: string;

  @Column({ type: 'uuid' })
  entityId!: string;

  @Column({ type: 'uuid', nullable: true })
  actorId?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  actorIp?: string | null;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  beforeState?: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  afterState?: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
