import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'tournament_fixtures' })
export class TournamentFixture {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  stageId!: string;

  @Column({ type: 'uuid', nullable: true })
  groupId?: string | null;

  @Column({ type: 'int' })
  round!: number;

  @Column({ type: 'uuid' })
  matchId!: string;
}
