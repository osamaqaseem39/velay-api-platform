import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 150 })
  fullName!: string;

  @Column({ type: 'varchar', length: 180, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  profilePictureUrl?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  passwordHash?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  passwordResetTokenHash?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  passwordResetExpiresAt?: Date | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
