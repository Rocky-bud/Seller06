import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function testFetch() {
  console.log('Testing direct fetch from chats table...\n');

  try {
    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .limit(10);

    if (error) {
      console.error('❌ Fetch error:', error);
      return;
    }

    console.log('✅ Successfully fetched', data.length, 'chats:');
    console.log(JSON.stringify(data, null, 2));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

testFetch();
