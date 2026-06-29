import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { StageStatus } from '../types/tournament.types';

@Entity({ name: 'tournament_stages' })
export class TournamentStage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  divisionId!: string;

  @Column({ type: 'uuid' })
  configVersionId!: string;

  @Column({ type: 'int' })
  order!: number;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 32 })
  stageType!: string;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: StageStatus;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
