import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'tournament_groups' })
export class TournamentGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  stageId!: string;

  @Column({ type: 'varchar', length: 8 })
  name!: string;
}
