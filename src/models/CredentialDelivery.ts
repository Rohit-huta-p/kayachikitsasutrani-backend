import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const credentialDeliverySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    // Snapshots so the list/search survive the User being removed.
    email: { type: String, required: true },
    name: { type: String, required: true },
    // AES-256-GCM parts (base64). Null once purged / retention elapsed / key absent.
    passwordCiphertext: { type: String, default: null },
    passwordIv: { type: String, default: null },
    passwordTag: { type: String, default: null },
    approvedByAdminId: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date, required: true },
    deliveredAt: { type: Date, default: null },
    revealedCount: { type: Number, default: 0 },
    lastRevealedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type CredentialDeliveryDoc = HydratedDocument<InferSchemaType<typeof credentialDeliverySchema>>;
export const CredentialDelivery = model('CredentialDelivery', credentialDeliverySchema);
