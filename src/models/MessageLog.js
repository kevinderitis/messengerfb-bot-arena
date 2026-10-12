import mongoose from 'mongoose';

const messageLogSchema = new mongoose.Schema({
  recipientId: { type: String, required: true, index: true },
  recipientName: { type: String, default: null },
  recipientType: { type: String, enum: ['user', 'group'], required: true },
  message: { type: String, required: true },
  status: {
    type: String,
    enum: ['sent', 'failed', 'uncertain'],
    required: true,
    index: true,
  },
  messageId: { type: String, default: null },
  error: { type: String, default: null },
  source: { type: String, enum: ['panel', 'api', 'scheduler'], default: 'panel' },
  sentAt: { type: Date, default: Date.now },
}, { timestamps: true });

messageLogSchema.index({ sentAt: -1 });
messageLogSchema.index({ recipientId: 1, sentAt: -1 });

const MessageLog = mongoose.model('MessageLog', messageLogSchema);

export default MessageLog;
