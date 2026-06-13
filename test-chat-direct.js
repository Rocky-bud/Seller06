import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function testChatInsert() {
  console.log('Testing chat insertion with correct schema...\n');

  const testData = {
    user_id: 'test_user_2',
    platform: 'telegram',
    message: 'سلام قیمت این محصول چنده؟',
    response: 'Thank you for your message! I\'m your AI assistant. How can I help you today?',
    intent: 'general'
  };

  console.log('Inserting test data:', JSON.stringify(testData, null, 2));

  try {
    const { data, error } = await supabase
      .from('chats')
      .insert([testData])
      .select();

    if (error) {
      console.error('❌ Insert error:', error);
      return;
    }

    console.log('\n✅ Successfully saved chat:');
    console.log(JSON.stringify(data, null, 2));

    console.log('\n📥 Fetching all chats for test_user_2...');
    const { data: history, error: fetchError } = await supabase
      .from('chats')
      .select('*')
      .eq('user_id', 'test_user_2')
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('❌ Fetch error:', fetchError);
      return;
    }

    console.log('\n✅ Chat History:');
    console.log(JSON.stringify(history, null, 2));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

testChatInsert();
