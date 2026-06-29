import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { RegistrationStatus } from '../types/tournament.types';

@Entity({ name: 'tournament_registrations' })
export class TournamentRegistration {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  divisionId!: string;

  @Column({ type: 'uuid' })
  teamId!: string;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: RegistrationStatus;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  paymentStatus!: string;

  @Column({ type: 'int', nullable: true })
  waitlistPosition?: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  rejectedReason?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  idempotencyKey?: string | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
