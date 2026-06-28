import express from 'express';
import { register, login, getMe, updateProfile, changePassword, getUsers } from '../controllers/authController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.put('/password', protect, changePassword);
router.get('/users', protect, authorize('admin', 'buyer'), getUsers);

export default router;
