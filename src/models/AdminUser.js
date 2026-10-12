import mongoose from 'mongoose';

const adminUserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  lastLogin: { type: Date, default: null },
}, { timestamps: true });

const AdminUser = mongoose.model('AdminUser', adminUserSchema);

export default AdminUser;
