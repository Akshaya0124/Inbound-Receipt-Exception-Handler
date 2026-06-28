import express from 'express';
import {
  uploadInvoice, processInvoice, getInvoices, getInvoiceById,
  updateInvoice, updateQualityStatus, extractInvoice
} from '../controllers/invoiceController.js';
import { protect } from '../middleware/auth.js';
import { uploadInvoice as multerUpload } from '../middleware/upload.js';

const router = express.Router();

router.post('/extract', protect, multerUpload.single('invoice'), extractInvoice);
router.get('/', protect, getInvoices);
router.post('/', protect, multerUpload.single('invoice'), uploadInvoice);
router.get('/:id', protect, getInvoiceById);
router.put('/:id', protect, updateInvoice);
router.post('/:id/process', protect, processInvoice);
router.put('/:id/quality', protect, updateQualityStatus);

export default router;
