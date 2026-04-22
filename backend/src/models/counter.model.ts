import { Schema, model } from 'mongoose';

/** Atomic sequence counters (e.g. sequential order invoice numbers). */
export interface CounterDoc {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterDoc>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

export const CounterModel = model<CounterDoc>('Counter', counterSchema);
