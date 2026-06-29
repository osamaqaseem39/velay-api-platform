import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'standings' })
export class Standing {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  groupId!: string;

  @Column({ type: 'uuid' })
  teamId!: string;

  @Column({ type: 'int', default: 0 })
  played!: number;

  @Column({ type: 'int', default: 0 })
  won!: number;

  @Column({ type: 'int', default: 0 })
  drawn!: number;

  @Column({ type: 'int', default: 0 })
  lost!: number;

  @Column({ type: 'int', default: 0 })
  goalsFor!: number;

  @Column({ type: 'int', default: 0 })
  goalsAgainst!: number;

  @Column({ type: 'int', default: 0 })
  points!: number;

  @Column({ type: 'int', nullable: true })
  rank?: number | null;

  @Column({ type: 'jsonb', nullable: true })
  tieBreakData?: Record<string, unknown> | null;

  @Column({ type: 'int', nullable: true })
  manualRankOverride?: number | null;
}
