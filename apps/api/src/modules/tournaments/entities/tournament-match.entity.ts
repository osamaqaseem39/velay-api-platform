import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { MatchStatus } from '../types/tournament.types';

@Entity({ name: 'tournament_matches' })
export class TournamentMatch {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  divisionId!: string;

  @Column({ type: 'uuid' })
  stageId!: string;

  @Column({ type: 'uuid', nullable: true })
  groupId?: string | null;

  @Column({ type: 'varchar', length: 24, default: 'draft' })
  status!: MatchStatus;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  venueId?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  courtKind?: string | null;

  @Column({ type: 'uuid', nullable: true })
  courtId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  homeTeamId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  awayTeamId?: string | null;

  @Column({ type: 'int', nullable: true })
  homeScore?: number | null;

  @Column({ type: 'int', nullable: true })
  awayScore?: number | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
