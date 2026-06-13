import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

let sheetsClient = null;

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  if (!CLIENT_EMAIL || !PRIVATE_KEY) {
    console.warn('Google Sheets credentials not configured (GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY)');
    return null;
  }

  const auth = new google.auth.JWT(
    CLIENT_EMAIL,
    null,
    PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

export async function appendOrderToSheet(spreadsheetId, orderData) {
  const sheets = getSheetsClient();
  if (!sheets) {
    console.warn('Google Sheets not configured — skipping sheet append');
    return { appended: false, reason: 'not_configured' };
  }

  const targetId = spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID;
  if (!targetId) {
    console.warn('No spreadsheet ID provided — skipping sheet append');
    return { appended: false, reason: 'no_spreadsheet_id' };
  }

  const row = [
    orderData.orderId || '',
    orderData.userId || '',
    orderData.productName || '',
    orderData.quantity || '',
    orderData.totalPrice || '',
    orderData.status || '',
    orderData.timestamp || new Date().toISOString()
  ];

  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: targetId,
      range: 'Orders!A:G',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [row]
      }
    });

    console.log('Order appended to Google Sheet:', response.data.updates?.updatedRange);
    return { appended: true, range: response.data.updates?.updatedRange };
  } catch (err) {
    console.error('Error appending to Google Sheet:', err.message);
    return { appended: false, reason: err.message };
  }
}
