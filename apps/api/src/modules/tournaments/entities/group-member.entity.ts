import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'group_members' })
export class GroupMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  groupId!: string;

  @Column({ type: 'uuid' })
  teamId!: string;

  @Column({ type: 'int', nullable: true })
  seed?: number | null;
}
