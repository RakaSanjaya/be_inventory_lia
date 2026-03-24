import mongoose, { Schema, Document } from 'mongoose';

export interface IItem extends Document {
  code: string;
  name: string;
  description?: string;
  category: mongoose.Types.ObjectId;
  type: 'returnable' | 'consumable';
  quantity: number;
  availableQty: number;
  minStock?: number;
  location: mongoose.Types.ObjectId;
  condition: 'good' | 'fair' | 'damaged' | 'under_repair';
  image?: string;
  acquisitionDate?: Date;
  price?: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const itemSchema = new Schema<IItem>({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: { type: String },
  category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
  type: { type: String, enum: ['returnable', 'consumable'], required: true },
  quantity: { type: Number, required: true, min: 0 },
  availableQty: { type: Number, required: true, min: 0 },
  minStock: { type: Number, default: 0 },
  location: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
  condition: { type: String, enum: ['good', 'fair', 'damaged', 'under_repair'], default: 'good' },
  image: { type: String },
  acquisitionDate: { type: Date },
  price: { type: Number },
  notes: { type: String },
}, { timestamps: true });

export const Item = mongoose.model<IItem>('Item', itemSchema);
