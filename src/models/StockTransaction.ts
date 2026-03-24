import mongoose, { Schema, Document } from "mongoose";

export interface IStockTransaction extends Document {
  item: mongoose.Types.ObjectId;
  type:
    | "in"
    | "out"
    | "adjustment"
    | "transfer"
    | "borrow"
    | "return"
    | "consume";
  quantity: number;
  previousQty: number;
  newQty: number;
  previousAvailableQty: number;
  newAvailableQty: number;
  reason: string;
  notes?: string;
  reference?: {
    model: "Borrowing" | "ConsumableRequest";
    id: mongoose.Types.ObjectId;
  };
  fromLocation?: mongoose.Types.ObjectId;
  toLocation?: mongoose.Types.ObjectId;
  performedBy: mongoose.Types.ObjectId;
  createdAt: Date;
}

const stockTransactionSchema = new Schema<IStockTransaction>(
  {
    item: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    type: {
      type: String,
      enum: [
        "in",
        "out",
        "adjustment",
        "transfer",
        "borrow",
        "return",
        "consume",
      ],
      required: true,
    },
    quantity: { type: Number, required: true },
    previousQty: { type: Number, required: true },
    newQty: { type: Number, required: true },
    previousAvailableQty: { type: Number, required: true },
    newAvailableQty: { type: Number, required: true },
    reason: { type: String, required: true },
    notes: { type: String },
    reference: {
      model: { type: String, enum: ["Borrowing", "ConsumableRequest"] },
      id: { type: Schema.Types.ObjectId },
    },
    fromLocation: { type: Schema.Types.ObjectId, ref: "Location" },
    toLocation: { type: Schema.Types.ObjectId, ref: "Location" },
    performedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

stockTransactionSchema.index({ item: 1, createdAt: -1 });
stockTransactionSchema.index({ type: 1, createdAt: -1 });

export const StockTransaction = mongoose.model<IStockTransaction>(
  "StockTransaction",
  stockTransactionSchema,
);
