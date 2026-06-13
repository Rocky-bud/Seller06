import { appendOrderToSheet } from './services/sheetsService.js';
import dotenv from 'dotenv';

dotenv.config();

async function testSheetsConnection() {
  console.log('=== Google Sheets Integration Test ===\n');

  // Check environment variables
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  console.log('Environment variable checks:');
  console.log(`  GOOGLE_CLIENT_EMAIL:   ${clientEmail ? `Set (${clientEmail.substring(0, 20)}...)` : 'NOT SET'}`);
  console.log(`  GOOGLE_PRIVATE_KEY:    ${privateKey ? `Set (${privateKey.substring(0, 30)}...)` : 'NOT SET'}`);
  console.log(`  GOOGLE_SPREADSHEET_ID: ${spreadsheetId ? `Set (${spreadsheetId})` : 'NOT SET'}`);

  // Validate client email format
  if (clientEmail && !clientEmail.includes('@')) {
    console.error('\nERROR: GOOGLE_CLIENT_EMAIL does not look like a valid email address.');
    console.error('  Expected format: your-service-account@your-project.iam.gserviceaccount.com');
    return;
  }

  // Validate private key format
  if (privateKey) {
    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      console.error('\nERROR: GOOGLE_PRIVATE_KEY is missing the "-----BEGIN PRIVATE KEY-----" header.');
      console.error('  Make sure you copied the full private key from the Google Cloud JSON file.');
      return;
    }
    if (!privateKey.includes('-----END PRIVATE KEY-----')) {
      console.error('\nERROR: GOOGLE_PRIVATE_KEY is missing the "-----END PRIVATE KEY-----" footer.');
      console.error('  The key may have been truncated during copy.');
      return;
    }
    // Check for escaped newlines
    const hasEscapedNewlines = privateKey.includes('\\n');
    const hasLiteralNewlines = privateKey.includes('\n');
    console.log(`  Private key newlines:  ${hasEscapedNewlines ? 'Has \\n sequences' : 'No \\n sequences'}, ${hasLiteralNewlines ? 'Has literal newlines' : 'No literal newlines'}`);
    if (!hasEscapedNewlines && !hasLiteralNewlines) {
      console.error('\nWARNING: GOOGLE_PRIVATE_KEY appears to have no newline characters.');
      console.error('  The key should contain newline characters (either literal or as \\n).');
      console.error('  If stored in .env, use \\n between key sections, e.g.:');
      console.error('    GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nMIIE...\\n-----END PRIVATE KEY-----"');
    }
  }

  if (!clientEmail || !privateKey) {
    console.error('\nMissing required credentials. Cannot test sheet connection.');
    console.error('To fix, add these to your .env file:');
    console.error('  GOOGLE_CLIENT_EMAIL=your-sa@project.iam.gserviceaccount.com');
    console.error('  GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----"');
    console.error('  GOOGLE_SPREADSHEET_ID=your-sheet-id');
    return;
  }

  // Mock order data
  const mockOrder = {
    orderId: 'test-123',
    userId: 'user-test',
    productName: 'تیشرت نخ پنبه',
    quantity: 1,
    totalPrice: 450000,
    status: 'pending',
    timestamp: new Date().toISOString()
  };

  console.log('\nAttempting to append test row to Google Sheet...');
  console.log('  Order data:', JSON.stringify(mockOrder, null, 2));

  try {
    const result = await appendOrderToSheet(spreadsheetId || null, mockOrder);

    if (result.appended) {
      console.log(`\nSUCCESS: Test row appended to sheet at range: ${result.range}`);
      console.log('Check your Google Sheet to verify the row appears in the "Orders" tab.');
    } else {
      console.error(`\nFAILED: Row was not appended. Reason: ${result.reason}`);
      if (typeof result.reason === 'string' && result.reason.includes('permission')) {
        console.error('  Tip: Make sure the service account email has Editor access to the spreadsheet.');
      }
      if (typeof result.reason === 'string' && result.reason.includes('not_found')) {
        console.error('  Tip: Verify the spreadsheet ID is correct and the sheet tab is named "Orders".');
      }
      if (typeof result.reason === 'string' && result.reason.includes('invalid')) {
        console.error('  Tip: The private key may be malformed. Check that \\n sequences are properly escaped in .env.');
      }
    }
  } catch (err) {
    console.error('\nUnexpected error during sheet test:');
    console.error(`  ${err.message}`);
    if (err.message.includes('decode') || err.message.includes('parse')) {
      console.error('  This usually means the GOOGLE_PRIVATE_KEY is malformed.');
      console.error('  Make sure newlines are represented as \\n in your .env file.');
    }
  }
}

testSheetsConnection();
