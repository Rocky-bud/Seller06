import dotenv from 'dotenv';
import { processMessage } from './services/aiService.js';

dotenv.config();

console.log('\n========================================');
console.log('  PHASE 3: Product Query Tests');
console.log('========================================\n');

async function testProductQueries() {
  const testCases = [
    {
      userId: 'test_user_1',
      platform: 'telegram',
      message: 'قیمت کفش ورزشی چنده؟'
    },
    {
      userId: 'test_user_2',
      platform: 'web',
      message: 'تیشرت نخ پنبه قیمتش چقدره؟'
    },
    {
      userId: 'test_user_3',
      platform: 'mobile',
      message: 'چه محصولاتی دارید؟'
    },
    {
      userId: 'test_user_4',
      platform: 'telegram',
      message: 'ساعت هوشمند'
    }
  ];

  for (const testCase of testCases) {
    console.log('User:', testCase.userId);
    console.log('Message:', testCase.message);

    try {
      const result = await processMessage(
        testCase.userId,
        testCase.platform,
        testCase.message
      );

      console.log('Intent:', result.intent);
      console.log('Response:');
      console.log(result.response);
      console.log('\n----------------------------------------\n');

    } catch (error) {
      console.error('Error:', error.message);
      console.log('\n----------------------------------------\n');
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('========================================');
  console.log('  All Product Query Tests Complete!');
  console.log('========================================\n');
}

testProductQueries();
