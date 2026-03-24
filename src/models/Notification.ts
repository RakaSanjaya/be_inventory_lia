import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
  user: mongoose.Types.ObjectId;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
  relatedModel?: string;
  relatedId?: mongoose.Types.ObjectId;
  isRead: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, enum: ['info', 'warning', 'success', 'error'], default: 'info' },
  relatedModel: { type: String },
  relatedId: { type: Schema.Types.ObjectId },
  isRead: { type: Boolean, default: false },
}, { timestamps: true });

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);
