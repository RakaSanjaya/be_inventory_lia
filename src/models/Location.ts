import mongoose, { Schema, Document } from 'mongoose';

export interface ILocation extends Document {
  building: string;
  room: string;
  shelf?: string;
  description?: string;
  createdAt: Date;
}

const locationSchema = new Schema<ILocation>({
  building: { type: String, required: true },
  room: { type: String, required: true },
  shelf: { type: String },
  description: { type: String },
}, { timestamps: true });

export const Location = mongoose.model<ILocation>('Location', locationSchema);
