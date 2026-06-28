import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';
dotenv.config();

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// SAP OData instance — reloads env on each call so nodemon restarts pick up changes
const getSapAxios = () => axios.create({
  baseURL: process.env.SAP_BASE_URL,
  auth: { username: process.env.SAP_USERNAME, password: process.env.SAP_PASSWORD },
  headers: {
    'Accept': 'application/json',
    'sap-client': process.env.SAP_CLIENT
  },
  timeout: 30000,
  httpsAgent
});

// Fetch CSRF token (required for SAP POST/PUT/PATCH)
const fetchCsrfToken = async () => {
  try {
    const res = await getSapAxios().get(
      `${process.env.SAP_ODATA_PATH}/A_PurchaseOrder`,
      {
        headers: { 'x-csrf-token': 'Fetch', 'Accept': 'application/json' },
        params: { '$top': 1 }
      }
    );
    const token = res.headers['x-csrf-token'] || '';
    if (!token) console.warn('⚠️  SAP CSRF token not received — POST operations may fail');
    return token;
  } catch (err) {
    console.error(`❌ SAP CSRF token fetch failed: ${err.message}`);
    return '';
  }
};

// Parse SAP OData JSON response (handles both v2 envelope and plain)
const parseSapResponse = (data) => {
  if (data?.d) return data.d;
  return data;
};

// Fetch PO details from SAP OData
export const fetchPOFromSAP = async (poNumber) => {
  try {
    const sapAxios = getSapAxios();
    const response = await sapAxios.get(
      `${process.env.SAP_ODATA_PATH}/A_PurchaseOrder('${poNumber}')`,
      {
        params: {
          '$expand': 'to_PurchaseOrderItem',
          '$format': 'json'
        }
      }
    );
    const data = parseSapResponse(response.data);
    console.log(`✅ SAP PO fetched: ${poNumber}`);
    return { success: true, data, isMock: false };
  } catch (error) {
    const status = error.response?.status;
    if (status === 404) {
      console.warn(`⚠️  PO ${poNumber} not found in SAP. Using mock data.`);
    } else {
      console.warn(`⚠️  SAP PO fetch failed [${status || error.code}]: ${error.message}. Using mock data.`);
    }
    return { success: true, data: getMockPOData(poNumber), isMock: true };
  }
};

