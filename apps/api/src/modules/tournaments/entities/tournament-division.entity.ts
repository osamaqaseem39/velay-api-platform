import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  TournamentStatus,
  TournamentStructureType,
} from '../types/tournament.types';

@Entity({ name: 'tournament_divisions' })
export class TournamentDivision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tournamentId!: string;

  @Column({ type: 'varchar', length: 64 })
  sport!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  label?: string | null;

  @Column({ type: 'int', default: 0 })
  displayOrder!: number;

  @Column({ type: 'timestamptz', nullable: true })
  registrationOpensAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  registrationClosesAt?: Date | null;

  @Column({ type: 'int' })
  maxTeams!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  entryFeeAmount?: string | null;

  @Column({ type: 'varchar', length: 8, default: 'PKR' })
  entryFeeCurrency!: string;

  @Column({ type: 'jsonb', nullable: true })
  prizePool?: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  rules?: string | null;

  @Column({ type: 'varchar', length: 48 })
  structureType!: TournamentStructureType;

  @Column({ type: 'varchar', length: 32, default: 'draft' })
  status!: TournamentStatus;

  @Column({ type: 'uuid', nullable: true })
  currentConfigVersionId?: string | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
