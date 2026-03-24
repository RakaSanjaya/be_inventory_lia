import mongoose, { Schema, Document } from "mongoose";

export interface IBorrowingItem {
  item: mongoose.Types.ObjectId;
  quantity: number;
  returnedQty: number;
  conditionOnReturn?: "good" | "fair" | "damaged";
}

export interface IBorrowing extends Document {
  borrower: mongoose.Types.ObjectId;
  items: IBorrowingItem[];
  purpose: string;
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "borrowed"
    | "returned"
    | "overdue";
  borrowDate: Date;
  expectedReturnDate: Date;
  actualReturnDate?: Date;
  approvedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  notes?: string;
  returnNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const borrowingSchema = new Schema<IBorrowing>(
  {
    borrower: { type: Schema.Types.ObjectId, ref: "User", required: true },
    items: [
      {
        item: { type: Schema.Types.ObjectId, ref: "Item", required: true },
        quantity: { type: Number, required: true, min: 1 },
        returnedQty: { type: Number, default: 0 },
        conditionOnReturn: { type: String, enum: ["good", "fair", "damaged"] },
      },
    ],
    purpose: { type: String, required: true },
    status: {
      type: String,
      enum: [
        "pending",
        "approved",
        "rejected",
        "borrowed",
        "returned",
        "overdue",
      ],
      default: "pending",
    },
    borrowDate: { type: Date, required: true },
    expectedReturnDate: { type: Date, required: true },
    actualReturnDate: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    notes: { type: String },
    returnNotes: { type: String },
  },
  { timestamps: true },
);

borrowingSchema.index({ borrower: 1, status: 1 });
borrowingSchema.index({ status: 1, createdAt: -1 });

export const Borrowing = mongoose.model<IBorrowing>(
  "Borrowing",
  borrowingSchema,
);
