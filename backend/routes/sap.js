import express from 'express';
import { fetchPODetails, postGRN, postIR, postCreditMemo } from '../controllers/sapController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/po/:poNumber', protect, fetchPODetails);
router.post('/grn/:invoiceId', protect, postGRN);
router.post('/ir/:invoiceId', protect, postIR);
router.post('/credit-memo/:invoiceId', protect, postCreditMemo);

export default router;
