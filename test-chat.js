import { processMessage, getChatHistory } from './services/aiService.js';

async function testChat() {
  console.log('Testing /api/chat endpoint logic...\n');

  const testPayload = {
    userId: 'test_user_1',
    platform: 'telegram',
    message: 'سلام قیمت این محصول چنده؟'
  };

  console.log('Sending payload:', JSON.stringify(testPayload, null, 2));

  try {
    const result = await processMessage(
      testPayload.userId,
      testPayload.platform,
      testPayload.message
    );

    console.log('\n✅ AI Response:');
    console.log(JSON.stringify(result, null, 2));

    console.log('\n📥 Fetching chat history for test_user_1...');
    const history = await getChatHistory('test_user_1');
    console.log('\n✅ Chat History:');
    console.log(JSON.stringify(history, null, 2));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

testChat();
