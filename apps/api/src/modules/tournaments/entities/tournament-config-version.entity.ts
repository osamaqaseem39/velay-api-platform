import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  SeedingMode,
  StandingsRules,
  StructureBlueprint,
} from '../types/tournament.types';

@Entity({ name: 'tournament_config_versions' })
export class TournamentConfigVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  divisionId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'jsonb' })
  structureBlueprint!: StructureBlueprint;

  @Column({ type: 'jsonb' })
  standingsRules!: StandingsRules;

  @Column({ type: 'varchar', length: 24, default: 'ranking' })
  seedingMode!: SeedingMode;

  @Column({ type: 'jsonb', default: [] })
  advancementRules!: Record<string, unknown>[];

  @Column({ type: 'timestamptz', nullable: true })
  lockedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  lockedByUserId?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
