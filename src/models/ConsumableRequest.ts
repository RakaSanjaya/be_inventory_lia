import mongoose, { Schema, Document } from 'mongoose';

export interface IConsumableRequest extends Document {
  requester: mongoose.Types.ObjectId;
  items: {
    item: mongoose.Types.ObjectId;
    quantity: number;
  }[];
  purpose: string;
  status: 'pending' | 'approved' | 'rejected' | 'fulfilled';
  approvedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  fulfilledAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const consumableRequestSchema = new Schema<IConsumableRequest>({
  requester: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  items: [{
    item: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
    quantity: { type: Number, required: true, min: 1 },
  }],
  purpose: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'fulfilled'],
    default: 'pending',
  },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt: { type: Date },
  fulfilledAt: { type: Date },
  notes: { type: String },
}, { timestamps: true });

export const ConsumableRequest = mongoose.model<IConsumableRequest>('ConsumableRequest', consumableRequestSchema);
