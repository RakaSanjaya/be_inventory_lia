import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  role: 'super_admin' | 'admin' | 'staff' | 'student';
  department: string;
  phone: string;
  avatar?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['super_admin', 'admin', 'staff', 'student'], default: 'staff' },
  department: { type: String, default: '' },
  phone: { type: String, default: '' },
  avatar: { type: String },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

export const User = mongoose.model<IUser>('User', userSchema);
