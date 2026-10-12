import mongoose from 'mongoose';

const scheduledMessageSchema = new mongoose.Schema({
  name: { type: String, required: true },
  message: { type: String, required: true },
  recipientType: { type: String, enum: ['user', 'group'], required: true },
  recipientId: { type: String, required: true },
  recipientName: { type: String, required: true },
  scheduledAt: { type: Date, required: true },
  timezone: { type: String, default: 'Asia/Bangkok' },
  isActive: { type: Boolean, default: true },
  status: {
    type: String,
    enum: ['pending', 'sent', 'failed', 'uncertain'],
    default: 'pending',
  },
  executedAt: { type: Date, default: null },
  result: { type: mongoose.Schema.Types.Mixed, default: null },
  messageId: { type: String, default: null },
  createdBy: { type: String, default: 'admin' },
}, { timestamps: true });

scheduledMessageSchema.index({ isActive: 1, scheduledAt: 1 });
scheduledMessageSchema.index({ status: 1 });

const ScheduledMessage = mongoose.model('ScheduledMessage', scheduledMessageSchema);

export default ScheduledMessage;
