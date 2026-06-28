import express from 'express';
import { getDashboardStats, getActivityFeed } from '../controllers/dashboardController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/stats', protect, getDashboardStats);
router.get('/activity', protect, getActivityFeed);

export default router;
