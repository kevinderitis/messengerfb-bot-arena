import mongoose from 'mongoose';

const messengerConversationSchema = new mongoose.Schema({
  conversationId: { type: String, default: null, index: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['user', 'group', 'unknown'], required: true, index: true },
  url: { type: String, default: null },
  lastSeenAt: { type: Date, default: null },
}, { timestamps: true });

messengerConversationSchema.index({ name: 1, type: 1 });

const MessengerConversation = mongoose.model('MessengerConversation', messengerConversationSchema);

export default MessengerConversation;
