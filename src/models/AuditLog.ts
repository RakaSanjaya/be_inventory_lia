import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditLog extends Document {
  user: mongoose.Types.ObjectId;
  action: string;
  targetModel: string;
  targetId: mongoose.Types.ObjectId;
  changes?: object;
  ipAddress?: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true },
  targetModel: { type: String, required: true },
  targetId: { type: Schema.Types.ObjectId, required: true },
  changes: { type: Schema.Types.Mixed },
  ipAddress: { type: String },
}, { timestamps: true });

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
