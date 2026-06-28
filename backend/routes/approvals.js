import express from 'express';
import { getApprovals, getApprovalById, approveRequest, rejectRequest, getApprovalStats } from '../controllers/approvalController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, getApprovals);
router.get('/stats', protect, getApprovalStats);
router.get('/:id', protect, getApprovalById);
router.put('/:id/approve', protect, approveRequest);
router.put('/:id/reject', protect, rejectRequest);

export default router;
