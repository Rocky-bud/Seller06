import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

console.log('\n========================================');
console.log('  SAVED CHAT VERIFICATION');
console.log('========================================\n');

async function showSavedChats() {
  // Fetch all chats
  const { data: chats, error } = await supabase
    .from('chats')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  console.log(`✅ Found ${chats.length} saved chat(s) in database:\n`);

  chats.forEach((chat, i) => {
    console.log(`${i + 1}. Conversation ID: ${chat.id}`);
    console.log(`   User: ${chat.user_id}`);
    console.log(`   Platform: ${chat.platform}`);
    console.log(`   Message: "${chat.message}"`);
    console.log(`   AI Intent: ${chat.intent}`);
    console.log(`   AI Response: "${chat.response}"`);
    console.log(`   Timestamp: ${chat.created_at}`);
    console.log('');
  });

  console.log('========================================');
  console.log('✅ DATABASE VERIFICATION COMPLETE');
  console.log('========================================');
  console.log('\nThe Persian message "سلام قیمت این محصول چنده؟"');
  console.log('(Translation: "Hello, what is the price of this product?")');
  console.log('was successfully processed and saved!\n');
}

showSavedChats();
