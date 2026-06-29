import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'bracket_nodes' })
export class BracketNode {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  stageId!: string;

  @Column({ type: 'int' })
  round!: number;

  @Column({ type: 'int' })
  slotIndex!: number;

  @Column({ type: 'uuid', nullable: true })
  parentNodeId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  teamId?: string | null;

  @Column({ type: 'boolean', default: false })
  isBye!: boolean;

  @Column({ type: 'uuid', nullable: true })
  winnerAdvancesToNodeId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  matchId?: string | null;

  @Column({ type: 'int', default: 1 })
  bracketVersion!: number;
}
