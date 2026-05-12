import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../iam/entities/user.entity';
import type {
  BookingSportType,
  BookingStatus,
  PaymentMethod,
  PaymentStatus,
} from '../types/booking.types';
import { BookingItem } from './booking-item.entity';

@Entity({ name: 'bookings' })
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Tenant scope. API `arenaId` is the business location from the booking's first court when available. */
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 16 })
  sportType!: BookingSportType;

  @Column({ type: 'date' })
  bookingDate!: string;

  /** First active item start (HH:mm); whole-session wall clock, not a single segment. */
  @Column({ type: 'varchar', length: 5, nullable: true })
  startTime!: string | null;

  /** Last active item end (HH:mm); can be earlier on the clock than startTime when play crosses midnight. */
  @Column({ type: 'varchar', length: 5, nullable: true })
  endTime!: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  subTotal!: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: '0' })
  discount!: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: '0' })
  tax!: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  totalAmount!: string;

  @Column({
    name: 'paid_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: '0',
  })
  paidAmount!: string;

  @Column({ type: 'varchar', length: 16 })
  paymentStatus!: PaymentStatus;

  @Column({ type: 'varchar', length: 16 })
  paymentMethod!: PaymentMethod;

  @Column({ type: 'varchar', length: 120, nullable: true })
  transactionId?: string;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt?: Date;

  @Column({ type: 'varchar', length: 20 })
  bookingStatus!: BookingStatus;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'text', nullable: true })
  cancellationReason?: string;

  @OneToMany(() => BookingItem, (item) => item.booking, { cascade: true })
  items!: BookingItem[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