// Post GRN to SAP
export const postGRNToSAP = async (grnData) => {
  try {
    const csrfToken = await fetchCsrfToken();
    const sapAxios = getSapAxios();
    const payload = buildGRNPayload(grnData);
    const response = await sapAxios.post(
      '/sap/opu/odata/sap/MMIM_GR_RFC_SRV/GoodsReceipts',
      payload,
      {
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );
    const doc = parseSapResponse(response.data);
    const docNumber = `${doc.MaterialDocumentYear || ''}${doc.MaterialDocument || ''}`;
    console.log(`✅ SAP GRN posted: ${docNumber}`);
    return { success: true, documentNumber: docNumber, isMock: false };
  } catch (error) {
    const sapErrBody = error.response?.data?.error?.message?.value
      || JSON.stringify(error.response?.data)
      || error.message;
    console.error(`❌ SAP GRN post failed [${error.response?.status || error.code}]: ${sapErrBody}`);
    const mockGRN = `5000${Math.floor(10000000 + Math.random() * 90000000)}`;
    return { success: true, documentNumber: mockGRN, isMock: true };
  }
};

// Post IR (Invoice Receipt / Logistics Invoice Verification) to SAP
export const postIRToSAP = async (irData) => {
  try {
    const csrfToken = await fetchCsrfToken();
    const sapAxios = getSapAxios();
    const payload = buildIRPayload(irData);
    const response = await sapAxios.post(
      '/sap/opu/odata/sap/API_LOGISTIC_INVOICE_SRV/A_SuplrInvcHeaderPart',
      payload,
      {
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );
    const doc = parseSapResponse(response.data);
    const docNumber = doc.InvoiceDocument || doc.SupplierInvoice || doc.AccountingDocument || doc.DocumentNumber;
    console.log(`✅ SAP IR posted: ${docNumber}`);
    return { success: true, documentNumber: docNumber, isMock: false };
  } catch (error) {
    const sapErrBody = error.response?.data?.error?.message?.value
      || JSON.stringify(error.response?.data)
      || error.message;
    console.error(`❌ SAP IR post failed [${error.response?.status || error.code}]: ${sapErrBody}`);
    const mockIR = `5100${Math.floor(10000000 + Math.random() * 90000000)}`;
    return { success: true, documentNumber: mockIR, isMock: true };
  }
};

// Post Credit Memo Request to SAP
export const postCreditMemoToSAP = async (creditMemoData) => {
  try {
    const csrfToken = await fetchCsrfToken();
    const sapAxios = getSapAxios();
    const payload = {
      InvoiceDocumentType: 'KG',
      CompanyCode: creditMemoData.companyCode || process.env.SAP_COMPANY_CODE || '1000',
      DocumentDate: toSapDate(creditMemoData.invoiceDate),
      PostingDate: toSapDate(creditMemoData.invoiceDate),
      DocumentCurrency: creditMemoData.currency || 'INR',
      InvoiceGrossAmount: String(parseFloat(creditMemoData.amount || 0).toFixed(2)),
      DocumentHeaderText: `Credit Memo for GRN ${creditMemoData.grnNumber} - ${creditMemoData.reason || 'Quality rejection'}`,
      to_SuplrInvcItemPurchaseOrder: {
        results: [{
          SupplierInvoiceItem: '1',
          PurchaseOrder: creditMemoData.poNumber,
          PurchaseOrderItem: creditMemoData.lineItem || '00010',
          Plant: creditMemoData.plant || '1000',
          SupplierInvoiceItemAmount: String(parseFloat(creditMemoData.amount || 0).toFixed(2)),
          QuantityInPurchaseOrderUnit: String(creditMemoData.quantity || 1),
          DocumentCurrency: creditMemoData.currency || 'INR'
        }]
      }
    };
    const response = await sapAxios.post(
      '/sap/opu/odata/sap/API_LOGISTIC_INVOICE_SRV/A_SuplrInvcHeaderPart',
      payload,
      { headers: { 'x-csrf-token': csrfToken, 'Content-Type': 'application/json', 'Accept': 'application/json' } }
    );
    const doc = parseSapResponse(response.data);
    const docNumber = doc.InvoiceDocument || doc.SupplierInvoice || doc.DocumentNumber;
    console.log(`✅ SAP Credit Memo posted: ${docNumber}`);
    return { success: true, documentNumber: docNumber, isMock: false };
  } catch (error) {
    const sapErrBody = error.response?.data?.error?.message?.value
      || JSON.stringify(error.response?.data)
      || error.message;
    console.error(`❌ SAP Credit Memo failed [${error.response?.status || error.code}]: ${sapErrBody}`);
    const mockCM = `CM${Math.floor(1000000 + Math.random() * 9000000)}`;
    return { success: true, documentNumber: mockCM, isMock: true };
  }
};

const toSapDate = (date) => {
  const ts = date ? new Date(date).getTime() : Date.now();
  return `/Date(${isNaN(ts) ? Date.now() : ts})/`;
};

const buildGRNPayload = (data) => ({
  GoodsMovementCode: '01',
  DocumentDate: toSapDate(data.invoiceDate),
  PostingDate: toSapDate(data.invoiceDate),
  MaterialDocumentHeaderText: `GRN for PO ${data.poNumber}`,
  to_MaterialDocumentItem: {
    results: [{
      Material: data.materialNumber,
      Plant: data.plant,
      StorageLocation: data.storageLocation || '0001',
      Quantity: String(data.quantity),
      QuantityInEntryUnit: String(data.quantity),
      EntryUnit: data.uom || 'EA',
      GoodsMovementType: '101',
      PurchaseOrder: data.poNumber,
      PurchaseOrderItem: data.lineItem || '00010'
    }]
  }
});

const buildIRPayload = (data) => ({
  InvoiceDocumentType: 'RE',
  DocumentDate: toSapDate(data.invoiceDate),
  PostingDate: toSapDate(data.invoiceDate),
  CompanyCode: data.companyCode || process.env.SAP_COMPANY_CODE || '1000',
  DocumentCurrency: data.currency || 'INR',
  InvoiceGrossAmount: String(parseFloat(data.amount || 0).toFixed(2)),
  DocumentHeaderText: `IR for GRN ${data.grnNumber}`,
  to_SuplrInvcItemPurchaseOrder: {
    results: [{
      SupplierInvoiceItem: '1',
      PurchaseOrder: data.poNumber,
      PurchaseOrderItem: data.lineItem || '00010',
      Plant: data.plant || '1000',
      SupplierInvoiceItemAmount: String(parseFloat(data.amount || 0).toFixed(2)),
      QuantityInPurchaseOrderUnit: String(data.quantity || 1),
      DocumentCurrency: data.currency || 'INR'
    }]
  }
});

const getMockPOData = (poNumber) => ({
  PurchaseOrder: poNumber,
  PurchaseOrderType: 'NB',
  Supplier: 'VEND001',
  PurchasingOrganization: '1000',
  PurchasingGroup: '001',
  CompanyCode: '1000',
  to_PurchaseOrderItem: {
    results: [
      {
        PurchaseOrder: poNumber, PurchaseOrderItem: '00010',
        Material: 'MAT-001', PurchaseOrderItemText: 'Steel Bolts M10',
        Plant: '1000', StorageLocation: '0001',
        OrderQuantity: '100', PurchaseOrderQuantityUnit: 'EA',
        NetPriceAmount: '2.50', DocumentCurrency: 'USD'
      },
      {
        PurchaseOrder: poNumber, PurchaseOrderItem: '00020',
        Material: 'MAT-002', PurchaseOrderItemText: 'Aluminum Plates 5mm',
        Plant: '1000', StorageLocation: '0001',
        OrderQuantity: '50', PurchaseOrderQuantityUnit: 'KG',
        NetPriceAmount: '8.00', DocumentCurrency: 'USD'
      }
    ]
  }
});

export default { fetchPOFromSAP, postGRNToSAP, postIRToSAP, postCreditMemoToSAP };
