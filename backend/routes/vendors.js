import express from 'express';
import { getVendors, getVendorById, getVendorAnalytics, seedVendors } from '../controllers/vendorController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, getVendors);
router.get('/analytics', protect, getVendorAnalytics);
router.get('/:vendorCode', protect, getVendorById);
router.post('/seed', protect, seedVendors);

export default router;
